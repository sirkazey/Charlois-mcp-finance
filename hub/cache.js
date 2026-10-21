// Mini-cache en mémoire de la STRUCTURE des tables, par utilisateur et par système.
// Il expire chaque nuit à CUTOFF h et se recharge à la demande avec le jeton de l'appelant :
// pas de compte technique, chacun voit la structure selon ses propres droits.
// Les données métier ne sont jamais mises en cache.
const CUTOFF = 3; // heure locale du conteneur (TZ)
const mem = new Map(); // "key:system" -> { at, data }

const lastCutoff = () => { const d = new Date(); d.setHours(CUTOFF, 0, 0, 0); if (d > Date.now()) d.setDate(d.getDate() - 1); return d; };

/** Renvoie la structure en cache si elle date d'après la dernière coupure nocturne, sinon la recharge via `load()`. */
export async function cachedSchema(key, system, load) {
  const id = `${key}:${system}`, hit = mem.get(id);
  if (hit && hit.at > lastCutoff()) return hit.data;
  const data = await load();
  mem.set(id, { at: new Date(), data });
  return data;
}

export const schemaAge = (key, system) => mem.get(`${key}:${system}`)?.at ?? null;
