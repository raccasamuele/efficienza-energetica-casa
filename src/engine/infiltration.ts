// Infiltrazioni dalla tenuta all'aria, con vento e tiraggio (motore 0.12.0, docs/validazione/CORREZIONE-MOTORE.md §13).
// Modello di Sherman e Grimsrud (1980) con i coefficienti della ASHRAE Handbook of Fundamentals (2001 cap. 26,
// 2005 cap. 27), come riportati nel riferimento di EnergyPlus, ZoneInfiltration:EffectiveLeakageArea:
//   Q = A_L / 1000 · √(Cs·|ΔT| + Cw·v²)   [m³/s], A_L in cm² a 4 Pa, v vento della stazione in m/s.
// Area di perdita dalla prova di tenuta (ASHRAE Fundamentals cap. 16, legge di potenza): Q4 = Q50·(4/50)^0,65,
// A_L = 10000·Q4·√(ρ/(2·4)), coefficiente di efflusso 1.
import type { BuildingInput, WindowsIntervention } from "./types";

/** Cs per 1, 2, 3 o più piani, (L/s)²/(cm⁴·K). */
export const STACK_COEFFICIENT = [0.000145, 0.00029, 0.000435] as const;
/** Cw per classe di riparo 1–5 (righe) e 1, 2, 3 o più piani (colonne), (L/s)²/(cm⁴·(m/s)²). */
export const WIND_COEFFICIENT = [
  [0.000319, 0.00042, 0.000494],
  [0.000246, 0.000325, 0.000382],
  [0.000174, 0.000231, 0.000271],
  [0.000104, 0.000137, 0.000161],
  [0.000032, 0.000042, 0.000049],
] as const;
export const SHELTER_CLASSES = [
  { value: 1, label: "1 · Nessun ostacolo vicino" },
  { value: 2, label: "2 · Casa isolata in campagna" },
  { value: 3, label: "3 · Edifici dall'altra parte della strada" },
  { value: 4, label: "4 · Città, lotti grandi" },
  { value: 5, label: "5 · Edifici subito accanto" },
] as const;
export const LEAKAGE_EXPONENT = 0.65;
const RHO_AIR = 1.2; // kg/m³
const P_REF = 4; // Pa

export interface InfiltrationModel {
  volume: number; // m³
  n50: number; // 1/h
  leakageArea_cm2: number;
  cs: number;
  cw: number;
  minAirChange: number; // vol/h
}

/** Area di perdita efficace a 4 Pa (cm²) da n50 (1/h) e volume (m³). */
export function leakageArea(n50: number, volume: number): number {
  const q50 = (n50 * volume) / 3600;
  const q4 = q50 * Math.pow(P_REF / 50, LEAKAGE_EXPONENT);
  return 10000 * q4 * Math.sqrt(RHO_AIR / (2 * P_REF));
}

const storeyIndex = (floors: number) => Math.min(3, Math.max(1, Math.round(floors))) - 1;
const shelterIndex = (c: number) => Math.min(5, Math.max(1, Math.round(c))) - 1;

/** n50 utilizzabile: noto e positivo. */
export function knownN50(b: BuildingInput): boolean {
  const n = b.infiltration.n50;
  return n.status !== "sconosciuto" && Number.isFinite(n.value) && n.value > 0;
}

/** Modello orario, oppure null nel modo costante o se n50 manca (si usa il ricambio costante). */
export function infiltrationModel(b: BuildingInput, volume: number): InfiltrationModel | null {
  const i = b.infiltration;
  if (i.mode !== "tenuta" || !knownN50(b)) return null;
  return {
    volume,
    n50: i.n50.value,
    leakageArea_cm2: leakageArea(i.n50.value, volume),
    cs: STACK_COEFFICIENT[storeyIndex(b.floors.value)],
    cw: WIND_COEFFICIENT[shelterIndex(i.shelterClass)][storeyIndex(b.floors.value)],
    minAirChange: i.minAirChange.value,
  };
}

/** Infiltrazioni dell'ora senza il minimo, vol/h. */
export function infiltrationAirChange(m: InfiltrationModel, dT: number, wind: number): number {
  const q = (m.leakageArea_cm2 / 1000) * Math.sqrt(m.cs * Math.abs(dT) + m.cw * wind * wind);
  return (3600 * q) / m.volume;
}

/** Ricambio dell'ora: infiltrazioni, ma almeno il minimo garantito da chi abita. */
export function hourlyAirChange(m: InfiltrationModel, dT: number, wind: number): number {
  return Math.max(infiltrationAirChange(m, dT, wind), m.minAirChange);
}

/** n50 dopo i serramenti nuovi: il dato inserito, altrimenti la stessa riduzione del modo costante. */
export function n50AfterWindows(b: BuildingInput, w: WindowsIntervention): { value: number; estimated: boolean } {
  if (w.n50After.status !== "sconosciuto" && Number.isFinite(w.n50After.value) && w.n50After.value > 0) return { value: w.n50After.value, estimated: false };
  const ratio = b.airChange.value > 0 ? w.airChange.value / b.airChange.value : 1;
  return { value: b.infiltration.n50.value * ratio, estimated: true };
}
