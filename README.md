# Verdict

Verdict is a browser extension that estimates how much of a product's review history looks
authentic, and shows an adjusted rating with the reasoning attached. Analysis runs inside
the browser, on pages the user is already viewing.

## Status

This repository currently holds the project skeleton only: four workspaces, a build and
test pipeline, and CI. There is no extraction, no scoring, and no user interface yet.
`just check` passes with zero tests, which is expected at this stage.

## Repository layout

```
extension/   typescript, wxt, manifest v3, chrome and firefox from one codebase
research/    python, uv managed, feature extraction and model training
service/     python, fastapi, the optional reviewer graph backend, no endpoints yet
site/        astro, static output, no client framework
```

`research/` and `extension/` will implement the same scoring maths twice, once in Python
and once in TypeScript, checked against each other by a parity test. Neither side has any
scoring logic yet.

## Commands

```
just setup       install everything
just ext dev     extension with hot reload
just ext build   production bundle, chrome and firefox
just ext test    vitest
just py test     pytest across research and service
just py lint     ruff check and ruff format
just parity      compare the python and typescript scorers, nothing to compare yet
just check       everything above, the gate before any commit
```

## Build it yourself

```
just setup
just check
```

## Licence

To be decided before the first public release.
