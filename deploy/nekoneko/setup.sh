#!/bin/sh
# Dedicated data and ports for the article; never reuse the live deployment.
set -eu
cd "$(dirname "$0")"
command -v podman >/dev/null
command -v podman-compose >/dev/null
[ "$(podman info --format '{{.Host.Security.Rootless}}')" = true ] || { echo 'Rootless Podman is required.'; exit 1; }
systemctl --user enable --now podman.socket >/dev/null
root="$HOME/nekoneko-guide"
if [ -d "$root" ] && [ ! -f "$root/.nekoneko-guide.json" ]; then
  echo 'Refusing an existing data directory without the guide marker.'; exit 1
fi
umask 077
mkdir -p "$root/.openmausbot"
printf '{"version":1}\n' > "$root/.nekoneko-guide.json"
env_file=../podman/.env.nekoneko
if [ ! -f "$env_file" ]; then
  cat > "$env_file" <<EOF
COMPOSE_PROJECT_NAME=nekoneko-guide
OMB_IMAGE_TAG=nekoneko-guide
OMB_DATA_ROOT=$root
PODMAN_SOCKET=/run/user/$(id -u)/podman/podman.sock
OMB_PORT=29799
OMB_WEBHOOK_PORT=29800
OMB_HTTP_PORT=29880
OMB_PUBLIC_URL=http://localhost:29880
OMB_HTTPS_HOST=https-disabled.invalid
ENGINES=@anthropic-ai/claude-code@2.1.263
EOF
fi
echo 'Prepared dedicated nekoneko-guide data. Browser: http://localhost:29880'
