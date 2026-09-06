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

# PRIVACY.md section 3 and the /privacy page's own claim: "our servers do
# not log IP addresses." verdict_service/logging_config.py already
# disables uvicorn's access logger in application code, so this covers
# only this process; a reverse proxy or load balancer placed in front of
# it is the deploying operator's own responsibility to configure the same
# way.
CMD ["uv", "run", "uvicorn", "verdict_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
