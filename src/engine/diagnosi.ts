import { HOURS, MONTH_DAYS, localDay, localHour, type ClimatePackage } from "./climate";
import { curveCell, otherUsesDemand, usesMeasuredCurve } from "./curva";
import { packagePv, residualDemand, seasonalDemand, seasonalTable } from "./electric";
import type { PackageResult } from "./scenarios";
import type { ProjectInput } from "./types";

/** Annate di gas utilizzabili, con il primo mese che permette la correzione climatica. */
export function billGasYears(p: ProjectInput): { smc: number; start: string }[] {
  return [
    { smc: p.consumption.gasSmcObserved.value, start: p.consumption.observedStart || "" },
    ...p.consumption.gasOtherYears.map((y) => ({ smc: y.smc.value, start: y.start || "" })),
  ].filter((y, i) => y.smc > 0 && (i === 0 ? p.consumption.gasSmcObserved.status : p.consumption.gasOtherYears[i - 1].smc.status) !== "sconosciuto");
}

/** Media delle bollette non normalizzata, usata per descrivere il consumo misurato. */
export function billGasMean(p: ProjectInput): { smc: number; years: number } | null {
  const values = billGasYears(p);
  return values.length ? { smc: values.reduce((s, y) => s + y.smc, 0) / values.length, years: values.length } : null;
}

export interface ElectricProfileStats { fondo_W: number; serale_pct: number; inverno_kWhGiorno: number; estate_kWhGiorno: number }
export interface ElectricDiagnosis {
  misurato: ElectricProfileStats;
  tipico: ElectricProfileStats;
  riduzione: { W: number; kWh: number; eur: number | null; soloOreSenzaSole: boolean };
}

/** Minimi notturni e consumi serali e stagionali sul calendario civile del clima. */
function profileStats(series: number[]): ElectricProfileStats {
  const night = new Array<number>(365).fill(Infinity);
  const winterDays = new Set<number>(), summerDays = new Set<number>();
  let total = 0, evening = 0, winter = 0, summer = 0;
  for (let h = 0; h < HOURS; h++) {
    const hour = localHour(h), day = localDay(h), w = series[h];
    let rest = day, month = 0;
    while (rest >= MONTH_DAYS[month]) rest -= MONTH_DAYS[month++];
    total += w;
    if (hour <= 5) night[day] = Math.min(night[day], w);
    if (hour >= 18) evening += w;
    if (month === 11 || month <= 1) { winter += w; winterDays.add(day); }
    if (month >= 5 && month <= 7) { summer += w; summerDays.add(day); }
  }
  return {
    fondo_W: night.reduce((s, w) => s + w, 0) / night.length,
    serale_pct: total > 0 ? evening / total * 100 : 0,
    inverno_kWhGiorno: winter / 1000 / winterDays.size,
    estate_kWhGiorno: summer / 1000 / summerDays.size,
  };
}

export function electricDiagnosis(p: ProjectInput, climate: ClimatePackage, r: PackageResult): ElectricDiagnosis | null {
  if (!usesMeasuredCurve(p)) return null;
  const misurato = profileStats(otherUsesDemand(p, r.otherUses_kWh, climate));
  const tipico = profileStats(p.consumption.profileMode === "stagionale"
    ? seasonalDemand(r.otherUses_kWh, p.consumption.profile, seasonalTable(p), curveCell)
    : residualDemand(r.otherUses_kWh, p.consumption.profile));
  const W = misurato.fondo_W >= 200 ? 100 : Math.max(10, Math.round(misurato.fondo_W / 2 / 10) * 10);
  const pv = p.existingPv.present ? packagePv(climate, p, false) : null;
  const hours = pv ? pv.filter((w) => w === 0).length : HOURS;
  const kWh = Math.round(W * hours / 1000);
  const eur = p.tariffs.elecPrice.status === "sconosciuto" ? null : Math.round(kWh * p.tariffs.elecPrice.value);
  return { misurato, tipico, riduzione: { W, kWh, eur, soloOreSenzaSole: p.existingPv.present } };
}

export interface GasDiagnosis {
  bolletta: { annuo: number; anni: number; acquaCucina: number; riscaldamento: number };
  modello: { acquaCucina: number; riscaldamento: number };
  errore: string | null;
  suggerimento: string | null;
}

export function gasDiagnosis(p: ProjectInput, base: PackageResult): GasDiagnosis | null {
  const mean = billGasMean(p), summer = p.consumption.summerGas;
  if (!mean || !(summer.smc.value > 0) || summer.smc.status === "sconosciuto" || summer.days < 28) return null;
  const water = summer.smc.value / summer.days * 365;
  const heat = mean.smc - water;
  const sys = p.system;
  const modelWater = (sys.acsOnGas ? sys.acsGasSmc.value : 0) + (sys.cookingOnGas ? sys.cookingGasSmc.value : 0);
  const errore = heat < 0 ? "Il gas d'estate ripetuto per tutto l'anno supera il gas annuo: controlla che il periodo estivo non comprenda mesi di riscaldamento." : null;
  const suggerimento = !errore && modelWater > 0 && Math.abs(water - modelWater) > modelWater * 0.25
    ? `Dalle bollette estive acqua calda e cucina valgono circa ${Math.round(water)} Smc l'anno, nel progetto ${Math.round(modelWater)}: puoi aggiornarli nel passo Impianto.` : null;
  return {
    bolletta: { annuo: Math.round(mean.smc), anni: mean.years, acquaCucina: Math.round(water), riscaldamento: Math.round(heat) },
    modello: { acquaCucina: Math.round(modelWater), riscaldamento: Math.round(base.gasSmc - modelWater) },
    errore, suggerimento,
  };
}
