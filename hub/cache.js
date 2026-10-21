// Mini-cache local de la structure des tables (fichier JSON), rafraîchi une fois par nuit.
// Les données métier ne sont JAMAIS mises en cache : chaque requête interroge l'outil en direct.
import { readFileSync, writeFileSync } from "node:fs";
import { store } from "./store.js";
import { withToken } from "./oauth.js";

const FILE = `${process.env.DATA_DIR || "./data"}/schema.json`;
const HOUR = Number(process.env.CACHE_REFRESH_HOUR ?? 3); // heure locale du conteneur (TZ)

let cache = {};
try { cache = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* vide au premier démarrage */ }

export const schemaCache = {
  get: (system) => cache[system]?.data || null,
  updatedAt: (system) => cache[system]?.updatedAt || null,

  /** Rafraîchit le schéma d'un connecteur avec le jeton de n'importe quel utilisateur connecté (structure identique pour tous). */
  async refresh(connector, key) {
    key ??= store.anyConnectedKey(connector.id);
    if (!key) return console.log(`[cache] ${connector.id} : aucun utilisateur connecté, schéma non rafraîchi`);
    try {
      const data = await withToken(connector, key, (t) => connector.schema(t));
      cache[connector.id] = { updatedAt: new Date().toISOString(), data };
      writeFileSync(FILE, JSON.stringify(cache));
      console.log(`[cache] ${connector.id} : schéma rafraîchi`);
    } catch (e) {
      console.error(`[cache] ${connector.id} : échec – ${e.message}`);
    }
  },

  /** Planifie le rafraîchissement nocturne de tous les connecteurs. */
  scheduleNightly(connectors) {
    const run = () => connectors.forEach((c) => this.refresh(c));
    const next = new Date(); next.setHours(HOUR, 0, 0, 0);
    if (next <= Date.now()) next.setDate(next.getDate() + 1);
    setTimeout(() => { run(); setInterval(run, 86_400_000); }, next - Date.now());
    console.log(`[cache] prochain rafraîchissement : ${next.toISOString()}`);
  },
};
