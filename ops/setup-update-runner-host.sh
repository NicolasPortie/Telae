#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este script como root." >&2
  exit 1
fi

# Conta que opera o servidor (dona do diretório de atualizações): TELAE_OWNER=usuario ./setup-update-runner-host.sh
owner="${TELAE_OWNER:-${SUDO_USER:-}}"
if [[ -z "$owner" ]]; then
  echo "Informe a conta dona do servidor em TELAE_OWNER." >&2
  exit 1
fi

if ! getent group telae-updates >/dev/null; then
  groupadd --system telae-updates
fi
if ! id telae-runner >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/telae-runner \
    --shell /bin/bash --groups telae-updates telae-runner
fi
usermod --append --groups telae-updates "$owner"

install -d -o telae-runner -g telae-runner -m 0750 /var/lib/telae-runner/runner
install -d -o "$owner" -g telae-updates -m 2775 /var/lib/telae-updates
install -d -o "$owner" -g telae-updates -m 2775 /var/lib/telae-updates/windows

old_updates="$(getent passwd "$owner" | cut -d: -f6)/apps/telae/data/updates/windows"
if [[ -d "$old_updates" ]]; then
  rsync -a "$old_updates/" /var/lib/telae-updates/windows/
  chgrp -R telae-updates /var/lib/telae-updates/windows
  chmod -R g+rX /var/lib/telae-updates/windows
fi
chmod 2775 /var/lib/telae-updates /var/lib/telae-updates/windows

install -d -m 0755 /etc/systemd/system/telae-server.service.d
cat > /etc/systemd/system/telae-server.service.d/updates.conf <<'EOF'
[Service]
Environment=Updates__Path=/var/lib/telae-updates/windows
EOF
systemctl daemon-reload
systemctl restart telae-server.service

echo "Diretório de atualizações e conta telae-runner preparados."
