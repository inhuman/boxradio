#!/usr/bin/env bash
# One-time VPS provisioning for boxradio:
#   - nginx reverse-proxy to the Go server on :8080 (with WebSocket upgrade)
#   - Let's Encrypt TLS via certbot (http-01, auto-redirect to https)
#   - sudoers for the CI deploy user (restart boxradio, reload nginx, certbot)
#
# Connection details and domain are read from ./.env at runtime — nothing is
# printed. Required keys in .env:
#   SSH_HOST, SSH_USER, SSH_PASSWORD   root-capable SSH login to the VPS
#   DOMAIN                             boxradio public domain (DNS A → this VPS)
#   LE_EMAIL                           email for Let's Encrypt notifications
# Optional:
#   SSH_PORT     (default 22)
#   DEPLOY_USER  (default boxradio)    CI account to grant limited sudo
#
# Usage: bash deploy/remote-setup.sh
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env in $(pwd)" >&2; exit 1; }
set -a; . ./.env; set +a

: "${SSH_HOST:?SSH_HOST missing in .env}"
: "${SSH_USER:?SSH_USER missing in .env}"
: "${SSH_PASSWORD:?SSH_PASSWORD missing in .env}"
: "${DOMAIN:?DOMAIN missing in .env}"
: "${LE_EMAIL:?LE_EMAIL missing in .env}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_USER="${DEPLOY_USER:-boxradio}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/boxradio}"

export SSHPASS="$SSH_PASSWORD"

# The remote body is a QUOTED heredoc — nothing expands locally. Domain, email
# and deploy user are handed to the remote root shell as environment, so the
# password never appears and no local/remote double-expansion can occur.
sshpass -e ssh \
  -p "$SSH_PORT" \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=15 \
  "$SSH_USER@$SSH_HOST" \
  "sudo DOMAIN='$DOMAIN' LE_EMAIL='$LE_EMAIL' DEPLOY_USER='$DEPLOY_USER' DEPLOY_PATH='$DEPLOY_PATH' bash -s" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

# WebSocket upgrade map (http context)
cat > /etc/nginx/conf.d/upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF

# vhost: everything to the Go server; streams/ws not buffered.
# On an existing host this file is Certbot-managed (it holds the 443 block), so
# it must never be rewritten wholesale — only the telemetry route is inserted.
VHOST=/etc/nginx/sites-available/boxradio
if [ ! -f "$VHOST" ]; then
cat > "$VHOST" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 1h;
        proxy_buffering off;
    }
}
EOF
fi

# Exact match: only this one path reaches the collector, and only over loopback.
if ! grep -q "location = /api/telemetry" "$VHOST"; then
    BK="$VHOST.bak.$(date +%s)"
    cp -a "$VHOST" "$BK"
    python3 - "$VHOST" <<'INNER_EOF'
import sys
path = sys.argv[1]
src = open(path).read()
block = """    location = /api/telemetry {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        client_max_body_size 16k;
        proxy_read_timeout 10s;
    }

"""
i = src.find("    location / {")
if i < 0:
    sys.exit("no 'location /' block to insert before")
open(path, "w").write(src[:i] + block + src[i:])
INNER_EOF
    if ! nginx -t; then
        cp -a "$BK" "$VHOST"
        echo "vhost restored from $BK" >&2
        exit 1
    fi
fi

ln -sf /etc/nginx/sites-available/boxradio /etc/nginx/sites-enabled/boxradio
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# telemetry collector: a separate process, so the static service keeps doing no
# per-request work (constitution §IV.4)
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 "$DEPLOY_PATH/telemetry"

cat > /etc/systemd/system/boxradio-telemetry.service <<EOF
[Unit]
Description=boxradio telemetry collector
After=network.target

[Service]
Type=simple
User=$DEPLOY_USER
Group=$DEPLOY_USER
WorkingDirectory=$DEPLOY_PATH
Environment=STATIC_DIR=$DEPLOY_PATH
Environment=TELEMETRY_DIR=$DEPLOY_PATH/telemetry
Environment=TELEMETRY_ADDR=127.0.0.1:8081
ExecStart=$DEPLOY_PATH/boxradio -telemetry
Restart=always
RestartSec=2
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
# Not started here: the running binary predates -telemetry, and Restart=always
# would loop on it. The next deploy restarts the unit with the new binary.
systemctl enable boxradio-telemetry

# limited sudo for the CI deploy user
cat > /etc/sudoers.d/boxradio <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart boxradio, /usr/bin/systemctl restart boxradio-telemetry, /usr/bin/systemctl reload nginx, /usr/bin/certbot
EOF
chmod 440 /etc/sudoers.d/boxradio

# issue cert (needs DNS A -> this VPS and port 80 open); non-fatal if not ready
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL" --redirect; then
    echo "TLS issued for $DOMAIN"
    systemctl reload nginx || true
else
    echo "WARN: certbot failed — проверь, что DNS A-запись $DOMAIN указывает на этот VPS и порт 80 открыт, затем перезапусти скрипт (или re-run deploy)"
fi

echo "provision done"
REMOTE

echo "VPS provisioned for ${DOMAIN}"
