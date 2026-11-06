import os
import paramiko

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
files = [
    "apps/api/src/connectors/strategy/bling-erp.ts",
    "apps/api/src/connectors/strategy/types.ts",
    "apps/api/src/catalog/full-sync.ts",
    "apps/api/src/scripts/sync-full.ts",
]

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
sftp = client.open_sftp()
for relative in files:
    sftp.put(os.path.join(root, relative), f"/opt/bling-sync-hub/{relative}")
sftp.close()
script = r"""
set -euo pipefail
cd /opt/bling-sync-hub
npm run build --workspace=@bling-sync/api
chown -R blinghub:blinghub /opt/bling-sync-hub
chmod 600 /opt/bling-sync-hub/.env
systemctl restart bling-hub-api
systemctl stop bling-full-sync || true
kill 18184 || true
sleep 1
systemd-run --uid=blinghub --gid=blinghub --working-directory=/opt/bling-sync-hub --unit=bling-full-sync --collect /usr/bin/node apps/api/dist/scripts/sync-full.js 501
sleep 2
systemctl is-active bling-hub-api
systemctl is-active bling-full-sync || true
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=120)
stdin.write(script)
stdin.channel.shutdown_write()
print(stdout.read().decode()[-2000:])
err = stderr.read().decode()
if err.strip():
    print("STDERR", err[-1200:])
print("exit", stdout.channel.recv_exit_status())
client.close()
