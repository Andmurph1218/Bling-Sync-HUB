#!/bin/bash
set -euo pipefail
APP=/opt/bling-sync-hub
rm -rf /tmp/bling-new
mkdir -p /tmp/bling-new
tar -xf /tmp/bling-src.tar -C /tmp/bling-new
cp -a /tmp/bling-new/Bling-Sync-HUB/. "$APP/"
cd "$APP"
# Cópia anterior deixou um conector duplicado. O tsc compila tudo em src.
rm -f apps/api/src/connectors/strategy/bling-erp.ts
# NODE_ENV=production no .env não pode vazar para o npm: isso omite devDependencies
# e o build/migration ficam sem tsc e tsx.
env -u NODE_ENV npm ci
env -u NODE_ENV npm run build --workspace=@bling-sync/api
env -u NODE_ENV NEXT_PUBLIC_API_URL=https://hub.jhshopping.com.br NODE_OPTIONS=--max-old-space-size=1400 npm run build --workspace=@bling-sync/web
DATABASE_URL="$(python3 - <<'PY'
from pathlib import Path
for line in Path("/opt/bling-sync-hub/.env").read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        print(line.split("=", 1)[1], end="")
        break
PY
)"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL ausente no .env" >&2
  exit 1
fi
export DATABASE_URL
npm run migrate:up
chown -R blinghub:blinghub "$APP"
chmod 600 "$APP/.env"
NEXT_BIN="$(cd "$APP" && node -e "console.log(require.resolve('next/dist/bin/next'))")"
python3 - << 'PY'
from pathlib import Path
text = Path("/opt/bling-sync-hub/.env").read_text()
needed = ("BLING_CLIENT_ID=", "BLING_CLIENT_SECRET=", "PUBLIC_BASE_URL=https://hub.jhshopping.com.br", "DATABASE_URL=")
missing = [item for item in needed if item not in text]
if missing:
    raise SystemExit("env incompleto: " + ",".join(missing))
print("env_preserved")
PY

cat > /etc/systemd/system/bling-hub-web.service <<UNIT
[Unit]
Description=Bling Sync HUB Web
After=network.target bling-hub-api.service

[Service]
User=blinghub
Group=blinghub
WorkingDirectory=/opt/bling-sync-hub/apps/web
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${NEXT_BIN} start -H 127.0.0.1 -p 3000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<'CADDY'
hub.jhshopping.com.br {
	encode gzip
	handle /api/* {
		reverse_proxy 127.0.0.1:3001
	}
	handle /auth/* {
		reverse_proxy 127.0.0.1:3001
	}
	handle /oauth/* {
		reverse_proxy 127.0.0.1:3001
	}
	handle /webhooks/* {
		reverse_proxy 127.0.0.1:3001
	}
	handle /health {
		reverse_proxy 127.0.0.1:3001
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
CADDY

systemctl daemon-reload
systemctl restart bling-hub-api
systemctl enable --now bling-hub-web
systemctl restart bling-hub-web
systemctl reload caddy || systemctl restart caddy
sleep 2
curl -fsS http://127.0.0.1:3001/health
echo
curl -fsS -o /dev/null -w "web:%{http_code}\n" http://127.0.0.1:3000/login
echo UPDATE_OK
