#!/bin/sh
# Sauvegarde automatique (conteneur mcp-backup) : au démarrage puis toutes les 24 h, copie users.json (chiffré) dans /backups sous un
# nom horodaté users-AAAA-MM-JJ_HHMMSS.json, jamais écrasé. Si le fichier n'a pas changé depuis la dernière sauvegarde, rien n'est
# écrit : un redémarrage du conteneur ne crée pas de doublon. La copie passe par un fichier temporaire vérifié (en-tête enc1:, taille,
# contenu identique) puis publié atomiquement ; une source absente ou invalide ne touche à rien. Rétention : fichiers de plus de
# BACKUP_KEEP_DAYS jours supprimés seulement après une copie réussie, jamais la plus récente.
# Variables de test : SRC, DEST (chemins), ONCE=1 (une seule passe, code de retour 0 = sauvegarde écrite ou inchangée, 1 = refusée).
SRC=${SRC:-/data/users.json}; DEST=${DEST:-/backups}; KEEP=${BACKUP_KEEP_DAYS:-30}; MIN_BYTES=64
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
latest() { ls -1 "$DEST"/users-*.json 2>/dev/null | sort | tail -n 1; }
backup() {
  find "$DEST" -name 'users-*.json.tmp' -mmin +10 -delete 2>/dev/null   # restes d'une interruption antérieure
  [ -f "$SRC" ] || { log "users.json absent : aucun collaborateur connecté, rien à sauvegarder"; return 1; }
  if [ "$(head -c 5 "$SRC")" != "enc1:" ] || [ "$(wc -c < "$SRC")" -lt "$MIN_BYTES" ]; then
    log "users.json invalide (en-tête ou taille) : sauvegarde refusée, les précédentes sont conservées"; return 1
  fi
  last=$(latest)
  if [ -n "$last" ] && cmp -s "$SRC" "$last"; then log "inchangé depuis $(basename "$last") : rien à écrire"; return 0; fi
  stamp=$(date +%Y-%m-%d_%H%M%S); name="users-$stamp.json"; n=0
  while [ -e "$DEST/$name" ]; do n=$((n + 1)); name="users-$stamp-$n.json"; done   # jamais d'écrasement, même dans la même seconde
  tmp="$DEST/$name.tmp"
  if ! cp "$SRC" "$tmp" || ! cmp -s "$SRC" "$tmp"; then rm -f "$tmp"; log "copie échouée : $name non publié, les précédentes sont conservées"; return 1; fi
  mv "$tmp" "$DEST/$name" || { rm -f "$tmp"; log "publication échouée : $name, les précédentes sont conservées"; return 1; }
  log "sauvegarde $name ($(wc -c < "$DEST/$name") octets)"
  find "$DEST" -name 'users-*.json' ! -name "$name" -mtime "+$KEEP" -delete 2>/dev/null   # rétention, seulement après une copie réussie
  return 0
}
if [ "${ONCE:-}" = "1" ]; then backup; exit $?; fi
trap 'exit 0' TERM INT
while :; do backup; sleep 86400 & wait $!; done
