# Clevoa backend (AWS Lambda)

Une seule fonction, aucune dépendance : `POST /api/v1/telemetry` reçoit le payload anonyme d'un hub MCP Charlois,
vérifie l'en-tête `X-Clevoa-Key`, enregistre les statistiques de volume (simulation : journal CloudWatch) et répond
`{"status":"active"}`.

```bash
npm i -g serverless            # Serverless Framework v4 (compte serverless.com gratuit pour l'usage personnel)
aws configure                  # identifiants IAM avec droits CloudFormation / Lambda / API Gateway / IAM / CloudWatch
cd clevoa-backend
CLEVOA_KEYS=cle-charlois serverless deploy          # affiche l'URL https://xxxx.execute-api.eu-west-3.amazonaws.com
curl -X POST "$URL/api/v1/telemetry" -H "X-Clevoa-Key: cle-charlois" -H "Content-Type: application/json" \
  -d '{"version":"1.0.0","date":"2026-10-22","connectors":{"salesforce":true},"requests":12}'
serverless logs -f telemetry --tail
serverless remove              # supprime toute la pile
```

Côté hub : `CLEVOA_URL=https://xxxx.execute-api.eu-west-3.amazonaws.com/api/v1/telemetry` et `CLEVOA_KEY=cle-charlois`.

Tests locaux sans AWS : `cd ../hub && npm test` exécute `handler.js` directement avec des événements API Gateway simulés.

Étape suivante quand vous voudrez persister : remplacer `record()` par un `PutItem` DynamoDB (table à déclarer dans
`resources:` du `serverless.yml` et droit `dynamodb:PutItem` dans `provider.iam`).
