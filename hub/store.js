// Persistance minimale : un fichier JSON dans le volume /data.
// users[key] = { email, salesforce: {tokens}, sagex3: {tokens} }
// La "key" est le secret que l'utilisateur met dans son client MCP.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";

const DIR = process.env.DATA_DIR || "./data";
const FILE = `${DIR}/users.json`;
mkdirSync(DIR, { recursive: true });

let db = { users: {} };
try { db = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* premier démarrage */ }

function save() {
  writeFileSync(FILE + ".tmp", JSON.stringify(db, null, 2));
  renameSync(FILE + ".tmp", FILE); // écriture atomique
}

export const store = {
  // Object.hasOwn : refuse "__proto__" & co (sinon un jeton pourrait être partagé via le prototype).
  get: (key) => (typeof key === "string" && Object.hasOwn(db.users, key) && db.users[key]) || null,
  create() {
    const key = randomBytes(24).toString("base64url");
    db.users[key] = { createdAt: new Date().toISOString() };
    save();
    return key;
  },
  setTokens(key, system, tokens, email) {
    const u = store.get(key); if (!u) return;
    u[system] = { ...u[system], ...tokens, updatedAt: new Date().toISOString() };
    if (email) u.email = email;
    save();
  },
  clearTokens(key, system) {
    const u = store.get(key); if (!u) return;
    delete u[system]; save();
  },
};
