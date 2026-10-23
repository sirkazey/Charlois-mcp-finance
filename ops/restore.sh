#!/bin/sh
# Restauration du hub : remet une sauvegarde users-*.json dans le volume Docker, hub arrêté, puis le redémarre.
# Usage : ops/restore.sh <fichier de sauvegarde>
# Variables : VOLUME=<nom du volume>, CONTAINER=<nom du conteneur du hub> si la détection automatique échoue.
# Prérequis : la MÊME ENCRYPTION_KEY que lors de la sauvegarde dans le .env (ou les variables de la stack Portainer).
set -eu
FILE=${1:?Usage : ops/restore.sh <sauvegarde users-AAAA-MM-JJ_HHMM.json>}
[ -f "$FILE" ] || { echo "Fichier introuvable : $FILE" >&2; exit 1; }
[ "$(head -c 5 "$FILE")" = "enc1:" ] || { echo "Ce fichier n'est pas une sauvegarde chiffrée du hub (en-tête enc1: absent)" >&2; exit 1; }
VOL=${VOLUME:-$(docker volume ls -q --filter name=mcp-data)}
[ -n "$VOL" ] || { echo "Aucun volume mcp-data : démarrer le hub une première fois, puis relancer." >&2; exit 1; }
[ "$(printf '%s\n' "$VOL" | wc -l)" -eq 1 ] || { echo "Plusieurs volumes trouvés : $(printf '%s ' $VOL). Relancer avec VOLUME=<nom>." >&2; exit 1; }
CONT=${CONTAINER:-$(docker ps -a -q --filter name=mcp-hub)}
DIR=$(cd "$(dirname "$FILE")" && pwd); NAME=$(basename "$FILE")
if [ -n "$CONT" ]; then docker stop $CONT >/dev/null; echo "Hub arrêté."; else echo "Aucun conteneur mcp-hub trouvé : restauration du volume seul."; fi
# L'ancien fichier est conservé dans le volume sous users.json.avant-restauration (un seul niveau, écrasé à la restauration suivante).
docker run --rm -v "$VOL:/data" -v "$DIR:/b:ro" node:22-alpine \
  sh -c "[ -f /data/users.json ] && cp /data/users.json /data/users.json.avant-restauration; cp /b/$NAME /data/users.json && chown node:node /data/users.json /data/users.json.avant-restauration 2>/dev/null; chmod 600 /data/users.json"
echo "Fichier restauré dans le volume $VOL."
[ -n "$CONT" ] || exit 0
docker start $CONT >/dev/null; echo "Hub redémarré, vérification dans 5 s…"; sleep 5
if docker logs --since 10s $CONT 2>&1 | grep -q "illisible"; then echo "ÉCHEC : users.json illisible, ENCRYPTION_KEY différente de celle de la sauvegarde. L'ancien fichier est dans le volume : users.json.avant-restauration." >&2; exit 1; fi
if docker logs --since 10s $CONT 2>&1 | grep -q "Hub MCP v"; then echo "OK : le hub a démarré avec les données restaurées."; else echo "Le hub n'a pas annoncé son démarrage : voir docker logs $CONT" >&2; exit 1; fi
