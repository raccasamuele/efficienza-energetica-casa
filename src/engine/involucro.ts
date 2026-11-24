import type { ClimatePackage } from "./climate";
import { summarizeCost } from "./economics";
import { computeGeometry, ORIENTATIONS } from "./geometry";
import type { Evaluation } from "./scenarios";
import { scheduledHeating, simulateThermal } from "./thermal";
import { n50AfterWindows } from "./infiltration";
import type { InsulationKind, InsulationMeasure, ProjectInput } from "./types";

export const INSULATION_KINDS: InsulationKind[] = ["walls", "roof", "floor"];
export type InsulationPriceType = "pareti" | "copertura" | "sottotetto" | "solaio";

export const INSULATION_PRICE_SCENARIOS: Record<InsulationPriceType, { basso: number; centrale: number; alto: number }> = {
  pareti: { basso: 110, centrale: 160, alto: 220 },
  copertura: { basso: 150, centrale: 230, alto: 320 },
  sottotetto: { basso: 30, centrale: 50, alto: 80 },
  solaio: { basso: 50, centrale: 80, alto: 120 },
};
export const INSULATION_PRICE_SOURCE = "Ipotesi di scenario, non un prezzo medio verificato: € per m² di superficie isolata, chiavi in mano con IVA. Scenari basso / centrale / alto nella sensibilità. Al 5/11/2026 non risulta una rilevazione italiana affidabile dei prezzi finiti; per confronto, i costi massimi del DM MiTE 14/2/2022 (Allegato A) valgono per la sola fornitura, senza IVA, posa, ponteggi e professionisti (pareti dall'esterno 180–195 €/m², coperture dall'esterno 276 €/m², pavimenti 144–180 €/m²)";

export function insulationApplies(p: ProjectInput, kind: InsulationKind): boolean {
  return kind === "walls" || (kind === "roof" ? p.building.upper !== "riscaldato" : p.building.lower === "nonRiscaldato" || p.building.lower === "esterno");
}

export const activeInsulation = (p: ProjectInput): InsulationKind[] => INSULATION_KINDS.filter((kind) => p.envelope[kind].enabled && insulationApplies(p, kind));

export function insulationPriceType(p: ProjectInput, kind: InsulationKind): InsulationPriceType {
  return kind === "walls" ? "pareti" : kind === "floor" ? "solaio" : p.building.upper === "sottotetto" ? "sottotetto" : "copertura";
}

export function insulationName(p: ProjectInput, kind: InsulationKind): { long: string; short: string } {
  if (kind === "walls") return { long: "Cappotto", short: "Cappotto" };
  if (kind === "floor") return { long: "Isolamento del solaio", short: "Solaio" };
  return p.building.upper === "sottotetto" ? { long: "Isolamento del sottotetto", short: "Sottotetto" } : { long: "Isolamento del tetto", short: "Tetto" };
}

export function insulationCurrentU(p: ProjectInput, kind: InsulationKind): number {
  return p.building[kind === "walls" ? "uWall" : kind === "roof" ? "uUpper" : "uLower"].value;
}

export function insulatedU(uNow: number, m: InsulationMeasure): number {
  if (m.method === "uFinale") return m.uFinal.value;
  return m.thicknessCm.value === 0 ? uNow : 1 / (1 / uNow + (m.thicknessCm.value / 100) / m.lambda.value);
}

export interface SurfaceUpgrade { uAfter: number; share: number; bridgeAfter: number }
export interface EnvelopeUpgrade { walls?: SurfaceUpgrade; upper?: SurfaceUpgrade; lower?: SurfaceUpgrade; bridgeShare?: number; ignoredBridgeDeltaU?: boolean }

export function envelopeUpgrade(p: ProjectInput, only?: InsulationKind[]): EnvelopeUpgrade {
  const out: EnvelopeUpgrade = {};
  const wallShare = p.building.thermalBridges.mode === "lineari" && activeInsulation(p).includes("walls") && (!only || only.includes("walls")) ? Math.max(0, Math.min(1, p.envelope.walls.sharePct.value/100)) : 0;
  if (p.building.thermalBridges.mode === "lineari") {
    out.bridgeShare=wallShare;
    out.ignoredBridgeDeltaU=activeInsulation(p).some(k=>(!only||only.includes(k))&&p.envelope[k].bridges==="valore");
  }
  for (const kind of activeInsulation(p)) {
    if (only && !only.includes(kind)) continue;
    const m = p.envelope[kind];
    out[kind === "walls" ? "walls" : kind === "roof" ? "upper" : "lower"] = {
      uAfter: insulatedU(insulationCurrentU(p, kind), m),
      share: Math.max(0, Math.min(1, m.sharePct.value / 100)),
      bridgeAfter: m.bridges === "valore" ? m.bridgeDeltaU.value : p.building.thermalBridgeDeltaU.value,
    };
  }
  return out;
}

export function envelopeCost(p: ProjectInput, kind: InsulationKind): { total: number; complete: boolean; unknownItems: string[]; area_m2: number } {
  const g = computeGeometry(p.building), m = p.envelope[kind];
  const surface = kind === "walls" ? ORIENTATIONS.reduce((s, o) => s + g.externalWall[o], 0) : kind === "roof" ? g.upperArea : g.lowerArea;
  const area_m2 = surface * Math.max(0, Math.min(1, m.sharePct.value / 100));
  if (m.costMode === "preventivo") return { ...summarizeCost(m.cost), area_m2 };
  const complete = m.pricePerM2.status !== "sconosciuto";
  return { total: m.pricePerM2.value * area_m2, complete, unknownItems: complete ? [] : ["prezzo per m²"], area_m2 };
}

export function envelopeLabel(p: ProjectInput): { long: string; short: string; parts: string[] } {
  const kinds = activeInsulation(p);
  const parts = [...(p.envelope.windows ? ["Serramenti"] : []), ...kinds.map((k) => insulationName(p, k).short)];
  if (parts.length === 1) return { long: p.envelope.windows ? "Serramenti" : insulationName(p, kinds[0]).long, short: parts[0], parts };
  return { long: parts.length ? `Involucro (${parts.map((s) => s.toLocaleLowerCase("it")).join(", ")})` : "Involucro", short: "Involucro", parts };
}

/** Gli stessi campi dei serramenti, applicati solo quando fanno parte dell'involucro. */
export function envelopeBuilding(p: ProjectInput) {
  if (!p.envelope.windows) return p.building;
  // modo «tenuta» (motore 0.12.0): i serramenti nuovi cambiano la tenuta all'aria
  const n50 = p.building.infiltration.mode === "tenuta" ? { ...p.building.infiltration.n50, value: n50AfterWindows(p.building, p.windows).value } : p.building.infiltration.n50;
  return { ...p.building, uWindow: p.windows.uWindow, gWindow: p.windows.gWindow, frameFraction: p.windows.frameFraction, airChange: p.windows.airChange, infiltration: { ...p.building.infiltration, n50 } };
}

export interface EnvelopePartValue {
  id: "windows" | InsulationKind;
  label: string;
  heatSaved_kWh: number;
  heatSavedPct: number;
  gasSaved_smc: number;
  eurSaved: number | null;
  cost: number;
  costComplete: boolean;
  area_m2: number | null;
  H_tb: number;
}
export interface EnvelopeBreakdown { parts: EnvelopePartValue[]; together: Omit<EnvelopePartValue, "id" | "label" | "area_m2" | "H_tb">; sumOfParts_kWh: number }

/** Confronto dei singoli lavori prima della taratura; non chiamato dal calcolo dei pacchetti. */
export function envelopeBreakdown(p: ProjectInput, climate: ClimatePackage, ev: Evaluation): EnvelopeBreakdown | null {
  const kinds = activeInsulation(p);
  const ids: ("windows" | InsulationKind)[] = [...(p.envelope.windows ? ["windows" as const] : []), ...kinds];
  if (!ev.ok || !ev.thermal || ids.length < 2) return null;
  const base = ev.thermal.base.heatNeed_kWh;
  const sys = p.system;
  const efficiency = p.heatPump.included && p.heatPump.boilerEndOfLife ? p.heatPump.replacementBoilerEfficiency.value : sys.boilerEfficiency.value;
  const fuel = sys.efficiencyBasis === "PCS" ? sys.gasPcs.value : sys.gasPci.value;
  const value = (need: number, cost: number, complete: boolean) => {
    const heatSaved_kWh = base - need;
    const gasSaved_smc = heatSaved_kWh / efficiency / fuel;
    return { heatSaved_kWh, heatSavedPct: base > 0 ? heatSaved_kWh / base * 100 : 0, gasSaved_smc, eurSaved: p.tariffs.gasPrice.status === "sconosciuto" ? null : gasSaved_smc * p.tariffs.gasPrice.value, cost, costComplete: complete };
  };
  const parts = ids.map((id): EnvelopePartValue => {
    const cost = id === "windows" ? summarizeCost(p.windows.cost) : envelopeCost(p, id);
    const heating = p.service.schedule?.mode === "fasce" ? scheduledHeating(p.service, ev.thermal!.base.schedule!.pMax_W!) : undefined;
    const th = simulateThermal(id === "windows" ? envelopeBuilding(p) : p.building, p.service, climate, p.cooling.today === "split" ? p.cooling : undefined, id === "windows" ? undefined : envelopeUpgrade(p, [id]), heating);
    return { id, label: id === "windows" ? "Serramenti" : insulationName(p, id).long, ...value(th.heatNeed_kWh, cost.total, cost.complete), area_m2: id === "windows" ? null : envelopeCost(p, id).area_m2, H_tb: th.envelope.H_tb };
  });
  return { parts, together: value(ev.thermal.windows.heatNeed_kWh, parts.reduce((s, x) => s + x.cost, 0), parts.every((x) => x.costComplete)), sumOfParts_kWh: parts.reduce((s, x) => s + x.heatSaved_kWh, 0) };
}
