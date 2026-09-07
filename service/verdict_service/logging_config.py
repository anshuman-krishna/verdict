import logging

# uvicorn's access log starts each line with the client address, so the /privacy page's claim has to
# override it here, in shipped code: a command line flag can be forgotten, an import cannot.
# deploy/Caddyfile is the layer in front, independently: either alone still leaves the address
# written down somewhere, so neither relies on the other


def configure_logging() -> None:
    logging.getLogger("uvicorn.access").disabled = True
