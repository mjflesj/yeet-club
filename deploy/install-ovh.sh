#!/usr/bin/env bash
# YEET CLUB — installation sur un VPS OVH (Ubuntu 22.04+/Debian 12+).
#
# Utilisation (en root, sur le serveur) :
#   curl -fsSL https://raw.githubusercontent.com/mjflesj/yeet-club/main/deploy/install-ovh.sh -o install-ovh.sh
#   sudo bash install-ovh.sh yeetclub.mondomaine.fr ton@email.fr
#
# Avant : le nom de domaine doit pointer vers l'adresse IP du serveur
# (enregistrement DNS de type A dans l'espace client OVH).
#
# Le script installe Node.js, nginx et un certificat HTTPS gratuit (Let's Encrypt),
# puis lance le jeu comme service qui redémarre tout seul.
# On peut le relancer sans risque pour mettre à jour.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="https://github.com/mjflesj/yeet-club.git"
DIR=/opt/yeet-club
ENV_FILE=/etc/yeet-club.env

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Utilisation : sudo bash install-ovh.sh <nom-de-domaine> <email>"
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then echo "Lance ce script avec sudo."; exit 1; fi

echo "==> Paquets système"
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ca-certificates

echo "==> Node.js"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Utilisateur et code du jeu"
id yeet >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin yeet
if [ -d "$DIR/.git" ]; then
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    echo "ARRÊT : des fichiers ont été modifiés directement dans $DIR. Envoie-les sur GitHub avant de relancer ce script."
    exit 1
  fi
  git -C "$DIR" fetch --depth 1 origin main
  git -C "$DIR" reset --hard origin/main
else
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"
npm ci --omit=dev
chown -R yeet:yeet "$DIR"

echo "==> Configuration"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<CONF
# Réglages du serveur YEET CLUB (relancer : systemctl restart yeet-club)
PORT=3000
HOST=127.0.0.1
# Version Android : empreinte SHA-256 de la clé de signature Google Play
# (Play Console → Configuration → Intégrité de l'application → Signature d'application)
ANDROID_PACKAGE=io.mjflesj.yeetclub
ANDROID_CERT_SHA256=
CONF
fi

cat > /etc/systemd/system/yeet-club.service <<UNIT
[Unit]
Description=YEET CLUB - serveur de jeu
After=network.target

[Service]
Type=simple
User=yeet
WorkingDirectory=$DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable yeet-club
systemctl restart yeet-club

echo "==> nginx"
cat > /etc/nginx/sites-available/yeet-club <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    # journaux techniques : la rotation de nginx (quotidienne, 14 fichiers) les supprime après 15 jours au plus

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;
        tcp_nodelay on;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/yeet-club /etc/nginx/sites-enabled/yeet-club
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full'
fi

echo "==> HTTPS (Let's Encrypt)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo
echo "C'est prêt : https://$DOMAIN"
echo "État du jeu : systemctl status yeet-club   ·   Journaux : journalctl -u yeet-club -f"
