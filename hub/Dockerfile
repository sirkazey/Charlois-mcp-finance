# Image de base figée par empreinte (Node 22.23.4, vérifiée le 24/10/2026) : une version publiée se reconstruit à l'identique.
# À mettre à jour à chaque version (docs/admin/installation.md § 6).
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Exécution sans privilèges : utilisateur "node" de l'image, propriétaire du volume /data.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
