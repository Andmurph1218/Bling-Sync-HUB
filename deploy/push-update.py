import os
import tarfile
import paramiko

host = "201.79.39.118"
password = os.environ["HUB_SSH_PW"]
root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
tar_path = os.path.join(os.environ["TEMP"], "bling-src.tar")
skip_dirs = {"node_modules", "dist", ".next", ".git"}

def should_skip(path: str) -> bool:
    name = os.path.basename(path)
    return name == ".env" or name.startswith(".env.")

with tarfile.open(tar_path, "w") as tar:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in skip_dirs]
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            if should_skip(full):
                continue
            arc = os.path.join("Bling-Sync-HUB", os.path.relpath(full, root))
            tar.add(full, arcname=arc)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username="root", password=password, timeout=30, allow_agent=False, look_for_keys=False)
sftp = client.open_sftp()
sftp.put(tar_path, "/tmp/bling-src.tar")
script = open(os.path.join(os.path.dirname(__file__), "update-hub.sh"), "rb").read().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
with sftp.file("/root/update-hub.sh", "w") as remote:
    remote.write(script.decode("utf-8"))
sftp.close()
stdin, stdout, stderr = client.exec_command("bash /root/update-hub.sh", timeout=900)
out = stdout.read().decode()
err = stderr.read().decode()
print(out[-6000:])
print("---stderr tail---")
print(err[-4000:])
print("exit", stdout.channel.recv_exit_status())
client.close()
