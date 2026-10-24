# Image de base figée par empreinte (Node 22.23.4, vérifiée le 24/10/2026) : une version publiée se reconstruit avec la même
# base. Empreinte remplacée par une version corrective quand l'image Node reçoit un correctif de sécurité (docs/admin/installation.md § 6).
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
USER node
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
