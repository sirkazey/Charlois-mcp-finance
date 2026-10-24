#!/usr/bin/env node
// Contrôle de la documentation, sans dépendance : parcourt les fichiers Markdown du dépôt (hors node_modules) et échoue si
//  - un lien relatif [texte](chemin#ancre) vise un fichier absent, ou une ancre absente d'un fichier Markdown ;
//  - un chemin de fichier cité entre accents graves (`docs/admin/exploitation.md`, `ops/restore.sh`) n'existe plus.
// Les archives (docs/history/) et le changelog citent des noms d'époque : seuls leurs liens sont vérifiés, pas les chemins cités.
// Usage : node ops/check-docs.js [racine] ; code de sortie 1 en cas d'erreur.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

const ROOT = resolve(process.argv[2] || join(dirname(new URL(import.meta.url).pathname), ".."));
const SKIP_DIRS = new Set(["node_modules", ".git", "results"]);
const HISTORICAL = (f) => /^docs\/history\/|^CHANGELOG\.md$/.test(f);

function* mdFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* mdFiles(join(dir, e.name)); }
    else if (e.name.endsWith(".md")) yield join(dir, e.name);
  }
}
// Ancre GitHub : minuscules, accents conservés, ponctuation retirée, espaces → tirets ; doublons suffixés -1, -2…
function anchors(md) {
  const seen = new Map(), out = new Set();
  let inCode = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    const m = !inCode && line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    let text = m[1].replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    let a = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/ /g, "-"); // GitHub ne fusionne pas les espaces consécutifs
    const n = seen.get(a) ?? 0; seen.set(a, n + 1); if (n) a = `${a}-${n}`;
    out.add(a);
  }
  return out;
}
const stripCode = (md) => md.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
const errors = [];
for (const file of mdFiles(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join("/"), md = readFileSync(file, "utf8"), body = stripCode(md);
  // liens relatifs
  for (const m of body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) { if (target.startsWith("#") && !anchors(md).has(decodeURIComponent(target.slice(1)))) errors.push(`${rel} : ancre introuvable ${target}`); continue; }
    const [path, anchor] = target.split("#");
    const abs = resolve(dirname(file), decodeURIComponent(path));
    if (!existsSync(abs)) { errors.push(`${rel} : lien vers un fichier absent ${target}`); continue; }
    if (anchor && abs.endsWith(".md") && !anchors(readFileSync(abs, "utf8")).has(decodeURIComponent(anchor))) errors.push(`${rel} : ancre introuvable ${target}`);
  }
  if (HISTORICAL(rel)) continue;
  // chemins de fichiers cités entre accents graves : relatifs à la racine du dépôt, ou au dossier du document
  for (const m of body.matchAll(/`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.*-]+)+|[A-Z_]+\.md)`/g)) {
    const p = m[1];
    if (/[*<>]/.test(p) || /^(https?|www)/.test(p) || /^\d/.test(p)) continue; // motifs, URL, versions
    if (!/\.(md|js|mjs|json|yml|yaml|sh|conf|toml|html|ps1|example)$|^[A-Z_]+\.md$|\/$/.test(p)) continue; // seulement des fichiers reconnaissables
    if (p.startsWith("/") || p.startsWith("~") || p.startsWith("%")) continue; // chemins du système cible
    const ok = existsSync(resolve(ROOT, p)) || existsSync(resolve(dirname(file), p));
    if (!ok) errors.push(`${rel} : fichier cité introuvable \`${p}\``);
  }
}
if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} erreur(s) de documentation.`); process.exit(1); }
console.log("Documentation : liens, ancres et fichiers cités vérifiés.");
