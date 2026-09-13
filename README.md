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

The service checks hourly and takes a backup once a day into its own `verdict-backups`
volume, separate from `verdict-data`, so losing the database volume does not also lose its
backups. Each backup is written to a temporary file, integrity checked, and only then renamed
into place, so a crash mid backup never leaves a file that looks like a good one. The newest 7
are kept. A restarting container does not take a fresh backup on every boot, so a crash loop
cannot rotate the good ones out. Flagged hashes are never removed by the graph itself
(`recompute.py`), so for a lost or corrupted database these backups are the recovery path.
Copy them off the host as well if the host itself is at risk.

`/v1/health` reports `degraded` when the last backup failed or the newest one is more than two
days old, and `/v1/metrics` exposes `verdict_backup_newest_timestamp_seconds` for alerting.
Neither endpoint is reachable through Caddy.

```
cd service/deploy
docker compose exec verdict-service python -m verdict_service.graph.backup_cli list /data/verdict.db
docker compose exec verdict-service python -m verdict_service.graph.backup_cli create /data/verdict.db
docker compose exec verdict-service python -m verdict_service.graph.backup_cli verify /data/verdict.db
```

To restore, stop the service first. The restore refuses to run while the service holds the
database, verifies the backup and the copied file, and keeps the replaced database and its
WAL beside it as `*.pre-restore-<time>` rather than deleting them.

```
docker compose stop verdict-service
docker compose run --rm --no-deps verdict-service \
  python -m verdict_service.graph.backup_cli restore /data/verdict.db --force
docker compose start verdict-service
```

Locally, `just backups list|verify|create|restore <database>` runs the same tool.

The container runs as an unprivileged user (uid 10001) on a read only root filesystem. A
volume created by an earlier image that ran as root needs its ownership changed once:
`docker compose run --rm --user root --no-deps verdict-service chown -R 10001:10001 /data /backups`.

## Build it yourself

```
just setup
just check
```
