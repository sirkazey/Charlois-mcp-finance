// Rend les tableaux Markdown du rapport à partir de loadtest/results/*.json (usage : node loadtest/tables.js > tableaux.md).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = join(dirname(fileURLToPath(import.meta.url)), "results");
const load = (n) => existsSync(join(DIR, `${n}.json`)) ? JSON.parse(readFileSync(join(DIR, `${n}.json`), "utf8")) : null;
const f = (v) => (v == null ? "–" : v);
const sum = (o, re) => Object.entries(o || {}).filter(([k]) => re.test(k)).reduce((s, [, n]) => s + n, 0);
const bk = (b) => Object.values(b || {}).map((x) => x.p95).filter((x) => x != null);
const row = (s) => `| ${s.scenario} | ${s.registeredUsers} | ${s.activeUsers} (${s.sseUsers} SSE) | ${f(s.targetPerMin)} | ${s.achievedPerMin} | ${s.notEmitted} | ${s.calls} | ${s.ok} | ${s.hubOwnErrors} (${s.hubOwnErrorRate} %) | ${s.configuredLimitRefusals} | ${s.backendErrors} | ${s.latencyAllOk.p50} / ${s.latencyAllOk.p95} / ${s.latencyAllOk.p99} | ${bk(s.backend).length ? Math.max(...bk(s.backend)) : "–"} | ${s.maxInflight} | ${s.hub.cpuAvg} / ${s.hub.cpuMax} | ${s.hub.rssStartMb} → ${s.hub.rssEndMb} (max ${s.hub.rssMaxMb}) | ${s.violations.length} |`;

const main = ["reference_http", "reference_sse", "nominal", "soutenue", "pointe", "stress"].map(load).filter(Boolean);
console.log("### Synthèse par scénario\n");
console.log("| Scénario | Enregistrés | Actifs | Visé /min | Servi /min | Non émis | Appels | OK | Erreurs hub | Plafond configuré | Erreurs backend | p50 / p95 / p99 e2e (ms, OK) | p95 bouchon max (ms) | En cours max | CPU hub moy / max (%) | RSS hub (Mo) | Violations isolation |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const s of main) console.log(row(s));

console.log("\n### Latence de bout en bout par outil (ms, appels OK)\n");
const tools = [...new Set(main.flatMap((s) => Object.keys(s.latencyPerTool)))];
console.log(`| Outil | ${main.map((s) => `${s.scenario} p50 / p95`).join(" | ")} |`);
console.log(`|---|${main.map(() => "---").join("|")}|`);
for (const t of tools) console.log(`| ${t} | ${main.map((s) => { const v = s.latencyPerTool[t]; return v ? `${f(v.p50)} / ${f(v.ok_p95)} (n=${v.n}${Object.keys(v.errors).length ? ", err " + JSON.stringify(v.errors) : ""})` : "–"; }).join(" | ")} |`);

console.log("\n### Erreurs par type\n");
const types = [...new Set(main.flatMap((s) => Object.keys(s.errorsByType)))].filter((t) => t !== "ok");
if (types.length) { console.log(`| Scénario | ${types.join(" | ")} |`); console.log(`|---|${types.map(() => "---").join("|")}|`); for (const s of main) console.log(`| ${s.scenario} | ${types.map((t) => s.errorsByType[t] || 0).join(" | ")} |`); } else console.log("Aucune erreur sur les scénarios de charge.");

console.log("\n### Temps de service côté bouchons (ms, p50 / p95 / p99)\n");
const fams = ["sagex3", "salesforce", "graph", "dropbox", "myreport"];
console.log(`| Scénario | ${fams.join(" | ")} |`); console.log(`|---|${fams.map(() => "---").join("|")}|`);
for (const s of main) console.log(`| ${s.scenario} | ${fams.map((k) => { const b = s.backend[k]; return b ? `${b.p50} / ${b.p95} / ${b.p99} (n=${b.count})` : "–"; }).join(" | ")} |`);

const st = load("stress");
if (st?.windows) { console.log("\n### Montée en charge (stress), fenêtres de 30 s\n"); console.log("| t (s) | Actifs démarrés | Servis / 30 s | ≈ /min | p95 OK (ms) | Erreurs | RSS hub (Mo) |"); console.log("|---|---|---|---|---|---|---|"); for (const w of st.windows) console.log(`| ${w.t} | ${w.activeStarted} | ${w.completed} | ${w.perMin} | ${f(w.p95)} | ${w.errors} | ${f(w.rssMb)} |`); }

const d = load("defaillances");
if (d) {
  console.log("\n### Défaillances\n");
  console.log("| Phase | Actifs | Appels | OK | Erreurs hub | Plafond | Erreurs backend (types) | p50 / p95 e2e OK (ms) | p95 bouchon (ms) | RSS hub (Mo) |"); console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const k of ["sage_lent_2s", "pendant_timeout", "salesforce_429", "graph_500"]) { const s = d[k] || load(`defaillances_${k}`); if (!s) continue; const bt = Object.entries(s.errorsByType).filter(([t]) => t.startsWith("backend_")).map(([t, n]) => `${t} ${n}`).join(", ") || "0";
    console.log(`| ${k} | ${s.activeUsers} | ${s.calls} | ${s.ok} | ${s.hubOwnErrors} | ${s.configuredLimitRefusals} | ${bt} | ${s.latencyAllOk.p50} / ${s.latencyAllOk.p95} | ${bk(s.backend).length ? Math.max(...bk(s.backend)) : "–"} | ${s.hub.rssStartMb} → ${s.hub.rssEndMb} |`); }
  console.log(`\nSage au-delà du délai du hub (bouchon à 35 s, 3 appels simultanés) : ${d.timeout.calls.map((c) => `${c.type} après ${c.ms} ms`).join(" ; ")} ; message : « ${d.timeout.calls[0].msg} ».`);
  console.log(`Pendant ces 3 appels bloqués, les autres outils (5 actifs) : p95 ${d.timeout.othersDuringTimeout.p95} ms, erreurs hub ${d.timeout.othersDuringTimeout.hubOwnErrors}.`);
  console.log(`\nReconnexions SSE brutales : ${d.sessions.reconnexions.cycles} cycles ouverture → appel → coupure, ${d.sessions.reconnexions.ok} OK, ${d.sessions.reconnexions.errors} erreurs.`);
  console.log(`Sessions SSE abandonnées : 40 ouvertes, RSS hub ${d.sessions.abandon.rssBeforeMb} Mo avant → ${d.sessions.abandon.rssWith20OpenMb} Mo avec 20 ouvertes → ${d.sessions.abandon.rssAfterMb} Mo après coupure de toutes. Hub arrêté : ${d.sessions.hubExited ? "OUI" : "non"}.`);
}
const c = load("campagne");
if (c) { const hub = c.samples.filter((s) => s.label === "hub"); console.log(`\n### Processus hub sur toute la campagne\n\nDurée ${c.startedAt} → ${c.finishedAt}. RSS ${hub[0]?.rssMb} Mo au début, ${hub[hub.length - 1]?.rssMb} Mo à la fin, maximum ${Math.max(...hub.map((s) => s.rssMb))} Mo ; CPU maximum ${Math.max(...hub.map((s) => s.cpu))} % d'un cœur. Arrêt inattendu : ${c.hubExited && c.hubExited.sig !== "SIGTERM" ? JSON.stringify(c.hubExited) : "aucun"}.`); }
