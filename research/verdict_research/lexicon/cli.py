import argparse
import base64
import json
import sys
from pathlib import Path

from verdict_research.features.embedding_backend import LEXICON_ARTIFACT_VERSION
from verdict_research.features.lexicon import DEFAULT_SCALE, LexiconError, parse_lexicon
from verdict_research.lexicon.source import (
    SourceError,
    artifact,
    encode,
    fit_to_budget,
    read_vectors,
)

DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[3] / "extension" / "src" / "score" / "lexicon.json"
)

ABSENT_REASON = "no word vector table has been built, so the hashed terms are what scores text"


def absent(reason: str = ABSENT_REASON) -> dict:
    return {"artifactVersion": LEXICON_ARTIFACT_VERSION, "present": False, "reason": reason}


def _identity_for(path: Path, given: str | None) -> str:
    return given if given else path.stem


def build(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="lexicon",
        description="turn a text file of word vectors into the table the extension bundles",
    )
    parser.add_argument("vectors", help="one token and its values per line, whitespace separated")
    parser.add_argument("--identity", help="what a report should name as the thing that read it")
    parser.add_argument("--max-tokens", type=int, help="keep only the first n tokens")
    parser.add_argument("--max-bytes", type=int, help="trim the table until the artifact fits")
    parser.add_argument("--scale", type=float, default=DEFAULT_SCALE)
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--write", action="store_true", help="write it, rather than report on it")
    args = parser.parse_args(argv)

    source = Path(args.vectors)
    try:
        with source.open(encoding="utf-8") as handle:
            vectors, skipped = read_vectors(handle, args.max_tokens)
    except (OSError, SourceError) as error:
        print(f"{source}: {error}", file=sys.stderr)
        return 1

    identity = _identity_for(source, args.identity)
    try:
        kept, trimmed = fit_to_budget(identity, vectors, args.max_bytes, args.scale)
        written = artifact(identity, kept, args.scale)
    except (LexiconError, SourceError) as error:
        print(str(error), file=sys.stderr)
        return 1

    text = encode(written)
    dimensions = len(next(iter(kept.values())))
    print(f"identity: {identity}")
    print(f"tokens: {len(kept)} at {dimensions} dimensions")
    print(f"unreachable or repeated tokens passed over: {skipped}")
    if trimmed:
        print(f"trimmed to fit {args.max_bytes} bytes: {trimmed} tokens dropped")
    print(f"artifact: {len(text.encode('utf-8'))} bytes")

    if not args.write:
        print()
        print("nothing written, pass --write to bundle it")
        return 0

    Path(args.output).write_text(text, encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


def clear(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lexicon-clear")
    parser.add_argument("--reason", default=ABSENT_REASON)
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args(argv)

    Path(args.output).write_text(encode(absent(args.reason)), encoding="utf-8")
    print(f"cleared {args.output}")
    return 0


def show(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lexicon-show")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args(argv)

    try:
        data = json.loads(Path(args.output).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"{args.output}: {error}", file=sys.stderr)
        return 1

    if data.get("present") is not True:
        print(f"no table bundled: {data.get('reason', 'no reason recorded')}")
        return 0

    table = parse_lexicon(base64.b64decode(data["bytes"]))
    if table is None:
        print("the bundled table does not parse, so text would score unembedded", file=sys.stderr)
        return 1
    print(f"identity: {data['identity']}")
    print(f"tokens: {table.token_count} at {table.dimensions} dimensions")
    return 0


def main(argv: list[str] | None = None) -> int:
    return build(argv)


if __name__ == "__main__":
    raise SystemExit(main())
