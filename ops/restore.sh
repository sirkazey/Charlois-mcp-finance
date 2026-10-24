#!/bin/sh
# Restauration du hub : remet une sauvegarde users-*.json dans le volume Docker, hub arrêté, puis le redémarre.
# Usage : ops/restore.sh <fichier de sauvegarde>
# Variables : VOLUME=<nom du volume>, CONTAINER=<nom du conteneur du hub> si la détection automatique échoue. Le conteneur retenu
# doit monter le volume retenu : toute incohérence est refusée avant d'arrêter le hub ou de toucher aux données.
# Fichiers acceptés : toute sauvegarde users-*.json du hub (quotidienne users-AAAA-MM-JJ.json, manuelle ou horodatée _HHMMSS) ;
# seul le contenu compte (en-tête enc1:).
# Prérequis : la MÊME ENCRYPTION_KEY que lors de la sauvegarde dans le .env (ou les variables de la stack Portainer).
# À lancer avec sudo (accès au démon Docker, sauvegardes automatiques appartenant à root) depuis n'importe quel dossier.
set -eu
FILE=${1:?Usage : sudo ops/restore.sh <sauvegarde users-AAAA-MM-JJ.json>}
[ -f "$FILE" ] || { echo "Fichier introuvable : $FILE" >&2; exit 1; }
[ -r "$FILE" ] || { echo "Fichier illisible ($FILE) : les sauvegardes automatiques appartiennent à root, lancer avec sudo." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker inaccessible : lancer avec sudo (ou depuis un compte du groupe docker)." >&2; exit 1; }
[ "$(head -c 5 "$FILE")" = "enc1:" ] || { echo "Ce fichier n'est pas une sauvegarde chiffrée du hub (en-tête enc1: absent)" >&2; exit 1; }
VOL=${VOLUME:-$(docker volume ls -q --filter name=mcp-data)}
[ -n "$VOL" ] || { echo "Aucun volume mcp-data : démarrer le hub une première fois, puis relancer." >&2; exit 1; }
[ "$(printf '%s\n' "$VOL" | wc -l)" -eq 1 ] || { echo "Plusieurs volumes trouvés : $(printf '%s ' $VOL). Relancer avec VOLUME=<nom>." >&2; exit 1; }
CONT=${CONTAINER:-$(docker ps -a -q --filter name=mcp-hub --filter volume="$VOL")}   # le conteneur mcp-hub qui monte CE volume
[ "$(printf '%s\n' "$CONT" | grep -c .)" -le 1 ] || { echo "Plusieurs conteneurs mcp-hub montent $VOL : $(docker ps -a --filter name=mcp-hub --filter volume="$VOL" --format '{{.Names}}' | tr '\n' ' '). Relancer avec CONTAINER=<nom>." >&2; exit 1; }
if [ -n "$CONT" ]; then
  MOUNTS=$(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' "$CONT" 2>/dev/null) || { echo "Conteneur introuvable : $CONT" >&2; exit 1; }
  case " $MOUNTS" in *" $VOL "*) ;; *) echo "Incohérence : le conteneur $(docker inspect -f '{{.Name}}' "$CONT" | sed 's|^/||') ne monte pas le volume $VOL (volumes montés : ${MOUNTS:-aucun}). Rien n'a été modifié ; vérifier VOLUME et CONTAINER." >&2; exit 1;; esac
fi
DIR=$(cd "$(dirname "$FILE")" && pwd); NAME=$(basename "$FILE")
if [ -n "$CONT" ]; then docker stop "$CONT" >/dev/null; echo "Hub arrêté."; trap '[ -n "$CONT" ] && docker start "$CONT" >/dev/null 2>&1; echo "Hub relancé après interruption." >&2' EXIT; else echo "Aucun conteneur mcp-hub trouvé : restauration du volume seul."; fi
# L'ancien fichier est conservé dans le volume sous users.json.avant-restauration (un seul niveau, écrasé à la restauration suivante).
docker run --rm -v "$VOL:/data" -v "$DIR:/b:ro" node:22-alpine \
  sh -c "[ -f /data/users.json ] && cp /data/users.json /data/users.json.avant-restauration; cp /b/$NAME /data/users.json && chown node:node /data/users.json /data/users.json.avant-restauration 2>/dev/null; chmod 600 /data/users.json"
echo "Fichier restauré dans le volume $VOL."
[ -n "$CONT" ] || exit 0
trap - EXIT
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)   # seuls les journaux postérieurs au redémarrage comptent (un hub qui bouclait avant garde ses anciens messages)
docker start "$CONT" >/dev/null; echo "Hub redémarré, vérification (30 s au plus)…"
i=0; while [ $i -lt 30 ]; do
  sleep 1; i=$((i + 1)); LOGS=$(docker logs --since "$SINCE" "$CONT" 2>&1)
  if printf '%s' "$LOGS" | grep -q "illisible"; then echo "ÉCHEC : users.json illisible, ENCRYPTION_KEY différente de celle de la sauvegarde. L'ancien fichier est dans le volume : users.json.avant-restauration." >&2; exit 1; fi
  if printf '%s' "$LOGS" | grep -q "Hub MCP v"; then echo "OK : le hub a démarré avec les données restaurées."; exit 0; fi
done
echo "Le hub n'a pas annoncé son démarrage en 30 s : voir docker logs $CONT (clé absente, PUBLIC_URL, port…)." >&2; exit 1
