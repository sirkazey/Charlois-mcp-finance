// Cohérence d'une version publiable : même numéro dans version.js, package.json et package-lock.json, une section du
// CHANGELOG à ce numéro, et une image de base figée par empreinte dans les Dockerfile et la stack (reconstruction à l'identique).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HUB_DIR } from "./helpers/hub.js";
import { VERSION } from "../version.js";

const ROOT = join(HUB_DIR, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("Version : X.Y.Z ou X.Y.Z-rc.N, identique dans version.js, package.json et package-lock.json", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+(-rc\.\d+)?$/);
  assert.equal(JSON.parse(read("hub/package.json")).version, VERSION);
  const lock = JSON.parse(read("hub/package-lock.json"));
  assert.equal(lock.version, VERSION); assert.equal(lock.packages[""].version, VERSION);
});

test("CHANGELOG : une section pour la version courante (tag vX.Y.Z et Release GitHub portent ce numéro)", () => {
  const heading = read("CHANGELOG.md").split("\n").find((l) => l.startsWith(`## [${VERSION}] – `)); // comparaison littérale, sans expression construite
  assert.ok(heading, `section « ## [${VERSION}] – AAAA-MM-JJ » absente`);
  assert.match(heading.slice(`## [${VERSION}] – `.length), /^\d{4}-\d{2}-\d{2}/);
});

test("Image de base figée par empreinte : Dockerfile du hub et du bouchon, conteneur de sauvegarde", () => {
  const pinned = /node:22-alpine@sha256:[0-9a-f]{64}/;
  const from = (p) => read(p).split("\n").find((l) => l.startsWith("FROM "));
  assert.match(from("hub/Dockerfile"), pinned);
  assert.equal(from("clevoa-mcp-stub/Dockerfile"), from("hub/Dockerfile"), "une seule image de base");
  assert.ok(read("docker-compose.yml").includes(from("hub/Dockerfile").slice(5)), "mcp-backup sur la même image");
});
