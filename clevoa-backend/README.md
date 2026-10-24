# Clevoa backend (AWS Lambda)

Public : Clevoa (éditeur). Objet : recevoir la télémétrie des hubs Clevoa AI Gateway, tenir une fiche par installation et
signaler chaque jour les installations silencieuses ou trop anciennes. Données envoyées par le hub, finalité et
conservation : [sécurité § 4](../docs/admin/securite.md#4-télémétrie-clevoa).

| Élément | Rôle |
|---|---|
| `POST /api/v1/telemetry` (fonction `telemetry`) | vérifie `X-Clevoa-Key`, valide le payload (champs connus seulement, 4 Ko au plus), met à jour la fiche `client#installation`, répond `{"status":"active"}` et, s'ils sont configurés, `minimum` et `latest` |
| Fonction `report`, chaque jour à 07:00 UTC | liste les installations sans contact depuis `SILENCE_HOURS` (48 h) et celles sous `MIN_VERSION` ; une ligne `[clevoa] ALERTE …` par cas dans CloudWatch et un message sur le sujet SNS d'alerte |
| Table DynamoDB `clevoa-backend-<stage>-installations` | une ligne par installation : client, identifiant, version, environnement, connecteurs déclarés, compteurs du dernier envoi, premier et dernier contact ; expirée 400 jours après le dernier contact |
| Sujet SNS `clevoa-backend-<stage>-alertes` | alertes par e-mail, abonnement créé une fois à la main |

Aucune dépendance à installer : le SDK AWS (DynamoDB, SNS) est fourni par le runtime Lambda Node 22. Sans
`TELEMETRY_TABLE` (tests, poste local), les fiches sont gardées en mémoire. La clé d'un client n'est jamais stockée :
la fiche porte le nom du client déclaré dans `CLEVOA_KEYS`, ou l'empreinte courte de la clé.

## Déployer (Clevoa, compte AWS existant)

Commandes non exécutées dans le cadre de la stabilisation d'octobre 2026 (aucun déploiement AWS réel) : syntaxe à
confirmer au premier déploiement.

```bash
npm i -g serverless            # Serverless Framework v4
aws configure                  # identifiants IAM avec droits CloudFormation, Lambda, API Gateway, IAM, DynamoDB, SNS, CloudWatch
cd clevoa-backend
CLEVOA_KEYS="charlois=<clé-charlois-prod>" MIN_VERSION=1.3.2 serverless deploy --stage prod   # affiche l'URL de l'API
aws sns subscribe --topic-arn <arn du sujet clevoa-backend-prod-alertes> --protocol email --notification-endpoint <adresse Clevoa>
```

Une clé par client et par environnement (`charlois-preprod=…,charlois=…`). Ajouter un client = redéployer avec la
nouvelle liste. La production des hubs envoie à `https://clevoa.fr/api/v1/telemetry` : nom de domaine personnalisé
API Gateway, certificat ACM et enregistrement DNS à créer une fois.

## Exploiter

```bash
serverless invoke -f report --stage prod      # rapport à la demande (JSON : total, silencieuses, obsolètes, installations)
serverless logs -f telemetry --stage prod --tail
serverless deploy --stage prod                # après changement de MIN_VERSION, LATEST_VERSION ou CLEVOA_KEYS
```

Une installation silencieuse n'est pas forcément en panne : hub arrêté, flux sortant bloqué par le client, clé
retirée. Le contact passe par l'administrateur du client ; Clevoa n'a aucun accès à l'installation.

Retirer la pile : `serverless remove --stage <stage>` supprime aussi la table et l'historique des contacts.

## Tester sans AWS

```bash
cd clevoa-backend && npm test     # 13 tests : clés, validation, persistance, séparation des clients, rapport, adaptateur DynamoDB
```
