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
runtime_container="wota-runtime-${release_id}"
runtime_dir=$(mktemp -d /tmp/wota-runtime.XXXXXX)
compose=(docker compose --profile production-mail)
ghcr_registry=${WOTA_GHCR_REGISTRY:-ghcr.nju.edu.cn}
dockerhub_registry=${WOTA_DOCKERHUB_REGISTRY:-docker.m.daocloud.io}

cleanup() {
  docker rm --force "$runtime_container" >/dev/null 2>&1 || true
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

resolve_image() {
  local variable_name=$1
  local repository=$2
  local override=${3:-}
  local image

  if [[ -n "$override" ]]; then
    docker pull "$override"
    image=$override
  elif docker pull "$repository:$release_id"; then
    image="$repository:$release_id"
  elif [[ "$release_id" =~ ^[0-9a-fA-F]{40}$ ]] && \
    docker pull "$repository:sha-${release_id:0:7}"; then
    image="$repository:sha-${release_id:0:7}"
    echo "Using short SHA image tag for $release_id." >&2
  else
    echo "Unable to pull $repository for $release_id." >&2
    return 1
  fi

  printf -v "$variable_name" '%s' "$image"
}

resolve_image WOTA_WEB_IMAGE \
  "$ghcr_registry/spartan859/wota-arrangement-web" "${WOTA_WEB_IMAGE:-}"
export WOTA_WEB_IMAGE
resolve_image WOTA_API_IMAGE \
  "$ghcr_registry/spartan859/wota-arrangement-web-api" "${WOTA_API_IMAGE:-}"
export WOTA_API_IMAGE

cd "$app_dir"
if [[ ! -f .env ]]; then
  echo "Missing $app_dir/.env" >&2
  exit 2
fi

docker rm --force "$runtime_container" >/dev/null 2>&1 || true
docker create --name "$runtime_container" "$WOTA_API_IMAGE" >/dev/null
if docker cp "$runtime_container:/app/runtime/." "$runtime_dir/" 2>/dev/null; then
  for file in compose.yaml nginx.compose.conf postgres-init.sql wota.yaml; do
    if [[ ! -f "$runtime_dir/$file" ]]; then
      echo "Runtime image is missing $file." >&2
      exit 1
    fi
  done
  install -d -m 755 docker docker/postgres docker/authentik/blueprints
  install -m 644 "$runtime_dir/compose.yaml" compose.yaml
  install -m 644 "$runtime_dir/nginx.compose.conf" docker/nginx.compose.conf
  install -m 644 "$runtime_dir/postgres-init.sql" docker/postgres/init.sql
  install -m 644 "$runtime_dir/wota.yaml" docker/authentik/blueprints/wota.yaml
else
  echo "Image has no runtime bundle; using installed runtime files." >&2
fi

if ! "${compose[@]}" pull; then
  echo "Some Compose images could not be pulled; using cached images." >&2
fi
"${compose[@]}" config -q
"${compose[@]}" up -d --remove-orphans

for attempt in {1..60}; do
  if curl --fail --silent --show-error --max-time 10 \
      https://wota.satintin.com/healthz | grep -qx 'ok' && \
    curl --fail --silent --show-error --max-time 10 \
      https://auth.wota.satintin.com/application/o/wota/.well-known/openid-configuration \
      >/dev/null; then
    echo "Deployed $release_id"
    exit 0
  fi
  sleep 3
done

"${compose[@]}" ps
"${compose[@]}" logs --no-color --tail=200
exit 1
