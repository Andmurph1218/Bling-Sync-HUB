#!/bin/bash
set -euo pipefail
tar -xf /tmp/bling-src.tar -C /tmp
rm -rf /opt/bling-sync-hub
mkdir -p /opt/bling-sync-hub
cp -a /tmp/Bling-Sync-HUB/. /opt/bling-sync-hub/
if ! id blinghub >/dev/null 2>&1; then
  useradd --system --home-dir /opt/bling-sync-hub --shell /usr/sbin/nologin blinghub
fi
DB_PASS="$(cat /root/bling-db.pass)"
gen() { openssl rand -base64 18 | tr -d '/+='; }
ADMIN_PW="$(gen)"
FISCAL1_PW="$(gen)"
FISCAL2_PW="$(gen)"
OPERATOR_PW="$(gen)"
umask 077
cat > /root/bling-initial-passwords.txt <<EOF
admin@blingsync.local ${ADMIN_PW}
fiscal1@blingsync.local ${FISCAL1_PW}
fiscal2@blingsync.local ${FISCAL2_PW}
operador@blingsync.local ${OPERATOR_PW}
EOF
cat > /opt/bling-sync-hub/.env <<EOF
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
LOG_LEVEL=info
DATABASE_URL=postgres://bling_hub:${DB_PASS}@127.0.0.1:5432/bling_sync_hub
REDIS_URL=redis://127.0.0.1:6379
SESSION_COOKIE_NAME=bling_hub_sid
SESSION_TTL_HOURS=24
SESSION_COOKIE_SECURE=true
OAUTH_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
PUBLIC_BASE_URL=https://hub.jhshopping.com.br
BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PW}
BOOTSTRAP_FISCAL1_PASSWORD=${FISCAL1_PW}
BOOTSTRAP_FISCAL2_PASSWORD=${FISCAL2_PW}
BOOTSTRAP_OPERATOR_PASSWORD=${OPERATOR_PW}
EOF
chmod 600 /opt/bling-sync-hub/.env /root/bling-initial-passwords.txt
cd /opt/bling-sync-hub
npm ci
npm run build --workspace=@bling-sync/api
node apps/api/dist/scripts/bootstrap.js
chown -R blinghub:blinghub /opt/bling-sync-hub
cat > /etc/systemd/system/bling-hub-api.service <<'UNIT'
[Unit]
Description=Bling Sync HUB API
After=network.target postgresql.service redis-server.service

[Service]
User=blinghub
Group=blinghub
WorkingDirectory=/opt/bling-sync-hub
EnvironmentFile=/opt/bling-sync-hub/.env
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/Caddyfile <<'CADDY'
hub.jhshopping.com.br {
	encode gzip
	reverse_proxy 127.0.0.1:3001
}
CADDY
systemctl daemon-reload
systemctl enable --now bling-hub-api
systemctl reload caddy || systemctl restart caddy
sleep 2
curl -fsS http://127.0.0.1:3001/health
echo
echo DEPLOY_OK
