// Tests unitaires de hub/cache.js : cache de structure par utilisateur et par système,
// expiré à la coupure nocturne (03:00), vérifié avec l'horloge simulée de node:test.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { cachedSchema, schemaAge } from "../cache.js";

const at = (t, iso) => t.mock.timers.setTime(Date.parse(iso));

test("cachedSchema : charge au premier appel, sert le cache ensuite, isolé par utilisateur et par système", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  at(t, "2026-03-10T10:00:00");
  const load = mock.fn(async () => ({ objects: ["A"] }));

  assert.equal(schemaAge("alice", "sf"), null);
  assert.deepEqual(await cachedSchema("alice", "sf", load), { objects: ["A"] });
  assert.deepEqual(await cachedSchema("alice", "sf", load), { objects: ["A"] });
  assert.equal(load.mock.callCount(), 1, "second appel servi depuis le cache");
  assert.equal(schemaAge("alice", "sf").getTime(), Date.parse("2026-03-10T10:00:00"));

  await cachedSchema("bob", "sf", load);
  await cachedSchema("alice", "sage", load);
  assert.equal(load.mock.callCount(), 3, "chaque utilisateur / système charge avec son propre jeton");
});

test("cachedSchema : expire à la coupure nocturne de 03:00, pas avant", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  at(t, "2026-03-10T22:00:00");
  const load = mock.fn(async () => ({ v: Date.now() }));
  await cachedSchema("carol", "sf", load);

  at(t, "2026-03-11T02:59:00");
  await cachedSchema("carol", "sf", load);
  assert.equal(load.mock.callCount(), 1, "toujours valide avant 03:00");

  at(t, "2026-03-11T03:00:01");
  await cachedSchema("carol", "sf", load);
  assert.equal(load.mock.callCount(), 2, "rechargé après la coupure");

  at(t, "2026-03-12T02:00:00");
  await cachedSchema("carol", "sf", load);
  assert.equal(load.mock.callCount(), 2, "une seule recharge par nuit");
});

test("cachedSchema : un échec de chargement n'est pas mis en cache", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  at(t, "2026-03-10T10:00:00");
  let n = 0;
  const load = async () => { if (++n === 1) throw new Error("401"); return { ok: true }; };
  await assert.rejects(cachedSchema("dave", "sf", load), /401/);
  assert.deepEqual(await cachedSchema("dave", "sf", load), { ok: true });
});
