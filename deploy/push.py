import os
import paramiko

host = "201.79.39.118"
password = os.environ["HUB_SSH_PW"]
root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
tar_path = os.path.join(os.environ["TEMP"], "bling-src.tar")
script_path = os.path.join(os.path.dirname(__file__), "remote-deploy.sh")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=password, timeout=30, allow_agent=False, look_for_keys=False)
print("connected", flush=True)
sftp = client.open_sftp()
sftp.put(tar_path, "/tmp/bling-src.tar")
script = open(script_path, "rb").read().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
with sftp.file("/root/remote-deploy.sh", "w") as remote:
    remote.write(script.decode("utf-8"))
sftp.close()
print("uploaded", flush=True)
stdin, stdout, stderr = client.exec_command("bash /root/remote-deploy.sh", timeout=600)
out = stdout.read().decode()
err = stderr.read().decode()
print(out[-5000:])
print("---stderr tail---")
print(err[-4000:])
print("exit", stdout.channel.recv_exit_status())
client.close()
