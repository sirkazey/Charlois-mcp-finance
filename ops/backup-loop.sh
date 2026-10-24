#!/bin/sh
# Sauvegarde automatique (conteneur mcp-backup) : copie users.json chaque jour dans /backups (users-AAAA-MM-JJ.json,
# un fichier par jour, écrasé si relancé le même jour) et supprime les fichiers plus vieux que BACKUP_KEEP_DAYS jours.
# Première copie au démarrage du conteneur. Le fichier est chiffré : sans ENCRYPTION_KEY, il ne révèle rien.
KEEP=${BACKUP_KEEP_DAYS:-30}
trap 'exit 0' TERM INT   # arrêt immédiat du conteneur (docker stop) au lieu d'attendre la fin du sleep
while :; do
  if [ -f /data/users.json ]; then
    cp /data/users.json "/backups/users-$(date +%F).json.tmp" && mv "/backups/users-$(date +%F).json.tmp" "/backups/users-$(date +%F).json" && echo "sauvegarde users-$(date +%F).json"
  else
    echo "users.json absent : aucun collaborateur connecté, rien à sauvegarder"
  fi
  find /backups -name 'users-*.json' -mtime "+$KEEP" -delete
  sleep 86400 & wait $!
done
