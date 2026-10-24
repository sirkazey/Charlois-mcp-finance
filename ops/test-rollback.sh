#!/bin/sh
# Retour arrière sur poste ou en CI (Docker requis, jamais contre une installation réelle) : la version courante de l'arbre de
# travail, puis la version publiée précédente (tag Git), puis de nouveau la courante, toujours sur le MÊME volume de données.
# Vérifie à chaque étape : démarrage, version annoncée, collaborateur toujours connecté, fichier chiffré lisible, et identifiant
# d'installation (télémétrie) conservé. Images fournies par IMAGE_CURRENT / IMAGE_PREV, sinon construites depuis le dépôt.
# Usage : ops/test-rollback.sh                 (PREV = version publiée la plus récente, hors candidates, différente de la courante)
#         PREV=v1.3.1 ops/test-rollback.sh
set -eu
cd "$(dirname "$0")/.."
CUR=$(sed -n 's/^export const VERSION = "\(.*\)";/\1/p' hub/version.js)
PREV=${PREV:-$(git tag --list 'v*' --sort=-v:refname | grep -v -- '-' | grep -v "^v$CUR\$" | head -n 1)}
[ -n "$PREV" ] || { echo "aucun tag précédent (git fetch --tags ?)" >&2; exit 1; }
P=clevoa-rollback-$$; PORT=${PORT:-18080}; URL="http://127.0.0.1:$PORT"
KEY=$(openssl rand -hex 32); WORK=$(mktemp -d)
IMAGE_CURRENT=${IMAGE_CURRENT:-$P-courante}; IMAGE_PREV=${IMAGE_PREV:-$P-precedente}
say() { printf '\n=== %s\n' "$*"; }
cleanup() { docker rm -f "$P-hub" >/dev/null 2>&1 || true; docker volume rm "$P-data" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

say "Images : courante $CUR, précédente $PREV"
docker image inspect "$IMAGE_CURRENT" >/dev/null 2>&1 || docker build -q -t "$IMAGE_CURRENT" hub >/dev/null
docker image inspect "$IMAGE_PREV" >/dev/null 2>&1 || git archive --format=tar "$PREV:hub" | docker build -q -t "$IMAGE_PREV" - >/dev/null

# Démarre une image sur le volume commun, comme la stack de pré-production (utilisateur node, lecture seule, sans privilèges).
start() {
  docker rm -f "$P-hub" >/dev/null 2>&1 || true
  docker run -d --name "$P-hub" -p "127.0.0.1:$PORT:8080" -v "$P-data:/data" --read-only --tmpfs /tmp --cap-drop ALL \
    --security-opt no-new-privileges:true -e ENCRYPTION_KEY="$KEY" -e PUBLIC_URL="$URL" -e APP_ENV=preprod \
    -e CLEVOA_KEY=cle-test -e CLEVOA_URL=http://127.0.0.1:9/api/v1/telemetry "$1" >/dev/null
  for i in $(seq 1 30); do curl -fsS "$URL/health" >/dev/null 2>&1 && return 0; sleep 1; done
  docker logs "$P-hub" >&2; echo "le hub ne démarre pas ($1)" >&2; return 1
}
me() { curl -fsS -b "$WORK/jar" "$URL/api/me"; }
version() { me | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }
connected() { me | grep -q '"id":"myreport"[^}]*"connected":true'; }
installation() { docker exec "$P-hub" node -e '
  const { createHash, createDecipheriv } = require("node:crypto"); const raw = require("node:fs").readFileSync("/data/users.json", "utf8");
  const [, iv, tag, data] = raw.split(":").map((p, i) => (i ? Buffer.from(p, "base64") : p));
  const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(process.env.ENCRYPTION_KEY).digest(), iv); d.setAuthTag(tag);
  console.log(JSON.parse(Buffer.concat([d.update(data), d.final()]).toString()).installation ?? "");'; }

say "1. Version courante $CUR : un collaborateur se connecte (jeton personnel MyReport)"
start "$IMAGE_CURRENT"; [ "$(version)" = "$CUR" ]
curl -fsS -c "$WORK/jar" "$URL/api/me" >/dev/null
curl -fsS -b "$WORK/jar" -X POST -H 'Content-Type: application/json' -d '{"apiKey":"MR-TEST-ROLLBACK"}' "$URL/api/myreport/apikey"
connected; ID=$(installation); [ -n "$ID" ]; echo "ok : connecté, installation $ID"

say "2. Sauvegarde avant retour arrière (copie du fichier chiffré)"
docker run --rm -u 0 -v "$P-data:/data:ro" -v "$WORK:/b" --entrypoint cp "$IMAGE_CURRENT" /data/users.json /b/avant.json
[ "$(head -c 5 "$WORK/avant.json")" = "enc1:" ]; echo "ok"

say "3. Retour arrière vers $PREV sur le même volume"
start "$IMAGE_PREV"; [ "$(version)" = "${PREV#v}" ]; connected; echo "ok : $(version), collaborateur toujours connecté"

say "4. Nouvelle mise à jour vers $CUR : données et identifiant d'installation conservés"
start "$IMAGE_CURRENT"; [ "$(version)" = "$CUR" ]; connected; [ "$(installation)" = "$ID" ]; echo "ok : identifiant inchangé"

say "Retour arrière $CUR → $PREV → $CUR réussi."
