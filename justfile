set shell := ["bash", "-uc"]

setup:
    cd extension && npm install
    cd site && npm install
    cd research && uv sync
    cd service && uv sync

ext target:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension
    case "{{target}}" in
        dev) npm run dev ;;
        build) npm run build ;;
        test) npm run test ;;
        zip) npm run zip ;;
        *) echo "unknown ext target: {{target}}" >&2; exit 1 ;;
    esac

py target:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{target}}" in
        test) just _py-test ;;
        lint) just _py-lint ;;
        *) echo "unknown py target: {{target}}" >&2; exit 1 ;;
    esac

_py-test:
    #!/usr/bin/env bash
    set -uo pipefail
    for dir in research service; do
        (cd "$dir" && uv run pytest)
        code=$?
        # pytest exits 5 on zero tests
        if [ "$code" -ne 0 ] && [ "$code" -ne 5 ]; then
            exit "$code"
        fi
    done

_py-lint:
    #!/usr/bin/env bash
    set -euo pipefail
    for dir in research service; do
        (cd "$dir" && uv run ruff check . && uv run ruff format --check .)
    done

# held out, the corpus is handmade
# judge the fixture corpus against section 14
fixtures:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && VERDICT_FIXTURE_GATE=1 npx vitest run tests/fixtures.spec.ts

#   just featurise research/labels.jsonl --output research/corpus.jsonl
# build the training corpus from labelled fixtures
featurise labels *args: canary-extractor
    #!/usr/bin/env bash
    set -euo pipefail
    uv --directory research run python -m verdict_research.corpus.cli "{{labels}}" {{args}}

#   just train corpus.jsonl --features a,b,c
#   just train graph.jsonl --features ... --slot reviewerGraph
# train, calibrate, evaluate, and export model.json
train corpus *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # --directory keeps relative paths relative
    uv --directory research run python -m verdict_research.model.cli "{{corpus}}" {{args}}

# reads model.json, never writes it
# score the exported model.json against a corpus
audit corpus *args:
    #!/usr/bin/env bash
    set -euo pipefail
    uv --directory research run python -m verdict_research.model.audit_cli "{{corpus}}" {{args}}

# *args would be split into words
# restore model.json to its stated absent form
clear-model reason="no model has been trained yet":
    #!/usr/bin/env bash
    set -euo pipefail
    uv --directory research run python -c \
      "import sys; from verdict_research.model.cli import clear; raise SystemExit(clear(sys.argv[1:]))" \
      --reason "{{reason}}"

# build the extractor the canary job drives
canary-extractor:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && npm run build:canary

#   just canary research/canary-targets.json --write
# check live extraction health against the canary targets
canary targets *args: canary-extractor
    #!/usr/bin/env bash
    set -euo pipefail
    uv --directory research run python -m verdict_research.canary.cli "{{targets}}" {{args}}

# stale output fails `just check`
# regenerate the band scale the website reads
export-vocabulary:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && node scripts/export-vocabulary.mjs

# runs on the built output
# check the built bundle against what gets extensions removed
preflight: (ext "build")
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension
    node scripts/store-preflight.mjs --target chrome-mv3
    node scripts/store-preflight.mjs --target firefox-mv3

#   just sign-rules --key path/to/private-key.jwk.json
# the key never lives here
# sign the extraction rules for publishing
sign-rules *args:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && node scripts/sign-rules.mjs {{args}}

parity:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && npx vitest run tests/parity.test.ts
    cd ../research && uv run pytest tests/test_parity.py

# refuses a build over 8 mb
# build the zips and write the release manifest
release: (ext "zip")
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && node scripts/release-manifest.mjs

check: (ext "build") (ext "test") (py "lint") (py "test") parity
