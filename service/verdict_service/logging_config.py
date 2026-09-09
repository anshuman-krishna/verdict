import logging


def configure_logging() -> None:
    logging.getLogger("uvicorn.access").disabled = True
