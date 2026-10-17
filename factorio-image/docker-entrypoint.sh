#!/bin/sh
set -eu
exec python3 /usr/local/lib/factory-control/entrypoint.py "$@"
