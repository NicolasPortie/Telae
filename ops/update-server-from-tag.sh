#!/usr/bin/env bash
set -Eeuo pipefail

tag="${1:-}"
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "Informe uma tag de versão válida, por exemplo: v0.1.1" >&2
  exit 2
fi

root_dir="${TELAE_ROOT:-$HOME/apps/telae}"
repo_dir="${TELAE_REPO_DIR:-$root_dir/repo}"
publish_dir="$(mktemp -d)"
trap 'rm -rf "$publish_dir"' EXIT

if [[ ! -d "$repo_dir/.git" ]]; then
  git clone git@github.com:NicolasPortie/Telae.git "$repo_dir"
fi

git -C "$repo_dir" fetch origin --tags --prune
git -C "$repo_dir" checkout --detach "$tag"

dotnet restore "$repo_dir/tests/server/Telae.Server.Tests.csproj"
dotnet test "$repo_dir/tests/server/Telae.Server.Tests.csproj" -c Release --no-restore --nologo
dotnet publish "$repo_dir/apps/server/Telae.Server.csproj" -c Release --no-restore -o "$publish_dir"

GITHUB_REF_NAME="$tag" GITHUB_RUN_ID="$(date +%s)" \
  bash "$repo_dir/ops/deploy-server.sh" "$publish_dir"
