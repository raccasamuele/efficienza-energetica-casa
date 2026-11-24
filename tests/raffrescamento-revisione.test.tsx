// Rilievi della revisione finale del ramo del raffrescamento.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkProject, defaultVariants, evaluate, exampleProject, parseProjectFile, toProjectFile } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { ConsumptionForm } from "../src/ui/forms";
import { InterventionsForm } from "../src/ui/interventions";
import { setChoice } from "../src/ui/journey";
import { FIELDS } from "../src/ui/metadata";
import { QuickSystemSummer } from "../src/ui/quick";
import { Report } from "../src/ui/report";
import { coolingProject, loadMilano } from "./helpers";

const milano = loadMilano();
const html = renderToStaticMarkup;

describe("Revisione — sovrapposizione dei periodi", () => {
  it("un file 0.1.2 con stagione di riscaldamento lunga si apre ancora", () => {
    const p = exampleProject();
    p.service.seasonStart = { month: 9, day: 1 };
    p.service.seasonEnd = { month: 5, day: 31 };
    const old = JSON.parse(JSON.stringify(toProjectFile(p, milano)));
    delete old.input.cooling;
    old.engineVersion = "0.1.2";
    const r = parseProjectFile(JSON.stringify(old), milano);
    expect(r.errors).toEqual([]);
    expect(checkProject(r.file!.input).filter((i) => i.severity === "errore")).toEqual([]);
  });

  it("chi raffresca con periodi sovrapposti ha ancora l'errore", () => {
    const p = coolingProject();
    p.service.seasonEnd = { month: 6, day: 30 };
    expect(checkProject(p).some((i) => i.severity === "errore" && /sovrappost/.test(i.message))).toBe(true);
  });

  it("chi non raffresca con stagioni che si toccano: il fabbisogno estivo informativo esclude i giorni di riscaldamento", () => {
    const p = exampleProject();
    p.service.seasonStart = { month: 9, day: 1 };
    p.service.seasonEnd = { month: 5, day: 31 };
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(true);
    expect(ev.packages[0].coolNeed_kWh).toBeGreaterThan(0);
  });
});

describe("Revisione — ipotesi estive e variante latente", () => {
  it("le ipotesi estive contano solo per chi raffresca", () => {
    const paths = (p: ReturnType<typeof exampleProject>) => FIELDS.filter((r) => r.applies(p)).map((r) => r.path);
    expect(paths(exampleProject()).filter((x) => x.startsWith("cooling."))).toEqual([]);
    expect(paths(coolingProject())).toEqual(expect.arrayContaining(["cooling.setpoint", "cooling.maxDelta", "cooling.summerShading", "cooling.latentFactor"]));
  });

  it("carico estivo +20% parte dal valore dell'utente", () => {
    const p = coolingProject();
    p.cooling.latentFactor.value = 1.1;
    expect(defaultVariants(p).find((v) => v.id === "clat+")!.apply(p).cooling.latentFactor.value).toBeCloseTo(1.32, 9);
  });
});

describe("Revisione — interfaccia e report", () => {
  it("la PDC espone reversibilità, EER e fattore EER; il catalogo dice quali macchine raffrescano", () => {
    const p = coolingProject();
    const s = html(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc issues={[]} /></FormContext.Provider>);
    for (const t of ["PDC reversibile", "EER della PDC a 35 °C", "Fattore di variazione dell&#x27;EER", "campo-heatPump-eer35", "campo-heatPump-eerFactor"]) expect(s).toContain(t);
    expect(s).toMatch(/Advantix[^<]*raffresca/);
  });

  it("l'elettricità degli altri usi esclude gli split", () => {
    const p = coolingProject();
    const s = html(<FormContext.Provider value={{ project: p }}><ConsumptionForm p={p} up={() => {}} doc issues={[]} /></FormContext.Provider>);
    expect(s).toMatch(/split/);
  });

  it("la Rapida mostra la scelta estiva attuale anche dopo un cambio in Documentata", () => {
    const p = coolingProject();
    setChoice(p, "cooling", "no");
    const s = html(<QuickSystemSummer p={p} up={() => {}} />);
    expect(s).toMatch(/<option value="split" selected="">/);
  });

  it("il report riporta i numeri estivi a chi raffresca e la nota a chi no", () => {
    const p = coolingProject();
    const s = html(<Report p={p} ev={evaluate(p, milano)} climate={milano} sens={null} />);
    expect(s).toContain("Raffrescamento estivo");
    expect(s).toContain("kWh elettrici");
    expect(s).toContain("Ventilconvettori");
    const q = exampleProject();
    const t = html(<Report p={q} ev={evaluate(q, milano)} climate={milano} sens={null} />);
    expect(t).toContain("non conteggiato perché la casa non è raffrescata");
  });
});
