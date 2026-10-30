#!/usr/bin/env bash
# POSIX entry point: run `./start.sh` (or bash start.sh).
# Forwards all arguments to the Node launcher (scripts/start.mjs).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/scripts/start.mjs" "$@"
