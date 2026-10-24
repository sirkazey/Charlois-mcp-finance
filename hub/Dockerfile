# Image de base figée par empreinte (Node 22.23.4, vérifiée le 24/10/2026) : une version publiée se reconstruit avec la même
# base. Empreinte remplacée par une version corrective quand l'image Node reçoit un correctif de sécurité (docs/admin/installation.md § 6).
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
COPY package*.json ./
# npm, corepack et yarn ne servent qu'à l'installation : retirés de l'image d'exécution (leurs dépendances embarquées
# sont signalées par Trivy et le hub ne les appelle jamais ; le diagnostic et le contrôle de santé n'utilisent que node).
RUN npm ci --omit=dev \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY . .
# Exécution sans privilèges : utilisateur "node" de l'image, propriétaire du volume /data.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
