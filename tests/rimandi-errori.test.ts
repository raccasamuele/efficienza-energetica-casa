import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkProject, exampleProject, type Goal, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { BuildingForm, ConsumptionForm, LocationForm, SystemForm } from "../src/ui/forms";
import { applyGoal, goalSteps } from "../src/ui/goals";
import { InterventionsForm } from "../src/ui/interventions";
import { ERROR_FIELDS, errorTarget } from "../src/ui/issues";
import { nextActions } from "../src/ui/journey";
import { FIELDS, fieldId, sectionStep } from "../src/ui/metadata";

const GOALS: Goal[] = ["auto", "fv", "batteria", "tariffa", "pdc", "serramenti", "completo"];
const COST_PATHS = ["windows.cost", "heatPump.cost", "ev.cost", "dhw.cost", "pv.cost", "battery.cost"];

function project(goal: Goal, tweak?: (p: ProjectInput) => void) {
  const p = exampleProject();
  applyGoal(p, goal);
  tweak?.(p);
  return p;
}

/** Il passo che il clic apre, disegnato come lo disegna la pagina. */
function stepMarkup(p: ProjectInput, path: string) {
  const section = FIELDS.find((r) => r.path === path)?.section;
  const step = section ? sectionStep(section) : path === "location" ? "localita" : "interventi";
  const props = { p, up: () => {}, doc: false, issues: [] };
  const form = step === "localita" ? createElement(LocationForm, { ...props, climate: null, index: null, comuni: null, comuniError: null, setProject: () => {} })
    : step === "edificio" ? createElement(BuildingForm, props)
    : step === "impianto" ? createElement(SystemForm, props)
    : step === "consumi" ? createElement(ConsumptionForm, props)
    : createElement(InterventionsForm, props);
  return { step, html: renderToStaticMarkup(createElement(FormContext.Provider, { value: { project: p } }, form)) };
}

describe("Rimandi dagli avvisi ai campi", () => {
  it("ogni suggerimento della guida porta a un campo che il passo della domanda mostra", () => {
    const cases: [Goal, ((p: ProjectInput) => void)?][] = [...GOALS.map((g): [Goal] => [g]), ["auto", (p) => void (p.ev.pvPlan = "nuovo")]];
    for (const [goal, tweak] of cases) {
      const p = project(goal, tweak);
      for (const a of nextActions(p)) {
        const { step, html } = stepMarkup(p, a.path);
        expect(goalSteps(goal), `${goal}: ${a.label}`).toContain(step);
        expect(html, `${goal}: ${a.label}`).toContain(`id="${fieldId(a.path)}"`);
      }
    }
  });

  it("gli errori che non iniziano col nome del campo hanno comunque un rimando", () => {
    for (const [, path] of ERROR_FIELDS) expect(FIELDS.some((r) => r.path === path) || COST_PATHS.includes(path), path).toBe(true);
    const p = exampleProject();
    p.building.floors.value = 2.5;
    p.economics.horizonYears.value = 20.5;
    p.system.efficiencyBasis = "PCS";
    p.system.boilerEfficiency.value = 0.99;
    const errors = checkProject(p).filter((i) => i.severity === "errore");
    const targets = errors.map((i) => [i.message, errorTarget(i)] as const);
    expect(targets.find(([m]) => m.startsWith("Il numero di piani"))?.[1]).toEqual({ path: "building.floors" });
    expect(targets.find(([m]) => m.startsWith("L'orizzonte"))?.[1]).toEqual({ path: "economics.horizonYears" });
    expect(targets.find(([m]) => m.startsWith("Rendimento oltre 0,98"))?.[1]).toEqual({ path: "system.boilerEfficiency" });
    for (const [, t] of targets) expect("path" in t || "section" in t).toBe(true);
  });

  it("un errore senza campo noto porta al passo della sua sezione", () => {
    expect(errorTarget({ section: "Servizio", severity: "errore", message: "Periodo di raffrescamento: data non valida." })).toEqual({ section: "Servizio" });
  });
});
