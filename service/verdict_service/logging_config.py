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
# This covers the application's own logging only. The layer in front of it
# is deploy/Caddyfile, which discards its access log and strips the client
# address before the request ever arrives here, and which
# tests/test_deploy_config.py holds to that. The two are deliberately
# independent: either one alone would still leave the address written down
# somewhere, so neither is allowed to rely on the other.


def configure_logging() -> None:
    logging.getLogger("uvicorn.access").disabled = True
