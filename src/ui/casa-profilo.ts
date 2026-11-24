import { evaluate, exportEnergyProfile, type ClimatePackage, type EnergyProfile, type ProjectInput } from "../engine";
import { startProject } from "./percorso-guidato";

/**
 * Dati della casa e profilo energetico, senza React: li usano il sito (tramite `casa-dati.ts`) e gli strumenti per
 * agenti AI (`scrivi_profilo`).
 */

export const CAMPI_CASA = ["name", "mode", "location", "climateId", "building", "service", "cooling", "system", "consumption", "tariffs", "existingPv"] as const;
export const CAMPI_CASA_EXTRA = ["journey"] as const;
export const CAMPI_VERIFICA = ["schemaVersion", "goal", "windows", "envelope", "heatPump", "cooking", "pv", "battery", "economics", "plan", "tariffCompare"] as const;
export const DHW_CASA = ["todayElectric", "todayTankLitres", "todayPowerKw", "todayStandbyW", "people", "litresPerPerson", "gasDhwEfficiency"] as const;
export const EV_CASA = ["enabled", "kmYear", "alreadyInConsumption"] as const;
export const EV_USO = ["consumptionKwh100", "winterExtraPct", "chargeLossPct", "outsideSharePct", "daysPerWeek", "departHour", "returnHour", "carBatteryKwh", "targetPct", "minDepartPct", "charger", "chargerKw", "strategy"] as const;
export const copy = <T,>(v: T): T => structuredClone(v);
export function conDatiCasa(verifica: ProjectInput, casa: ProjectInput): ProjectInput {
  const p = copy(verifica);
  for (const k of CAMPI_CASA) (p as any)[k] = copy(casa[k]);
  if ("journey" in casa) (p as any).journey = copy((casa as any).journey); else delete (p as any).journey;
  for (const k of DHW_CASA) (p.dhw as any)[k] = copy(casa.dhw[k]);
  for (const k of EV_CASA) (p.ev as any)[k] = copy(casa.ev[k]);
  return p;
}
export function casaNuova(mode: ProjectInput["mode"]): ProjectInput { return startProject(mode, false, "completo"); }
export function progettoCasa(casa: ProjectInput): ProjectInput {
  const p = casaNuova(casa.mode), merged = conDatiCasa(p, casa);
  for (const k of EV_USO) (merged.ev as any)[k] = copy(casa.ev[k]);
  merged.ev.pvPlan = casa.existingPv.present ? "esistente" : "nessuno";
  return merged;
}
/** Nome del file del profilo energetico scaricato: «profilo-energetico_Fossano.json». */
export function nomeFileProfilo(comune: string): string {
  return `profilo-energetico_${comune.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "casa"}.json`;
}
export function profiloCasa(casa: ProjectInput, clima: ClimatePackage, oggi?: Date): EnergyProfile | { errore: string } {
  try {
    if (!casa.location.code) throw new Error();
    const p = progettoCasa(casa), evaluation = evaluate(p, clima);
    if (!evaluation.ok) throw new Error();
    const base = evaluation.packages.find(x => x.id === "base"); if (!base) throw new Error();
    return exportEnergyProfile(p, clima, [base], oggi);
  } catch { return { errore: "Per scaricare il profilo completa i dati della casa: comune e consumi." }; }
}
