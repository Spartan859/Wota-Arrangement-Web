#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <image-archive.tar.gz> <image-tag>" >&2
  exit 2
fi

archive=$1
image_tag=$2
app_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
previous_image=$(docker inspect --format '{{.Config.Image}}' wota-arrangement-web-web-1 2>/dev/null || true)

rollback() {
  if [[ -n "$previous_image" ]]; then
    echo "Health check failed; rolling back to $previous_image" >&2
    WOTA_IMAGE="$previous_image" docker compose --project-directory "$app_dir" -f "$app_dir/compose.yaml" up -d --force-recreate
  fi
}
trap rollback ERR

gzip -dc "$archive" | docker load
WOTA_IMAGE="$image_tag" docker compose --project-directory "$app_dir" -f "$app_dir/compose.yaml" up -d --force-recreate --remove-orphans

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:18080/healthz >/dev/null; then
    rm -f -- "$archive"
    trap - ERR
    echo "Deployed $image_tag"
    exit 0
  fi
  sleep 1
done

docker compose --project-directory "$app_dir" -f "$app_dir/compose.yaml" logs --tail=100 web >&2
false
