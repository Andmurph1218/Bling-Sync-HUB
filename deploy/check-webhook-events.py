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
echo '=== counts ==='
sudo -u postgres psql -d bling_sync_hub -c "SELECT source, event_type, status, count(*) FROM webhook_events GROUP BY 1,2,3 ORDER BY 1,2;"
echo '=== latest ==='
sudo -u postgres psql -d bling_sync_hub -c "SELECT event_type, status, resource_id, ignore_reason, left(error_detail, 160) AS error, created_at, processed_at, raw_payload->>'event' AS payload_event, raw_payload->'data'->'produto'->>'id' AS produto_id, left(raw_payload->'data'->'produto'->>'nome', 80) AS nome FROM webhook_events ORDER BY created_at DESC LIMIT 15;"
echo '=== catalog ==='
sudo -u postgres psql -d bling_sync_hub -c "SELECT (SELECT count(*) FROM master_products) AS products, (SELECT count(*) FROM product_variants) AS variants, (SELECT count(*) FROM stock_warehouses) AS warehouses;"
echo '=== product ==='
sudo -u postgres psql -d bling_sync_hub -c "SELECT bling_id, bling_sku, left(name, 80) AS name, catalog_status, last_bling_sync FROM master_products;"
echo '=== pending ==='
sudo -u postgres psql -d bling_sync_hub -c "SELECT platform, job_kind, priority, count(*) FROM pending_product_changes GROUP BY 1,2,3 ORDER BY 1;"
echo '=== jobs ==='
sudo -u postgres psql -d bling_sync_hub -c "SELECT status, count(*) FROM push_jobs GROUP BY 1;"
echo '=== token ==='
sudo -u postgres psql -d bling_sync_hub -c "SELECT provider, expires_at > now() AS valid, expires_at, updated_at FROM oauth_tokens ORDER BY provider;"
echo '=== caddy ==='
journalctl -u caddy --since '90 min ago' --no-pager | grep -E 'webhook|bling' | tail -n 20 || true
echo '=== api ==='
journalctl -u bling-hub-api --since '90 min ago' --no-pager | grep -Ei 'webhook|hmac|POST /webhooks' | tail -n 30 || true
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
