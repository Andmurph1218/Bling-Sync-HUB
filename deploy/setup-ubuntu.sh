#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get install -y ca-certificates curl gnupg ufw git postgresql postgresql-contrib redis-server debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

if ! id blinghub >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /opt/bling-sync-hub --shell /usr/sbin/nologin blinghub
fi
mkdir -p /opt/bling-sync-hub
chown blinghub:blinghub /opt/bling-sync-hub

if [[ ! -f /root/bling-db.pass ]]; then
  openssl rand -base64 24 | tr -d '/+=' | head -c 32 > /root/bling-db.pass
  chmod 600 /root/bling-db.pass
fi
DB_PASS="$(cat /root/bling-db.pass)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bling_hub') THEN
    CREATE ROLE bling_hub LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE bling_hub WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE bling_sync_hub OWNER bling_hub'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bling_sync_hub')\gexec
SQL

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "SETUP_OK node=$(node -v) caddy=$(caddy version | head -1)"
