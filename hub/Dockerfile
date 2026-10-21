FROM node:22-alpine
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
