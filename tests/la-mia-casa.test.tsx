// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, evaluate, exampleProject, parseProjectFile, type Goal, type ProjectInput } from "../src/engine";
import { CasaCard, casaRows, goalChange, switchGoal, projectForCasaEdit, savedInput } from "../src/ui/casa";
import { editValue, startProject } from "../src/ui/journey";
import App from "../src/App";
import { Entry } from "../src/App";
import { ConsumptionForm } from "../src/ui/forms";
import { FormContext } from "../src/ui/fields";
import { expectFixtureValue, loadMilanoLegacy } from "./helpers";

afterEach(() => vi.unstubAllGlobals());
const clone = <T,>(v: T): T => structuredClone(v);
const equalExceptQuestion = (a: ProjectInput, b: ProjectInput) => {
  const x = clone(a) as any, y = clone(b) as any;
  for (const p of [x, y]) { delete p.goal; delete p.mode; delete p.battery.enabled; delete p.ev.pvPlan; }
  expect(y).toEqual(x);
};
describe("La mia casa", () => {
  it("conserva i calcoli originali della fixture annuale", () => {
    const expected = require("./fixtures/casa-prima.json") as any[];
    const cases: { mode: ProjectInput["mode"]; goal: Goal }[] = [...["fv", "batteria", "pdc", "serramenti", "auto", "completo"].map((goal) => ({ mode: "rapida" as const, goal: goal as Goal })), { mode: "documentata", goal: "completo" }];
    const actual = cases.map(({ mode, goal }) => {
      const ev = evaluate(startProject(mode, true, goal), loadMilanoLegacy());
      return { mode, goal, ok: ev.ok, packages: ev.packages.map((x) => ({ id: x.id, npv: x.cash?.npv ?? null, spending: x.costs.total, electricityKwh: x.elec.import_kWh, gasSmc: x.gasSmc, investment: x.investment })) };
    });
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) expectFixtureValue(actual[i], expected[i]);
  });

  it("riapre le vecchie bozze senza avvisi e mostra la casa salvata", () => {
    const cases = [exampleProject(), startProject("rapida", false, "pdc"), exampleProject()];
    cases[1]!.location = { ...cases[1]!.location, code: "015146", name: "Milano", sigla: "MI" };
    cases[2]!.plan!.custom.W = null;
    for (const input of cases) {
      const r = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input }), null, undefined, { draft: true });
      expect(r.file?.input).toEqual(input); expect(r.warnings.filter((w) => !w.startsWith("Anagrafe dei comuni non disponibile"))).toEqual([]);
    }
    vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: cases[1] }) } });
    const html = renderToStaticMarkup(<App />);
    for (const text of ["La mia casa", cases[1].name, "Hai un lavoro salvato in questo browser", "Riprendi", "Oppure scegli una domanda: parte dai dati della tua casa"]) expect(html).toContain(text);
    expect(html).not.toContain("verrà sostituito");
    expect(html).not.toContain("Inizia con la tua casa");
  });

  it("cambiare domanda conserva casa e preventivi senza mutare l'origine", () => {
    const p = startProject("rapida", false, "pdc");
    p.building.floorArea.value = 174; p.tariffs.elecPrice.value = .42; p.pv.cost.items[0]!.amount.value = 5432; p.plan!.budgetNow.value = 9999; p.ev.enabled = true; p.existingPv.present = false;
    const before = clone(p); let next = p;
    for (const goal of ["serramenti", "fv", "auto", "completo", "pdc"] as Goal[]) next = switchGoal(next, goal, "documentata", true);
    equalExceptQuestion(before, next); expect(p).toEqual(before);
  });

  it("chiede conferma o blocca i contrasti e applica soltanto i cambi consentiti", () => {
    const p = startProject("rapida", false, "completo");
    p.existingPv.present = true;
    expect(goalChange(p, "fv").kind).toBe("blocked");
    expect((goalChange(p, "fv") as any).text).toContain("batteria");
    p.existingPv.present = false;
    expect(goalChange(p, "batteria").kind).toBe("confirm");
    expect(switchGoal(p, "batteria", "rapida").existingPv.present).toBe(false);
    expect(switchGoal(p, "batteria", "rapida", true).existingPv.present).toBe(true);
    p.ev.enabled = false; expect(goalChange(p, "auto").kind).toBe("confirm");
    expect(switchGoal(p, "auto", "rapida", true).ev.enabled).toBe(true);
    p.ev.pvPlan = "nessuno"; p.existingPv.present = true;
    expect(switchGoal(p, "auto", "rapida", true).ev.pvPlan).toBe("esistente");
    expect(switchGoal(p, "auto", "rapida", true).existingPv.present).toBe(true);
    p.existingPv.present = false; p.ev.pvPlan = "esistente";
    expect(switchGoal(p, "auto", "rapida", true).ev.pvPlan).toBe("nessuno");
  });

  it("presenta sette righe con stati e valori formattati", () => {
    const p = startProject("rapida", false, "completo"), rows = casaRows(p);
    expect(rows).toHaveLength(7); expect(rows[0].state).toBe("manca");
    expect(rows.slice(1, 5).every((r) => ["manca", "ipotesi"].includes(r.state))).toBe(true);
    p.location = { ...p.location, code: "015146", name: "Milano", sigla: "MI" };
    p.existingPv.present = true; p.existingPv.kWp.value = 3; p.ev.enabled = true;
    expect(casaRows(p)[5].value).toBe("sì, 3,0 kWp"); expect(casaRows(p)[6].value).toContain("km all'anno");
    p.existingPv.present = false; p.ev.enabled = false;
    expect(casaRows(p)[5].value).toBe("no"); expect(casaRows(p)[6].value).toBe("no");
    const html = renderToStaticMarkup(<CasaCard p={p} onEdit={() => {}} />);
    for (const text of ["La mia casa", "Modifica la casa", ...rows.map((r) => r.label)]) expect(html).toContain(text);
  });

  it("classifica come dato tuo i valori inseriti con editValue", () => {
    const p = startProject("rapida", false, "completo");
    p.consumption.electricityKwh = editValue(p.consumption.electricityKwh, 3200);
    p.consumption.gasSmcObserved = editValue(p.consumption.gasSmcObserved, 1450);
    expect(casaRows(p)[3].state).toBe("tuo");
  });

  it("mostra frase e azione continua con casa salvata; senza goal la sezione resta chiusa", () => {
    const p = startProject("rapida", false, "pdc");
    vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: p }) } });
    const appHtml = renderToStaticMarkup(<App />);
    expect(appHtml).toContain("Oppure scegli una domanda: parte dai dati della tua casa");
    expect(appHtml).not.toContain("verrà sostituito");
    const entryHtml = renderToStaticMarkup(<Entry mode="rapida" onStart={() => {}} casa={{ p, onEdit: () => {} }} />);
    expect(entryHtml).toContain("Continua con la mia casa");
    expect(entryHtml).not.toContain("Inizia con la tua casa");
  });

  it("scrive e rilegge la bozza identica anche con null ammesso", () => {
    const input = startProject("rapida", false, "completo"); input.plan!.custom.H = null;
    const raw = JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input });
    expect(parseProjectFile(raw, null, undefined, { draft: true }).file?.input).toEqual(input);
  });

  it("decide di salvare la casa ma non l'esempio", () => {
    const p = startProject("rapida", false, "pdc");
    expect(savedInput(p, false)).toEqual(p); expect(savedInput(p, true)).toBeNull();
  });

  it("mostra FV esistente e auto nella vista casa completa senza mutare la casa", () => {
    const p = startProject("rapida", false, "fv");
    p.existingPv.present = true; p.ev.enabled = false;
    const before = clone(p), view = projectForCasaEdit(p);
    const renderForm = (project: ProjectInput) => {
      const html = renderToStaticMarkup(<FormContext.Provider value={{ project }}><ConsumptionForm p={project} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>);
      return html.replaceAll("&#x27;", "'");
    };
    const houseForm = renderForm(view);
    expect(houseForm).toContain("La casa ha già un impianto fotovoltaico");
    expect(houseForm).toContain("In famiglia c'è o ci sarà un'auto elettrica");
    expect(renderForm(p)).not.toContain("La casa ha già un impianto fotovoltaico");
    expect(view.goal).toBe("completo");
    expect(p).toEqual(before);
  });
});
