# Décisions

Décisions de conception et leurs raisons, datées. Document d'archive : une décision n'est modifiée que par une
nouvelle entrée qui la remplace. Les audits qui les ont motivées : [audits d'octobre 2026](audit-2026-10.md).

| Date | Décision | Raison | Conséquence |
|---|---|---|---|
| 2026-10-21 | Un seul conteneur, connecteurs en modules, pas de framework ni de base de données | la solution doit rester une petite machine lisible en une heure | 3 dépendances, ~1 060 lignes, un fichier d'état chiffré |
| 2026-10-21 | Aucun compte de service ; jeton personnel transmis tel quel | les droits de chaque système s'appliquent sans réimplémentation | sans connexion du collaborateur, aucun outil ne répond |
| 2026-10-21 | Clé MCP uniquement en en-tête `Authorization`, jamais dans l'URL | une clé dans l'URL finirait dans les journaux des reverse proxys | claude.ai web et mobile non pris en charge |
| 2026-10-21 | Pas de serveur OAuth 2.1 côté hub | le hub reste sur le réseau interne ; les assistants installés sur les postes couvrent le besoin | claude.ai web et mobile écartés définitivement |
| 2026-10-22 | `users.json` chiffré AES-256-GCM avec clé maîtresse par environnement, sans rotation de clé | 24 lignes, zéro dépendance ; changer de clé = tout le monde se reconnecte | clé au coffre, jamais avec les sauvegardes |
| 2026-10-22 | Transport SSE conservé à côté du Streamable HTTP | compatibilité des assistants ; `/messages` exige la clé qui a ouvert la session | à retirer en premier quand les assistants seront tous en Streamable HTTP |
| 2026-10-23 | Salesforce par le serveur MCP hébergé SObject Reads, pas par l'API REST | lecture seule garantie par Salesforce ; outils et droits natifs | une session MCP par appel ; crédits Flex ; `SF_MAX_PER_MIN` |
| 2026-10-23 | Pas de factorisation entre connecteurs proxy (Salesforce, Dropbox, MyReport) | gain nul, abstraction en plus | à revoir seulement si un quatrième proxy arrive |
| 2026-10-23 | En production, un connecteur sans configuration n'est pas exposé | aucune donnée inventée possible en production | simulateurs réservés à la pré-production |
| 2026-10-23 | `SF_MCP_URL` acceptée seulement si elle désigne `…/sobject-reads` (liste blanche) | une liste noire des serveurs d'écriture aurait laissé passer un nouveau serveur | |
| 2026-10-24 | SSO Entra ID implémenté dans le routeur OAuth existant, sans oauth2-proxy ni composant supplémentaire | ~75 lignes, mêmes flux (code + PKCE), un seul conteneur | SSO = authentification seulement, jamais d'autorisation Graph |
| 2026-10-24 | Clé toujours fraîche à la première liaison SSO ; clé antérieure au SSO jamais reprise | revue indépendante : fixation de session, jetons d'un autre collaborateur | activer le SSO invalide les clés existantes |
| 2026-10-24 | Conteneur de sauvegarde avec la seule capacité `DAC_OVERRIDE` | lire le volume en 700 et écrire dans `BACKUP_DIR` quel qu'en soit le propriétaire ; un `chown` par l'administrateur est fragile sous Portainer | documenté dans l'exploitation |
| 2026-10-24 | Mode démo du portail retiré | quatrième couche de simulation, sans test, périmée ; le bouchon joue ce rôle | |
| 2026-10-24 | nginx fourni en profil Compose `proxy`, optionnel | https obligatoire en production sans imposer un reverse proxy | une seule stack par machine peut porter le profil |
| 2026-10-24 | Campagne de charge sur bouchons avant toute mesure sur les systèmes réels | mesurer d'abord, corriger ensuite ; ne jamais charger un système réel | corrections proposées séparément, aucune appliquée en 1.2.1 |
| 2026-10-24 | Produit nommé Clevoa AI Gateway, édité par Clevoa SASU ; Charlois = client et contexte de déploiement | identité produit et licence propriétaire | identifiants techniques inchangés dans la 1.2.1 pour éviter toute régression |
| 2026-10-24 | 1.3.0 : nom du serveur MCP et libellé d'instance paramétrables (`MCP_SERVER_NAME`, `INSTANCE_LABEL`), bouchon renommé `clevoa-mcp-stub`, paquets `clevoa-gateway-hub` et `clevoa-mcp-stub` | socle multi-client sans valeur Charlois codée en dur ; le nom du serveur n'est qu'une clé locale chez le client MCP, le changer ne casse aucune configuration | jeu de données fictif du bouchon conservé (e-mails `@charlois.com`, tables YFAC/ZVENTE) : cohérent avec les tests, à neutraliser seulement pour un second client |
