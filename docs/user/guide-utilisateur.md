# Guide utilisateur

Pour le collaborateur qui veut interroger Salesforce, Sage X3, SharePoint, Dropbox ou MyReport depuis son assistant IA.
Rien n'est installé sur les systèmes métier : vous connectez vos propres comptes une fois sur le portail, puis
l'assistant interroge les outils **avec vos droits, en lecture seule**.

## 1. Ouvrir le portail et se connecter aux outils

1. Ouvrir l'adresse du portail communiquée par votre DSI (exemple : `https://mcp.<entreprise>.fr`). Si le SSO
   Microsoft Entra ID est activé, votre identité est reconnue automatiquement ; sinon le portail vous attribue une clé
   personnelle au premier passage. En haut de page, trois étapes indiquent où vous en êtes et la prochaine action :
   connecter vos outils, les vérifier, brancher votre assistant.
2. Dans **Vos outils**, chaque carte indique l'état de l'outil (« À connecter », « Connecté », « Simulé », « Non
   configuré »). Cliquer **Se connecter** :
   * **Salesforce, SharePoint / OneDrive, Dropbox** : page de connexion de l'éditeur, puis autorisation « lecture ».
   * **Sage X3** : selon la configuration de votre DSI, saisir votre identifiant et votre mot de passe Syracuse, ou votre
     clé d'API Syracuse (chiffrés dans le hub, jamais renvoyés au navigateur) ; OAuth si elle l'a configuré.
   * **MyReport** : coller votre jeton personnel MyReport Server.
3. Cliquer **Tester** sur une carte, ou **Tout tester** : encadré vert « Accès vérifié » avec le détail (outils ou
   tables disponibles), encadré rouge avec le message d'erreur. Une erreur n'empêche pas les autres outils de fonctionner.

Un outil « Non configuré » doit d'abord être activé par votre DSI. En pré-production, Sage X3 et MyReport
peuvent tourner en **simulateur** : les données sont inventées et étiquetées comme telles.

## 2. Brancher l'assistant

La section **Branchez votre assistant IA** propose deux onglets, chacun avec ses instructions et un bloc de
configuration prêt à copier. Votre clé y figure : elle est masquée à l'écran (bouton **Afficher la clé**), mais le
bouton **Copier** la copie en entier. Ne la partagez jamais : elle vaut pour tous vos outils connectés.

### Claude Code, ChatGPT, Copilot et clients MCP HTTP

Onglet **Claude Code, ChatGPT, Copilot** : URL `<portail>/mcp` et en-tête `Authorization: Bearer <clé>`. Ces assistants
sont testés au niveau du protocole MCP ; seul Claude Desktop a été vérifié en conditions réelles. Signaler à la DSI
tout écart constaté.

* Claude Code : coller le bloc dans un fichier `.mcp.json` à la racine du projet (ou dans `~/.claude.json` pour tous
  les projets), relancer `claude` ; la commande `/mcp` liste le serveur sous le nom indiqué par le portail (`clevoa-gateway` par
  défaut, un autre nom si votre DSI en a choisi un).
* Ligne de commande (syntaxe à confirmer avec `claude mcp add --help`) :

```bash
claude mcp add --transport http clevoa-gateway <portail>/mcp --header "Authorization: Bearer <clé>"
```

### Claude Desktop

Claude Desktop n'accepte pas d'en-tête sur un serveur distant : le bloc **Claude Desktop** passe par le pont
`mcp-remote`. Prérequis : Node.js LTS installé (`node -v`). Libellés vérifiés sur Claude Desktop pour Windows le
23 octobre 2026.

1. Portail → onglet « Claude Desktop » → Copier.
2. Claude Desktop → nom d'utilisateur en bas à gauche → Paramètres → Développeur → **Modifier la configuration** : ouvre
   le dossier de `claude_desktop_config.json` (`%APPDATA%\Claude`).
3. Coller l'entrée (nommée comme sur le portail, `clevoa-gateway` par défaut) **à l'intérieur** du `mcpServers` existant. Fichier vide : coller le bloc entier.
4. Quitter Claude Desktop par l'icône de la barre système (clic droit → Quitter), relancer. Premier lancement : 10 à
   20 s, le pont se télécharge.
5. Nouvelle conversation → icône des outils : le serveur figure avec ses outils.

Journal en cas d'échec : Paramètres → Développeur → Ouvrir les journaux → `mcp-server-<nom du serveur>.log`.

Claude.ai web et mobile ne sont pas pris en charge : le hub reste sur le réseau interne et ces clients ne peuvent pas
poser l'en-tête d'autorisation.

## 3. Poser des questions et lire les réponses

La section **Exemples de questions** du portail (onglets Prise en main, Analyse de données, Contrôle de gestion) donne
des questions de départ, à copier d'un clic, par exemple « Quel est le chiffre d'affaires facturé des 12 derniers mois, par mois ? ».

Chaque résultat se termine par une ligne **« Source : … »** : `Source : Sage X3 · dossier X3TST_CHREC`,
`Source : Salesforce · sandbox preprod` ou `· production`. L'assistant est instruit de la citer ; elle permet de
vérifier d'où vient chaque donnée. Il est aussi instruit d'interroger Sage X3 **et** Salesforce quand une question sur
un tiers, une commande ou une facture ne nomme pas le système.

Questions de contrôle dont la réponse est connue :

* « Décris les champs de PINVOICE » → colonnes de liste et champs de fiche.
* « Donne-moi les 3 dernières factures d'achat du site TO219 avec le fournisseur » → trois fiches.
* « Qui suis-je sur Salesforce ? » → nom, e-mail, profil.
* « Compare ce que Sage X3 et Salesforce savent du client X en 2026 » → deux lignes Source.

Outils exposés à l'assistant : `salesforce_tools`, `salesforce_call` · `sagex3_representations`, `sagex3_describe`,
`sagex3_query`, `sagex3_get` · `sharepoint_sites`, `sharepoint_list`, `sharepoint_search`, `sharepoint_read` ·
`dropbox_tools`, `dropbox_call` · `myreport_tools`, `myreport_call`.

### Particularités Sage X3 à connaître

* `sagex3_query` ne renvoie que les colonnes de liste ; le filtre accepte tout champ d'en-tête, mais la valeur filtrée
  n'est pas renvoyée : l'assistant lit alors chaque fiche avec `sagex3_get` (un total sur 100 factures = 100 lectures).
* Le type de pièce (facture ou avoir) n'est pas exposé par PINVOICE : seul le numéro (`…FAF…` / `…AVF…`) le distingue, et
  les montants ne sont pas signés. L'assistant en est averti.
* Le statut de règlement n'est pas exposé tant que les échéances (`GACCDUDATE`) ne sont pas publiées par l'intégrateur.
* Une fiche complète pèse de 60 à 130 000 caractères : le paramètre `champs` de `sagex3_get` ne garde que l'utile.

## 4. Gérer sa clé

* **Régénérer la clé** (encadré « Votre clé personnelle », après confirmation) : l'ancienne cesse de fonctionner aussitôt. À faire si vous pensez qu'elle a
  été vue par quelqu'un, et à recopier dans votre assistant.
* **Se déconnecter** (avec le SSO, icône à droite de votre nom) ferme la session du portail puis la session Microsoft du navigateur : indispensable
  sur un poste partagé.
* **Déconnecter un outil** retire vos jetons pour ce système ; l'assistant reçoit alors « Non connecté » jusqu'à une
  nouvelle connexion.

## 5. Problèmes courants

| Ce que vous voyez | Cause probable | Que faire |
|---|---|---|
| L'assistant répond « Non connecté à … » | Outil jamais connecté, ou jetons retirés | Portail → Se connecter → Tester |
| « Session … expirée ou révoquée : reconnectez-vous sur le portail » | Autorisation révoquée côté éditeur, mot de passe changé | Se reconnecter sur le portail |
| Claude Desktop : erreur `401` | Clé régénérée ou révoquée | Recopier le bloc du portail dans la configuration |
| Voyant rouge « Sage X3 401 » | Mot de passe Syracuse changé ou compte désactivé | Ressaisir identifiant et mot de passe |
| « absentes de ce dossier (404) : … » dans le diagnostic Sage | Représentations non publiées par l'intégrateur | Signaler à la DSI ; le reste fonctionne |
| « interdites à votre utilisateur X3 (403) : … » | Droits fonctionnels X3 | Normal : vos droits s'appliquent |
| « plafond de N appels par minute atteint » | Limite partagée du connecteur (MyReport : 20 par minute pour tous) | Réessayer dans un instant |
| « Trop de requêtes, réessayez dans une minute » sur le portail | Limite par adresse IP, souvent derrière un NAT commun | Attendre une minute |
| « Sage X3 : pas de réponse en 30 s » | Syracuse lent | Réessayer ; restreindre la question |
| « State OAuth invalide » après une connexion | Portail ouvert à une autre adresse que celle prévue | Ouvrir exactement l'adresse communiquée par la DSI |
| Avec le SSO : page de connexion Microsoft à chaque fois | Pas de session Microsoft 365 dans ce navigateur | Se connecter une fois ; c'est du SSO, mais pas silencieux |

Si le problème persiste, ouvrir une issue « Bug » dans le dépôt avec le message d'erreur du diagnostic ou de
l'assistant, **sans jeton ni donnée métier**.
