// Tests unitaires de hub/cache.js : cache de structure par utilisateur et par système,
// expiré à la coupure nocturne (03:00), vérifié avec l'horloge simulée de node:test.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { cachedSchema } from "../cache.js";

const at = (t, iso) => t.mock.timers.setTime(Date.parse(iso));

test("cachedSchema : charge au premier appel, sert le cache ensuite, isolé par utilisateur et par système", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  at(t, "2026-03-10T10:00:00");
  const load = mock.fn(async () => ({ objects: ["A"] }));

  assert.deepEqual(await cachedSchema("alice", "sf", load), { objects: ["A"] });
  assert.deepEqual(await cachedSchema("alice", "sf", load), { objects: ["A"] });
  assert.equal(load.mock.callCount(), 1, "second appel servi depuis le cache");

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

test("Sage X3 : parsePrototype lit le format réel Syracuse 24R1 (champs sous $resources.$item, libellés {@n}, exclus ignorés)", async () => {
  const { parsePrototype } = await import("../connectors/sagex3.js");
  const real = { // extrait réel de $prototypes('BPCUSTOMER.$query') sur une instance 24R1
    $actxUser: "ACHEB", $actxFolder: "CHREC", $representation: "BPCUSTOMER", $title: "{@1503}", $itemsPerPage: 300,
    $properties: { $resources: { $type: "application/x-array", $item: { $key: "{BPCNUM}", $properties: {
      BPCSTA: { $title: "{@188}", $type: "application/x-boolean", $isReadOnly: true },
      BPCNUM: { $title: "{@3662}", $type: "application/x-string", $isMandatory: true, $maxLength: 15 },
      BPCNAM: { $title: "{@1644}", $type: "application/x-string", $maxLength: 50 },
      RBPAADDLIG1: { $title: "{@50490}", $type: "application/x-string", $isExcluded: true },
      BPCTYP: { $title: "{@16094}", $type: "application/x-choice", $value: { $type: "application/x-integer" } },
      PTE_LEG_REF: { $title: "{@26213}", $type: "application/x-reference", $isHidden: true },
    } } } },
    $localization: { "@1503": "Clients", "@188": "Actif", "@3662": "Client", "@1644": "Raison sociale", "@50490": "Ligne adresse 1", "@16094": "Type client", "@26213": "Législation" },
  };
  assert.deepEqual(parsePrototype(real), [
    { name: "BPCSTA", type: "boolean", label: "Actif" },
    { name: "BPCNUM", type: "string", label: "Client" },
    { name: "BPCNAM", type: "string", label: "Raison sociale" },
    { name: "BPCTYP", type: "choice", label: "Type client" },
  ]);
});

test("Sage X3 : strip retire les métadonnées $ et aplatit les références au format réel 24R1", async () => {
  const { strip } = await import("../connectors/sagex3.js");
  const row = { $uuid: "1a0e", $etag: "2026-07-06T12:15:34Z", NUM: "TO2192607FAF0005", ACCDAT: "2026-07-04", FCY: "TO219",
    FCY_REF: { $title: "", $description: "DOREAU L'ATELIER" }, BPR: "T005664", BPR_REF: { $title: "404/210", $description: "ENGIE" }, PTE_LEG_REF: { $title: "" }, AMT: 12.5, LINES: [{ L: 1 }] };
  assert.deepEqual(strip(row), { NUM: "TO2192607FAF0005", ACCDAT: "2026-07-04", FCY: "TO219", FCY_REF: "DOREAU L'ATELIER", BPR: "T005664", BPR_REF: "ENGIE", PTE_LEG_REF: "", AMT: 12.5, LINES: [{ L: 1 }] });
});
