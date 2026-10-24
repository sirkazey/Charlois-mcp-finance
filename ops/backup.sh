#!/bin/sh
# Sauvegarde manuelle du hub : copie users.json (chiffré AES-256-GCM) depuis le volume Docker vers un dossier.
# Usage : ops/backup.sh [dossier]        (défaut : BACKUP_DIR ou ./backups)
# Variables : VOLUME=<nom du volume> si plusieurs volumes mcp-data existent sur la machine.
# Le fichier est inutilisable sans ENCRYPTION_KEY (fichier .env ou variables de la stack) : la garder À PART des sauvegardes.
# À lancer avec sudo (accès au démon Docker) depuis n'importe quel dossier, Portainer ou non.
set -eu
docker info >/dev/null 2>&1 || { echo "Docker inaccessible : lancer avec sudo (ou depuis un compte du groupe docker)." >&2; exit 1; }
DEST=${1:-${BACKUP_DIR:-./backups}}
VOL=${VOLUME:-$(docker volume ls -q --filter name=mcp-data)}
[ -n "$VOL" ] || { echo "Aucun volume mcp-data : le hub n'a jamais démarré sur cette machine." >&2; exit 1; }
[ "$(printf '%s\n' "$VOL" | wc -l)" -eq 1 ] || { echo "Plusieurs volumes trouvés : $(printf '%s ' $VOL). Relancer avec VOLUME=<nom>." >&2; exit 1; }
mkdir -p "$DEST"
STAMP=$(date +%Y-%m-%d_%H%M)
# Copie faite en root dans le conteneur (le volume appartient à l'utilisateur node, en 700), puis attribuée à l'utilisateur qui lance le script.
docker run --rm -v "$VOL:/data:ro" -v "$(cd "$DEST" && pwd):/backups" node:22-alpine \
  sh -c "[ -f /data/users.json ] || { echo 'users.json absent : aucun collaborateur connecté, rien à sauvegarder' >&2; exit 2; }; cp /data/users.json /backups/users-$STAMP.json && chown $(id -u):$(id -g) /backups/users-$STAMP.json && chmod 600 /backups/users-$STAMP.json"
[ "$(head -c 5 "$DEST/users-$STAMP.json")" = "enc1:" ] || { echo "Sauvegarde invalide : le fichier n'est pas chiffré au format attendu" >&2; exit 1; }
echo "Sauvegarde écrite : $DEST/users-$STAMP.json ($(wc -c < "$DEST/users-$STAMP.json") octets, chiffrée). Conserver ENCRYPTION_KEY séparément."
