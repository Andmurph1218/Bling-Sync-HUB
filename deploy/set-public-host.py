import os
import paramiko

host_name = "hub.jhshopping.com.br"
public_base = f"https://{host_name}"
password = os.environ["HUB_SSH_PW"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("201.79.39.118", username="root", password=password, timeout=30, allow_agent=False, look_for_keys=False)

remote_script = f"""
set -euo pipefail
python3 - << 'PY'
from pathlib import Path
path = Path("/opt/bling-sync-hub/.env")
lines = []
seen = False
for line in path.read_text().splitlines():
    if line.startswith("PUBLIC_BASE_URL="):
        lines.append("PUBLIC_BASE_URL={public_base}")
        seen = True
    else:
        lines.append(line)
if not seen:
    lines.append("PUBLIC_BASE_URL={public_base}")
path.write_text("\\n".join(lines) + "\\n")
path.chmod(0o600)
PY
chown blinghub:blinghub /opt/bling-sync-hub/.env
cat > /etc/caddy/Caddyfile << 'CADDY'
{host_name} {{
	encode gzip
	reverse_proxy 127.0.0.1:3001
}}
CADDY
systemctl restart bling-hub-api
systemctl reload caddy || systemctl restart caddy
sleep 2
python3 - << 'PY'
from pathlib import Path
for line in Path("/opt/bling-sync-hub/.env").read_text().splitlines():
    if line.startswith("PUBLIC_BASE_URL="):
        print(line)
PY
systemctl is-active bling-hub-api caddy
echo DOMAIN_OK
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=60)
stdin.write(remote_script)
stdin.channel.shutdown_write()
print(stdout.read().decode()[-2000:])
err = stderr.read().decode()
if err:
    print("---stderr---")
    print(err[-2000:])
print("exit", stdout.channel.recv_exit_status())
client.close()
