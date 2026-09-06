import logging

# PRIVACY.md section 3 and the /privacy page's own published claim: "our
# servers do not log IP addresses." uvicorn's access logger, left at its
# default, writes one line per request whose format starts with the
# client's address. That default is exactly what this guarantee has to
# override, and it has to happen here, in code that ships with the
# application, rather than only as a command line flag on whatever
# eventually starts it: a flag can be forgotten by a process manager, a
# container CMD, or a future deployment change; an import cannot be.
#
# This covers the application's own logging only. A reverse proxy or load
# balancer placed in front of this service can still log the client
# address at its own layer, and configuring that is the deploying
# operator's responsibility, not something this file can reach.


def configure_logging() -> None:
    logging.getLogger("uvicorn.access").disabled = True
