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
    # TODO: compare research/grain_research/features and extension/src/score
    # against tests/parity/vectors.jsonl once signals exist, per SPEC.md section 7
    echo "parity: no scoring signals implemented yet, nothing to compare"

check: (ext "build") (ext "test") (py "lint") (py "test") parity
