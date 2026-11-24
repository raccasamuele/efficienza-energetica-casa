import type { ProjectInput, Q } from "../engine";
import { fmt } from "./format";
import { isInherited } from "./metadata";

/** Righe della scheda «La mia casa», senza React: le stesse nel sito e negli strumenti per agenti AI. */
export interface CasaRow { label: string; value: string; state: "tuo" | "ipotesi" | "manca" }
const stateFor = (...qs: (Q | null | undefined)[]): CasaRow["state"] =>
  qs.some((q) => !q || q.status === "sconosciuto") ? "manca" :
    qs.some((q) => isInherited(q!)) ? "ipotesi" : "tuo";
export function casaRows(p: ProjectInput): CasaRow[] {
  const row = (label: string, value: string, state: CasaRow["state"]): CasaRow => ({ label, value, state });
  const pvState = p.existingPv.present ? stateFor(p.existingPv.kWp) : "tuo";
  const evState = p.ev.enabled ? stateFor(p.ev.kmYear) : "tuo";
  const impiantoQs = [p.system.boilerEfficiency, p.dhw.todayElectric ? p.dhw.todayPowerKw : p.dhw.gasDhwEfficiency];
  if (p.cooling.today === "split") impiantoQs.push(p.cooling.splitEer35);
  return [
    row("Comune", p.location.name ? `${p.location.name}${p.location.sigla ? ` (${p.location.sigla})` : ""}` : "da scegliere", p.location.code ? "tuo" : "manca"),
    row("Casa", `${fmt(p.building.floorArea.value)} m² · ${fmt(p.building.floors.value)} piani`, stateFor(p.building.floorArea, p.building.floors)),
    row("Impianto", `caldaia a gas; acqua calda ${p.dhw.todayElectric ? "con boiler elettrico" : "a gas"}; raffrescamento ${p.cooling.today === "nessuno" ? "nessuno" : "con condizionatori"}`, stateFor(...impiantoQs)),
    row("Bollette", `${fmt(p.consumption.electricityKwh.value)} kWh luce · ${fmt(p.consumption.gasSmcObserved.value)} Smc gas all'anno`, stateFor(p.consumption.electricityKwh, p.consumption.gasSmcObserved)),
    row("Tariffe", `${fmt(p.tariffs.elecPrice.value, 2)} €/kWh luce · ${fmt(p.tariffs.gasPrice.value, 2)} €/Smc gas`, stateFor(p.tariffs.elecPrice, p.tariffs.gasPrice)),
    row("Fotovoltaico già presente", p.existingPv.present ? `sì, ${fmt(p.existingPv.kWp.value, 1)} kWp` : "no", pvState),
    row("Auto elettrica", p.ev.enabled ? `sì, ${fmt(p.ev.kmYear.value)} km all'anno` : "no", evState),
  ];
}
