// Diagnostic exportable, lancé par l'administrateur dans le conteneur : docker exec mcp-hub-prod node diagnostic.js > diagnostic.json
// Rapport JSON des informations techniques utiles au support : version, environnement, état du hub, du fichier chiffré,
// des connecteurs et de la télémétrie. Jamais une valeur de secret, un jeton, une clé, une adresse e-mail, une URL ni une
// donnée métier : seulement des états (« renseignée », « joignable »), des compteurs et des codes d'erreur.
// Lecture seule : n'écrit rien, n'ouvre aucun port, ne contacte que le hub local et, sauf --sans-reseau, l'hôte de chaque
// système configuré (une requête HEAD sans identifiant) pour distinguer une panne réseau d'une erreur d'identifiant.
import { readFileSync, statSync, accessSync, statfsSync, constants } from "node:fs";
import { createHash, createDecipheriv } from "node:crypto";
import { VERSION, APP_ENV, IS_PROD } from "./version.js";

const offline = process.argv.includes("--sans-reseau");
const env = process.env;
const DIR = env.DATA_DIR || "./data";
const problems = [];
const set = (n) => !!(env[n] && env[n].trim());

// Variables lues par le hub : seulement « renseignée » ou « vide ». Quelques réglages sans secret sont donnés en clair.
const NAMES = Object.keys(env).filter((n) => /^(PUBLIC_URL|APP_ENV|LOG_LEVEL|TRUST_PROXY|ENCRYPTION_KEY|SSO_MODE|MCP_SERVER_NAME|INSTANCE_LABEL|SF_|SAGE_|MS_|SP_|GRAPH_URL|DROPBOX_|MYREPORT_|CLEVOA_|TZ$)/.test(n)).sort();
const PLAIN = new Set(["APP_ENV", "LOG_LEVEL", "TRUST_PROXY", "SSO_MODE", "SAGE_APIKEY_MODE", "TZ", "MYREPORT_MAX_PER_MIN", "SF_MAX_PER_MIN", "SF_DEFAULT_LIMIT"]);
const plain = (n) => PLAIN.has(n) && (n === "TRUST_PROXY" ? /^\d{1,2}$/ : /^[\w./+:-]{1,40}$/).test(env[n]); // TRUST_PROXY : un nombre de sauts, jamais une adresse
const variables = Object.fromEntries(NAMES.map((n) => [n, !set(n) ? "vide" : plain(n) ? env[n] : "renseignée"]));

// Connecteurs : mêmes règles que les modules. Sage X3 et MyReport sans URL tournent en simulateur (pré-prod) et ne sont pas
// exposés en production ; Salesforce, SharePoint et Dropbox sans application OAuth restent visibles mais « non configurés ».
const CONNECTORS = [
  { id: "salesforce", vars: ["SF_CLIENT_ID"], url: "SF_MCP_URL" },
  { id: "sagex3", vars: ["SAGE_URL"], url: "SAGE_URL", simulator: true },
  { id: "sharepoint", vars: ["MS_CLIENT_ID"], url: "GRAPH_URL", defaultUrl: "https://graph.microsoft.com/v1.0" },
  { id: "dropbox", vars: ["DROPBOX_APP_KEY"], url: "DROPBOX_MCP_URL", defaultUrl: "https://mcp.dropbox.com/mcp" },
  { id: "myreport", vars: ["MYREPORT_MCP_URL"], url: "MYREPORT_MCP_URL", simulator: true },
];

/** Requête HEAD sans identifiant vers l'hôte : code HTTP (même 401/404, preuve de joignabilité) ou code d'erreur réseau. */
async function reach(url) {
  try {
    const t0 = Date.now();
    const r = await fetch(new URL(url).origin, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
    return { joignable: true, http: r.status, ms: Date.now() - t0 };
  } catch (e) {
    const code = e.name === "TimeoutError" ? "DELAI" : e.cause?.code || e.name;
    return { joignable: false, erreur: String(code).slice(0, 40) };
  }
}

/** État du fichier chiffré : présence, taille, date, déchiffrable avec ENCRYPTION_KEY, compteurs (jamais une clé ni un jeton). */
function storeState() {
  const file = `${DIR}/users.json`;
  const out = { dossierInscriptible: false, fichier: "absent" };
  try { accessSync(DIR, constants.W_OK); out.dossierInscriptible = true; } catch { problems.push("dossier de données non inscriptible"); }
  try { const s = statfsSync(DIR); out.espaceLibreMo = Math.floor((s.bavail * s.bsize) / 1048576); if (out.espaceLibreMo < 100) problems.push("moins de 100 Mo libres sur le volume de données"); } catch { /* statfs indisponible */ }
  let raw;
  try { raw = readFileSync(file, "utf8"); const s = statSync(file); Object.assign(out, { fichier: "présent", octets: s.size, modifie: s.mtime.toISOString() }); }
  catch (e) { if (e.code !== "ENOENT") { out.fichier = `illisible (${e.code})`; problems.push("users.json illisible"); } return out; }
  out.chiffre = raw.startsWith("enc1:");
  let db;
  try {
    if (out.chiffre) {
      const master = createHash("sha256").update(env.ENCRYPTION_KEY || "").digest();
      const [, iv, tag, data] = raw.split(":").map((p, i) => (i ? Buffer.from(p, "base64") : p));
      const d = createDecipheriv("aes-256-gcm", master, iv, { authTagLength: 16 }); d.setAuthTag(tag);
      db = JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
    } else db = JSON.parse(raw);
    out.dechiffrable = true;
  } catch { out.dechiffrable = false; problems.push("users.json non déchiffrable avec ENCRYPTION_KEY (mauvaise clé ou fichier corrompu)"); return out; }
  const users = Object.values(db.users || {});
  const connected = (u, id) => !!(u[id] && (u[id].access_token || u[id].apiKey));
  // Identifiant aléatoire de la télémétrie (UUID v4 seulement, toute autre valeur est tue).
  out.installation = typeof db.installation === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(db.installation) ? db.installation : null;
  out.entrees = users.length;
  out.liesSso = users.filter((u) => u.sso).length;
  out.connexions = Object.fromEntries(CONNECTORS.map((c) => [c.id, users.filter((u) => connected(u, c.id)).length]));
  return out;
}

async function main() {
  const port = env.PORT || 8080;
  let hub;
  try {
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    hub = { health: r.status, ms: Date.now() - t0 };
    if (!r.ok) problems.push(`/health répond ${r.status}`);
  } catch (e) { hub = { health: "injoignable", erreur: e.cause?.code || e.name }; problems.push("le hub ne répond pas sur /health"); }

  const connectors = [];
  for (const c of CONNECTORS) {
    const configured = c.vars.every(set);
    const row = { id: c.id, etat: configured ? "configuré" : !c.simulator ? "non configuré" : IS_PROD ? "non exposé (production)" : "simulateur" };
    const url = env[c.url] || c.defaultUrl;
    if (configured && !url) problems.push(`${c.id} : configuré sans URL de service`);
    if (configured && !offline) {
      row.reseau = url ? await reach(url) : { joignable: null, erreur: "URL absente" };
      if (row.reseau.joignable === false) problems.push(`${c.id} : hôte injoignable (${row.reseau.erreur})`);
    }
    connectors.push(row);
  }

  const telemetry = { active: set("CLEVOA_KEY"), urlParDefaut: !set("CLEVOA_URL") };
  if (telemetry.active && !offline) telemetry.reseau = await reach(env.CLEVOA_URL || "https://clevoa.fr/api/v1/telemetry");

  let publicUrl = "vide";
  try { if (set("PUBLIC_URL")) publicUrl = new URL(env.PUBLIC_URL).protocol.replace(":", ""); } catch { publicUrl = "invalide"; problems.push("PUBLIC_URL invalide : le hub ne peut pas démarrer"); }
  // Même règle que le hub : https en production, sauf adresse locale de test.
  if (IS_PROD && !/^https:|^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(env.PUBLIC_URL || "")) problems.push("PUBLIC_URL n'est pas en https en production");

  const report = {
    avertissement: "Rapport technique sans secret ni donnée métier. Relisez-le avant de le transmettre à Clevoa.",
    genere: new Date().toISOString(),
    version: VERSION, environnement: APP_ENV, node: process.version, reseauTeste: !offline,
    hub, publicUrl, variables, donnees: storeState(), connecteurs: connectors, telemetrie: telemetry,
  };
  report.problemes = problems;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch((e) => { process.stderr.write(`[diagnostic] échec : ${e.name}\n`); process.exit(1); });
