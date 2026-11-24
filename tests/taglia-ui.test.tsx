// Taglia indicativa nell'interfaccia: le due strade, risultati e report.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, runSensitivity, type ProjectInput } from "../src/engine";
import { FormContext } from "../src/ui/fields";
import { evaluationForGoal } from "../src/ui/goals";
import { InterventionsForm } from "../src/ui/interventions";
import { startProject } from "../src/ui/journey";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { FIELDS } from "../src/ui/metadata";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const form = (p: ProjectInput) => text(renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><InterventionsForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>));

describe("Le due strade nel passo Interventi", () => {
  it("con il preventivo: potenza e preventivo, niente tetto né prezzi tipici", () => {
    const p = startProject("rapida", true, "fv");
    const s = form(p);
    expect(s).toContain("Hai già un preventivo?");
    expect(s).toContain("Preventivo FV");
    expect(s).not.toContain("Tetto utilizzabile");
  });
  it("senza preventivo: tetto e prezzo tipico, niente preventivo né capacità", () => {
    const p = startProject("rapida", true, "fv");
    p.pv.sizing = "indicativa";
    const s = form(p);
    expect(s).toContain("Tetto utilizzabile");
    expect(s).toContain("Prezzo tipico del FV (stima)");
    expect(s).toContain("Batteria, parte per kWh (stima)");
    expect(s).toContain("Batteria, parte fissa con FV nuovo (stima)");
    expect(s).not.toContain("Preventivo FV");
    expect(s).not.toContain("Preventivo batteria");
    expect(s).not.toContain("Capacità utile");
  });
  it("con il FV esistente la scelta compare nella sezione della batteria", () => {
    const p = startProject("rapida", true, "batteria");
    p.pv.sizing = "indicativa";
    const s = form(p);
    expect(s).toContain("Hai già un preventivo?");
    expect(s).not.toContain("Tetto utilizzabile");
  });
  it("la casa personale conserva le fonti dei prezzi tipici", () => {
    const p = startProject("rapida", false, "fv");
    expect(p.pv.pricePerKwp.source).toContain("IEA PVPS");
    expect(p.battery.pricePerKwh.source).toContain("Ipotesi di scenario");
  });
});

describe("Unità dei campi nuovi", () => {
  it("tetto, prezzi tipici, batteria e FV esistente hanno la loro unità, non «adimensionale»", () => {
    const expected: Record<string, string> = {
      "pv.roofArea": "m²", "pv.areaPerKwp": "m²/kWp", "pv.pricePerKwp": "€/kWp", "battery.pricePerKwh": "€/kWh",
      "battery.capacityKwh": "kWh", "battery.powerKw": "kW", "battery.roundTripPct": "%", "battery.reservePct": "%",
      "battery.fadePctPerYear": "%/anno", "battery.lifeYears": "anni", "battery.lifeCycles": "cicli",
      "existingPv.kWp": "kWp", "existingPv.gridImportKwh": "kWh/anno", "economics.incentive.batteryPct": "%",
    };
    for (const [path, unit] of Object.entries(expected)) expect(FIELDS.find((r) => r.path === path)?.unit, path).toBe(unit);
  });
});

describe("Risultati e report", () => {
  const p = startProject("rapida", true, "fv");
  p.pv.sizing = "indicativa";
  const ev = evaluationForGoal(evaluate(p, milano), "fv");
  const sens = runSensitivity(p, milano, evaluate(p, milano), ["base", "P"]);
  it("i risultati mostrano taglia, prezzo massimo, curve e la frase sulla stima", () => {
    const s = text(renderToStaticMarkup(<Results ev={ev} p={p} sens={sens} climate={milano} />));
    expect(s).toContain("Taglia indicativa");
    expect(s).toMatch(/Scelta economica: FV \d+(,\d)? kWp/);
    expect(s).toContain("Alternativa per più autonomia");
    expect(s).toContain("Non è consigliata per convenienza");
    expect(s).toContain("non sostituisce sopralluogo e preventivo");
    expect(ev.sizing!.map((x) => x.id)).toEqual(["P"]);
  });
  it("il report dice che i costi sono stimati e cita le fonti", () => {
    const s = text(renderToStaticMarkup(<Report p={p} ev={ev} climate={milano} sens={sens} />));
    expect(s).toContain("Taglia indicativa (stima, non preventivo)");
    expect(s).toContain("Costi stimati, non da preventivo");
    expect(s).toContain("IEA PVPS");
    expect(s).not.toContain("Costi fotovoltaico");
  });
});
