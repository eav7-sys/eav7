#!/usr/bin/env bash
# Wrapper — lógica real em bin/eav7-deploy-frontend.sh (IPs em deploy/nodes.env).
exec bash "$(cd "$(dirname "$0")" && pwd)/bin/eav7-deploy-frontend.sh" "$@"
