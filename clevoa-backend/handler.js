// Backend Clevoa (AWS Lambda), deux fonctions et aucune dépendance à installer :
// - telemetry : reçoit le POST quotidien d'un hub Clevoa AI Gateway, vérifie la clé client, valide le payload et met à jour
//   la fiche de l'installation (une ligne par installation : version, connecteurs déclarés, dernier contact) ;
// - report : rapport quotidien (planifié) des installations silencieuses et des versions sous le minimum, journalisé et,
//   si ALERT_TOPIC_ARN est renseignée, publié sur un sujet SNS (e-mail de Clevoa).
// Persistance : table DynamoDB si TELEMETRY_TABLE est renseignée (SDK AWS fourni par le runtime Lambda Node 22),
// mémoire de l'instance sinon (tests locaux, aucun accès AWS). Conservation : expiration DynamoDB (TTL) RETENTION_DAYS
// jours après le dernier contact.
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_BODY = 4096; // un payload légitime fait environ 300 octets
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,20})?$/;
const env = (n, d) => process.env[n] || d;
const hash = (s) => createHash("sha256").update(s).digest();

/** Clés clients acceptées : CLEVOA_KEYS = « client=clé » séparées par des virgules (nom : lettres minuscules, chiffres, tirets).
 *  Une entrée sans nom est ignorée. Liste vide = AUCUNE clé acceptée. Seul le nom du client est enregistré, jamais la clé. */
function clients() {
  return (process.env.CLEVOA_KEYS || "").split(",").map((e) => e.trim()).filter(Boolean).flatMap((e) => {
    const i = e.indexOf("=");
    const name = e.slice(0, Math.max(i, 0)).trim(), key = e.slice(i + 1).trim();
    if (i <= 0 || !/^[a-z0-9-]{1,40}$/.test(name) || !key) { console.error("[clevoa] entrée de CLEVOA_KEYS ignorée : format client=clé attendu"); return []; }
    return [{ client: name, digest: hash(key) }];
  });
}
/** Client correspondant à la clé présentée (comparaison à temps constant sur les empreintes), ou null. */
function identify(key, list) {
  if (typeof key !== "string" || !key) return null;
  const d = hash(key);
  let found = null;
  for (const c of list) if (timingSafeEqual(c.digest, d)) found = c.client;
  return found;
}

const reply = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Valide le payload : champs connus seulement, types et bornes stricts. Renvoie un message d'erreur ou null. */
export function validate(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "payload JSON attendu";
  const allowed = ["installation", "version", "env", "date", "connectors", "requests", "seats"];
  const extra = Object.keys(p).filter((k) => !allowed.includes(k));
  if (extra.length) return `champs non autorisés : ${extra.join(", ")}`; // garde-fou : rien d'autre ne doit arriver ici
  if (p.installation !== undefined && (typeof p.installation !== "string" || !UUID.test(p.installation))) return "installation : UUID v4 attendu"; // optionnel : hubs antérieurs à 1.3.2
  if (typeof p.version !== "string" || !SEMVER.test(p.version)) return "version : X.Y.Z attendu";
  if (p.env !== undefined && !["PRODUCTION", "PRE-PROD"].includes(p.env)) return "env : PRODUCTION ou PRE-PROD";
  if (p.date !== undefined && (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date))) return "date : AAAA-MM-JJ attendu";
  if (!p.connectors || typeof p.connectors !== "object" || Array.isArray(p.connectors)) return "connectors doit être un objet de booléens";
  const names = Object.keys(p.connectors);
  if (names.length > 20 || names.some((n) => !/^[a-z0-9_-]{1,32}$/.test(n)) || Object.values(p.connectors).some((v) => typeof v !== "boolean")) return "connectors doit être un objet de booléens";
  if (!Number.isInteger(p.requests) || p.requests < 0 || p.requests > 1e9) return "requests doit être un entier positif";
  if (p.seats !== undefined && (!Number.isInteger(p.seats) || p.seats < 0 || p.seats > 1e6)) return "seats doit être un entier positif"; // optionnel : hubs antérieurs à 1.2
  return null;
}

/** Compare deux versions X.Y.Z (une préversion passe avant la version finale). */
export function compareVersions(a, b) {
  const parse = (v) => { const [core, pre] = String(v).split("-"); return [...core.split(".").map(Number), pre ? 0 : 1]; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

// ---------- Persistance ----------
/** Stockage en mémoire de l'instance (tests et usage local) : même interface que DynamoDB. */
export function memoryStore() {
  const items = new Map();
  return {
    async put(item) { const prev = items.get(item.id); items.set(item.id, { ...item, firstSeen: prev?.firstSeen ?? item.lastSeen }); },
    async list() { return [...items.values()]; },
  };
}

// Conversion minimale vers le format DynamoDB : chaînes, nombres, booléens, tableaux et objets.
const toAttr = (v) => (typeof v === "string" ? { S: v } : typeof v === "number" ? { N: String(v) } : typeof v === "boolean" ? { BOOL: v }
  : v === null || v === undefined ? { NULL: true } : Array.isArray(v) ? { L: v.map(toAttr) } : { M: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toAttr(x)])) });
const fromAttr = (a) => ("S" in a ? a.S : "N" in a ? Number(a.N) : "BOOL" in a ? a.BOOL : "NULL" in a ? null : "L" in a ? a.L.map(fromAttr)
  : Object.fromEntries(Object.entries(a.M).map(([k, x]) => [k, fromAttr(x)])));

/** Stockage DynamoDB : une ligne par installation (clé `id`), mise à jour à chaque contact ; `firstSeen` conservé. */
export function dynamoStore(table, { client, UpdateItemCommand, ScanCommand }) {
  return {
    async put(item) {
      const { id, ...fields } = item;
      const names = Object.keys(fields);
      await client.send(new UpdateItemCommand({
        TableName: table,
        Key: { id: { S: id } },
        UpdateExpression: `SET ${names.map((n, i) => `#f${i} = :v${i}`).join(", ")}, #first = if_not_exists(#first, :now)`,
        ExpressionAttributeNames: { ...Object.fromEntries(names.map((n, i) => [`#f${i}`, n])), "#first": "firstSeen" },
        ExpressionAttributeValues: { ...Object.fromEntries(names.map((n, i) => [`:v${i}`, toAttr(fields[n])])), ":now": { S: item.lastSeen } },
      }));
    },
    async list() {
      const out = [];
      let ExclusiveStartKey;
      do {
        const r = await client.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
        for (const it of r.Items || []) out.push(fromAttr({ M: it }));
        ExclusiveStartKey = r.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return out;
    },
  };
}

let current = null;
/** Stockage courant : injecté par les tests, DynamoDB si TELEMETRY_TABLE est renseignée, mémoire sinon. */
async function store() {
  if (current) return current;
  if (!process.env.TELEMETRY_TABLE) return (current = memoryStore());
  const sdk = await import("@aws-sdk/client-dynamodb"); // fourni par le runtime Lambda Node 22 : rien à empaqueter
  return (current = dynamoStore(process.env.TELEMETRY_TABLE, { client: new sdk.DynamoDBClient({}), UpdateItemCommand: sdk.UpdateItemCommand, ScanCommand: sdk.ScanCommand }));
}
export const setStore = (s) => { current = s; };

// ---------- Fonction « telemetry » (POST /api/v1/telemetry) ----------
export async function telemetry(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const list = clients();
  if (!list.length) { console.error("[clevoa] CLEVOA_KEYS vide : aucune clé acceptée"); return reply(503, { status: "unavailable" }); } // fermé par défaut, sans détail pour l'appelant
  const client = identify(headers["x-clevoa-key"], list);
  if (!client) return reply(401, { status: "unauthorized", error: "clé client absente ou inconnue" });

  if ((event.body || "").length > MAX_BODY * 2) return reply(413, { status: "invalid", error: "payload trop volumineux" }); // avant tout décodage
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString() : event.body || "";
  if (Buffer.byteLength(raw) > MAX_BODY) return reply(413, { status: "invalid", error: "payload trop volumineux" });
  let p;
  try { p = JSON.parse(raw); } catch { return reply(400, { status: "invalid", error: "JSON invalide" }); }
  const err = validate(p);
  if (err) return reply(400, { status: "invalid", error: err });

  const now = new Date();
  // Fiche « client#installation#environnement » : une autre clé ne peut ni la lire ni l'écraser, et une pré-production restaurée
  // depuis une sauvegarde de production (même identifiant) garde sa propre fiche.
  const installation = p.installation ?? "ancienne"; // hubs antérieurs à 1.3.2 : une fiche par client et environnement
  const item = {
    id: `${client}#${installation}#${p.env ?? "inconnu"}`, client, installation, version: p.version, env: p.env ?? null, connectors: p.connectors,
    requests: p.requests, seats: p.seats ?? null, reportedDate: p.date ?? null, lastSeen: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + Number(env("RETENTION_DAYS", "400")) * 86400, // TTL DynamoDB (secondes)
  };
  try { await (await store()).put(item); }
  catch (e) { console.error("[clevoa] échec d'enregistrement", e.name); return reply(500, { status: "error", error: "enregistrement impossible" }); }
  console.log("[clevoa] contact", JSON.stringify({ id: item.id, version: item.version, env: item.env, requests: item.requests, seats: item.seats }));

  const body = { status: "active", recorded: item.lastSeen };
  if (process.env.MIN_VERSION) body.minimum = process.env.MIN_VERSION; // le hub signale dans ses journaux une version sous le minimum
  if (process.env.LATEST_VERSION) body.latest = process.env.LATEST_VERSION;
  return reply(200, body);
}

// ---------- Fonction « report » (planifiée chaque jour) ----------
/** Installations silencieuses (aucun contact depuis SILENCE_HOURS heures, 48 par défaut) et versions sous MIN_VERSION.
 *  Au-delà de SILENCE_MAX_DAYS jours (30 par défaut), une installation muette est rangée parmi les « perdues » sans alerte :
 *  réinstallation, passage d'un hub antérieur à 1.3.2, fiche à retirer (README). L'alerte ne devient pas un bruit de fond. */
export async function report(_event = {}, { now = Date.now(), publish } = {}) {
  const items = await (await store()).list();
  const silenceMs = Number(env("SILENCE_HOURS", "48")) * 3600_000;
  const min = process.env.MIN_VERSION;
  const row = (i) => ({ id: i.id, client: i.client, env: i.env, version: i.version, lastSeen: i.lastSeen });
  const lostMs = Number(env("SILENCE_MAX_DAYS", "30")) * 86400_000;
  const age = (i) => now - Date.parse(i.lastSeen);
  const silent = items.filter((i) => age(i) > silenceMs && age(i) <= lostMs).map(row);
  const lost = items.filter((i) => age(i) > lostMs).map(row);
  const outdated = min ? items.filter((i) => age(i) <= lostMs && compareVersions(i.version, min) < 0).map(row) : [];
  const result = { generatedAt: new Date(now).toISOString(), total: items.length, silent, outdated, lost, installations: items.map(row) };
  console.log("[clevoa] rapport", JSON.stringify({ total: result.total, silent: silent.length, outdated: outdated.length, lost: lost.length }));
  for (const s of silent) console.log("[clevoa] ALERTE silence", JSON.stringify(s));
  for (const o of outdated) console.log("[clevoa] ALERTE version", JSON.stringify(o));
  if ((silent.length || outdated.length) && process.env.ALERT_TOPIC_ARN) {
    const text = [`Installations : ${items.length}`, `Silencieuses depuis plus de ${env("SILENCE_HOURS", "48")} h : ${silent.length}`,
      ...silent.map((s) => `  - ${s.id} (${s.env ?? "?"}, ${s.version}) dernier contact ${s.lastSeen}`),
      `Sous la version minimale ${min ?? "-"} : ${outdated.length}`, ...outdated.map((o) => `  - ${o.id} (${o.env ?? "?"}) en ${o.version}`)].join("\n");
    const send = publish ?? (async (subject, message) => {
      const sns = await import("@aws-sdk/client-sns"); // fourni par le runtime Lambda Node 22
      await new sns.SNSClient({}).send(new sns.PublishCommand({ TopicArn: process.env.ALERT_TOPIC_ARN, Subject: subject, Message: message }));
    });
    try { await send("Clevoa AI Gateway : installations à surveiller", text); }
    catch (e) { result.alertError = e.name; console.error("[clevoa] échec de l'alerte SNS", e.name); } // pas d'échec de la fonction : pas de doublon par nouvel essai
  }
  return result;
}
