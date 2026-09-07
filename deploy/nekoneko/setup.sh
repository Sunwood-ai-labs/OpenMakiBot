#!/bin/sh
set -eu
cd "$(dirname "$0")"
command -v podman >/dev/null
command -v podman-compose >/dev/null
[ "$(podman info --format '{{.Host.Security.Rootless}}')" = true ] || { echo 'Rootless Podman is required.'; exit 1; }
systemctl --user enable --now podman.socket >/dev/null
python3 setup.py
