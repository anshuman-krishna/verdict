# python-igraph's leidenalg dependency (verdict_service/graph/community.py)
# ships prebuilt wheels for standard platforms, so no compiler toolchain
# is installed here; if a future dependency needs one, add it explicitly
# rather than reaching for a heavier base image by default.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY verdict_service ./verdict_service
RUN uv sync --frozen --no-dev

EXPOSE 8000

# unset means the two graph stores live in memory and a restart forgets
# every contributed edge, which is right for a throwaway run and useless for
# a deployment: PRIVACY.md section 8 retains raw edges for ninety days, and
# a process that forgets them hourly never accumulates ninety of anything.
# Point this at a mounted volume to persist. graph/sqlite_store.py explains
# why that is one sqlite file rather than a database server.
ENV VERDICT_DATABASE_PATH=/data/verdict.db
VOLUME ["/data"]

# PRIVACY.md section 3 and the /privacy page's own claim: "our servers do
# not log IP addresses." verdict_service/logging_config.py disables
# uvicorn's access logger in application code, so this process writes no
# request line. The reverse proxy in front of it is deploy/Caddyfile, which
# PRIVACY.md section 4 commits to publishing and which
# tests/test_deploy_config.py checks on every run.
CMD ["uv", "run", "uvicorn", "verdict_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
