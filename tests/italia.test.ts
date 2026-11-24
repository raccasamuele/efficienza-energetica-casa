// Test della copertura nazionale: anagrafe dei comuni, pacchetti dei capoluoghi, località, catalogo PDC, ISO 13370.
import { describe, expect, it } from "vitest";
import {
  HP_CATALOG,
  SEASON_BY_ZONE,
  applyLocation,
  catalogPower,
  evaluate,
  exampleProject,
  groundEquivalentU,
  matchClimate,
  parseComuni,
  performance,
  suggestClimate,
  validateClimate,
  type ClimateIndexEntry,
} from "../src/engine";
import { loadMilano, loadPackage, readPublicJson } from "./helpers";

const comuni = parseComuni(readPublicJson("comuni.json"));
const index = (readPublicJson("packages/index.json") as { climates: ClimateIndexEntry[] }).climates;

describe("anagrafe dei comuni", () => {
  it("contiene tutti i comuni ISTAT con zona, gradi giorno e coordinate in Italia", () => {
    expect(comuni.length).toBeGreaterThan(7800);
    for (const c of comuni) {
      expect(c.lat).toBeGreaterThan(35.4);
      expect(c.lat).toBeLessThan(47.2);
      expect(c.lon).toBeGreaterThan(6.5);
      expect(c.lon).toBeLessThan(18.6);
    }
  });
  it("le quattro discordanze di zona e GG sono conservate e dichiarate", () => {
    const ranges: Record<string, [number, number]> = { A: [0, 600], B: [601, 900], C: [901, 1400], D: [1401, 2100], E: [2101, 3000], F: [3001, 99999] };
    const bad = comuni.filter((c) => c.gg < ranges[c.zone][0] || c.gg > ranges[c.zone][1]);
    expect(bad.map((c) => c.name).sort()).toEqual(["Caprese Michelangelo", "Cunico", "Mongiana", "Vito d'Asio"].sort());
    expect(bad.every((c) => c.fonte === "DPR412-conflitto" && c.provenance?.conflict)).toBe(true);
  });
  it("valori noti: Milano E 2404 GG, Palermo B 751 GG, Roma D 1415 GG", () => {
    const g = (n: string) => comuni.find((c) => c.name === n)!;
    expect([g("Milano").zone, g("Milano").gg]).toEqual(["E", 2404]);
    expect([g("Palermo").zone, g("Palermo").gg]).toEqual(["B", 751]);
    expect([g("Roma").zone, g("Roma").gg]).toEqual(["D", 1415]);
  });
});

describe("pacchetti clima dei capoluoghi", () => {
  it("un pacchetto valido per ogni capoluogo in indice", () => {
    expect(index.length).toBeGreaterThanOrEqual(100);
    for (const e of index.slice(0, 5)) expect(validateClimate(loadPackage(e.id))).toEqual([]);
  });
  it("il pacchetto compatto di Milano ha valori fisici plausibili", () => {
    const m = loadMilano();
    const mean = m.series.tAir.reduce((a, b) => a + b, 0) / 8760;
    expect(mean).toBeGreaterThan(10);
    expect(mean).toBeLessThan(17);
    expect(m.manifest.zone).toBe("E");
  });
});

describe("località", () => {
  it("un comune dell'hinterland milanese usa un capoluogo vicino entro le soglie", () => {
    const c = comuni.find((x) => x.name === "Sesto San Giovanni")!;
    const s = suggestClimate(c, index)!;
    expect(["Milano", "Monza"]).toContain(s.entry.name);
    expect(s.distanceKm).toBeLessThan(15);
    expect(s.good).toBe(true);
  });
  it("un comune di montagna lontano dal capoluogo risulta esplorativo", () => {
    const c = comuni.find((x) => x.name === "Livigno")!;
    const s = matchClimate(c, index)[0];
    expect(s.good).toBe(false);
  });
  it("applicare il comune imposta clima, stagione della zona e temperatura di progetto stimata", () => {
    const c = comuni.find((x) => x.name === "Palermo")!;
    const p = applyLocation(exampleProject(), c, suggestClimate(c, index)!);
    expect(p.climateId).toBe(index.find((e) => e.name === "Palermo")!.id);
    expect(p.service.seasonStart).toEqual(SEASON_BY_ZONE.B.start);
    expect(p.system.designOutdoorTemp.status).toBe("ipotizzato");
    expect(p.system.designOutdoorTemp.value).toBeGreaterThan(-3);
  });
  it("valutazione completa con un clima del sud", () => {
    const c = comuni.find((x) => x.name === "Palermo")!;
    const s = suggestClimate(c, index)!;
    const p = applyLocation(exampleProject(), c, s);
    const ev = evaluate(p, loadPackage(s.entry.id));
    expect(ev.ok).toBe(true);
    expect(ev.packages[0].heatNeed_kWh).toBeGreaterThan(0);
    expect(ev.packages[0].heatNeed_kWh).toBeLessThan(evaluate(exampleProject(), loadMilano()).packages[0].heatNeed_kWh);
  });
});

describe("catalogo PDC (dati Keymark via hplib)", () => {
  const p = exampleProject();
  it("ogni macchina ha COP > 1 e potenza positiva dentro il dominio", () => {
    for (const m of HP_CATALOG) {
      const hp = { ...p.heatPump, model: "catalogo" as const, catalogId: m.id };
      const perf = performance(0, 45, hp);
      expect(perf.inDomain).toBe(true);
      expect(perf.cop).toBeGreaterThan(1);
      expect(perf.capW).toBeGreaterThan(0);
    }
  });
  it("sotto la temperatura minima di funzionamento l'ora è fuori dominio (nessuna estrapolazione)", () => {
    const m = HP_CATALOG[0];
    const hp = { ...p.heatPump, model: "catalogo" as const, catalogId: m.id };
    expect(performance(m.tol_C - 1, 40, hp).inDomain).toBe(false);
    expect(performance(0, m.maxFlow_C + 1, hp).inDomain).toBe(false);
  });
  it("sopra −7 °C la potenza non scende sotto quella a −7 °C", () => {
    for (const m of HP_CATALOG) expect(catalogPower(m, 5, 45)).toBeGreaterThanOrEqual(catalogPower(m, -7, 45) - 1e-9);
  });
  it("il COP cresce con la temperatura dell'aria e cala con la mandata", () => {
    const hp = { ...p.heatPump, model: "catalogo" as const, catalogId: HP_CATALOG[0].id };
    expect(performance(7, 35, hp).cop).toBeGreaterThan(performance(-5, 35, hp).cop);
    expect(performance(0, 35, hp).cop).toBeGreaterThan(performance(0, 55, hp).cop);
  });
});

describe("terreno EN ISO 13370", () => {
  it("la U equivalente di una platea grande è minore della U del pacchetto", () => {
    expect(groundEquivalentU(2.0, 100, 40)).toBeLessThan(2.0);
    expect(groundEquivalentU(2.0, 400, 80)).toBeLessThan(groundEquivalentU(2.0, 100, 40));
  });
  it("un pavimento isolato resta isolato", () => {
    expect(groundEquivalentU(0.3, 100, 40)).toBeLessThan(0.3);
    expect(groundEquivalentU(0.3, 100, 40)).toBeGreaterThan(0.1);
  });
});

describe("regressioni dalla revisione dei dati", () => {
  const g = (n: string, s?: string) => comuni.find((c) => c.name === n && (!s || c.sigla === s))!;
  it("Trento usa la riga principale del DPR (E, 2567 GG), non quella della porzione elevata", () => {
    expect([g("Trento").zone, g("Trento").gg, g("Trento").alt]).toEqual(["E", 2567, 194]);
    expect(index.find((e) => e.name === "Trento")!.zone).toBe("E");
  });
  it("Tre Ville (TN) non prende i dati di Treville (AL)", () => {
    expect(g("Tre Ville", "TN").zone).toBe("F");
    expect(g("Tre Ville", "TN").fonte).toBe("vicino");
  });
  it("righe ricomposte o con refusi del PDF tornano ai valori del DPR", () => {
    expect([g("Nusco").zone, g("Nusco").gg]).toEqual(["E", 2695]);
    expect([g("Bajardo").zone, g("Bajardo").gg]).toEqual(["F", 3338]);
    expect([g("Verceia").zone, g("Verceia").gg]).toEqual(["E", 2354]);
    expect([g("Valfurva").zone, g("Valfurva").gg, g("Valfurva").alt]).toEqual(["F", 3971, 1339]);
    expect([g("Bastia Umbra").zone, g("Bastia Umbra").gg]).toEqual(["D", 1994]);
    expect(g("Sorradile").gg).toBe(1408);
  });
  it("tutti i capoluoghi sono abbinati esattamente al DPR", () => {
    const caps = comuni.filter((c) => c.capoluogo);
    expect(caps.length).toBe(119);
    expect(caps.filter((c) => c.fonte !== "DPR412").map((c) => c.name)).toEqual([]);
  });
  it("sotto −7 °C la potenza di catalogo non supera quella a −7 °C (nessuna estrapolazione verso l'alto)", () => {
    for (const m of HP_CATALOG) expect(catalogPower(m, -15, 35)).toBeLessThanOrEqual(catalogPower(m, -7, 35) + 1e-9);
  });
  it("mandata oltre 55 °C fuori dal dominio del catalogo", () => {
    const hp = { ...exampleProject().heatPump, model: "catalogo" as const, catalogId: HP_CATALOG[0].id };
    expect(performance(0, 58, hp).inDomain).toBe(false);
  });
  it("per un comune d'alta quota nessun capoluogo è rappresentativo: caso esplorativo", () => {
    const s = suggestClimate(g("Livigno"), index)!;
    expect(s.good).toBe(false);
    const p = applyLocation(exampleProject(), g("Livigno"), s);
    const ev = evaluate(p, loadPackage(s.entry.id));
    expect(ev.issues.some((i) => i.section === "Località" && i.severity === "esplorativo")).toBe(true);
  });
});
