#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this one-time installer as root." >&2
  exit 1
fi

source_dir=${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}
stack_dir=/opt/wota-stack

install -d -m 755 "$stack_dir" "$stack_dir/docker" "$stack_dir/docker/postgres"
install -m 644 "$source_dir/compose.yaml" "$stack_dir/compose.yaml"
install -m 644 "$source_dir/docker/nginx.compose.conf" "$stack_dir/docker/nginx.compose.conf"
install -m 644 "$source_dir/docker/postgres/init.sql" "$stack_dir/docker/postgres/init.sql"
install -m 755 "$source_dir/deploy/deploy-compose.sh" /usr/local/sbin/wota-compose-deploy

if [[ ! -f "$stack_dir/.env" ]]; then
  echo "Created $stack_dir. Add .env with production secrets before deployment." >&2
fi

cat > /etc/sudoers.d/wota-compose <<'EOF'
wota-deploy ALL=(root) NOPASSWD: /usr/local/sbin/wota-compose-deploy *
EOF
chmod 440 /etc/sudoers.d/wota-compose
visudo -cf /etc/sudoers.d/wota-compose

echo "Installed Wota Compose runtime in $stack_dir."
