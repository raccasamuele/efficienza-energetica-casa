import { describe, expect, it } from "vitest";
import {
  compareTariffs,
  energyByBand,
  evaluate,
  exampleProject,
  hoursOver,
  parseProjectFile,
  q,
  type Band,
  ENGINE_VERSION,
} from "../src/engine";
import { loadMilano } from "./helpers";

const climate = loadMilano();
const sumBands = (bands: Record<Band, number>) => bands.F1 + bands.F2 + bands.F3;
const setIndexedUnknown = (p: ReturnType<typeof exampleProject>) => {
  for (const price of Object.values(p.tariffCompare!.indicizzata)) {
    if (typeof price === "object") price.status = "sconosciuto";
  }
};

describe("confronto tariffe e potenza", () => {
  it("classifica le fasce del calendario sintetico 2025", () => {
    const counts: Record<Band, number> = { F1: 0, F2: 0, F3: 0 };
    for (let h = 0; h < 8760; h++) counts[bandForHour(h)]++;
    expect(counts.F1).toBeGreaterThanOrEqual(2700);
    expect(counts.F1).toBeLessThanOrEqual(2800);
    expect(counts.F1 + counts.F2 + counts.F3).toBe(8760);
  });

  it("riconosce ore locali note, festivita e Pasquetta", () => {
    // h=154: martedi 7 gennaio, 10 UTC / 11 ora locale invernale.
    expect(bandForHour(154)).toBe("F1");
    // h=82: sabato 4 gennaio, 10 UTC / 11 ora locale invernale.
    expect(bandForHour(82)).toBe("F2");
    // h=106: domenica 5 gennaio, 10 UTC / 11 ora locale invernale.
    expect(bandForHour(106)).toBe("F3");
    // h=0: 1 gennaio festivo, 00 UTC / 01 ora locale invernale.
    expect(bandForHour(0)).toBe("F3");
    // h=2650: lunedi 21 aprile, 10 UTC / 11 ora locale: Pasquetta.
    expect(bandForHour(2650)).toBe("F3");
  });

  it("somma i prelievi del pacchetto base, FV e FV con batteria", () => {
    const p = exampleProject();
    const basic = evaluate(p, climate);
    expect(basic.ok).toBe(true);
    for (const id of ["base", "P"] as const) {
      const result = basic.packages.find((item) => item.id === id)!;
      expect(sumBands(compareTariffs(p, climate, result).kWhPerFascia)).toBeCloseTo(result.elec.import_kWh, 1);
    }
    p.battery.enabled = true;
    const withBattery = evaluate(p, climate);
    expect(withBattery.ok).toBe(true);
    const result = withBattery.packages.find((item) => item.id === "P")!;
    expect(result.battery).toBeDefined();
    expect(sumBands(compareTariffs(p, climate, result).kWhPerFascia)).toBeCloseTo(result.elec.import_kWh, 1);
  });

  it("spesa monoraria e bioraria coincide a prezzo uguale", () => {
    const p = exampleProject();
    p.tariffCompare!.monoraria.prezzo = q(0.25);
    p.tariffCompare!.bioraria.f1 = q(0.25);
    p.tariffCompare!.bioraria.f23 = q(0.25);
    const result = evaluate(p, climate).packages[0]!;
    const comparison = compareTariffs(p, climate, result);
    expect(comparison.righe[0]!.spesaEnergia).toBeCloseTo(comparison.righe[1]!.spesaEnergia!, 8);
  });

  it("non calcola le strutture con oneri sconosciuti", () => {
    const p = exampleProject();
    p.tariffCompare!.oneriKwh.status = "sconosciuto";
    const result = evaluate(p, climate).packages[0]!;
    expect(compareTariffs(p, climate, result).righe.every((row) => row.stato === "prezzi mancanti")).toBe(true);
  });

  it("con l'esempio il prezzo medio monorario, oneri inclusi, è 0,28 €/kWh", () => {
    const p = exampleProject();
    const result = evaluate(p, climate).packages[0]!;
    expect(compareTariffs(p, climate, result).righe[0]!.prezzoMedio).toBeCloseTo(0.28, 8);
  });

  it("gli oneri uguali non cambiano la struttura meno cara", () => {
    const p = exampleProject();
    p.tariffCompare!.monoraria.prezzo = q(0.2);
    p.tariffCompare!.bioraria.f1 = q(0.3);
    p.tariffCompare!.bioraria.f23 = q(0.3);
    p.tariffCompare!.indicizzata.punF1 = q(0.1);
    p.tariffCompare!.indicizzata.punF2 = q(0.1);
    p.tariffCompare!.indicizzata.punF3 = q(0.1);
    p.tariffCompare!.indicizzata.spread = q(0);
    const result = evaluate(p, climate).packages[0]!;
    const first = compareTariffs(p, climate, result).menoCara;
    p.tariffCompare!.oneriKwh = q(0.35);
    expect(compareTariffs(p, climate, result).menoCara).toBe(first);
  });

  it("la bioraria con F1 piu cara penalizza il profilo diurno rispetto al serale", () => {
    const p = exampleProject();
    p.tariffCompare!.monoraria.prezzo.status = "sconosciuto";
    p.tariffCompare!.bioraria.f1 = q(0.35);
    p.tariffCompare!.bioraria.f23 = q(0.08);
    p.tariffCompare!.indicizzata.punF1.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF2.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF3.status = "sconosciuto";
    p.tariffCompare!.indicizzata.spread.status = "sconosciuto";
    const result = evaluate(p, climate).packages[0]!;
    const daytime = compareTariffs({ ...p, consumption: { ...p.consumption, profile: "diurno" } }, climate, result);
    const evening = compareTariffs({ ...p, consumption: { ...p.consumption, profile: "serale" } }, climate, result);
    expect(daytime.righe[1]!.totale).toBeGreaterThan(evening.righe[1]!.totale!);
  });

  it("applica D3: 20 euro distinguibili no, 100 euro e oltre il 3 percento si", () => {
    const p = exampleProject();
    setIndexedUnknown(p);
    p.tariffCompare!.monoraria.prezzo = q(0.25);
    p.tariffCompare!.bioraria.f1 = q(0.25);
    p.tariffCompare!.bioraria.f23 = q(0.25);
    p.tariffCompare!.monoraria.fissa = q(70);
    p.tariffCompare!.bioraria.fissa = q(90);
    let result = evaluate(p, climate).packages[0]!;
    expect(compareTariffs(p, climate, result).nonDistinguibili).toContain("bioraria");
    p.tariffCompare!.bioraria.fissa = q(170);
    result = evaluate(p, climate).packages[0]!;
    expect(compareTariffs(p, climate, result).nonDistinguibili).not.toContain("bioraria");
  });

  it("calcola per profilo senza curva misurata e non la espone con curva misurata", () => {
    const p = exampleProject();
    const result = evaluate(p, climate).packages[0]!;
    expect(compareTariffs(p, climate, result).perProfilo).toHaveLength(3);
    p.consumption.measuredCurve = {
      ore: Array.from({ length: 864 }, (_, index) => index % 24 >= 18 ? 0.8 : 0.2),
      giorni: 365,
      dal: "2023-01-01",
      al: "2023-12-31",
      fonte: "Contatore",
    };
    expect(compareTariffs(p, climate, result).perProfilo).toBeUndefined();
  });

  it("conta le ore oltre potenza in W con tolleranza del 10 percento", () => {
    const series_W = [...new Array<number>(10).fill(4000), ...new Array<number>(5).fill(0)];
    expect(sumBands(energyByBand(series_W))).toBe(40);
    expect(hoursOver(series_W, 3)).toBe(10);
    expect(hoursOver(series_W, 4.5)).toBe(0);
  });

  it("lascia prezzi mancanti senza totale o struttura meno cara se ne resta una sola", () => {
    const p = exampleProject();
    p.tariffCompare!.bioraria.f1.status = "sconosciuto";
    p.tariffCompare!.bioraria.f23.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF1.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF2.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF3.status = "sconosciuto";
    p.tariffCompare!.indicizzata.spread.status = "sconosciuto";
    const result = evaluate(p, climate).packages[0]!;
    const comparison = compareTariffs(p, climate, result);
    expect(comparison.righe[1]!.stato).toBe("prezzi mancanti");
    expect(comparison.righe[1]!.totale).toBeUndefined();
    expect(comparison.menoCara).toBeNull();
  });

  it("apre un progetto precedente senza avvisi tariffari e completa i prezzi come sconosciuti", () => {
    const input = exampleProject();
    delete input.tariffCompare;
    const parsed = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input }), null, undefined, { draft: true });
    expect(parsed.file).toBeDefined();
    expect(parsed.warnings.filter((warning) => !warning.startsWith("Anagrafe dei comuni non disponibile"))).toEqual([]);
    const tariff = parsed.file!.input.tariffCompare!;
    expect(tariff.monoraria.prezzo.status).toBe("sconosciuto");
    expect(tariff.oneriKwh.status).toBe("sconosciuto");
    expect(tariff.bioraria.f1.status).toBe("sconosciuto");
    expect(tariff.indicizzata.punF1.status).toBe("sconosciuto");
  });
});

import { bandOf } from "../src/engine";
function bandForHour(hourUtc: number): Band {
  return bandOf(hourUtc);
}
