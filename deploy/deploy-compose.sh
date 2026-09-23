#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <release-sha>" >&2
  exit 2
fi

release_id=$1
case "$release_id" in
  ''|*[!A-Za-z0-9._-]*)
    echo "Invalid release id: $release_id" >&2
    exit 2
    ;;
esac

app_dir=${WOTA_STACK_DIR:-/opt/wota-stack}
cd "$app_dir"

if [[ ! -f .env ]]; then
  echo "Missing $app_dir/.env" >&2
  exit 2
fi

export WOTA_WEB_IMAGE="ghcr.io/spartan859/wota-arrangement-web:$release_id"
export WOTA_API_IMAGE="ghcr.io/spartan859/wota-arrangement-api:$release_id"

docker compose --profile production-mail pull
docker compose --profile production-mail up -d --remove-orphans

for attempt in {1..30}; do
  if curl --fail --silent --show-error \
      https://wota.satintin.com/healthz | grep -qx 'ok' && \
    curl --fail --silent --show-error \
      https://auth.wota.satintin.com/realms/wota/.well-known/openid-configuration \
      >/dev/null; then
    echo "Deployed $release_id"
    exit 0
  fi
  sleep 2
done

docker compose --profile production-mail ps
exit 1
