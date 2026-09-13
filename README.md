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
schema/      constants both languages read, so neither can drift from the other
```

Which storefronts are supported is data, not code. `schema/sites.json` carries each site's
hosts, product URL shape, and review page template, and the extension derives its URL parsing,
its manifest matches, and the website bridge's allowlist from that one file. Adding a
storefront is an entry there plus a rules file in `extension/src/extract/rules/`.

A page that hides one signal still gets a report. The trainer records a quantile sketch of
every feature it fits on, so a product with no verification badges or no review text is scored
with that feature drawn from the sketch instead of being refused outright. The point estimate
takes the median; each bootstrap resample draws its own value, so the interval widens by
exactly what is unknown, and the panel names the signal it could not read. A model whose
sketch does not cover its own coefficients fails `just preflight`.

The panel never makes you wait on the network. Scoring runs in two passes over one set of
cached embeddings: the local signals produce a report immediately, and the reviewer network
lookup, which deliberately jitters up to four seconds for k anonymity, refines that report in
place when it lands. While it is outstanding the panel says so, so a figure never changes
without explanation. If nothing has been drawn within 400 ms the extension says what it is
doing rather than showing a bare spinner, and a panel closed while provisional stays closed.
Both service calls are bounded, so a server that accepts a connection and never answers
cannot wedge the report or stall the contribution queue.

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
just audit       score the exported model against a corpus it never saw
just canary      check live extraction health against the canary targets
just preflight   check the built bundle against what gets extensions removed
just release     build the zips and write the release manifest
```

## Deploying the service

`service/deploy/docker-compose.yml` brings up the reviewer graph service behind the Caddy
config `service/deploy/Caddyfile` already describes and `service/tests/test_deploy_config.py`
checks on every run: `docker compose -f service/deploy/docker-compose.yml up -d`. The service
container publishes no port of its own; Caddy is the only path in, and only to the two
endpoints the Caddyfile allows.

Once a day the service writes a timestamped snapshot of its database into a `backups/`
folder next to it in the same `verdict-data` volume, keeping the most recent 7 and pruning
older ones automatically — flagged hashes are never removed by the graph itself
(`recompute.py`), so this is the only recovery path if the volume is ever lost or corrupted.

## Build it yourself

```
just setup
just check
```
