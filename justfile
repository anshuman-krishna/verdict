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
        # pytest exits 5 when it collects zero tests, which is expected
        # before any module has tests of its own
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

# SPEC.md section 14: "correct extraction on 95 percent of the fixture
# corpus across at least four locales". Held out of `just check` on purpose,
# because the corpus is hand built and an unfinished one would block every
# commit until it is complete.
#
# judge the fixture corpus against section 14
fixtures:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && VERDICT_FIXTURE_GATE=1 npx vitest run tests/fixtures.spec.ts

# PLAN.md week 4's other half: turns anshuman's labels and the saved pages
# they name into the corpus.jsonl `just train` reads. Every feature comes out
# of the shipped extractor and the shipped signals, so the corpus holds what
# the extension computes rather than a second estimate of it.
#   just featurise research/labels.jsonl --output research/corpus.jsonl
# The label file is ground truth and is written by hand. The corpus it
# produces carries features and labels only: no url, no title, no reviewer id.
#
# build the training corpus from labelled fixtures
featurise labels *args: canary-extractor
    #!/usr/bin/env bash
    set -euo pipefail
    uv --directory research run python -m verdict_research.corpus.cli "{{labels}}" {{args}}

# PLAN.md week 5 as one command: fit, calibrate on a held out slice,
# evaluate on the untouched test set, and write extension/src/score/model.json
# only if SPEC.md section 14's precision, recall, and calibration criteria
# are met. Which features the model uses is not a default, so pass them:
#   just train path/to/corpus.jsonl --features a,b,c
# `just train corpus.jsonl --list-features` prints what the corpus carries.
#
# SPEC.md 5.6's opt in model is fitted on its own corpus, the one carrying a
# flagged share, so it is a second run into the other slot rather than a
# second half of the first:
#   just train graph-corpus.jsonl --features ...,reviewerGraph.flaggedReviewShare --slot reviewerGraph
# A run writes its own slot and leaves the other exactly as it found it.
#
# train, calibrate, evaluate, and export model.json
train corpus *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # --directory rather than cd, so a relative corpus path is still
    # relative to where the command was typed
    uv --directory research run python -m verdict_research.model.cli "{{corpus}}" {{args}}

# every report path already handles the absent form as "no score can be
# computed yet".
#
# restore model.json to its stated absent form
# a named parameter, not *args: just joins *args into one unquoted string, so a multi word reason
# was being split into separate arguments and rejected
clear-model reason="no model has been trained yet":
    #!/usr/bin/env bash
    set -euo pipefail
    uv --directory research run python -c \
      "import sys; from verdict_research.model.cli import clear; raise SystemExit(clear(sys.argv[1:]))" \
      --reason "{{reason}}"

# PLAN.md week 7. Builds the shipped extractor into something node can run,
# so the python canary job drives the real interpreter rather than a second
# python copy of it. Lands in extension/.output, never in a release zip.
#
# build the extractor the canary job drives
canary-extractor:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && npm run build:canary

# fetches each target in the targets file, asks the shipped extractor what
# it finds, alerts on what changed since the last run, and writes the
# document SITE.md's /status page renders. Writes nothing without --write:
#   just canary research/canary-targets.json --write
# See research/canary-targets.example.json for the format.
#
# check live extraction health against the canary targets
canary targets *args: canary-extractor
    #!/usr/bin/env bash
    set -euo pipefail
    uv --directory research run python -m verdict_research.canary.cli "{{targets}}" {{args}}

# The band scale and the rosette's shape constants live in the extension
# and the website draws with them too. This writes them to
# site/src/data/reportVocabulary.json rather than leaving each page with its
# own copy. `just check` fails when the committed file is out of date, so
# changing a band colour and forgetting this is a failing build rather than
# a website rendering last month's palette.
#
# regenerate the band scale the website reads
export-vocabulary:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && node scripts/export-vocabulary.mjs

# Store removal is this project's main operational risk, not lawsuits.
# Reads the built bundle and refuses it if it names a host the
# manifest never declared, carries remote code, asks for a permission
# nothing justifies, or grants more of the web than it needs. Runs on the
# output, since the bundle is what gets reviewed.
#
# check the built bundle against what gets extensions removed
preflight: (ext "build")
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension
    node scripts/store-preflight.mjs --target chrome-mv3
    node scripts/store-preflight.mjs --target firefox-mv3

# SPEC.md section 9's remote rules, the path that makes a broken selector a
# same day fix instead of a store review. Signs the document the extension
# also bundles and writes the envelope the site serves. Refuses to sign
# anything the extension would reject or discard on arrival.
#   just sign-rules --key path/to/private-key.jwk.json
# The key never lives in this repository.
#
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

# SPEC.md section 14: writes the commit and the sha256 of every zip that
# SITE.md's /install page and the README both promise a release lists, and
# refuses a build over the 8 mb bundle cap. The document lands in
# extension/.output beside the zips it describes, to be published with them.
#
# build the zips and write the release manifest
release: (ext "zip")
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && node scripts/release-manifest.mjs

check: (ext "build") (ext "test") (py "lint") (py "test") parity
