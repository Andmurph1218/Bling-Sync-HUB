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
rm -f /opt/bling-sync-hub/sync-full.log
chown blinghub:blinghub /opt/bling-sync-hub
systemd-run --uid=blinghub --gid=blinghub --working-directory=/opt/bling-sync-hub --unit=bling-full-sync --collect /usr/bin/node apps/api/dist/scripts/sync-full.js
sleep 2
systemctl is-active bling-full-sync || true
journalctl -u bling-full-sync -n 20 --no-pager || true
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=40)
stdin.write(script)
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err.strip():
    print("STDERR", err[-1500:])
print("exit", stdout.channel.recv_exit_status())
client.close()
