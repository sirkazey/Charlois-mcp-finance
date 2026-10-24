// Télémétrie Clevoa : un HTTPS POST au démarrage puis chaque jour à 03:00, réduit à des compteurs.
// Payload : identifiant aléatoire de l'installation, version du hub, environnement, état de configuration des connecteurs (booléens),
// compteur brut de requêtes MCP, nombre de sièges (collaborateurs ayant connecté au moins un outil : un entier, aucune identité).
// Jamais de donnée utilisateur, de jeton, de requête ni de résultat. Désactivée si CLEVOA_KEY est vide.
// Ne bloque jamais le hub : délai de 10 s par envoi, trois nouveaux essais espacés après un échec, puis l'horaire quotidien.
import { VERSION, APP_ENV } from "./version.js";

const URL_ = process.env.CLEVOA_URL || "https://clevoa.fr/api/v1/telemetry";
const KEY = process.env.CLEVOA_KEY || "";
const HOUR = 3;
const TIMEOUT = 10_000;
let requests = 0;
export const count = () => { requests++; };

/** Construit le payload à partir des connecteurs (configuré = vrai système joignable, simulateur = faux). */
export const payload = (connectors, seats = 0, installation) => ({
  ...(installation ? { installation } : {}),
  version: VERSION,
  env: APP_ENV,
  date: new Date().toISOString().slice(0, 10),
  connectors: Object.fromEntries(connectors.map((c) => [c.id, !c.mock && !!(c.oauth?.clientId || c.apiKey)])),
  requests,
  seats, // fourni par le hub (store.seats) : le module ne lit jamais le store lui-même
});

/** Vrai si la version a est strictement inférieure à b (X.Y.Z ; une préversion passe avant la version finale, comme côté Clevoa). */
const older = (a, b) => {
  const parse = (v) => { const [core, pre] = String(v).split("-"); return [...core.split(".").map(Number), pre ? 0 : 1]; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

/** Envoie le payload et remet le compteur à zéro. Renvoie le statut annoncé par Clevoa, ou null en cas d'échec. */
export async function send(connectors, seats = () => 0, installation = () => undefined) {
  if (!KEY) return null;
  try {
    const body = payload(connectors, seats(), installation());
    // redirect "error" : la clé et le payload ne partent jamais vers une autre adresse que CLEVOA_URL.
    const r = await fetch(URL_, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "X-Clevoa-Key": KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
    const data = await r.json().catch(() => ({}));
    if (r.ok) requests = Math.max(0, requests - body.requests); // les appels comptés pendant l'envoi restent pour le prochain
    // Rien de la réponse n'est journalisé tel quel : statut court en minuscules, version X.Y.Z stricte, sinon ignorés.
    const status = typeof data.status === "string" && /^[a-z]{1,20}$/.test(data.status) ? data.status : "";
    const minimum = typeof data.minimum === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(data.minimum) ? data.minimum : null;
    console.log(`[telemetry] ${r.status} ${status} (${body.requests} requêtes)`);
    if (r.ok && minimum && older(VERSION, minimum))
      console.warn(`[telemetry] version ${VERSION} inférieure au minimum ${minimum} annoncé par Clevoa : mise à jour à planifier (docs/admin/exploitation.md)`);
    return r.ok ? status || "ok" : null;
  } catch (e) {
    console.error(`[telemetry] échec : ${e.name === "TimeoutError" ? "délai dépassé" : e.message}`);
    return null;
  }
}

const RETRY = [60_000, 300_000, 1_800_000]; // après un échec : 1 min, 5 min, 30 min, puis retour à l'horaire quotidien

/** Démarre : envoi immédiat, puis chaque jour à HOUR:00 (recalculé à chaque passage, donc insensible au changement d'heure).
 *  Un envoi en échec (Clevoa injoignable) est retenté à 1, 5 puis 30 minutes avant de retomber sur l'horaire quotidien. */
export function start(connectors, seats = () => 0, installation = () => undefined) {
  if (!KEY) return console.log("[telemetry] désactivée (CLEVOA_KEY vide)");
  const next = () => { const d = new Date(); d.setHours(HOUR, 0, 0, 0); if (d <= Date.now()) d.setDate(d.getDate() + 1); return d - Date.now(); };
  let failures = 0;
  const tick = async () => {
    failures = (await send(connectors, seats, installation)) ? 0 : failures + 1;
    setTimeout(tick, failures && failures <= RETRY.length ? RETRY[failures - 1] : next()).unref();
  };
  tick();
}
