// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, evaluate, exampleProject, parseProjectFile, type Goal, type ProjectInput } from "../src/engine";
import { switchGoal } from "../src/ui/casa";
import { GOAL_OPTIONS, goalPackages } from "../src/ui/goals";
import { aggiungiCasa, confrontaCase, duplicaCasa, eliminaCasa, importaCasa, leggiCase, MAX_CASE, rinominaCasa, scriviCase, usaCasa, type Case } from "../src/ui/case";
import { CaseBadge, CaseList, CompareTable } from "../src/ui/case-view";
import App from "../src/App";
import { startProject } from "../src/ui/journey";
import { loadMilanoLegacy } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const clone = <T,>(v: T): T => structuredClone(v);
function close(a: number | null, b: number | null) {
  if (a === null || b === null) expect(a).toBe(b);
  else expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(b) * 1e-9));
}
function closeDeep(actual: any, expected: any): void {
  if (typeof actual === "number" && typeof expected === "number") return close(actual, expected);
  if (Array.isArray(actual) && Array.isArray(expected)) { expect(actual).toHaveLength(expected.length); actual.forEach((value, i) => closeDeep(value, expected[i])); return; }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) closeDeep(actual[key], expected[key]);
    return;
  }
  expect(actual).toBe(expected);
}
const climate = loadMilanoLegacy();
const makeCase = (input: ProjectInput, id: string): Case => ({ attiva: input, altre: [{ id, savedAt: "2026-11-05T12:00:00.000Z", input: startProject("rapida", true, "pdc") }] });

describe("Le mie case", () => {
  it("legge la bozza storica senza migrazioni o avvisi", () => {
    const p = startProject("rapida", false, "pdc"), s = new MemoryStorage();
    s.setItem("confronto-interventi:bozza:v1", JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p }));
    const expected = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p }), null, undefined, { draft: true }).file!.input;
    closeDeep(leggiCase(s), { attiva: expected, altre: [], note: [] });
    expect(leggiCase(new MemoryStorage())).toMatchObject({ attiva: null, altre: [], note: [] });
  });

  it("scrive e rilegge identico, conserva null ammessi e mette da parte dati rifiutati", () => {
    const p = exampleProject(); p.plan!.custom.W = null;
    const c: Case = { attiva: p, altre: [{ id: "alt", savedAt: "2026-11-05T00:00:00Z", input: clone(p) }] };
    const s = new MemoryStorage(); scriviCase(s, c);
    const expected = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p }), null, undefined, { draft: true }).file!.input;
    closeDeep(leggiCase(s).attiva, expected); closeDeep(leggiCase(s).altre[0]?.input, expected);
    const draftKey = "confronto-interventi:bozza:v1", listKey = "confronto-interventi:altre-case:v1";
    const priorList = s.getItem(listKey)!, priorDraft = s.getItem(draftKey)!;
    const failing = new MemoryStorage(); failing.setItem(listKey, priorList); failing.setItem(draftKey, priorDraft);
    const order: string[] = [], set = failing.setItem.bind(failing);
    failing.setItem = (k, v) => { order.push(k); if (k === draftKey && v.includes('"Nuova"')) throw new Error("quota"); set(k, v); };
    const changed = clone(p); changed.name = "Nuova";
    expect(() => scriviCase(failing, { attiva: changed, altre: c.altre })).toThrow("quota");
    expect(order.slice(0, 2)).toEqual([listKey, draftKey]); expect(failing.getItem(listKey)).toBe(priorList); expect(failing.getItem(draftKey)).toBe(priorDraft);
    const key = "confronto-interventi:altre-case:v1";
    s.setItem(key, JSON.stringify({ version: 1, case: [{ id: "bad", savedAt: "x", file: { schemaVersion: 9 } }] }));
    const bad = leggiCase(s); expect(bad.altre).toEqual([]); expect(bad.note).toHaveLength(1);
    expect(s.getItem("confronto-interventi:altre-case-rifiutate")).toContain('"bad"');
    s.setItem(key, JSON.stringify({ version: 1, case: [
      { id: "ok-a", savedAt: "x", file: { schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p } },
      { id: "bad-middle", savedAt: "x", file: null },
      { id: "ok-b", savedAt: "x", file: { schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p } },
    ] }));
    expect(leggiCase(s).altre.map((x) => x.id)).toEqual(["ok-a", "ok-b"]);
    s.setItem(key, JSON.stringify({ version: 1, case: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, savedAt: "x", file: { schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p } })) }));
    expect(leggiCase(s).altre).toHaveLength(9); expect(leggiCase(s).altre.map((x) => x.id)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]); expect(leggiCase(s).note.length).toBeGreaterThan(0);
  });

  it("gestisce uso, duplicazione, rinomina, eliminazione, aggiunta, import e limite senza mutare", () => {
    const p = startProject("rapida", false, "pdc"); p.plan!.custom.W = null;
    const q = startProject("rapida", true, "fv"), initial = makeCase(p, "b");
    const before = clone(initial);
    const first = usaCasa(initial, "b", "t1");
    const back = usaCasa(first, first.altre[0]!.id, "t2");
    closeDeep(back.attiva, p); closeDeep(initial, before);
    const duplicated = duplicaCasa(initial, "attiva", "now", "new") as Case;
    expect(duplicated.altre[1].id).toBe("new"); closeDeep(duplicated.altre[1].input, { ...p, name: `Copia di ${p.name}` });
    expect(rinominaCasa(initial, "attiva", "  Nome  ")).toMatchObject({ attiva: { name: "Nome" } });
    expect(rinominaCasa(initial, "attiva", "  ")).toMatchObject({ errore: "Scrivi un nome." });
    expect((rinominaCasa(initial, "attiva", "x".repeat(70)) as Case).attiva!.name).toHaveLength(60);
    expect(eliminaCasa(initial, "attiva").attiva).toBeNull();
    const added = aggiungiCasa(initial, "now", "id") as Case;
    expect(added.attiva).toBeNull(); expect(added.altre.map((x) => x.id)).toEqual(["b", "id"]); closeDeep(added.altre[1]!.input, p);
    const imported = importaCasa(initial, q, "now", "imp") as Case;
    closeDeep(imported.attiva, q); expect(imported.altre.map((x) => x.id)).toEqual(["b", "imp"]);
    const full: Case = { attiva: p, altre: Array.from({ length: MAX_CASE - 1 }, (_, i) => ({ id: `${i}`, savedAt: "", input: p })) };
    for (const result of [duplicaCasa(full, "attiva", "", "x"), aggiungiCasa(full, "", "x"), importaCasa(full, q, "", "x")]) expect(result).toMatchObject({ errore: "Hai già 10 case: eliminane una prima." });
    closeDeep(initial, before);
  });

  it("calcola le righe con evaluate, lascia fuori i contrasti e rispetta la fixture congelata", () => {
    const p = startProject("rapida", true, "pdc"); p.location = { ...p.location, code: "015146", name: "Milano", sigla: "MI" };
    const c: Case = { attiva: p, altre: [] };
    for (const g of ["fv", "pdc", "completo"] as Goal[]) {
      const row = confrontaCase(c, g, new Map([["015146", climate]]))[0];
      if (row.stato === "ok") {
        const switched = switchGoal(p, g, p.mode), ev = evaluate(switched, climate), eligible = ev.packages.filter((x) => x.id !== "base" && (goalPackages(switched) ?? []).includes(x.id));
        const best = eligible.slice().sort((a, b) => (b.cash?.npv ?? -Infinity) - (a.cash?.npv ?? -Infinity))[0];
        expect(row.spesaOggi).toBeDefined(); if (best && row.migliore) { close(row.migliore.investimento, best.investment); close(row.migliore.spesa, best.costs.total); close(row.migliore.van, best.cash?.npv ?? null); }
      }
    }
    const blocked = clone(p); blocked.existingPv.present = true;
    expect(confrontaCase({ attiva: blocked, altre: [] }, "fv", new Map()).at(0)).toMatchObject({ stato: "non adatta", motivo: expect.stringContaining("fotovoltaico") });
    const noPv = clone(p); noPv.existingPv.present = false;
    expect(confrontaCase({ attiva: noPv, altre: [] }, "batteria", new Map()).at(0)?.stato).toBe("non adatta");
    expect(confrontaCase({ attiva: p, altre: [] }, "pdc", new Map()).at(0)).toMatchObject({ stato: "da completare", motivo: "clima non disponibile" });
    const noComune = clone(p); noComune.location = { ...noComune.location, code: "", name: "", sigla: "" };
    expect(confrontaCase({ attiva: noComune, altre: [] }, "pdc", new Map([[noComune.climateId, climate]])).at(0)).toMatchObject({ stato: "da completare", motivo: "dati da completare nei passi" });
    const original = clone(c); confrontaCase(c, "pdc", new Map([["015146", climate]])); closeDeep(c, original);

    const fixtures = require("./fixtures/case-prima.json") as any[];
    const fixtureInputs = [exampleProject(), (() => { const x = exampleProject(); x.existingPv.present = true; x.goal = "batteria"; return x; })(), startProject("rapida", true, "auto")];
    fixtureInputs.forEach((x) => { x.location = { ...x.location, code: "015146", name: "Milano", sigla: "MI" }; });
    fixtures.forEach((fixture, i) => fixture.questions.forEach((q: any) => {
      const casa = fixtureInputs[i]!;
      const result = confrontaCase({ attiva: casa, altre: [] }, q.goal, new Map([[casa.location.code, climate]]))[0]!;
      expect(result.stato).toBe("ok");
      const switched = switchGoal(casa, q.goal, casa.mode), ev = evaluate(switched, climate);
      const expectedBase = q.packages.find((x: any) => x.id === "base");
      close(result.spesaOggi ?? null, expectedBase.annualCost);
      const eligible = ev.packages.filter((x) => x.id !== "base" && (goalPackages(switched) ?? ev.packages.map((p) => p.id)).includes(x.id));
      const best = eligible.filter((x) => x.cash?.npv != null).sort((a, b) => b.cash!.npv! - a.cash!.npv!)[0] ?? eligible[0];
      if (best) {
        const expected = q.packages.find((x: any) => x.id === best.id);
        expect(result.migliore?.id).toBe(best.id);
        close(result.migliore?.investimento ?? null, expected.investment);
        close(result.migliore?.spesa ?? null, expected.annualCost);
        close(result.migliore?.van ?? null, expected.npv);
        // oltre l'orizzonte il rientro non si mostra (src/ui/case.ts); con il motore 0.7.0 succede a un caso della fixture
        const horizon = switched.economics.horizonYears.value;
        close(result.migliore?.rientro ?? null, expected.payback !== null && expected.payback > horizon ? null : expected.payback);
      }
    }));
  });

  it("mostra elenco, limite, confronto e motivi nelle viste statiche", () => {
    const p = startProject("rapida", false, "pdc"), other = startProject("rapida", true, "fv"), third = startProject("rapida", true, "auto");
    p.name = "Prima"; other.name = "Seconda"; third.name = "Terza";
    const c: Case = { attiva: p, altre: [{ id: "b", savedAt: "", input: other }, { id: "c", savedAt: "", input: third }] };
    const html = renderToStaticMarkup(<CaseList value={c} onUse={() => {}} onDuplicate={() => {}} onRename={() => {}} onDelete={() => {}} onAdd={() => {}} onCompare={() => {}} />);
    for (const text of ["La mia casa", "Le altre case", p.name, "Usa questa", "Aggiungi una casa", "Confronta le case"]) expect(html).toContain(text);
    const fullMarkup = renderToStaticMarkup(<CaseList value={{ attiva: p, altre: Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, savedAt: "", input: p })) }} onUse={() => {}} onDuplicate={() => {}} onRename={() => {}} onDelete={() => {}} onAdd={() => {}} onCompare={() => {}} />).replaceAll("&#x27;", "'");
    expect(fullMarkup).toContain("Al massimo 10 case in questo browser: eliminane una per aggiungerne un'altra.");
    expect(fullMarkup).toMatch(/<button[^>]*disabled=""[^>]*>Aggiungi una casa/);
    expect(GOAL_OPTIONS).toHaveLength(7);
    expect(renderToStaticMarkup(<CaseList value={{ attiva: p, altre: [] }} onUse={() => {}} onDuplicate={() => {}} onRename={() => {}} onDelete={() => {}} onAdd={() => {}} onCompare={() => {}} />)).not.toContain("Confronta le case");
    const comparison = renderToStaticMarkup(<CompareTable rows={[{ id: "attiva", nome: p.name, comune: "Milano", stato: "non adatta", motivo: "ha già il fotovoltaico" }]} />);
    expect(comparison).toContain("ha già il fotovoltaico");
  });

  it("pagina d'inizio: solo il riquadro «Le mie case», l'elenco sta nella sua pagina", () => {
    const a = exampleProject(); a.name = "Casa uno";
    const b = exampleProject(); b.name = "Casa due";
    const file = (input: ProjectInput) => ({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input });
    const data: Record<string, string> = {
      "confronto-interventi:bozza:v1": JSON.stringify(file(a)),
      "confronto-interventi:altre-case:v1": JSON.stringify({ version: 1, case: [{ id: "b", savedAt: "2026-11-05T10:00:00Z", file: file(b) }] }),
    };
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => data[k] ?? null, setItem: () => {}, removeItem: () => {} } });
    const html = renderToStaticMarkup(<App />).replaceAll("&#x27;", "'");
    for (const text of ["Le mie case", "La mia casa", "«Casa uno»", "2 case salvate", "Hai un lavoro salvato in questo browser", "Riprendi", "Cosa vuoi verificare?"]) expect(html).toContain(text);
    for (const text of ["Le altre case", "Casa due", "Usa questa", "Duplica", "Confronta le case", "Modifica la casa"]) expect(html).not.toContain(text);
    const none = renderToStaticMarkup(<CaseBadge value={{ attiva: null, altre: [{ id: "b", savedAt: "", input: b }] }} onOpen={() => {}} onResume={() => {}} />);
    expect(none).toContain("Nessuna casa in uso"); expect(none).toContain("1 casa salvata"); expect(none).not.toContain("Riprendi");
  });
});
