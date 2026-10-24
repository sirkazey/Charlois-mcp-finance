// Campagne de charge reproductible du hub : démarre les bouchons (mock-backends.js) et le hub de la release en processus enfants,
// pré-enregistre N collaborateurs (jetons distincts), puis joue des scénarios d'appels d'outils MCP réels (Streamable HTTP et SSE)
// en boucle ouverte : chaque utilisateur actif émet un appel à cadence fixe, qu'il ait reçu ou non la réponse précédente (au plus
// 5 appels en cours par utilisateur, les suivants sont comptés « non émis »). Mesure côté client (latence de bout en bout, erreurs par
// type), côté bouchon (temps de service, latence injectée comprise) et côté hub (CPU, RSS lus dans /proc). Résultats JSON dans
// loadtest/results/. Usage : node loadtest/run.js [scenarios séparés par des virgules] ; défaut : tous. Jamais vers un système réel.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport, SSEClientTransport } from "./sdk.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(ROOT, "loadtest", "results"); mkdirSync(RESULTS, { recursive: true });
const USERS = Number(process.env.LT_USERS || 50);
const SSE_SHARE = Number(process.env.LT_SSE_SHARE || 0.2); // part des utilisateurs actifs sur le transport SSE (les autres : Streamable HTTP)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- processus
async function startMock() {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, "loadtest", "mock-backends.js")], { env: { PATH: process.env.PATH, PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"] });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${url}/__stats`)).ok) break; } catch {} await sleep(50); }
  return { url, child, control: (c) => fetch(`${url}/__control`, { method: "POST", body: JSON.stringify(c) }).then((r) => r.json()), reset: () => fetch(`${url}/__reset`, { method: "POST" }), stats: () => fetch(`${url}/__stats`).then((r) => r.json()) };
}
function seedUsers(n) {
  const users = {};
  for (let i = 1; i <= n; i++) {
    const m = `usr-${String(i).padStart(2, "0")}`, key = `lt-${m}-${randomBytes(12).toString("base64url")}`;
    users[key] = { createdAt: new Date().toISOString(), email: `${m}@charlois.example`,
      salesforce: { access_token: `sf-token-${m}`, refresh_token: `sf-refresh-${m}`, token_type: "Bearer" },
      sagex3: { apiKey: `sage-key-${m}` }, sharepoint: { access_token: `ms-token-${m}`, refresh_token: `ms-refresh-${m}` },
      dropbox: { access_token: `dbx-token-${m}`, refresh_token: `dbx-refresh-${m}` }, myreport: { apiKey: `mr-token-${m}` } };
  }
  return users;
}
async function startHub(mockUrl, users, env = {}) {
  const port = await freePort(), dataDir = mkdtempSync(join(tmpdir(), "mcp-load-"));
  writeFileSync(join(dataDir, "users.json"), JSON.stringify({ users }));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(ROOT, "hub", "server.js")], { env: {
    PATH: process.env.PATH, TZ: "Europe/Paris", APP_ENV: "preprod", LOG_LEVEL: process.env.LT_LOG_LEVEL || "info", ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    PORT: String(port), PUBLIC_URL: url, DATA_DIR: dataDir,
    SF_LOGIN_URL: mockUrl, SF_MCP_URL: `${mockUrl}/platform/mcp/v1/d/load/platform/sobject-reads`, SF_CLIENT_ID: "x", SF_CLIENT_SECRET: "x",
    SAGE_URL: mockUrl, SAGE_FOLDER: "PROD", SAGE_REPRESENTATIONS: "PINVOICE,BPCUSTOMER",
    MS_LOGIN_URL: `${mockUrl}/ms`, MS_TENANT_ID: "common", MS_CLIENT_ID: "x", MS_CLIENT_SECRET: "x", GRAPH_URL: `${mockUrl}/v1.0`,
    DROPBOX_APP_KEY: "x", DROPBOX_APP_SECRET: "x", DROPBOX_API_URL: mockUrl, DROPBOX_AUTH_URL: mockUrl, DROPBOX_MCP_URL: `${mockUrl}/dropbox-mcp`,
    MYREPORT_MCP_URL: `${mockUrl}/myreport/sse`, MYREPORT_TOOLS: "liste_indicateurs,valeur_indicateur",
    CLEVOA_URL: `${mockUrl}/api/v1/telemetry`, CLEVOA_KEY: "x", ...env } , stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout.on("data", (d) => { logs += d; }); child.stderr.on("data", (d) => { logs += d; });
  let exited = null; child.on("exit", (code, sig) => { exited = { code, sig, at: Date.now() }; });
  for (let i = 0; i < 200; i++) { if (exited) throw new Error(`hub arrêté :\n${logs}`); try { if ((await fetch(`${url}/health`)).ok) break; } catch {} await sleep(50); }
  return { url, child, dataDir, pid: child.pid, logs: () => logs, exited: () => exited, stop: async () => { child.kill("SIGTERM"); await sleep(300); rmSync(dataDir, { recursive: true, force: true }); } };
}
// ---------------------------------------------------------------- mesures /proc
const CLK = 100;
function procSample(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8"), f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const rss = Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)?.[1] || 0) / 1024;
    const fds = (() => { try { return readFileSync(`/proc/${pid}/status`, "utf8").match(/Threads:\s+(\d+)/)?.[1]; } catch { return null; } })();
    return { ticks: Number(f[11]) + Number(f[12]), rssMb: Math.round(rss), threads: Number(fds) };
  } catch { return null; }
}
function sampler(pid, label, store) {
  let last = procSample(pid), lastAt = Date.now();
  const t = setInterval(() => { const s = procSample(pid); if (!s || !last) return; const dt = (Date.now() - lastAt) / 1000; store.push({ at: Date.now(), label, cpu: Math.round((s.ticks - last.ticks) / CLK / dt * 100), rssMb: s.rssMb, threads: s.threads }); last = s; lastAt = Date.now(); }, 1000);
  return () => clearInterval(t);
}
// ---------------------------------------------------------------- utilisateurs virtuels
const MIX = [ // [nom, poids, outil MCP, arguments, marqueur attendu dans la réponse]
  ["sagex3_query", 30, "sagex3_query", () => ({ representation: "PINVOICE", count: 100, orderBy: "ACCDAT desc" }), true],
  ["salesforce_soql", 25, "salesforce_call", () => ({ tool: "soqlQuery", arguments: { q: "SELECT Id, Name FROM Account WHERE Name LIKE 'A%'" } }), true],
  ["sharepoint_list", 15, "sharepoint_list", () => ({ path: "Finance/2026" }), true],
  ["dropbox_list", 10, "dropbox_call", () => ({ tool: "list_folder", arguments: { path: "/Finance" } }), true],
  ["myreport_call", 10, "myreport_call", () => ({ tool: "valeur_indicateur", arguments: { code: "CA_HT" } }), true],
  ["sagex3_describe", 5, "sagex3_describe", () => ({ representation: "PINVOICE" }), false],
  ["salesforce_tools", 3, "salesforce_tools", () => ({}), false],
  ["sagex3_get", 2, "sagex3_get", () => ({ representation: "PINVOICE", key: "F1", champs: ["NUM", "BPRNAM", "LINES"] }), true],
];
const pick = (mix) => { const total = mix.reduce((s, m) => s + m[1], 0); let r = Math.random() * total; return mix.find((m) => (r -= m[1]) < 0) || mix[mix.length - 1]; };
const classify = (text) => /plafond/.test(text) ? "limite_configuree" : /injoignable/.test(text) ? "backend_injoignable" : /délai|timeout|abort/i.test(text) ? "backend_timeout"
  : /\b429\b/.test(text) ? "backend_429" : /\b5\d\d\b/.test(text) ? "backend_5xx" : /\b4\d\d\b/.test(text) ? "backend_4xx" : /Non connecté/.test(text) ? "non_connecte" : "autre_isError";

class VUser {
  constructor(key, marker, hubUrl, sse) { Object.assign(this, { key, marker, hubUrl, sse, client: null, inflight: 0, records: [], violations: [] }); }
  async connect() {
    this.client = new Client({ name: `lt-${this.marker}`, version: "1.0.0" });
    const opts = { requestInit: { headers: { Authorization: `Bearer ${this.key}` } } };
    this.transport = this.sse ? new SSEClientTransport(new URL(`${this.hubUrl}/sse`), opts) : new StreamableHTTPClientTransport(new URL(`${this.hubUrl}/mcp`), opts);
    await this.client.connect(this.transport);
  }
  async close() { try { await this.client?.close(); } catch {} }
  async call(entry, scenario) {
    const [name, , tool, args, expectMarker] = entry, t0 = Date.now();
    const rec = { scenario, user: this.marker, name, tool, transport: this.sse ? "sse" : "http", at: t0 };
    this.inflight++;
    try {
      const r = await this.client.callTool({ name: tool, arguments: args() }, undefined, { timeout: 70_000 });
      const text = r.content?.map((c) => c.text ?? "").join("\n") ?? "";
      rec.ms = Date.now() - t0; rec.bytes = text.length;
      if (r.isError) { rec.status = "isError"; rec.type = classify(text); rec.msg = text.slice(0, 120); }
      else { rec.status = "ok"; rec.type = "ok"; }
      const foreign = [...new Set((text.match(/usr-\d{2}/g) || []).filter((m) => m !== this.marker))];
      if (foreign.length) { rec.violation = foreign; this.violations.push({ name, foreign, msg: text.slice(0, 200) }); }
      if (!r.isError && expectMarker && !text.includes(this.marker)) { rec.violation = rec.violation || ["marqueur-absent"]; this.violations.push({ name, foreign: ["marqueur-absent"], msg: text.slice(0, 200) }); }
    } catch (e) {
      rec.ms = Date.now() - t0; rec.status = "exception"; rec.msg = String(e.message).slice(0, 160);
      rec.type = e.code && Number.isInteger(e.code) ? `hub_http_${e.code}` : /timeout|Timed out/i.test(e.message) ? "client_timeout" : /ECONNRESET|ECONNREFUSED|fetch failed|socket/i.test(e.message) ? "connexion" : "exception";
    } finally { this.inflight--; }
    this.records.push(rec);
    return rec;
  }
}
// ---------------------------------------------------------------- scénarios
function summarize(records, samples, mockStats, extra = {}) {
  const by = (fn) => { const g = {}; for (const r of records) (g[fn(r)] ??= []).push(r); return g; };
  const lat = (rs) => { const a = rs.filter((r) => r.status !== "exception" || r.type.startsWith("hub_http")).map((r) => r.ms); return { n: rs.length, p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? Math.max(...a) : null }; };
  const okRecs = records.filter((r) => r.status === "ok");
  const types = Object.fromEntries(Object.entries(by((r) => r.type)).map(([k, v]) => [k, v.length]));
  const perTool = Object.fromEntries(Object.entries(by((r) => r.name)).map(([k, v]) => [k, { ...lat(v), ok: v.filter((r) => r.status === "ok").length, ok_p95: pct(v.filter((r) => r.status === "ok").map((r) => r.ms), 0.95), errors: Object.fromEntries(Object.entries(by.call(null, (r) => r.type)).filter(() => false)) }]));
  for (const [k, v] of Object.entries(by((r) => r.name))) perTool[k].errors = Object.fromEntries(Object.entries(v.reduce((acc, r) => { if (r.type !== "ok") acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {})));
  const perTransport = Object.fromEntries(Object.entries(by((r) => r.transport)).map(([k, v]) => [k, lat(v.filter((r) => r.status === "ok"))]));
  const hubSamples = samples.filter((s) => s.label === "hub"), cpu = hubSamples.map((s) => s.cpu), rss = hubSamples.map((s) => s.rssMb);
  const hubOwn = types => Object.entries(types).filter(([k]) => /^(hub_http_|connexion|exception|autre_isError|client_timeout)/.test(k)).reduce((s, [, n]) => s + n, 0);
  const configured = (types.limite_configuree || 0), backend = Object.entries(types).filter(([k]) => k.startsWith("backend_")).reduce((s, [, n]) => s + n, 0);
  return { calls: records.length, ok: okRecs.length, errorsByType: types, hubOwnErrors: hubOwn(types), hubOwnErrorRate: records.length ? +(hubOwn(types) / records.length * 100).toFixed(2) : null, configuredLimitRefusals: configured, backendErrors: backend,
    latencyAllOk: lat(okRecs), latencyPerTool: perTool, latencyPerTransport: perTransport,
    hub: { cpuAvg: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null, cpuMax: cpu.length ? Math.max(...cpu) : null, rssStartMb: rss[0] ?? null, rssEndMb: rss[rss.length - 1] ?? null, rssMaxMb: rss.length ? Math.max(...rss) : null },
    backend: mockStats?.families || {}, injected: mockStats?.injected, ...extra };
}
async function runOpenLoop({ name, hub, mock, users, active, ratePerMin, durationSec, mix = MIX, ramp = null, samples, sequential = false, sse = null }) {
  let seq = 0;
  log(`▶ ${name} : ${active} actifs / ${users.length} enregistrés, ${ratePerMin} appels/min visés, ${durationSec} s${ramp ? ` (montée ${ramp.from}→${ramp.to})` : ""}`);
  await mock.reset();
  const vusers = users.slice(0, active).map((u, i) => new VUser(u.key, u.marker, hub.url, sse ?? (SSE_SHARE > 0 && (i + 1) % Math.round(1 / SSE_SHARE) === 0)));
  const start = Date.now(), end = start + durationSec * 1000, records = [], windows = [];
  let notEmitted = 0, scheduled = 0, maxInflight = 0;
  const intervalMs = ramp ? ramp.intervalMs : active * 60_000 / ratePerMin;
  const startAt = (i) => ramp ? start + (i / Math.max(1, active - 1)) * (durationSec * 1000 * ramp.rampShare) : start;
  const stopSampler = sampler(hub.pid, "hub", samples), stopMock = sampler(mock.child.pid, "mock", samples);
  await Promise.all(vusers.map(async (vu) => { await vu.connect(); }));
  const loops = vusers.map(async (vu, i) => {
    if (startAt(i) > Date.now()) await sleep(startAt(i) - Date.now());
    while (Date.now() < end) {
      scheduled++;
      if (vu.inflight >= 5) notEmitted++; else vu.call(sequential ? mix[seq++ % mix.length] : pick(mix), name).then((r) => records.push(r));
      const inflight = vusers.reduce((s, v) => s + v.inflight, 0); if (inflight > maxInflight) maxInflight = inflight;
      await sleep(intervalMs * (0.7 + Math.random() * 0.6));
    }
  });
  const windowTimer = setInterval(() => { const now = Date.now(), w = records.filter((r) => r.at + r.ms > now - 30_000 && r.at + r.ms <= now); const ok = w.filter((r) => r.status === "ok");
    windows.push({ t: Math.round((now - start) / 1000), activeStarted: vusers.filter((_, i) => startAt(i) <= now).length, completed: w.length, perMin: w.length * 2, p95: pct(ok.map((r) => r.ms), 0.95), errors: w.length - ok.length, rssMb: samples.filter((s) => s.label === "hub").slice(-1)[0]?.rssMb }); }, 30_000);
  await Promise.all(loops);
  const drainEnd = Date.now() + 75_000; while (vusers.some((v) => v.inflight > 0) && Date.now() < drainEnd) await sleep(200);
  clearInterval(windowTimer); stopSampler(); stopMock();
  await Promise.all(vusers.map((v) => v.close()));
  const elapsed = (Date.now() - start) / 1000, mockStats = await mock.stats();
  const summary = summarize(records, samples.filter((s) => s.at >= start), mockStats, { scenario: name, registeredUsers: users.length, activeUsers: active, sseUsers: vusers.filter((v) => v.sse).length, targetPerMin: ratePerMin, durationSec, elapsedSec: Math.round(elapsed),
    scheduled, notEmitted, achievedPerMin: Math.round(records.length / (durationSec / 60)), maxInflight, windows: ramp ? windows : undefined, violations: vusers.flatMap((v) => v.violations), hubExited: hub.exited() });
  writeFileSync(join(RESULTS, `${name}.json`), JSON.stringify(summary, null, 1));
  log(`■ ${name} : ${summary.calls} appels (${summary.achievedPerMin}/min), ok ${summary.ok}, erreurs hub ${summary.hubOwnErrors}, limites ${summary.configuredLimitRefusals}, backend ${summary.backendErrors}, p50/p95/p99 ok ${summary.latencyAllOk.p50}/${summary.latencyAllOk.p95}/${summary.latencyAllOk.p99} ms, CPU hub moy ${summary.hub.cpuAvg}% max ${summary.hub.cpuMax}%, RSS ${summary.hub.rssStartMb}→${summary.hub.rssEndMb} Mo, violations ${summary.violations.length}`);
  return summary;
}
async function runFailures({ hub, mock, users, samples }) {
  log("▶ defaillances : backend lent, délai dépassé, 429, 500, reconnexions, sessions abandonnées");
  const out = {};
  const phase = async (label, control, active, secs, mix, perMin = 120) => { await mock.control({ delay: 0, fail: null, routes: ".*" }); await mock.control(control); const s = await runOpenLoop({ name: `defaillances_${label}`, hub, mock, users, active, ratePerMin: perMin, durationSec: secs, mix, samples }); out[label] = s; return s; };
  const sageOnly = MIX.filter((m) => m[0] === "sagex3_query"), notSage = MIX.filter((m) => !m[0].startsWith("sagex3"));
  // (a) Sage lent (2 s) pendant que les autres connecteurs servent : les autres doivent rester rapides
  await phase("sage_lent_2s", { delay: 2000, routes: "^/api1/" }, 10, 40, MIX, 120);
  // (b) Sage au-delà du délai du hub (30 s) : 3 appels seulement, les autres outils continuent
  await mock.control({ delay: 35_000, routes: "^/api1/" });
  const slow = new VUser(users[0].key, users[0].marker, hub.url, false); await slow.connect();
  const t0 = Date.now(); const timeouts = await Promise.all([0, 1, 2].map(() => slow.call(sageOnly[0], "defaillances_timeout")));
  const others = await runOpenLoop({ name: "defaillances_pendant_timeout", hub, mock, users: users.slice(1), active: 5, ratePerMin: 60, durationSec: 20, mix: notSage, samples });
  out.timeout = { calls: timeouts.map((r) => ({ ms: r.ms, type: r.type, msg: r.msg })), totalMs: Date.now() - t0, othersDuringTimeout: { p95: others.latencyAllOk.p95, hubOwnErrors: others.hubOwnErrors } };
  await slow.close();
  // (c) 429 sur Salesforce, (d) 500 sur Graph
  await phase("salesforce_429", { delay: 0, fail: { status: 429, rate: 0.5 }, routes: "sobject-reads" }, 10, 30, MIX.filter((m) => m[0].startsWith("salesforce")), 120);
  await phase("graph_500", { delay: 0, fail: { status: 500, rate: 0.5 }, routes: "^/v1.0/" }, 10, 30, MIX.filter((m) => m[0] === "sharepoint_list"), 120);
  await mock.control({ delay: 0, fail: null, routes: ".*" });
  // (e) reconnexions SSE : 10 utilisateurs ouvrent, appellent, coupent brutalement, rouvrent, 5 fois
  const rssBefore = procSample(hub.pid).rssMb; let recon = { cycles: 0, ok: 0, errors: 0 };
  for (let c = 0; c < 5; c++) await Promise.all(users.slice(0, 10).map(async (u) => { const vu = new VUser(u.key, u.marker, hub.url, true); await vu.connect(); const r = await vu.call(MIX[0], "defaillances_reconnexion"); r.status === "ok" ? recon.ok++ : recon.errors++; await vu.transport.close(); recon.cycles++; }));
  // (f) sessions abandonnées : 40 sessions SSE ouvertes, 20 coupées sans clôture propre, 20 laissées ouvertes puis coupées
  const abandoned = await Promise.all(users.slice(0, 40).map(async (u) => { const vu = new VUser(u.key, u.marker, hub.url, true); await vu.connect(); return vu; }));
  await Promise.all(abandoned.slice(0, 20).map((vu) => vu.transport.close()));
  await sleep(5000); const rssMid = procSample(hub.pid).rssMb;
  await Promise.all(abandoned.slice(20).map((vu) => vu.transport.close())); await sleep(5000);
  out.sessions = { reconnexions: recon, abandon: { opened: 40, rssBeforeMb: rssBefore, rssWith20OpenMb: rssMid, rssAfterMb: procSample(hub.pid).rssMb }, hubExited: hub.exited() };
  writeFileSync(join(RESULTS, "defaillances.json"), JSON.stringify(out, null, 1));
  log(`■ defaillances : timeout ${out.timeout.calls.map((c) => `${c.type} ${c.ms}ms`).join(", ")} ; reconnexions ok ${recon.ok}/${recon.ok + recon.errors} ; RSS ${rssBefore}→${rssMid}→${out.sessions.abandon.rssAfterMb} Mo`);
  return out;
}
// ---------------------------------------------------------------- campagne
const SCENARIOS = {
  reference: async (ctx) => ({ http: await runOpenLoop({ ...ctx, name: "reference_http", active: 1, ratePerMin: 30, durationSec: 60, sequential: true, sse: false }),
    sse: await runOpenLoop({ ...ctx, name: "reference_sse", active: 1, ratePerMin: 30, durationSec: 40, sequential: true, sse: true }) }),
  nominal: (ctx) => runOpenLoop({ ...ctx, name: "nominal", active: 5, ratePerMin: 30, durationSec: 180 }),
  soutenue: (ctx) => runOpenLoop({ ...ctx, name: "soutenue", active: 15, ratePerMin: 150, durationSec: 180 }),
  pointe: (ctx) => runOpenLoop({ ...ctx, name: "pointe", active: 30, ratePerMin: 600, durationSec: 120 }),
  stress: (ctx) => runOpenLoop({ ...ctx, name: "stress", active: 50, ratePerMin: 1000, durationSec: 180, ramp: { from: 1, to: 50, rampShare: 0.8, intervalMs: 3000 } }),
  defaillances: (ctx) => runFailures(ctx),
};
const wanted = (process.argv[2] || Object.keys(SCENARIOS).join(",")).split(",");
const mock = await startMock(); const seeded = seedUsers(USERS); const hub = await startHub(mock.url, seeded);
const users = Object.keys(seeded).map((key) => ({ key, marker: key.match(/usr-\d{2}/)[0] }));
const samples = [];
log(`environnement : node ${process.version}, ${cpus().length} vCPU ${cpus()[0]?.model.trim()}, ${Math.round(totalmem() / 1e9)} Go RAM, noyau ${release()} ; hub pid ${hub.pid}, ${USERS} collaborateurs enregistrés, part SSE ${SSE_SHARE}`);
const campaign = { startedAt: new Date().toISOString(), node: process.version, cpus: cpus().length, cpuModel: cpus()[0]?.model.trim(), memGb: Math.round(totalmem() / 1e9), kernel: release(), users: USERS, sseShare: SSE_SHARE, hubLogLevel: process.env.LT_LOG_LEVEL || "info", scenarios: {} };
try {
  for (const s of wanted) { if (!SCENARIOS[s]) { log(`scénario inconnu : ${s}`); continue; } campaign.scenarios[s] = await SCENARIOS[s]({ hub, mock, users, samples }); if (hub.exited()) { log("LE HUB S'EST ARRÊTÉ"); break; } await sleep(3000); }
} finally {
  campaign.finishedAt = new Date().toISOString(); campaign.hubExited = hub.exited(); campaign.hubLogTail = hub.logs().split("\n").slice(-20).join("\n"); campaign.samples = samples;
  writeFileSync(join(RESULTS, "campagne.json"), JSON.stringify(campaign, null, 1));
  await hub.stop(); mock.child.kill("SIGTERM");
  log(`campagne terminée ; hub arrêté par la campagne : ${hub.exited() ? JSON.stringify(hub.exited()) : "non (toujours vivant jusqu'à l'arrêt volontaire)"}`);
}
