#!/usr/bin/env bash
# YEET CLUB — met à jour le jeu sur le serveur avec la dernière version de GitHub.
# Utilisation : sudo bash /opt/yeet-club/deploy/update.sh
set -euo pipefail
DIR=/opt/yeet-club
# Sécurité : ne jamais écraser des modifications faites directement sur le serveur
if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
  echo "ARRÊT : des fichiers ont été modifiés directement sur le serveur :"
  git -C "$DIR" status --short --untracked-files=no
  echo "Envoie d'abord ces changements sur GitHub (git add, commit, push), sinon ils seraient perdus."
  exit 1
fi
git -C "$DIR" fetch --depth 1 origin main
git -C "$DIR" reset --hard origin/main
cd "$DIR" && npm ci --omit=dev
chown -R yeet:yeet "$DIR"
systemctl restart yeet-club
echo "Mis à jour : $(git -C "$DIR" log --oneline -1)"
