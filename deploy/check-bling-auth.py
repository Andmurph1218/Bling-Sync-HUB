import os
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(
    "201.79.39.118",
    username="root",
    password=os.environ["HUB_SSH_PW"],
    timeout=25,
    allow_agent=False,
    look_for_keys=False,
)
script = r"""
set -euo pipefail
python3 - << 'PY'
from pathlib import Path
lengths = {}
for line in Path("/opt/bling-sync-hub/.env").read_text().splitlines():
    if "=" not in line or line.startswith("#"):
        continue
    key, value = line.split("=", 1)
    if key.startswith("BLING_") or key == "PUBLIC_BASE_URL":
        lengths[key] = len(value.strip())
print("env", " ".join(f"{key}:{lengths[key]}" for key in sorted(lengths)))
PY
sudo -u postgres psql -d bling_sync_hub -c "SELECT provider, expires_at, updated_at, (refresh_token_enc IS NOT NULL) AS has_refresh, (expires_at > now()) AS valid FROM oauth_tokens ORDER BY provider;"
echo '--- events ---'
sudo -u postgres psql -d bling_sync_hub -c "SELECT event_type, status, created_at FROM webhook_events WHERE source = 'bling' ORDER BY created_at DESC LIMIT 8;"
echo '--- journal ---'
journalctl -u bling-hub-api --since '45 min ago' --no-pager | grep -E 'webhook|HMAC|oauth|Falha|Erro|bling' | tail -n 30 || true
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=40)
stdin.write(script)
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("STDERR", err[-2000:])
print("exit", stdout.channel.recv_exit_status())
client.close()
