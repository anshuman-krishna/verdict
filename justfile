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

parity:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && npx vitest run tests/parity.test.ts
    cd ../research && uv run pytest tests/test_parity.py

# SPEC.md section 14: writes the commit and the sha256 of every zip that
# SITE.md's /install page and the README both promise a release lists, and
# refuses a build over the 8 mb bundle cap. The document lands in
# extension/.output beside the zips it describes, to be published with them.
release: (ext "zip")
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension && node scripts/release-manifest.mjs

check: (ext "build") (ext "test") (py "lint") (py "test") parity
