# Clevoa backend (AWS Lambda)

Public : Clevoa (éditeur). Objet : recevoir la télémétrie des hubs Clevoa AI Gateway, tenir une fiche par installation et
signaler chaque jour les installations silencieuses ou trop anciennes. Données envoyées par le hub, finalité et
conservation : [sécurité § 4](../docs/admin/securite.md#4-télémétrie-clevoa).

| Élément | Rôle |
|---|---|
| `POST /api/v1/telemetry` (fonction `telemetry`) | vérifie `X-Clevoa-Key`, valide le payload (champs connus seulement, 4 Ko au plus), met à jour la fiche `client#installation#environnement`, répond `{"status":"active"}` et, s'ils sont configurés, `minimum` et `latest` |
| Fonction `report`, chaque jour à 07:00 UTC | liste les installations sans contact depuis `SILENCE_HOURS` (48 h) et celles sous `MIN_VERSION` ; une ligne `[clevoa] ALERTE …` par cas dans CloudWatch et un message sur le sujet SNS d'alerte ; au-delà de `SILENCE_MAX_DAYS` (30 jours), l'installation est « perdue » : listée, sans alerte |
| Table DynamoDB `clevoa-backend-<stage>-installations` | une ligne par installation : client, identifiant, version, environnement, connecteurs déclarés, compteurs du dernier envoi, premier et dernier contact ; expirée 400 jours après le dernier contact |
| Sujet SNS `clevoa-backend-<stage>-alertes` | alertes par e-mail, abonnement créé une fois à la main |

Aucune dépendance à installer : le SDK AWS (DynamoDB, SNS) est fourni par le runtime Lambda Node 22. Sans
`TELEMETRY_TABLE` (tests, poste local), les fiches sont gardées en mémoire. `CLEVOA_KEYS` liste des entrées
`client=clé` (nom en minuscules, chiffres et tirets) ; une entrée sans nom est ignorée. La clé n'est jamais stockée ni
journalisée : la fiche porte le nom du client.

Conservation : fiche expirée 400 jours après le dernier contact (suppression par AWS en général sous quelques jours),
copie de restauration à un instant donné gardée 35 jours, journaux CloudWatch 90 jours, alertes e-mail selon la
politique de la messagerie de Clevoa.

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

Une clé par client et par environnement est recommandée (`charlois-preprod=…,charlois=…`). Une sauvegarde de production
restaurée en pré-production y apporte le même identifiant d'installation : l'environnement fait partie de la fiche,
les deux restent distinctes. Ajouter un client = redéployer avec la
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

Fiches qui ne seront plus mises à jour, à retirer une fois le cas compris : `client#ancienne#<env>` laissée par un hub
antérieur à 1.3.2 après sa mise à jour, ancienne fiche d'une installation réinstallée (volume perdu, sauvegarde antérieure
à l'identifiant), fiche d'une version 1.3.2 après un retour arrière vers 1.3.1 (puis de nouveau active à la remise à niveau).
Elles passent d'elles-mêmes en « perdues » après 30 jours, et expirent après 400 jours. Retrait immédiat :

```bash
aws dynamodb delete-item --table-name clevoa-backend-prod-installations --key '{"id":{"S":"<client>#<identifiant>#<ENV>"}}'
```

Limites connues, à reprendre au premier déploiement : les deux fonctions partagent un rôle IAM (la fonction
`telemetry` détient aussi `Scan` et `Publish`) ; pas de limitation de débit par route sur l'API (une clé divulguée
permet de créer des fiches en nombre, à révoquer en la retirant de `CLEVOA_KEYS`) ; `reservedConcurrency: 5` exige un
compte AWS dont le quota dépasse 10 exécutions simultanées.

Retirer la pile : `serverless remove --stage <stage>` supprime aussi la table et l'historique des contacts.

## Tester sans AWS

```bash
cd clevoa-backend && npm test     # 15 tests : clés, validation, persistance, séparation des clients, rapport, adaptateur DynamoDB
```
