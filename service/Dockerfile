# python-igraph's leidenalg dependency (verdict_service/graph/community.py)
# ships prebuilt wheels for standard platforms, so no compiler toolchain
# is installed here; if a future dependency needs one, add it explicitly
# rather than reaching for a heavier base image by default.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY verdict_service ./verdict_service
RUN uv sync --frozen --no-dev --no-editable

# run from the built venv, uv run would resync dev dependencies at boot
ENV PATH="/app/.venv/bin:$PATH"

RUN groupadd --system --gid 10001 verdict \
    && useradd --system --uid 10001 --gid verdict --home-dir /app --shell /usr/sbin/nologin verdict \
    && mkdir -p /data /backups \
    && chown verdict:verdict /data /backups

EXPOSE 8000

# unset means the two graph stores live in memory and a restart forgets
# every contributed edge, which is right for a throwaway run and useless for
# a deployment: PRIVACY.md section 8 retains raw edges for ninety days, and
# a process that forgets them hourly never accumulates ninety of anything.
# Point this at a mounted volume to persist. graph/sqlite_store.py explains
# why that is one sqlite file rather than a database server.
ENV VERDICT_DATABASE_PATH=/data/verdict.db \
    VERDICT_BACKUP_DIR=/backups
VOLUME ["/data", "/backups"]

USER verdict

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/v1/health', timeout=4)"]

# PRIVACY.md section 3 and the /privacy page's own claim: "our servers do
# not log IP addresses." verdict_service/logging_config.py disables
# uvicorn's access logger in application code, so this process writes no
# request line. The reverse proxy in front of it is deploy/Caddyfile, which
# PRIVACY.md section 4 commits to publishing and which
# tests/test_deploy_config.py checks on every run.
CMD ["uvicorn", "verdict_service.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
