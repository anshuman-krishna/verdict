import logging

from verdict_service.logging_config import configure_logging


class TestConfigureLogging:
    def test_disables_the_uvicorn_access_logger(self):
        logger = logging.getLogger("uvicorn.access")
        logger.disabled = False
        configure_logging()
        assert logger.disabled is True

    def test_is_safe_to_call_more_than_once(self):
        configure_logging()
        configure_logging()
        assert logging.getLogger("uvicorn.access").disabled is True


def test_importing_main_disables_the_access_logger():
    # main.py calls configure_logging() at import time, so the guarantee
    # holds for anything that imports app, not only a caller that
    # remembers to invoke configure_logging() itself.
    logging.getLogger("uvicorn.access").disabled = False
    import verdict_service.main  # noqa: F401

    assert logging.getLogger("uvicorn.access").disabled is True
