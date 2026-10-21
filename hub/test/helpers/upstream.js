// Serveur HTTP mock "amont" qui imite à la fois Salesforce (REST + OAuth2) et Sage X3 Syracuse.
// Il enregistre chaque requête reçue (méthode, chemin, query, en-têtes, corps) pour que les tests
// vérifient notamment que l'en-tête Authorization transmis est bien le jeton de l'utilisateur.
import { createServer } from "node:http";

export const SF_V = "v62.0";

export async function startUpstream() {
  const state = {
    requests: [],   // { method, path, query, headers, body }
    failNext: [],   // { pathIncludes, status, body } consommés à la première requête correspondante
  };
  let base = "";

  const json = (res, status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  function handle(req, res, rawBody) {
    const u = new URL(req.url, "http://mock");
    const path = decodeURIComponent(u.pathname);
    const query = Object.fromEntries(u.searchParams);
    state.requests.push({ method: req.method, path, query, headers: req.headers, body: rawBody });

    const fi = state.failNext.findIndex((f) => path.includes(f.pathIncludes));
    if (fi !== -1) {
      const f = state.failNext.splice(fi, 1)[0];
      return json(res, f.status, f.body ?? [{ errorCode: "INVALID_SESSION_ID", message: "Session expired or invalid" }]);
    }

    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    // ---- OAuth2 Salesforce ----
    if (path === "/services/oauth2/token" && req.method === "POST") {
      const p = new URLSearchParams(rawBody);
      if (p.get("grant_type") === "refresh_token")
        return json(res, 200, { access_token: "sf-token-refreshed", instance_url: base, token_type: "Bearer", issued_at: "1" });
      if (p.get("grant_type") === "authorization_code")
        return json(res, 200, { access_token: `sf-token-${p.get("code")}`, refresh_token: `sf-refresh-${p.get("code")}`, instance_url: base, token_type: "Bearer", id: `${base}/id/00D/005` });
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/services/oauth2/userinfo") {
      if (!bearer) return json(res, 401, { error: "no bearer" });
      return json(res, 200, { email: "alice@example.com", name: "Alice Martin", user_id: "005" });
    }

    // ---- OAuth2 "Entra" pour Sage X3 ----
    if (path === "/oauth/token" && req.method === "POST") {
      const p = new URLSearchParams(rawBody);
      if (p.get("grant_type") === "refresh_token")
        return json(res, 200, { access_token: "sage-token-refreshed", token_type: "Bearer" });
      if (p.get("grant_type") === "authorization_code")
        return json(res, 200, { access_token: `sage-token-${p.get("code")}`, refresh_token: `sage-refresh-${p.get("code")}`, token_type: "Bearer" });
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/oauth/userinfo") {
      if (!bearer) return json(res, 401, { error: "no bearer" });
      return json(res, 200, { email: "alice@example.com" });
    }

    // ---- Salesforce REST ----
    if (path.startsWith(`/services/data/${SF_V}/`)) {
      if (!bearer) return json(res, 401, [{ errorCode: "INVALID_SESSION_ID", message: "no bearer" }]);
      const rest = path.slice(`/services/data/${SF_V}/`.length);
      if (rest === "limits") return json(res, 200, { DailyApiRequests: { Max: 15000, Remaining: 14990 } });
      if (rest === "sobjects") {
        return json(res, 200, { sobjects: [
          { name: "Account", label: "Compte", queryable: true },
          { name: "Contact", label: "Contact", queryable: true },
          { name: "Opportunity", label: "Opportunité", queryable: true },
          { name: "Lead", label: "Piste", queryable: true },
          { name: "AccountHistory", label: "Historique", queryable: false },
        ] });
      }
      const d = rest.match(/^sobjects\/(\w+)\/describe$/);
      if (d) {
        if (d[1] === "Unknown__c") return json(res, 404, [{ errorCode: "NOT_FOUND", message: "The requested resource does not exist" }]);
        return json(res, 200, { name: d[1], fields: [
          { name: "Id", type: "id", label: "ID" },
          { name: "Name", type: "string", label: `Nom ${d[1]}` },
          { name: "OwnerId", type: "reference", label: "Propriétaire", referenceTo: ["User"] },
        ] });
      }
      if (rest === "query") {
        const q = query.q || "";
        if (/FROM\s+Opportunity/i.test(q)) {
          return json(res, 200, { totalSize: 3, done: false, nextRecordsUrl: `/services/data/${SF_V}/query/01g-2000`, records: [
            { attributes: { type: "Opportunity", url: "/x/1" }, Id: "006A", Name: "Opp A", Amount: 100 },
            { attributes: { type: "Opportunity", url: "/x/2" }, Id: "006B", Name: "Opp B", Amount: 200 },
          ] });
        }
        return json(res, 200, { totalSize: 2, done: true, records: [
          { attributes: { type: "Account", url: "/x/1" }, Id: "001A", Name: "ACME" },
          { attributes: { type: "Account", url: "/x/2" }, Id: "001B", Name: "Globex" },
        ] });
      }
      if (rest === "query/01g-2000") {
        return json(res, 200, { totalSize: 3, done: true, records: [
          { attributes: { type: "Opportunity", url: "/x/3" }, Id: "006C", Name: "Opp C", Amount: 300 },
        ] });
      }
      return json(res, 404, [{ errorCode: "NOT_FOUND", message: `mock: ${path}` }]);
    }

    // ---- Sage X3 Syracuse ----
    if (path.startsWith("/api1/x3/erp/PROD/")) {
      if (!bearer) return json(res, 401, { $diagnoses: [{ $severity: "error", $message: "no bearer" }] });
      const rest = path.slice("/api1/x3/erp/PROD/".length);
      let m = rest.match(/^\$prototypes\('(\w+)\.\$query'\)$/);
      if (m) {
        if (m[1] === "NOPE") return json(res, 404, { $diagnoses: [{ $severity: "error", $message: "unknown representation" }] });
        return json(res, 200, { $properties: {
          [`${m[1]}_NUM`]: { $type: "application/x-string", $title: "Numéro" },
          AMTATI: { $type: "application/x-decimal", $title: "Montant TTC" },
        } });
      }
      m = rest.match(/^(\w+)\('(.*)'\)$/);
      if (m) {
        if (query.representation !== `${m[1]}.$details`) return json(res, 400, { $diagnoses: [{ $message: "representation attendue" }] });
        return json(res, 200, { $uuid: "u-1", $etag: 3, $url: `${base}${path}`, NUM: m[2], REP: m[1] });
      }
      m = rest.match(/^(\w+)$/);
      if (m) {
        if (query.representation !== `${m[1]}.$query`) return json(res, 400, { $diagnoses: [{ $message: "representation attendue" }] });
        return json(res, 200, { $resources: [
          { $uuid: "r-1", $url: `${base}${path}('C0001')`, BPRNUM: "C0001", BPRNAM: "ACME" },
          { $uuid: "r-2", $url: `${base}${path}('C0002')`, BPRNUM: "C0002", BPRNAM: "Globex" },
        ] });
      }
      return json(res, 404, { $diagnoses: [{ $message: `mock: ${path}` }] });
    }

    json(res, 404, { error: `mock: route inconnue ${req.method} ${path}` });
  }

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => handle(req, res, body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;

  return {
    url: base,
    state,
    /** Requêtes dont le chemin contient `fragment` (et, optionnellement, de cette méthode). */
    requests: (fragment, method) => state.requests.filter((r) => r.path.includes(fragment) && (!method || r.method === method)),
    reset: () => { state.requests.length = 0; state.failNext.length = 0; },
    /** La prochaine requête dont le chemin contient `pathIncludes` répondra `status`. */
    failNext: (pathIncludes, status = 401, body) => state.failNext.push({ pathIncludes, status, body }),
    stop: () => new Promise((r) => server.close(r)),
  };
}
