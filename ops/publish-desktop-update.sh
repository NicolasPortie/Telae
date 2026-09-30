#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <diretorio-com-instalador-e-latest.yml>" >&2
  exit 2
fi

source_dir="$(cd "$1" && pwd)"
manifest="$source_dir/latest.yml"
if [[ ! -f "$manifest" ]]; then
  echo "latest.yml não encontrado em $source_dir" >&2
  exit 2
fi

version="$(sed -n 's/^version: *//p' "$manifest" | head -n 1 | tr -d '\r\"\047')"
filename="$(sed -n 's/^[[:space:]]*-[[:space:]]*url: *//p' "$manifest" | head -n 1 | tr -d '\r\"\047')"
expected_hash="$(sed -n 's/^[[:space:]]*sha512: *//p' "$manifest" | head -n 1 | tr -d '\r\"\047')"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
   [[ "$filename" != "Telae-Setup-$version.exe" ]] ||
   [[ ! -f "$source_dir/$filename" ]] ||
   [[ -z "$expected_hash" ]]; then
  echo "Versão, instalador ou hash inválido em latest.yml" >&2
  exit 2
fi

actual_hash="$(openssl dgst -sha512 -binary "$source_dir/$filename" | openssl base64 -A)"
if [[ "$actual_hash" != "$expected_hash" ]]; then
  echo "O SHA-512 do instalador não corresponde ao latest.yml" >&2
  exit 2
fi

target_dir="${TELAE_UPDATES_DIR:-/var/lib/telae-updates/windows}"
mkdir -p "$target_dir"
install -m 0644 "$source_dir/$filename" "$target_dir/$filename.next"
mv -f "$target_dir/$filename.next" "$target_dir/$filename"
if [[ -f "$source_dir/$filename.blockmap" ]]; then
  install -m 0644 "$source_dir/$filename.blockmap" "$target_dir/$filename.blockmap.next"
  mv -f "$target_dir/$filename.blockmap.next" "$target_dir/$filename.blockmap"
fi
install -m 0644 "$manifest" "$target_dir/latest.yml.next"
mv -f "$target_dir/latest.yml.next" "$target_dir/latest.yml"

echo "Telae $version publicado em $target_dir"
