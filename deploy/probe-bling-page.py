import os
import paramiko

probe = r"""
import { OAuthTokenManager } from '/opt/bling-sync-hub/apps/api/dist/connectors/oauth-token-manager.js';
import { refreshBlingTokenViaHttp } from '/opt/bling-sync-hub/apps/api/dist/routes/oauth.js';

const tm = new OAuthTokenManager();
const token = await tm.getValidAccessToken('bling', refreshBlingTokenViaHttp);
const list = await fetch('https://api.bling.com.br/Api/v3/produtos?pagina=501&limite=20&tipo=P', {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  signal: AbortSignal.timeout(20000),
});
const listed = await list.json();
const ids = [listed.data?.[0]?.id, listed.data?.[19]?.id, 16551690221].filter(Boolean);
for (const id of ids) {
  const started = Date.now();
  try {
    const res = await fetch(`https://api.bling.com.br/Api/v3/produtos/${id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json();
    console.log(JSON.stringify({
      id,
      status: res.status,
      ms: Date.now() - started,
      formato: body.data?.formato ?? null,
      variacoes: Array.isArray(body.data?.variacoes) ? body.data.variacoes.length : 0,
    }));
  } catch (error) {
    console.log(JSON.stringify({ id, error: error instanceof Error ? error.name : 'error', ms: Date.now() - started }));
  }
}
"""

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
with sftp.file("/tmp/probe-bling.mjs", "w") as remote:
    remote.write(probe)
sftp.close()
script = r"""
grep -n "AbortSignal" /opt/bling-sync-hub/apps/api/dist/connectors/strategy/bling-erp.js | head
systemctl stop bling-full-sync || true
cd /opt/bling-sync-hub
sudo -u blinghub node /tmp/probe-bling.mjs
rm -f /tmp/probe-bling.mjs
"""
stdin, stdout, stderr = client.exec_command("bash -s", timeout=70)
stdin.write(script)
stdin.channel.shutdown_write()
print(stdout.read().decode()[-2000:])
err = stderr.read().decode()
if err.strip():
    print("STDERR", err[-1000:])
print("exit", stdout.channel.recv_exit_status())
client.close()
