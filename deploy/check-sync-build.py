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
systemctl stop bling-full-sync || true
echo stopped
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=20)
stdin.write(script)
stdin.channel.shutdown_write()
print(stdout.read().decode())
print(stderr.read().decode()[-400:])
print("exit", stdout.channel.recv_exit_status())
client.close()
