// Fonction AWS Lambda "telemetry" : reçoit le POST quotidien d'un hub Charlois, vérifie la clé client,
// enregistre (simulation) les statistiques de volume et répond { status: "active" }.
// Aucune dépendance : Node 20 natif. Le stockage réel (DynamoDB, S3) se branche dans `record()`.

const KEYS = (process.env.CLEVOA_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean); // clés clients acceptées ; vide = toute clé non vide
const stats = []; // simulation d'enregistrement : mémoire de l'instance Lambda (perdue à chaque démarrage à froid)

const reply = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Valide le payload anonyme : version, connecteurs (booléens), compteur de requêtes. Refuse tout champ inattendu. */
function validate(p) {
  if (!p || typeof p !== "object") return "payload JSON attendu";
  const allowed = ["version", "env", "date", "connectors", "requests"];
  const extra = Object.keys(p).filter((k) => !allowed.includes(k));
  if (extra.length) return `champs non autorisés : ${extra.join(", ")}`; // garde-fou anonymat : rien d'autre ne doit arriver ici
  if (typeof p.version !== "string") return "version manquante";
  if (!p.connectors || typeof p.connectors !== "object" || Object.values(p.connectors).some((v) => typeof v !== "boolean")) return "connectors doit être un objet de booléens";
  if (!Number.isInteger(p.requests) || p.requests < 0) return "requests doit être un entier positif";
  return null;
}

/** Enregistre les statistiques de volume (simulation : journal CloudWatch + tableau mémoire). */
function record(key, p) {
  const entry = { receivedAt: new Date().toISOString(), client: key.slice(0, 4) + "…", version: p.version, env: p.env, date: p.date, requests: p.requests, connectors: Object.values(p.connectors).filter(Boolean).length };
  stats.push(entry);
  console.log("[clevoa] stat", JSON.stringify(entry));
  return entry;
}

export async function telemetry(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const key = headers["x-clevoa-key"];
  if (!key || (KEYS.length && !KEYS.includes(key))) return reply(401, { status: "unauthorized", error: "clé client absente ou inconnue" });

  let payload;
  try { payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body || ""); } catch { return reply(400, { status: "invalid", error: "JSON invalide" }); }
  const err = validate(payload);
  if (err) return reply(400, { status: "invalid", error: err });

  const entry = record(key, payload);
  return reply(200, { status: "active", recorded: entry.receivedAt, totalToday: stats.filter((s) => s.date === payload.date).length });
}
