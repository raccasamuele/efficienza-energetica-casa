import { curveCell, usesMeasuredCurve } from "./curva";
import { packageSeries } from "./profilo";
import type { ClimatePackage } from "./climate";
import type { PackageResult } from "./scenarios";
import type { ElectricProfile, ProjectInput, Q, TariffStructureId } from "./types";

export type Band = "F1" | "F2" | "F3";

export interface TariffRow {
  id: TariffStructureId;
  label: string;
  stato: "ok" | "prezzi mancanti";
  spesaEnergia?: number;
  fissa?: number;
  totale?: number;
  prezzoMedio?: number;
}

export interface TariffComparison {
  kWhPerFascia: Record<Band, number>;
  righe: TariffRow[];
  menoCara: TariffStructureId | null;
  nonDistinguibili: TariffStructureId[];
  perProfilo?: { profilo: ElectricProfile; menoCara: TariffStructureId | null }[];
}

export interface PowerRow {
  kW: number;
  costoAnnuo: number;
  oreOltre: number;
  attuale: boolean;
}

const LABELS: Record<TariffStructureId, string> = {
  monoraria: "Monoraria",
  bioraria: "Bioraria",
  indicizzata: "Indicizzata",
};

/** Fascia ARERA dell'ora UTC h nel calendario sintetico 2025. */
export function bandOf(h: number): Band {
  const cell = curveCell(h);
  const hour = cell % 24;
  const dayType = Math.floor(cell / 288);

  if (dayType === 2) return "F3";
  if (dayType === 1) return hour >= 7 && hour < 23 ? "F2" : "F3";
  if (hour >= 8 && hour < 19) return "F1";
  if (hour === 7 || (hour >= 19 && hour < 23)) return "F2";
  return "F3";
}

/** Somma i prelievi orari espressi in W (Wh nell'ora) per fascia. */
export function energyByBand(series_W: number[]): Record<Band, number> {
  const totals: Record<Band, number> = { F1: 0, F2: 0, F3: 0 };
  for (let h = 0; h < series_W.length; h++) {
    totals[bandOf(h)] += series_W[h] / 1000;
  }
  return totals;
}

function row(
  id: TariffStructureId,
  prices: Q[],
  energy: number,
  fixed: Q,
  totalKwh: number,
  oneriKwh: Q,
): TariffRow {
  if ([...prices, fixed, oneriKwh].some((price) => price.status === "sconosciuto")) {
    return { id, label: LABELS[id], stato: "prezzi mancanti" };
  }
  return {
    id,
    label: LABELS[id],
    stato: "ok",
    spesaEnergia: energy + totalKwh * oneriKwh.value,
    fissa: fixed.value,
    totale: energy + totalKwh * oneriKwh.value + fixed.value,
    prezzoMedio: (energy + totalKwh * oneriKwh.value) / (totalKwh || 1),
  };
}

function rowsFor(p: ProjectInput, kwh: Record<Band, number>): TariffRow[] {
  const tariff = p.tariffCompare;
  if (!tariff) return [];
  const totalKwh = kwh.F1 + kwh.F2 + kwh.F3;
  const monorariaEnergy = totalKwh * tariff.monoraria.prezzo.value;
  const biorariaEnergy = kwh.F1 * tariff.bioraria.f1.value
    + (kwh.F2 + kwh.F3) * tariff.bioraria.f23.value;
  const indexedEnergy = kwh.F1 * (tariff.indicizzata.punF1.value + tariff.indicizzata.spread.value)
    + kwh.F2 * (tariff.indicizzata.punF2.value + tariff.indicizzata.spread.value)
    + kwh.F3 * (tariff.indicizzata.punF3.value + tariff.indicizzata.spread.value);

  return [
    row("monoraria", [tariff.monoraria.prezzo], monorariaEnergy, tariff.monoraria.fissa, totalKwh, tariff.oneriKwh),
    row("bioraria", [tariff.bioraria.f1, tariff.bioraria.f23], biorariaEnergy, tariff.bioraria.fissa, totalKwh, tariff.oneriKwh),
    row("indicizzata", [tariff.indicizzata.punF1, tariff.indicizzata.punF2, tariff.indicizzata.punF3, tariff.indicizzata.spread], indexedEnergy, tariff.indicizzata.fissa, totalKwh, tariff.oneriKwh),
  ];
}

function leastExpensive(rows: TariffRow[]): TariffRow[] {
  return rows.filter((item) => item.stato === "ok").sort((a, b) => a.totale! - b.totale!);
}

function tariffWinner(rows: TariffRow[]): TariffRow | undefined {
  const complete = leastExpensive(rows);
  return complete.length >= 2 ? complete[0] : undefined;
}

export function compareTariffs(
  p: ProjectInput,
  climate: ClimatePackage,
  result: PackageResult,
): TariffComparison {
  const series_W = packageSeries(p, climate, result).import;
  const kWhPerFascia = energyByBand(series_W);
  const righe = rowsFor(p, kWhPerFascia);
  const winner = tariffWinner(righe);
  const nonDistinguibili = winner
    ? leastExpensive(righe)
      .filter((item) => item.id !== winner.id && (
        Math.abs(item.totale! - winner.totale!) < 30
        || Math.abs(item.totale! - winner.totale!) / Math.max(winner.totale!, 1) < 0.03
      ))
      .map((item) => item.id)
    : [];

  let perProfilo: TariffComparison["perProfilo"];
  if (!usesMeasuredCurve(p)) {
    const profiles: ElectricProfile[] = ["diurno", "serale", "distribuito"];
    perProfilo = profiles.map((profile) => {
      const profiledProject = {
        ...p,
        consumption: { ...p.consumption, profile },
      };
      const profileSeries_W = packageSeries(profiledProject, climate, result).import;
      const winnerForProfile = tariffWinner(rowsFor(profiledProject, energyByBand(profileSeries_W)));
      return { profilo: profile, menoCara: winnerForProfile?.id ?? null };
    });
  }

  return {
    kWhPerFascia,
    righe,
    menoCara: winner?.id ?? null,
    nonDistinguibili,
    ...(perProfilo ? { perProfilo } : {}),
  };
}

/** Conta le ore in cui la media oraria supera la potenza con il 10% di tolleranza. */
export function hoursOver(series_W: number[], kW: number): number {
  return series_W.filter((watts) => watts > kW * 1.1 * 1000).length;
}

export function comparePower(
  p: ProjectInput,
  climate: ClimatePackage,
  result: PackageResult,
): PowerRow[] {
  const series_W = packageSeries(p, climate, result).import;
  const powers = [...new Set([
    ...(p.tariffCompare?.potenze ?? [3, 4.5, 6]),
    p.tariffs.contractPower.value,
  ])].sort((a, b) => a - b);

  return powers.map((kW) => ({
    kW,
    costoAnnuo: p.tariffs.powerCostPerKw.value * kW,
    oreOltre: hoursOver(series_W, kW),
    attuale: kW === p.tariffs.contractPower.value,
  }));
}
