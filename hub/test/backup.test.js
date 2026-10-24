// Boucle de sauvegarde automatique (ops/backup-loop.sh) exécutée en une passe (ONCE=1) sur des dossiers temporaires, sans Docker :
// horodatage sans écrasement, dédoublonnage quand rien n'a changé, source absente ou invalide refusée sans toucher aux sauvegardes
// existantes, copie temporaire puis publication atomique, restes d'interruption nettoyés, rétention seulement après une copie réussie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUB_DIR } from "./helpers/hub.js";

const SCRIPT = join(HUB_DIR, "..", "ops", "backup-loop.sh");
const VALID = "enc1:" + "a".repeat(120); // en-tête et taille plausibles (le vrai fichier est du base64 chiffré)
let dir, src, dest;
const fresh = () => { dir = mkdtempSync(join(tmpdir(), "mcp-backup-")); src = join(dir, "users.json"); dest = join(dir, "backups"); spawnSync("mkdir", [dest]); };
const run = (env = {}) => spawnSync("sh", [SCRIPT], { env: { PATH: process.env.PATH, SRC: src, DEST: dest, ONCE: "1", BACKUP_KEEP_DAYS: "30", ...env }, encoding: "utf8" });
const files = () => readdirSync(dest).sort();
const backups = () => files().filter((f) => /^users-.*\.json$/.test(f));
const ago = (file, days) => { const t = new Date(Date.now() - days * 86_400_000); utimesSync(file, t, t); };

test("Deux passes le même jour : la première écrit un fichier horodaté, la seconde sans changement n'écrit rien ; un changement crée un second fichier distinct", () => {
  fresh(); writeFileSync(src, VALID);
  const r1 = run(); assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.equal(backups().length, 1); assert.match(backups()[0], /^users-\d{4}-\d{2}-\d{2}_\d{6}\.json$/);
  assert.equal(readFileSync(join(dest, backups()[0]), "utf8"), VALID);
  const r2 = run(); assert.equal(r2.status, 0); assert.match(r2.stdout, /inchangé/);
  assert.equal(backups().length, 1, "aucun doublon quand le contenu n'a pas changé (redémarrage du conteneur)");
  writeFileSync(src, VALID + "b");
  const r3 = run(); assert.equal(r3.status, 0); assert.match(r3.stdout, /sauvegarde users-/);
  assert.equal(backups().length, 2, "contenu changé : nouvelle sauvegarde, l'ancienne conservée");
  assert.notEqual(backups()[0], backups()[1]);
  assert.ok(!files().some((f) => f.endsWith(".tmp")), "aucun fichier temporaire après publication");
  rmSync(dir, { recursive: true, force: true });
});

test("Source corrompue, tronquée ou absente (après une perte de users.json) : rien n'est écrit, les sauvegardes existantes restent intactes", () => {
  fresh(); writeFileSync(src, VALID); assert.equal(run().status, 0);
  const before = backups(); const content = readFileSync(join(dest, before[0]), "utf8");
  writeFileSync(src, '{"users":{}}'); // en clair : jamais une sauvegarde
  let r = run(); assert.equal(r.status, 1); assert.match(r.stdout, /invalide/);
  writeFileSync(src, "enc1:abc"); // trop court
  r = run(); assert.equal(r.status, 1); assert.match(r.stdout, /invalide/);
  rmSync(src);
  r = run(); assert.equal(r.status, 1); assert.match(r.stdout, /absent/);
  assert.deepEqual(backups(), before, "aucune sauvegarde ajoutée ni retirée");
  assert.equal(readFileSync(join(dest, before[0]), "utf8"), content, "la sauvegarde saine est inchangée");
  assert.ok(!files().some((f) => f.endsWith(".tmp")));
  rmSync(dir, { recursive: true, force: true });
});

test("Rétention : un fichier plus vieux que BACKUP_KEEP_DAYS est supprimé après une copie réussie seulement, jamais après un échec ; les .tmp d'une interruption sont nettoyés", () => {
  fresh();
  const old = join(dest, "users-2020-01-01.json"); writeFileSync(old, VALID + "old"); ago(old, 40);
  const staleTmp = join(dest, "users-2020-01-02_000000.json.tmp"); writeFileSync(staleTmp, "x"); ago(staleTmp, 1);
  writeFileSync(src, "pas une sauvegarde");
  let r = run(); assert.equal(r.status, 1);
  assert.ok(backups().includes("users-2020-01-01.json"), "échec de copie : l'ancienne sauvegarde saine est conservée");
  assert.ok(!files().includes("users-2020-01-02_000000.json.tmp"), "reste d'interruption nettoyé");
  writeFileSync(src, VALID);
  r = run(); assert.equal(r.status, 0, r.stdout);
  assert.ok(!backups().includes("users-2020-01-01.json"), "copie réussie : la rétention s'applique");
  assert.equal(backups().length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("Même seconde : deux contenus différents donnent deux fichiers (suffixe), jamais un écrasement", () => {
  fresh(); writeFileSync(src, VALID); assert.equal(run().status, 0);
  writeFileSync(src, VALID + "2"); assert.equal(run().status, 0);
  writeFileSync(src, VALID + "3"); assert.equal(run().status, 0);
  assert.equal(backups().length, 3, backups().join());
  assert.equal(new Set(backups().map((f) => readFileSync(join(dest, f), "utf8"))).size, 3);
  rmSync(dir, { recursive: true, force: true });
});
