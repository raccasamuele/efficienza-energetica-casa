import { describe, expect, it } from "vitest";
import { addQuote, checkProject, coldWaterC, compareQuotes, defaultVariants, dhwCost, dhwDraws, dhwNeed, dhwNeedFromGas, dhwNeedFromPeople, dhwSolarShare, DHW_DRAW_SHARE, envelopeBreakdown, evaluate, exampleProject, HOURS, localHour, otherUsesFromBill, packageSeries, parseComuni, parseProjectFile, plantLabel, primaryEnergy, profileScenario, q, quotesApply, simulateTank, summarizeCost, toProjectFile, type Evaluation, type PackageId, type TankParams } from "../src/engine";
import original from "./fixtures/involucro-prima.json";
import before from "./fixtures/acqua-prima.json";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

const climate = loadMilanoLegacy(), comuni = parseComuni(readPublicJson("comuni.json"));
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((r) => r.id === id)!;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / 1000;
const boilerProject = () => {
  const p = exampleProject(); p.system.acsOnGas = false; p.dhw.todayElectric = true;
  p.dhw.replace = true; p.heatPump.included = false;
  return p;
};
const tank = (patch: Partial<TankParams> = {}): TankParams => ({ litres: 200, standbyW: 35, roomC: 15, coldC: 12, heater: "pdc", hpThermalW: 1800, backupW: 1500, copRated: 3, copRatedAirC: 7, airSource: "esterno", minAirC: -5, control: "termostato", ...patch });

describe("Compatibilità prima dell'acqua calda", () => {
  for (const name of ["esempio", "split", "serramenti"]) it(name, () => {
    const p = exampleProject();
    if (name === "split") p.cooling.today = "split";
    if (name === "serramenti") p.goal = "serramenti";
    expect(p.heatPump.included).toBe(true);
    const ref = original.find((x) => x.name === name)!;
    const compare = (ev: Evaluation) => {
      expect(ev.ok).toBe(true);
      expect(ev.calibration?.factor ?? null).toBe(ref.calibrationFactor);
      for (const old of ref.packages) {
        const r = pk(ev, old.id as PackageId);
        expect(r.label).toBe(old.label);
        for (const key of ["heatNeed_kWh", "peak_kW", "gasSmc", "investment", "annualBenefit"] as const) expect(r[key]).toBeCloseTo(old[key], 9);
        expect(r.elec.import_kWh).toBeCloseTo(old.import_kWh, 9);
        if (old.npv === null) expect(r.cash?.npv ?? null).toBeNull();
        else expect(r.cash!.npv).toBeCloseTo(old.npv, 9);
      }
    };
    compare(evaluate(p, climate));
    p.economics.homeValue = { enabled: true, energyClass: "E", marketValue: q(300000, "ipotizzato", "Stima dell'utente") };
    const ev = evaluate(p, climate);
    compare(ev);
    // numeri a 6 decimali: fra Node di Windows e del server di pubblicazione cambia solo l'ultima cifra (1e-13)
    const rounded = (x: unknown) => JSON.parse(JSON.stringify(x, (_, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)));
    expect(rounded(ev.homeValue)).toEqual(rounded(before.find((x) => x.name === name)!.homeValue));
  });
  it("i file precedenti si aprono senza avvisi, enum e litri attivi sono controllati", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), climate)));
    delete file.input.dhw; delete file.input.heatPump.included;
    const parsed = parseProjectFile(JSON.stringify(file), climate, comuni);
    expect(parsed.errors).toEqual([]); expect(parsed.warnings).toEqual([]);
    expect(parsed.file!.input.dhw.replace).toBe(false);
    expect(parsed.file!.input.heatPump.included).toBe(true);
    const bad = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), climate)));
    bad.input.dhw.newType = "x";
    expect(parseProjectFile(JSON.stringify(bad), climate, comuni).errors.join(" ")).toContain("dhw.newType");
    const p = boilerProject(); p.dhw.tankLitres.value = 900;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni).errors.length).toBeGreaterThan(0);
    p.dhw.replace = false;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, climate)), climate, comuni).errors).toEqual([]);
  });
});

describe("Fabbisogno e serbatoio", () => {
  it("fabbisogno da gas o persone con formule indipendenti e profilo civile normalizzato", () => {
    const p = exampleProject();
    expect(dhwNeedFromGas(p)).toBe(150 * 9.55 * .75);
    p.system.efficiencyBasis = "PCS";
    expect(dhwNeedFromGas(p)).toBe(150 * 10.6 * .75);
    const mean = climate.series.tAir.reduce((s, x) => s + x, 0) / HOURS;
    expect(coldWaterC(climate)).toBe(mean);
    const hand = 3 * 50 * 1.163 * (40 - mean) * 365 / 1000;
    expect(dhwNeedFromPeople(p, climate)).toBeCloseTo(hand, 10);
    expect(dhwNeed(p, climate).from).toBe("gas");
    p.system.acsGasSmc.status = "sconosciuto";
    expect(dhwNeedFromGas(p)).toBeNull();
    expect(dhwNeed(p, climate)).toEqual({ kWh: hand, from: "persone" });
    const draws = dhwDraws(hand);
    expect(draws).toHaveLength(HOURS);
    expect(sum(draws)).toBeCloseTo(hand, 9);
    expect(Object.values(DHW_DRAW_SHARE).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    for (let h = 0; h < HOURS; h++) expect(draws[h]).toBeCloseTo(hand * 1000 / 365 * (DHW_DRAW_SHARE[localHour(h)] ?? 0), 9);
  });
  for (const [name, params, pv] of [
    ["boiler", tank({ heater: "resistenza", litres: 80, backupW: 1200, standbyW: 50 }), null],
    ["PDC termostato", tank(), null],
    ["PDC sole", tank({ control: "sole" }), Array.from({ length: HOURS }, (_, h) => localHour(h) >= 10 && localHour(h) <= 16 ? 1500 : 0)],
  ] as const) it(`bilancio orario e somme annue: ${name}`, () => {
    const result = simulateTank(params, dhwDraws(1800), climate.series.tAir, pv);
    let previous = result.storedStart_kWh * 1000;
    for (let h = 0; h < HOURS; h++) {
      expect(Math.abs(result.stored[h] - previous - (result.heat[h] - result.draw[h] - result.loss[h]))).toBeLessThanOrEqual(1e-6);
      previous = result.stored[h];
    }
    for (const key of ["elec", "heat", "draw", "loss"] as const) expect(sum(result[key])).toBeCloseTo(result[`${key}_kWh`], 9);
    expect(result.storedEnd_kWh - result.storedStart_kWh).toBeCloseTo(result.heat_kWh - result.draw_kWh - result.loss_kWh, 8);
  });
  it("caso indipendente senza perdite e COP esatto alla temperatura di prova", () => {
    const draws = dhwDraws(2000), air = new Array<number>(HOURS).fill(15);
    const boiler = simulateTank(tank({ heater: "resistenza", standbyW: 0 }), draws, air, null);
    expect(boiler.elec_kWh).toBeCloseTo(boiler.draw_kWh + boiler.storedEnd_kWh - boiler.storedStart_kWh, 9);
    const special = new Array<number>(HOURS).fill(0); special[0] = 200 * 1.163 * 5; special[1] = 100;
    const cop = simulateTank(tank({ standbyW: 0, copRatedAirC: 15 }), special, air, null);
    expect(cop.heat[0]).toBe(0);
    expect(cop.heat[1] / cop.elec[1]).toBeCloseTo(3, 12);
    const local = simulateTank(tank({ airSource: "locale", copRatedAirC: 15 }), draws, air, null);
    expect(local.cop).toBeGreaterThanOrEqual(.7 * 3); expect(local.cop).toBeLessThanOrEqual(1.1 * 3);
    const cold = simulateTank(tank(), draws, new Array<number>(HOURS).fill(-10), null);
    expect(cold.elec_kWh).toBeCloseTo(cold.resistance_kWh, 9);
    expect(cold.heat_kWh).toBeCloseTo(cold.resistance_kWh, 9);
  });
  it("non nasconde l'acqua insufficiente correggendo l'energia accumulata", () => {
    const r = simulateTank(tank({ litres: 30, backupW: 0, hpThermalW: 0 }), dhwDraws(5000), climate.series.tAir, null);
    expect(r.unmetHours).toBeGreaterThan(0); expect(r.unmet_kWh).toBeGreaterThan(0);
    expect(r.stored.some((x) => x < 0)).toBe(true);
  });
});

describe("Impianto nei pacchetti", () => {
  it("stesso boiler: stesso consumo, stessa spesa e beneficio zero senza PDC", () => {
    const p = boilerProject(); p.dhw.newType = "elettrico";
    p.dhw.tankLitres = { ...p.dhw.todayTankLitres }; p.dhw.backupKw = { ...p.dhw.todayPowerKw }; p.dhw.standbyW = { ...p.dhw.todayStandbyW };
    const ev = evaluate(p, climate), base = pk(ev, "base"), h = pk(ev, "H");
    expect(ev.ok).toBe(true);
    expect(h.dhw!.result.elec_kWh).toBeCloseTo(base.dhw!.result.elec_kWh, 9);
    expect(h.costs.total).toBeCloseTo(base.costs.total, 9);
    expect(h.annualBenefit).toBeCloseTo(0, 9);
    expect(base.otherUses_kWh).toBeCloseTo(p.consumption.electricityKwh.value - base.dhw!.result.elec_kWh, 9);
    expect(base.elec.demand_kWh).toBeCloseTo(p.consumption.electricityKwh.value, 8);
  });
  it("sostituisce l'ACS a gas, distingue la PDC e la quota fissa del gas", () => {
    const p = exampleProject(); p.dhw.replace = true; p.heatPump.included = false;
    const ev = evaluate(p, climate), base = pk(ev, "base"), h = pk(ev, "H");
    expect(base.gasSmc - h.gasSmc).toBeCloseTo(150, 9);
    expect(h.hp).toBeUndefined();
    expect(h.services.some((s) => s.service === "ACS" && s.carrier === "elettricità")).toBe(true);
    expect(h.costs.gasFixed).toBe(p.tariffs.gasFixed.value);
    p.heatPump.included = true; p.system.cookingOnGas = false;
    expect(pk(evaluate(p, climate), "H").costs.gasFixed).toBe(0);
    p.heatPump.boilerEndOfLife = true; p.heatPump.included = false;
    expect(pk(evaluate(p, climate), "H").investment).toBe(3000);
    p.envelope.walls.enabled = true;
    const current = evaluate(p, climate), part = envelopeBreakdown(p, climate, current)!.parts[0];
    expect(part.gasSaved_smc).toBeCloseTo(part.heatSaved_kWh / p.system.boilerEfficiency.value / p.system.gasPci.value, 9);
    const worse = defaultVariants(p).find((v) => v.id === "rend-")!.apply(p);
    expect(pk(evaluate(worse, climate), "H").gasSmc).toBeGreaterThan(pk(current, "H").gasSmc);
  });
  it("blocca impianto vuoto, scaldacqua senza servizio e boiler oltre la bolletta", () => {
    const p = exampleProject(); p.heatPump.included = false;
    for (const r of evaluate(p, climate).packages.filter((r) => r.has.H)) {
      expect(r.valid).toBe(false);
      expect(r.blockers).toContain("Impianto vuoto: scegli almeno la pompa di calore o lo scaldacqua nel passo Interventi.");
    }
    p.dhw.replace = true; p.system.acsOnGas = false;
    expect(pk(evaluate(p, climate), "H").blockers).toContain("Per uno scaldacqua nuovo indica nel passo Impianto com'è oggi l'acqua calda (a gas o con un boiler elettrico).");
    p.dhw.todayElectric = true; p.consumption.electricityKwh.value = 300;
    const ev = evaluate(p, climate);
    expect(ev.ok).toBe(false);
    expect(ev.issues.some((x) => x.message === "Il boiler elettrico consuma più della luce indicata: controlla i consumi elettrici, le persone o i litri.")).toBe(true);
  });
  it("nomi, costo, prezzo sconosciuto, preventivo, manutenzione e incentivo dell'intero impianto", () => {
    const p = boilerProject(); let ev = evaluate(p, climate);
    expect(pk(ev, "H").label).toBe("Scaldacqua a pompa di calore");
    expect(pk(ev, "HP").label).toBe("Scaldacqua + FV");
    expect(plantLabel(p).short).toBe("Scaldacqua");
    p.dhw.newType = "elettrico";
    expect(plantLabel(p).long).toBe("Boiler elettrico nuovo");
    p.heatPump.included = true; p.dhw.newType = "pdc"; ev = evaluate(p, climate);
    expect(pk(ev, "H").label).toBe("Impianto (PDC, scaldacqua)");
    expect(pk(ev, "WHP").label).toBe("Serramenti + Impianto + FV");
    expect(pk(ev, "H").investment).toBe(summarizeCost(p.heatPump.cost).total + 3000);
    expect(dhwCost(p).total).toBe(3000);
    p.dhw.price.status = "sconosciuto";
    expect(pk(evaluate(p, climate), "H").economicsMissing).toContain("Scaldacqua: prezzo");
    p.dhw.price.status = "ipotizzato";
    Object.assign(p.economics.incentive, { enabled: true, source: "Regola", date: "2026-11-05" }); p.economics.incentive.heatPumpPct = q(50);
    ev = evaluate(p, climate);
    expect(ev.incentive!.rows.find((r) => r.id === "H")!.total).toBe(pk(ev, "H").investment / 2);
    p.dhw.costMode = "preventivo"; p.dhw.cost.items.forEach((x) => { x.status = "incluso"; x.amount.value = 100; });
    expect(dhwCost(p).total).toBe(p.dhw.cost.items.length * 100);
    p.dhw.maintenanceDelta.status = "sconosciuto";
    expect(pk(evaluate(p, climate), "H").economicsMissing).toContain("Manutenzione scaldacqua");
  });
  it("sole: sposta il consumo verso il surplus, anche prima della taglia indicativa", () => {
    const p = boilerProject(), ev = evaluate(p, climate), h = pk(ev, "H"), hp = pk(ev, "HP");
    const pv = packageSeries(p, climate, hp).pv!;
    const fraction = (r: typeof h) => sum(r.dhw!.result.elec.filter((_, i) => pv[i] > 0)) / r.dhw!.result.elec_kWh;
    expect(fraction(hp)).toBeGreaterThan(fraction(h));
    expect(dhwSolarShare(p, climate, h)).toBeNull();
    expect(dhwSolarShare(p, climate, hp)).toBeGreaterThan(0);
    p.pv.sizing = "indicativa";
    expect(pk(evaluate(p, climate), "HP").conditions.some((x) => x.includes("FV di riferimento"))).toBe(true);
  });
  it("coerenza del gas, prezzo fuori scenario e preventivi della sola PDC", () => {
    const p = exampleProject(); p.dhw.replace = true;
    p.dhw.people.value = 12;
    expect(evaluate(p, climate).issues.some((x) => x.section === "Acqua calda" && x.message.includes("controlla il gas per l'acqua calda o le persone."))).toBe(true);
    p.dhw.price.value = 100;
    expect(checkProject(p).some((x) => x.message.includes("fuori dagli scenari dichiarati per uno scaldacqua a pompa di calore (2200–4200 €)"))).toBe(true);
    addQuote(p, "heatPump");
    expect(compareQuotes(p, climate, evaluate(p, climate), ["heatPump"])[0].notes).toContain("Beneficio, VAN e rientro sono dell'impianto intero (PDC e scaldacqua); il costo nella tabella è quello della sola PDC.");
    p.heatPump.included = false;
    expect(quotesApply(p, "heatPump")).toBe(false);
  });
});

describe("Acqua calda negli altri moduli", () => {
  it("energia primaria e profilo v1 contano la serie senza nuovi campi", () => {
    const p = boilerProject(), ev = evaluate(p, climate), r = pk(ev, "HP"), s = packageSeries(p, climate, r);
    const other = sum(s.demand) - r.dhw!.result.elec_kWh;
    expect(other).toBeCloseTo(r.otherUses_kWh, 8);
    expect(sum(s.demand)).toBeCloseTo(r.elec.demand_kWh, 8);
    const prof = profileScenario(p, climate, r);
    expect(prof.consumi.usi!.altri_usi_kwh).toBeCloseTo(Math.round((r.otherUses_kWh + r.dhw!.result.elec_kWh) * 10) / 10, 9);
    expect(Object.keys(prof.consumi.usi!)).toEqual(["altri_usi_kwh"]);
    const gas = r.services.filter((x) => x.carrier === "gas" && x.service !== "Cucina").reduce((a, x) => a + x.final_kWh, 0);
    const elec = r.dhw!.result.elec.reduce((a, x, i) => a + Math.max(0, x - s.pv![i]), 0) / 1000;
    expect(primaryEnergy(p, climate, r)).toBeCloseTo(gas * 1.05 + elec * 1.95, 8);
    const covered = r.dhw!.result.elec.reduce((a, x, i) => a + Math.min(x, Math.max(0, s.pv![i] - (s.demand[i] - x))), 0);
    expect(dhwSolarShare(p, climate, r)).toBeCloseTo(covered / (r.dhw!.result.elec_kWh * 1000) * 100, 9);
  });
  it("sensibilità solo pertinente e scala tutti i costi", () => {
    expect(defaultVariants(exampleProject()).some((v) => v.id.startsWith("acs"))).toBe(false);
    const p = boilerProject(), variants = defaultVariants(p);
    for (const id of ["acs-cop", "acs-litri", "acsprezzo-basso", "acsprezzo-alto"]) expect(variants.some((v) => v.id === id)).toBe(true);
    expect(variants.find((v) => v.id === "inv+")!.apply(p).dhw.price.value).toBe(3600);
    expect(variants.find((v) => v.id === "acsprezzo-alto")!.apply(p).dhw.price.value).toBe(4200);
    p.dhw.newType = "elettrico"; p.dhw.costMode = "preventivo";
    expect(defaultVariants(p).some((v) => v.id === "acs-cop" || v.id.startsWith("acsprezzo"))).toBe(false);
    p.system.acsOnGas = true;
    expect(defaultVariants(p).some((v) => v.id === "acs-litri")).toBe(false);
  });
  it("il boiler di oggi viene scorporato anche dai consumi ricostruiti con FV esistente", () => {
    const p = boilerProject(); p.existingPv.present = true; p.existingPv.consumptionFrom = "bolletta"; p.existingPv.gridImportKwh.value = 3500;
    const ev = evaluate(p, climate);
    expect(ev.ok).toBe(true);
    const base = pk(ev, "base");
    expect(base.otherUses_kWh).toBeCloseTo(otherUsesFromBill(p, climate, null)! - base.dhw!.result.elec_kWh, 8);
  });
});
