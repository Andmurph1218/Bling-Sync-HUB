import os
import paramiko

password = os.environ["HUB_SSH_PW"]
client_id = os.environ["BLING_CLIENT_ID"].strip()
client_secret = os.environ["BLING_CLIENT_SECRET"].strip()

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(
    "201.79.39.118",
    username="root",
    password=password,
    timeout=30,
    allow_agent=False,
    look_for_keys=False,
)
sftp = client.open_sftp()
with sftp.file("/root/bling-app.env", "w") as remote:
    remote.write(f"BLING_CLIENT_ID={client_id}\nBLING_CLIENT_SECRET={client_secret}\n")
sftp.chmod("/root/bling-app.env", 0o600)
sftp.close()

remote_script = r"""
set -euo pipefail
python3 - << 'PY'
from pathlib import Path
incoming = {}
for line in Path("/root/bling-app.env").read_text().splitlines():
    key, value = line.split("=", 1)
    incoming[key] = value
incoming["BLING_WEBHOOK_SECRET"] = incoming["BLING_CLIENT_SECRET"]
path = Path("/opt/bling-sync-hub/.env")
lines = []
seen = set()
for line in path.read_text().splitlines():
    key = line.split("=", 1)[0] if "=" in line else None
    if key in incoming:
        lines.append(f"{key}={incoming[key]}")
        seen.add(key)
    else:
        lines.append(line)
for key, value in incoming.items():
    if key not in seen:
        lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n")
path.chmod(0o600)
PY
chown blinghub:blinghub /opt/bling-sync-hub/.env
shred -u /root/bling-app.env || rm -f /root/bling-app.env
systemctl restart bling-hub-api
sleep 2
python3 - << 'PY'
from pathlib import Path
lengths = {}
for line in Path("/opt/bling-sync-hub/.env").read_text().splitlines():
    if "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.startswith("BLING_"):
        lengths[key] = len(value)
print("bling_keys", " ".join(f"{key}:{lengths[key]}" for key in sorted(lengths)))
PY
systemctl is-active bling-hub-api
curl -fsS http://127.0.0.1:3001/health
echo
echo CREDENTIALS_OK
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=60)
stdin.write(remote_script)
stdin.channel.shutdown_write()
print(stdout.read().decode()[-2000:])
err = stderr.read().decode()
if err:
    print("---stderr---")
    print(err[-1500:])
print("exit", stdout.channel.recv_exit_status())
client.close()
