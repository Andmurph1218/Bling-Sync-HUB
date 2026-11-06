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
sudo -u postgres psql -d bling_sync_hub -c "SELECT count(*) AS depositos FROM stock_warehouses;"
sudo -u postgres psql -d bling_sync_hub -c "SELECT platform, name FROM channel_stores ORDER BY platform;"
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=20)
stdin.write(script)
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("STDERR", err[-800:])
print("exit", stdout.channel.recv_exit_status())
client.close()
