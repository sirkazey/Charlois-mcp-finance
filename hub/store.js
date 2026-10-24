// Persistance minimale : un fichier chiffré AES-256-GCM dans le volume /data, déchiffré en mémoire seulement.
// users[key] = { email, sso: { sub, tid, upn, name, at }, salesforce: {tokens}, sagex3: {tokens}, sharepoint, dropbox, myreport }
// La "key" est le secret que l'utilisateur met dans son client MCP. La clé maîtresse vient de ENCRYPTION_KEY.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from "node:crypto";

const DIR = process.env.DATA_DIR || "./data";
const FILE = `${DIR}/users.json`;
const SECRET = process.env.ENCRYPTION_KEY || "";
if (SECRET.length < 32) { console.error("[store] ENCRYPTION_KEY absente ou trop courte (32 caractères minimum, ex. openssl rand -hex 32)"); process.exit(1); }
const MASTER = createHash("sha256").update(SECRET).digest(); // 32 octets = AES-256
mkdirSync(DIR, { recursive: true });

/** Chiffre un texte : "enc1:<iv>:<tag>:<données>" en base64. IV aléatoire à chaque écriture. */
function encrypt(text) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", MASTER, iv, { authTagLength: 16 });
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["enc1", iv, c.getAuthTag(), data].map((p, i) => (i ? p.toString("base64") : p)).join(":");
}
function decrypt(blob) {
  const [, iv, tag, data] = blob.split(":").map((p, i) => (i ? Buffer.from(p, "base64") : p));
  const d = createDecipheriv("aes-256-gcm", MASTER, iv, { authTagLength: 16 }); d.setAuthTag(tag); // tag de 16 octets exigé : un tag tronqué est refusé
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

let db = { users: {} };
try {
  const raw = readFileSync(FILE, "utf8");
  db = JSON.parse(raw.startsWith("enc1:") ? decrypt(raw) : raw); // un ancien fichier en clair est rechiffré à la première écriture
} catch (e) { if (e.code !== "ENOENT") { console.error(`[store] users.json illisible (mauvaise ENCRYPTION_KEY ?) : ${e.message}`); process.exit(1); } }

/** Vrai pour une entrée qui vaut d'être conservée : identité SSO ou au moins un identifiant ; une clé anonyme sans rien n'est jamais persistée. */
const worthKeeping = (u) => !!u.sso || Object.values(u).some((v) => v && typeof v === "object" && (v.access_token || v.apiKey));
function save() {
  const users = Object.fromEntries(Object.entries(db.users).filter(([, u]) => worthKeeping(u)));
  writeFileSync(FILE + ".tmp", encrypt(JSON.stringify({ ...db, users })), { mode: 0o600 });
  renameSync(FILE + ".tmp", FILE); // écriture atomique, jamais en clair sur le disque
}

export const store = {
  // Object.hasOwn : refuse "__proto__" & co (sinon un jeton pourrait être partagé via le prototype).
  get: (key) => (typeof key === "string" && Object.hasOwn(db.users, key) && db.users[key]) || null,
  create() {
    const key = randomBytes(24).toString("base64url");
    db.users[key] = { createdAt: new Date().toISOString() }; // écrit sur disque au premier jeton seulement
    return key;
  },
  setTokens(key, system, tokens, email) {
    const u = store.get(key); if (!u) return;
    u[system] = { ...u[system], ...tokens, updatedAt: new Date().toISOString() };
    if (email && !u.email) u.email = email; // la première identité OAuth fait foi
    save();
  },
  /** Sièges : collaborateurs ayant connecté au moins un outil (jeton OAuth ou identifiant personnel), qu'ils s'en servent ou non. Un simple visiteur du portail ne compte pas. */
  seats: () => Object.values(db.users).filter((u) => Object.values(u).some((v) => v && typeof v === "object" && (v.access_token || v.apiKey))).length,
  clearTokens(key, system) {
    const u = store.get(key); if (!u) return;
    delete u[system]; save();
  },
  // ---- SSO : une identité Entra (oid + locataire) ↔ une clé ----
  findSso: (sub, tid) => Object.keys(db.users).find((k) => db.users[k].sso?.sub === sub && db.users[k].sso?.tid === tid) ?? null,
  setSso(key, { sub, tid, upn, name, email }) {
    const u = store.get(key); if (!u) return;
    u.sso = { sub, tid, upn, name, at: new Date().toISOString() };
    if (email) u.email = email; // l'identité Entra fait foi
    save();
  },
  /** Identifiant de l'installation pour la télémétrie : UUID aléatoire créé au premier appel, conservé dans le fichier chiffré
   *  (il suit donc les sauvegardes et restaurations). Ne dit rien du client ni d'un collaborateur. */
  installationId() {
    if (!db.installation) { db.installation = randomUUID(); save(); }
    return db.installation;
  },
  remove(key) { if (store.get(key)) { delete db.users[key]; save(); } },
  /** Oublie les clés anonymes sans identifiant plus vieilles que maxAgeMs (départs SSO abandonnés) ; rien n'est écrit, elles n'ont jamais été persistées. */
  purge(maxAgeMs) {
    const limit = Date.now() - maxAgeMs;
    for (const [k, u] of Object.entries(db.users)) if (!worthKeeping(u) && Date.parse(u.createdAt) < limit) delete db.users[k];
  },
  /** Nouvelle clé pour le même collaborateur : l'ancienne est révoquée sur-le-champ (clients MCP et portail), identité et jetons suivent. */
  rotate(key) {
    const u = store.get(key); if (!u) return null;
    const fresh = randomBytes(24).toString("base64url");
    db.users[fresh] = u; delete db.users[key]; save();
    return fresh;
  },
};
