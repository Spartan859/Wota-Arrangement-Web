#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <site-archive.tar.gz> <release-id>" >&2
  exit 2
fi

archive=$1
release_id=$2
app_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
releases_dir="$app_dir/releases"
release_dir="$releases_dir/$release_id"
current_link="$app_dir/current"
previous_target=$(readlink "$current_link" 2>/dev/null || true)

case "$release_id" in
  ''|*[!A-Za-z0-9._-]*)
    echo "Invalid release id: $release_id" >&2
    exit 2
    ;;
esac

rollback() {
  if [[ -n "$previous_target" ]]; then
    ln -sfn "$previous_target" "$current_link"
  else
    rm -f -- "$current_link"
  fi
}
trap rollback ERR

install -d -m 755 "$releases_dir"
rm -rf -- "$release_dir"
install -d -m 755 "$release_dir"
tar -xzf "$archive" -C "$release_dir"
test -f "$release_dir/index.html"
ln -sfn "$release_dir" "$current_link"

for attempt in {1..20}; do
  if curl --fail --silent --show-error \
    --resolve wota.satintin.com:443:127.0.0.1 \
    https://wota.satintin.com/healthz | grep -qx 'ok' && \
    curl --fail --silent --show-error \
      --resolve wota.satintin.com:443:127.0.0.1 \
      https://wota.satintin.com/ | grep -Fq 'Wota · 编排工作台'; then
    rm -f -- "$archive"
    find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
      | sort -nr \
      | tail -n +6 \
      | cut -d' ' -f2- \
      | xargs -r rm -rf --
    trap - ERR
    echo "Deployed release $release_id"
    exit 0
  fi
  sleep 1
done

false
