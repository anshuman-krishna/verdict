# Verdict

Verdict is a browser extension that estimates how much of a product's review history looks
authentic, and shows an adjusted rating with the reasoning attached. Analysis runs inside
the browser, on pages the user is already viewing.

## Status

Early, but no longer empty. The rules interpreter, the local cache and history storage,
the review page fetcher, the five local signals, the panel and popup, and the optional
reviewer graph service all exist and are tested, including a gate that fails the build if
the default analysis path makes a network request.

Two things are deliberately absent, and everything downstream waits on them. The extraction
rules for Amazon are still empty, so nothing extracts from a real page yet. There is no
labelled corpus, so no model has been trained and every report resolves to "no score can be
computed yet" rather than to a number. Both are hand work, and neither is the kind of gap
code can close.

## Repository layout

```
extension/   typescript, wxt, manifest v3, chrome and firefox from one codebase
research/    python, uv managed, feature extraction and model training
service/     python, fastapi, the optional reviewer graph backend
site/        astro, static output, no client framework
```

`research/` and `extension/` implement the same scoring maths twice, once in Python and
once in TypeScript, checked against each other by a parity test over shared vectors. A
change to one side that is not mirrored in the other fails `just check`.

## Commands

```
just setup       install everything
just ext dev     extension with hot reload
just ext build   production bundle, chrome and firefox
just ext test    vitest
just py test     pytest across research and service
just py lint     ruff check and ruff format
just parity      compare the python and typescript scorers against shared vectors
just check       everything above, the gate before any commit
```

Beyond the gate:

```
just fixtures    judge the saved page corpus against the extraction criteria
just featurise   build the training corpus from labelled fixtures
just train       fit, calibrate, evaluate, and export the model
just canary      check live extraction health against the canary targets
just preflight   check the built bundle against what gets extensions removed
just release     build the zips and write the release manifest
```

## Build it yourself

```
just setup
just check
```
