#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <diretorio-publicado>" >&2
  exit 2
fi

source_dir="$(cd "$1" && pwd)"
root_dir="${TELAE_ROOT:-/home/usuario/apps/telae}"
release_name="${GITHUB_REF_NAME:-manual}-${GITHUB_RUN_ID:-$(date +%Y%m%d%H%M%S)}"
release_dir="$root_dir/server/releases/$release_name"
current_link="$root_dir/server/current"

mkdir -p "$release_dir" "$root_dir/data" "$root_dir/server/releases"
rsync -a --delete "$source_dir/" "$release_dir/"
ln -sfn "$release_dir" "$current_link.next"
mv -Tf "$current_link.next" "$current_link"

sudo /usr/bin/systemctl restart telae-server.service

for attempt in {1..20}; do
  if curl --fail --silent --show-error http://127.0.0.1:5015/health >/dev/null; then
    mapfile -t old_releases < <(ls -1dt "$root_dir"/server/releases/* 2>/dev/null | tail -n +6)
    if (( ${#old_releases[@]} > 0 )); then
      rm -rf -- "${old_releases[@]}"
    fi
    echo "Telae server ativo: $release_name"
    exit 0
  fi
  sleep 1
done

echo "O Telae server não respondeu ao health check após o deploy." >&2
sudo /usr/bin/systemctl --no-pager status telae-server.service || true
exit 1

