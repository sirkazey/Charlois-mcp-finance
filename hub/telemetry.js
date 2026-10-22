// Télémétrie Clevoa : un HTTPS POST au démarrage puis chaque jour à 03:00, 100 % anonyme.
// Payload : version du hub, environnement, état de configuration des connecteurs (booléens), compteur brut de requêtes MCP du jour.
// Jamais de donnée utilisateur, de jeton, de requête ni de résultat. Désactivée si CLEVOA_KEY est vide.
import { VERSION, APP_ENV } from "./version.js";
export { VERSION };

const URL_ = process.env.CLEVOA_URL || "https://clevoa.fr/api/v1/telemetry";
const KEY = process.env.CLEVOA_KEY || "";
const HOUR = 3;
let requests = 0;
export const count = () => { requests++; };

/** Construit le payload anonyme à partir des connecteurs (configuré = vrai système joignable, simulateur = faux). */
export const payload = (connectors) => ({
  version: VERSION,
  env: APP_ENV,
  date: new Date().toISOString().slice(0, 10),
  connectors: Object.fromEntries(connectors.map((c) => [c.id, !c.mock && !!(c.oauth?.clientId || c.apiKey)])),
  requests,
});

/** Envoie le payload et remet le compteur à zéro. Renvoie le statut de licence annoncé par Clevoa, ou null. */
export async function send(connectors) {
  if (!KEY) return null;
  const body = payload(connectors);
  try {
    const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json", "X-Clevoa-Key": KEY }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (r.ok) requests = 0;
    console.log(`[telemetry] ${r.status} ${data.status ?? ""} (${body.requests} requêtes)`);
    return r.ok ? data.status ?? "ok" : null;
  } catch (e) {
    console.error(`[telemetry] échec : ${e.message}`);
    return null;
  }
}

const RETRY = [60_000, 300_000, 1_800_000]; // après un échec : 1 min, 5 min, 30 min, puis retour à l'horaire quotidien

/** Démarre : envoi immédiat, puis chaque jour à HOUR:00 (recalculé à chaque passage, donc insensible au changement d'heure).
 *  Un envoi en échec (Clevoa injoignable) est retenté à 1, 5 puis 30 minutes avant de retomber sur l'horaire quotidien. */
export function start(connectors) {
  if (!KEY) return console.log("[telemetry] désactivée (CLEVOA_KEY vide)");
  const next = () => { const d = new Date(); d.setHours(HOUR, 0, 0, 0); if (d <= Date.now()) d.setDate(d.getDate() + 1); return d - Date.now(); };
  let failures = 0;
  const tick = async () => {
    failures = (await send(connectors)) ? 0 : failures + 1;
    setTimeout(tick, failures ? RETRY[Math.min(failures, RETRY.length) - 1] : next()).unref();
  };
  tick();
}
