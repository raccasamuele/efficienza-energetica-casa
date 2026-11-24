import { HOURS, type ClimatePackage } from "./climate";
import { packagePv, pvProduction } from "./electric";
import { effectiveLocation } from "./location";
import type { Evaluation, PackageResult } from "./scenarios";
import type { EnergyClass, PackageId, ProjectInput } from "./types";

export const ENERGY_CLASSES: EnergyClass[] = ["A4", "A3", "A2", "A1", "B", "C", "D", "E", "F", "G"];
/** Limite superiore del rapporto EPgl,nren / EPgl,nren,rif,standard; G senza limite. */
export const CLASS_UPPER: Record<EnergyClass, number> = { A4: .4, A3: .6, A2: .8, A1: 1, B: 1.2, C: 1.5, D: 2, E: 2.6, F: 3.5, G: Infinity };
/** Centro dell'intervallo della classe; A4 e G sono ipotesi dichiarate. */
export const CLASS_MID: Record<EnergyClass, number> = { A4: .3, A3: .5, A2: .7, A1: .9, B: 1.1, C: 1.35, D: 1.75, E: 2.3, F: 3.05, G: 4 };

export function classOfRatio(r: number): EnergyClass {
  return ENERGY_CLASSES.find((c) => r <= CLASS_UPPER[c]) ?? "G";
}

export const PRIMARY_FACTORS = { gas: 1.05, elettricita: 1.95 }; // fP,nren, DM 26/6/2015, Allegato 1, tabella 1

/** Energia primaria dei servizi dell'edificio, kWh/anno; esclusi cucina, altri usi e batteria. */
export function primaryEnergy(p: ProjectInput, climate: ClimatePackage, r: PackageResult): number {
  const gas = r.services.filter((s) => s.carrier === "gas" && (s.service === "Riscaldamento" || s.service === "ACS")).reduce((sum, s) => sum + s.final_kWh, 0);
  const pv = p.existingPv.present ? packagePv(climate, p, false) : r.has.P ? pvProduction(climate, p.pv.plane, r.pvKwp, p.pv.lossPct.value) : null;
  let elec = 0;
  for (let h = 0; h < HOURS; h++) elec += Math.max(0, (r.hp?.elec[h] ?? 0) + (r.cooling?.elec[h] ?? 0) + (r.dhw?.result.elec[h] ?? 0) - (pv?.[h] ?? 0));
  return gas * PRIMARY_FACTORS.gas + elec / 1000 * PRIMARY_FACTORS.elettricita;
}

export type PremiumColumn = "italia" | "AB" | "C" | "D" | "E" | "F";
export const CLASS_PREMIUM: Record<PremiumColumn, Record<"A" | "B" | "C" | "D" | "E" | "F", number>> = {
  italia: { A: .227, B: .190, C: .145, D: .106, E: .070, F: .033 },
  AB: { A: .113, B: .129, C: .096, D: .084, E: .045, F: .015 },
  C: { A: .147, B: .126, C: .099, D: .057, E: .043, F: .022 },
  D: { A: .145, B: .129, C: .107, D: .078, E: .044, F: .021 },
  E: { A: .282, B: .224, C: .172, D: .129, E: .091, F: .048 },
  F: { A: .313, B: .278, C: .217, D: .150, E: .115, F: .082 },
};
export const PREMIUM_SOURCE = "Loberto, Mistretta, Spuri, «The capitalization of energy labels into house prices. Evidence from Italy», Banca d'Italia, Questioni di Economia e Finanza n. 818, novembre 2023, tabella 1: prezzi chiesti negli annunci di Immobiliare.it, gennaio 2018 – dicembre 2022, a parità di zona, stato di manutenzione e caratteristiche";

export function premiumColumn(p: ProjectInput): PremiumColumn {
  const zone = effectiveLocation(p.location).zone;
  return zone === "A" || zone === "B" ? "AB" : zone;
}

export function classPremium(col: PremiumColumn, c: EnergyClass): number {
  if (c === "G") return 0;
  if (c === "A1" || c === "A2" || c === "A3" || c === "A4") return CLASS_PREMIUM[col].A;
  return CLASS_PREMIUM[col][c];
}

export interface HomeValueRow {
  id: PackageId;
  label: string;
  epBase_kWh: number;
  ep_kWh: number; // energia primaria non rinnovabile del pacchetto, kWh/anno
  classBefore: EnergyClass;
  classAfter: EnergyClass;
  premiumPct: number;
  premiumEur: number | null;
  presentValue: number | null; // aumento di valore a fine orizzonte, attualizzato
  npv: number | null; // VAN del modello, senza incentivo né taratura
  npvWithValue: number | null;
}

export interface HomeValueScenario {
  rows: HomeValueRow[];
  classAssumed: boolean;
  column: PremiumColumn;
  zone: string;
  horizon: number;
}

/** Scenario a parte: nessuna modifica ai pacchetti, ai flussi o al VAN principale. */
export function withHomeValue(p: ProjectInput, climate: ClimatePackage, ev: Evaluation): Evaluation {
  const input = p.economics.homeValue;
  if (!ev.ok || !input.enabled) return ev;
  const base = ev.packages.find((r) => r.id === "base");
  const epBase_kWh = base ? primaryEnergy(p, climate, base) : 0;
  if (epBase_kWh <= 0) return { ...ev, homeValue: null, homeValueNote: "Senza riscaldamento a gas o elettrico nel modello non si può stimare la classe dopo i lavori." };
  const classAssumed = input.energyClass === "nonSo";
  const classBefore = input.energyClass === "nonSo" ? "F" : input.energyClass;
  const column = premiumColumn(p), zone = effectiveLocation(p.location).zone;
  const horizon = p.economics.horizonYears.value, rate = p.economics.realDiscountRate.value;
  const market = input.marketValue;
  const rows = ev.packages.filter((r) => r.id !== "base" && r.valid).map((r): HomeValueRow => {
    const ep_kWh = primaryEnergy(p, climate, r);
    const classAfter = classOfRatio(CLASS_MID[classBefore] * ep_kWh / epBase_kWh);
    const premium = Math.exp(classPremium(column, classAfter) - classPremium(column, classBefore)) - 1;
    const premiumEur = market.status !== "sconosciuto" && market.value > 0 ? market.value * premium : null;
    const presentValue = premiumEur === null ? null : premiumEur / Math.pow(1 + rate, horizon);
    const npv = r.cash?.npv ?? null;
    return { id: r.id, label: r.label, epBase_kWh, ep_kWh, classBefore, classAfter, premiumPct: premium * 100, premiumEur, presentValue, npv, npvWithValue: npv === null || presentValue === null ? null : npv + presentValue };
  });
  return { ...ev, homeValue: { rows, classAssumed, column, zone, horizon } };
}
