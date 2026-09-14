# verdict

verdict is a browser extension that estimates how much of a product's review history looks
authentic, then shows you an adjusted rating with the reasoning right next to it.

all of the analysis happens inside your browser, on pages you are already looking at. there
is no account, and nothing about what you shop for leaves your machine unless you switch on
the optional reviewer network yourself.

```
  claimed  ★★★★★  4.6          adjusted  ★★★★☆  3.9
  ────────────────────────────────────────────────────
  ████████████████████████████░░░░░░    1,208 of 8,431
  kept                        excluded  reviews look inorganic

  evidence
    arrival timing          strong    bursts well above the usual rate
    duplicate text          moderate  templated phrasing across reviews
    verification            weak      unverified reviews cluster in the bursts
```

(an illustration of the panel, not real output.)

---

## where things stand

early, but no longer empty.

these parts exist and are tested:

- the rules interpreter that reads a product page
- the local cache and history storage
- the review page fetcher
- the five local signals
- the panel and popup
- the optional reviewer graph service
- a gate that fails the build if the default analysis path makes any network request

two pieces are missing on purpose, and everything downstream waits on them:

| missing | what it means today |
|---|---|
| amazon extraction rules | nothing extracts from a real page yet |
| a labelled corpus | no model has been trained, so every report says "no score can be computed yet" instead of giving a number |

both are careful hand work. writing more code will not fill either gap.

---

## how it fits together

```
  ┌──────────────────────────── your browser ────────────────────────────┐
  │                                                                      │
  │   product page                              verdict.tools            │
  │   storefront script reads reviews           history and check pages  │
  │            │                                         │               │
  │            │                              relay in the content script│
  │            ▼                                         ▼               │
  │   ┌──────────────────────────────────────────────────────────────┐   │
  │   │ background worker                                            │   │
  │   │ five local signals ──► model.json ──► report ──► local store │   │
  │   └───────────────────────────────┬──────────────────────────────┘   │
  └───────────────────────────────────┼──────────────────────────────────┘
                                      │  only after you opt in
                                      ▼
                          api.verdict.tools (reviewer graph)
```

### the repo

```
extension/   typescript, wxt, manifest v3, chrome and firefox from one codebase
research/    python, managed by uv, feature extraction and model training
service/     python, fastapi, the optional reviewer graph backend
site/        astro, static output, no client framework
schema/      constants both languages read, so neither can drift from the other
tests/       contract and parity fixtures both sides check themselves against
```

### storefronts are data, not code

`schema/sites.json` holds each storefront's hosts, product url shape and review page template.
the extension derives three things from that one file:

```
  schema/sites.json
     ├──► url parsing          (is this a product page?)
     ├──► manifest matches     (where the content script runs)
     └──► bridge allowlist     (which links the website may ask it to check)
```

adding a storefront means adding an entry there plus a rules file in
`extension/src/extract/rules/`.

### a missing signal still gets a report

some pages hide a signal. there might be no verification badges, or no review text at all.
verdict does not refuse those pages. while training, it records a quantile sketch of every
feature it fits on. when a feature is missing, it fills the gap from that sketch:

- the headline figure uses the median
- each bootstrap resample draws its own value, so the confidence interval widens by exactly
  what is unknown
- the panel names the signal it could not read

a model whose sketch does not cover its own coefficients fails `just preflight`.

### the panel never waits on the network

```
  time ──────────────────────────────────────────────────────────►

  0 ms        local signals done ──► report drawn
  400 ms      if nothing is drawn yet, say what is happening (no bare spinner)
  0 to 4 s    reviewer network lookup, jittered on purpose for k anonymity
  later       lookup lands ──► same report refined in place, labelled provisional until then
```

scoring runs in two passes over one set of cached embeddings. while the network pass is still
out, the panel says so, so a number never changes without a reason. if you close a provisional
panel, it stays closed. both service calls have time limits, so a server that accepts the
connection and then goes silent cannot freeze the report or stall the contribution queue.

### the website talks to the extension, never to a server

the history and check pages on verdict.tools do their work through the extension you already
have installed.

```
  verdict.tools page
        │  window.postMessage (same origin only)
        ▼
  relay in the extension's content script
        │  runtime message, carrying the tab's real origin
        ▼
  background worker
        ├── is the origin exactly https://verdict.tools?   no ──► refused
        └── yes ──► answer
```

- the relay makes it work in firefox, which has no `externally_connectable`, as well as in
  chromium.
- whichever path a message takes, the background worker only answers the production site.
  dev builds also match localhost, and store builds have it stripped from the manifest.
- every message is checked against the sending tab's origin, not just the manifest.
- a check only ever opens a product page. the pasted link is cut down to its path on the
  storefront's main host, so a query string, a subdomain or a sign out link never reaches the
  hidden tab.
- `extension/tests/siteBridge.spec.ts` runs the site's client against the extension's relay, so
  neither side can change the protocol on its own.

### the maths is written twice, on purpose

`research/` (python) and `extension/` (typescript) each implement the same scoring maths.
a parity test runs both against shared vectors in `tests/parity/`.

```
  tests/parity/vectors.jsonl ──┬──► python scorer     ─┐
                               └──► typescript scorer ─┴──► same numbers, or just check fails
```

---

## commands

you need node 22.18 or newer, uv, and just. docker only if you run the service.

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

beyond the gate:

```
just fixtures    judge the saved page corpus against the extraction criteria
just featurise   build the training corpus from labelled fixtures
just train       fit, calibrate, evaluate, and export the model
just audit       score the exported model against a corpus it never saw
just canary      check live extraction health against the canary targets
just preflight   check the built bundle against what gets extensions removed
just release     build the zips and write the release manifest
```

### trying the extension

```
just ext build
```

- chrome: open `chrome://extensions`, turn on developer mode, click "load unpacked" and pick
  `extension/.output/chrome-mv3`
- firefox: open `about:debugging#/runtime/this-firefox`, click "load temporary add-on" and pick
  `extension/.output/firefox-mv3/manifest.json`

or run `just ext dev`, which opens a browser with it already loaded and reloads on save.

---

## deploying the service

the service is optional. the extension works fully without it.

```
  internet ──► :80 / :443 caddy ──► verdict-service:8000
                  │                   │  (no port published of its own)
                  │                   ├── verdict-data     /data     sqlite
                  │                   └── verdict-backups  /backups  newest 7
                  │
                  └── lets through only:
                        /v1/reputation/lookup
                        /v1/graph/contribute
```

bring it up with:

```
docker compose -f service/deploy/docker-compose.yml up -d
```

`service/deploy/docker-compose.yml` runs the reviewer graph service behind the caddy config in
`service/deploy/Caddyfile`, and `service/tests/test_deploy_config.py` checks that config on
every run. the service container publishes no port of its own. caddy is the only way in, and
only to the two endpoints the caddyfile allows.

### limits on what comes in

limits apply at both layers:

| layer | limit |
|---|---|
| caddy | refuses bodies over 2 mib, drops connections that trickle headers or bodies |
| service | enforces the same 2 mib body limit itself, in case it ever runs without the proxy |
| graph | keeps at most `VERDICT_MAX_RETAINED_EDGES` edges, 2,000,000 by default |

past the edge cap, `/v1/graph/contribute` answers 503 with a `Retry-After` header. the
extension treats that as "try later", and `verdict_contributions_refused_total` counts the
refusals. expired edges are pruned after every recompute, including one that failed. the limits
both sides rely on are pinned in `tests/contract/serviceLimits.json`, and each test suite checks
its own constants against that file.

### backups

```
  every hour: is a backup due?
        │ yes, once a day
        ▼
  write to a temp file ──► integrity check ──► rename into place ──► keep newest 7
```

- backups go to their own `verdict-backups` volume, separate from `verdict-data`, so losing the
  database volume does not take the backups with it.
- a crash in the middle of a backup never leaves a file that looks like a good one.
- a restarting container does not take a fresh backup on every boot, so a crash loop cannot
  rotate the good ones out.
- the graph never removes flagged hashes by itself (`recompute.py`), so if the database is lost
  or corrupted, these backups are how you recover. copy them off the host too if the host itself
  is at risk.

`/v1/health` reports `degraded` when the last backup failed or the newest one is more than two
days old, and `/v1/metrics` exposes `verdict_backup_newest_timestamp_seconds` for alerting.
neither endpoint is reachable through caddy.

```
cd service/deploy
docker compose exec verdict-service python -m verdict_service.graph.backup_cli list /data/verdict.db
docker compose exec verdict-service python -m verdict_service.graph.backup_cli create /data/verdict.db
docker compose exec verdict-service python -m verdict_service.graph.backup_cli verify /data/verdict.db
```

### restoring

stop the service first. the restore refuses to run while the service holds the database. it
verifies both the backup and the copied file, and it keeps the replaced database and its wal
file next to it as `*.pre-restore-<time>` instead of deleting them.

```
docker compose stop verdict-service
docker compose run --rm --no-deps verdict-service \
  python -m verdict_service.graph.backup_cli restore /data/verdict.db --force
docker compose start verdict-service
```

on your own machine, `just backups list|verify|create|restore <database>` runs the same tool.

### permissions

the container runs as an unprivileged user (uid 10001) on a read only root filesystem. a volume
created by an older image that ran as root needs its ownership fixed once:

```
docker compose run --rm --user root --no-deps verdict-service chown -R 10001:10001 /data /backups
```

---

## build it yourself

```
just setup
just check
```

if both finish green, you have the same build ci produces.
