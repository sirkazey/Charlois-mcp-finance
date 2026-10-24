#!/bin/sh
# Scénarios de sauvegarde et restauration contre une stack pré-prod DÉJÀ démarrée (docker-compose.dev.yml, hub sur HUB_URL,
# sauvegardes automatiques dans BACKUP_DIR). Joué par la CI ; exécutable sur un poste avec Docker (jamais contre la production).
# Couvre : deux sauvegardes le même jour (sans doublon si rien ne change), sidecar relancé après corruption puis perte de users.json,
# sauvegarde invalide qui ne remplace rien, restauration d'anciens et nouveaux noms de fichiers, incohérence conteneur / volume refusée,
# sauvegarde manuelle, mauvaise ENCRYPTION_KEY détectée.
set -eu
HUB_URL=${HUB_URL:-http://localhost:8080}; COMPOSE=${COMPOSE:-docker compose -f docker-compose.dev.yml}; BACKUP_DIR=${BACKUP_DIR:?dossier des sauvegardes automatiques}
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
say() { printf '\n=== %s\n' "$*"; }
count() { ls "$BACKUP_DIR"/users-*.json 2>/dev/null | wc -l; }
vol() { docker volume ls -q --filter name=mcp-data; }
sidecar() { $COMPOSE restart mcp-backup >/dev/null 2>&1; sleep 4; $COMPOSE logs --no-log-prefix --since 20s mcp-backup | tail -n 3; }
health() { for i in $(seq 1 30); do curl -fsS "$HUB_URL/health" >/dev/null 2>&1 && return 0; sleep 1; done; echo "hub injoignable" >&2; return 1; }
me() { curl -fsS -b "$1" "$HUB_URL/api/me"; }
newuser() { curl -fsS -c "$1" "$HUB_URL/api/me" >/dev/null; curl -fsS -b "$1" -X POST -H 'Content-Type: application/json' -d "{\"apiKey\":\"$2\"}" "$HUB_URL/api/myreport/apikey"; }
connected() { me "$1" | grep -q '"id":"myreport"[^}]*"connected":true'; }

say "A. état initial : un collaborateur avec un jeton MyReport"
health; newuser "$WORK/jar1" MR-MARIE-2026; connected "$WORK/jar1"
say "B. première sauvegarde automatique"
sidecar; [ "$(count)" -eq 1 ]; f1=$(ls "$BACKUP_DIR"/users-*.json); [ "$(sudo head -c 5 "$f1")" = "enc1:" ]; echo "ok : $f1"
say "C. sidecar relancé sans changement : pas de doublon le même jour"
sidecar | grep -q "inchangé"; [ "$(count)" -eq 1 ]; echo "ok : toujours 1 fichier"
say "D. second collaborateur puis sidecar relancé : deuxième sauvegarde horodatée, la première conservée"
newuser "$WORK/jar2" MR-PAUL-2026; sidecar; [ "$(count)" -eq 2 ]; [ -f "$f1" ]; f2=$(ls -t "$BACKUP_DIR"/users-*.json | head -n 1); [ "$f2" != "$f1" ]; echo "ok : $f2"
say "E. users.json corrompu dans le volume : la sauvegarde est refusée, les deux précédentes intactes"
sum_before=$(sudo cat "$f1" "$f2" | md5sum)
docker run --rm -v "$(vol):/data" node:22-alpine sh -c 'printf "{\"users\":{}}" > /data/users.json'
sidecar | grep -q "invalide"; [ "$(count)" -eq 2 ]; [ "$(sudo cat "$f1" "$f2" | md5sum)" = "$sum_before" ]; ls "$BACKUP_DIR" | grep -q '\.tmp$' && { echo "fichier temporaire resté"; exit 1; }; echo "ok"
say "F. users.json perdu : rien n'est écrit, rien n'est supprimé"
docker run --rm -v "$(vol):/data" node:22-alpine rm -f /data/users.json
sidecar | grep -q "absent"; [ "$(count)" -eq 2 ]; echo "ok"
say "G. le hub redémarre sans données : perte confirmée"
$COMPOSE restart mcp-hub >/dev/null 2>&1; health
connected "$WORK/jar1" && { echo "les données auraient dû être perdues"; exit 1; }; echo "ok : perte confirmée"
say "H. restauration depuis une sauvegarde à l'ANCIEN format de nom (users-AAAA-MM-JJ.json)"
mkdir -p "$WORK/anciennes"; sudo cp "$f2" "$WORK/anciennes/users-2026-01-01.json"; sudo chmod 644 "$WORK/anciennes/users-2026-01-01.json"
sudo ops/restore.sh "$WORK/anciennes/users-2026-01-01.json"; health; connected "$WORK/jar1"; connected "$WORK/jar2"; echo "ok : les deux collaborateurs retrouvent leur jeton"
say "I. sauvegarde manuelle (ops/backup.sh) : nom horodaté, chiffrée, lisible par l'administrateur"
sudo ops/backup.sh "$WORK/manuelles" >/dev/null; m=$(ls "$WORK/manuelles"/users-*.json); [ "$(head -c 5 "$m")" = "enc1:" ]; echo "ok : $m"
say "J. incohérence conteneur / volume : refus avant tout arrêt, données intactes"
docker volume create autre-mcp-data >/dev/null
if VOLUME=autre-mcp-data CONTAINER=mcp-hub-preprod sudo -E ops/restore.sh "$m" 2>"$WORK/err"; then echo "aurait dû refuser"; exit 1; fi
grep -q "Incohérence" "$WORK/err"; [ "$(docker inspect -f '{{.State.Running}}' mcp-hub-preprod)" = "true" ]; connected "$WORK/jar1"; echo "ok : refus, hub toujours en marche"
say "K. VOLUME explicite : le conteneur qui le monte est retrouvé seul, restauration d'un fichier au NOUVEAU format de nom"
VOLUME=$(docker volume ls -q --filter name=mcp-data | grep -v autre) sudo -E ops/restore.sh "$f2"; health; connected "$WORK/jar2"; echo "ok"
docker volume rm autre-mcp-data >/dev/null
say "L. une ENCRYPTION_KEY différente est détectée"
cp .env "$WORK/env.bak"; sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
$COMPOSE up -d mcp-hub >/dev/null 2>&1
if sudo ops/restore.sh "$m" 2>"$WORK/err"; then echo "l'erreur de clé aurait dû être signalée"; exit 1; fi
grep -q "ENCRYPTION_KEY différente" "$WORK/err"; cp "$WORK/env.bak" .env; echo "ok : erreur de clé signalée"
say "Tous les scénarios passent."
