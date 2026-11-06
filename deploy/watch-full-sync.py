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
systemctl is-active bling-full-sync || true
journalctl -u bling-full-sync --since '08:29:00' --no-pager | tail -n 8
ps -o etime,pcpu,pid,cmd -p $(systemctl show -p MainPID --value bling-full-sync) || true
echo '--- counts ---'
sudo -u postgres psql -d bling_sync_hub -c "SELECT count(*) AS products FROM master_products; SELECT count(*) AS variants FROM product_variants;"
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=30)
stdin.write(script)
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err.strip():
    print("STDERR", err[-800:])
print("exit", stdout.channel.recv_exit_status())
client.close()
