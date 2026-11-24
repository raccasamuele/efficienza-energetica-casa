import { describe, expect, it } from "vitest";
import { defaultVariants, evaluate, exampleProject, gridImportSeries, nonFinitePaths } from "../src/engine";
import { coolingProject, loadMilanoLegacy, loadPackage } from "./helpers";

const milano = loadMilanoLegacy();
/**
 * Spese annue (centesimi) e prelievi (Wh) degli 8 pacchetti della casa d'esempio, motore 0.9.0.
 * Motore 0.8.0: [308461, 289814, 242361, 280703, 231056, 203293, 192686, 262055] e
 * [2700000, 2700000, 6898618, 1708636, 6494855, 5503334, 5124486, 1708636].
 * Con il motore 0.7.1: [309517, 289640, 243039, 281759, 230987, 203902, 192630, 261882] e
 * [2700000, 2700000, 6922818, 1708636, 6492377, 5525072, 5122488, 1708636].
 * Con il motore 0.7.0: [313032, 292903, 244870, 285273, 232695, 204933, 193608, 265145] e
 * [2700000, 2700000, 6988227, 1708636, 6553400, 5561900, 5157424, 1708636].
 * Con il motore 0.6.0: [326066, 304907, 253496, 298308, 240648, 219150, 206868, 277149] e
 * [2700000, 2700000, 7296286, 1708636, 6837424, 6069634, 5630996, 1708636].
 * Con il motore 0.1.2-0.5.0: [344164, 322273, 262124, 316406, 248673, 220164, 207147, 294515] e
 * [2700000, 2700000, 7604435, 1708636, 7124047, 6105871, 5640981, 1708636].
 */
// Motore 0.9.0 prima della revisione round 1: [308461, 289814, 244526, 280703, 233227, 204479, 193876, 262055].
const BASELINE_COSTS = [308461, 289814, 243909, 280703, 232627, 204129, 193532, 262055];
// Motore 0.9.0 prima della revisione round 1: [2700000, 2700000, 6975930, 1708636, 6572391, 5545695, 5166991, 1708636].
const BASELINE_IMPORT_WH = [2700000, 2700000, 6953904, 1708636, 6550977, 5533166, 5154703, 1708636];
/** Capoluogo con la temperatura media più bassa nell'indice dei pacchetti clima. */
const COLDEST_ID = "014061"; // Sondrio

describe("Raffrescamento — pacchetti e conti", () => {
  const evOff = evaluate(exampleProject(), milano);
  const p = coolingProject();
  const ev = evaluate(p, milano);

  it("chi non raffresca: spese, VAN e prelievi identici al motore senza estate", () => {
    expect(evOff.packages.map((r) => Math.round(r.costs.total * 100))).toEqual(BASELINE_COSTS);
    expect(evOff.packages.map((r) => Math.round(r.elec.import_kWh * 1000))).toEqual(BASELINE_IMPORT_WH);
    for (const r of evOff.packages) {
      expect(r.cooling).toBeUndefined();
      expect(r.coolNeed_kWh).toBeGreaterThan(0);
      expect(r.coolingNotes.join(" ")).toContain("non conteggiato perché la casa non è raffrescata");
      expect(r.services.some((s) => s.service === "Raffrescamento")).toBe(false);
    }
  });

  it("chi non raffresca e ha una PDC adatta vede quanto consumerebbe", () => {
    const q = exampleProject();
    q.system.emitters = "ventilconvettori";
    q.heatPump.model = "parametrico";
    const h = evaluate(q, milano).packages.find((r) => r.id === "H")!;
    expect(h.coolingNotes.join(" ")).toMatch(/La PDC potrebbe raffrescare con circa [\d.]+ kWh elettrici/);
    expect(evaluate(q, milano).packages.find((r) => r.id === "base")!.coolingNotes.join(" ")).not.toContain("La PDC potrebbe");
  });

  it("chi raffresca: riga nel registro e consumo in tutti gli 8 pacchetti", () => {
    expect(ev.ok).toBe(true);
    const ref = evaluate({ ...p, cooling: { ...p.cooling, today: "nessuno" } }, milano);
    for (const r of ev.packages.filter((x) => x.valid)) {
      const line = r.services.find((s) => s.service === "Raffrescamento")!;
      expect(line.carrier).toBe("elettricità");
      expect(line.final_kWh).toBeCloseTo(r.cooling!.elec_kWh, 9);
      expect(r.elec.demand_kWh).toBeGreaterThan(ref.packages.find((x) => x.id === r.id)!.elec.demand_kWh);
    }
  });

  it("nei pacchetti con PDC adatta raffresca la PDC, negli altri gli split", () => {
    expect(ev.packages.find((r) => r.id === "H")!.cooling!.generator).toMatch(/PDC/);
    expect(ev.packages.find((r) => r.id === "WHP")!.cooling!.generator).toMatch(/PDC/);
    expect(ev.packages.find((r) => r.id === "base")!.cooling!.generator).toMatch(/Split/);
    expect(ev.packages.find((r) => r.id === "P")!.cooling!.generator).toMatch(/Split/);
  });

  it("con i radiatori anche i pacchetti PDC restano agli split, con la condizione", () => {
    const q = coolingProject();
    q.system.emitters = "radiatori";
    const h = evaluate(q, milano).packages.find((r) => r.id === "H")!;
    expect(h.cooling!.generator).toMatch(/Split/);
    expect(h.conditions.join(" ")).toMatch(/radiatori/);
  });

  it("i serramenti cambiano il carico estivo", () => {
    const base = ev.packages.find((r) => r.id === "base")!;
    const w = ev.packages.find((r) => r.id === "W")!;
    expect(w.coolNeed_kWh).not.toBeCloseTo(base.coolNeed_kWh, 0);
  });

  it("il FV copre parte del raffrescamento e i prelievi CER lo includono", () => {
    const p0 = evOff.packages.find((r) => r.id === "P")!;
    const p1 = ev.packages.find((r) => r.id === "P")!;
    expect(p1.elec.self_kWh).toBeGreaterThan(p0.elec.self_kWh);
    const s = gridImportSeries(p, milano, p1);
    expect(s.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(p1.elec.import_kWh, 6);
  });

  it("split sottodimensionati: condizione con ore e kWh non forniti", () => {
    const q = coolingProject();
    q.cooling.splitCapacity.value = 0.5;
    const base = evaluate(q, milano).packages[0];
    expect(base.valid).toBe(true);
    expect(base.conditions.join(" ")).toMatch(/ore oltre la potenza degli split/);
  });

  it("capoluogo senza molte ore calde: nessun NaN", () => {
    const q = coolingProject();
    const clim = loadPackage(COLDEST_ID);
    q.climateId = COLDEST_ID;
    const e = evaluate(q, clim);
    expect(e.packages.length).toBe(8);
    expect(nonFinitePaths(e.packages)).toEqual([]);
  });
});

describe("Raffrescamento — sensibilità", () => {
  const ids = (p: ReturnType<typeof exampleProject>) => defaultVariants(p).map((v) => v.id);

  it("varianti estive solo per chi raffresca", () => {
    expect(ids(exampleProject())).not.toContain("clat+");
    expect(ids(coolingProject())).toEqual(expect.arrayContaining(["cset-", "cset+", "eer-", "clat+", "cshade"]));
  });

  it("carico estivo +20% aumenta il consumo estivo della base", () => {
    const p = coolingProject();
    const v = defaultVariants(p).find((x) => x.id === "clat+")!;
    expect(v.label).toContain("umidità");
    const a = evaluate(p, milano).packages[0].cooling!;
    const b = evaluate(v.apply(p), milano).packages[0].cooling!;
    // il carico cresce del 20%; il consumo meno, perché nelle ore più calde gli split sono già al limite di potenza
    expect(b.delivered_kWh + b.undelivered_kWh).toBeCloseTo((a.delivered_kWh + a.undelivered_kWh) * 1.2, 6);
    // motore 0.6.0: col sole sulle pareti gli split sono al limite più ore, l'aumento resta sopra il 3%
    expect(b.elec_kWh).toBeGreaterThan(a.elec_kWh * 1.03);
    expect(b.undelivered_kWh).toBeGreaterThan(a.undelivered_kWh);
  });

  it("EER −15% scala split e PDC, non il COP invernale", () => {
    const p = coolingProject();
    const q = defaultVariants(p).find((x) => x.id === "eer-")!.apply(p);
    expect(q.cooling.splitEer35.value).toBeCloseTo(p.cooling.splitEer35.value * 0.85, 9);
    expect(q.heatPump.eerFactor.value).toBeCloseTo(0.85, 9);
    expect(q.heatPump.copFactor.value).toBe(p.heatPump.copFactor.value);
  });

  it("schermature più deboli restano entro 1", () => {
    const p = coolingProject();
    p.cooling.summerShading.value = 0.9;
    expect(defaultVariants(p).find((x) => x.id === "cshade")!.apply(p).cooling.summerShading.value).toBe(1);
  });
});
