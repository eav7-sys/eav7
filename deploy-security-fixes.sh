#!/usr/bin/env bash
# Encaminha ao deploy do Core.
exec bash "$(cd "$(dirname "$0")" && pwd)/bin/eav7-deploy-core.sh" "$@"
