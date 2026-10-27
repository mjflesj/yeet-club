#!/usr/bin/env bash
# YEET CLUB — met à jour le jeu sur le serveur avec la dernière version de GitHub.
# Utilisation : sudo bash /opt/yeet-club/deploy/update.sh
set -euo pipefail
DIR=/opt/yeet-club
git -C "$DIR" fetch --depth 1 origin main
git -C "$DIR" reset --hard origin/main
cd "$DIR" && npm ci --omit=dev
chown -R yeet:yeet "$DIR"
systemctl restart yeet-club
echo "Mis à jour : $(git -C "$DIR" log --oneline -1)"
