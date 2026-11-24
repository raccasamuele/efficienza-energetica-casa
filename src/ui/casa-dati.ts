import type { ProjectInput } from "../engine";
import type { Case } from "./case";
import { importaCasa } from "./case";
import { CAMPI_CASA, conDatiCasa, copy, DHW_CASA, EV_CASA } from "./casa-profilo";

export { CAMPI_CASA, CAMPI_CASA_EXTRA, CAMPI_VERIFICA, casaNuova, conDatiCasa, DHW_CASA, EV_CASA, EV_USO, nomeFileProfilo, profiloCasa, progettoCasa } from "./casa-profilo";

function sameValue(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && sameValue(a[key], b[key]));
}
export function stessaCasa(a: ProjectInput, b: ProjectInput): boolean {
  const pick = (p: ProjectInput) => ({ ...Object.fromEntries(CAMPI_CASA.map(k => [k, p[k]])), ...("journey" in p ? { journey: (p as any).journey } : {}), dhw: Object.fromEntries(DHW_CASA.map(k => [k, p.dhw[k]])), ev: Object.fromEntries(EV_CASA.map(k => [k, p.ev[k]])) });
  return sameValue(pick(a), pick(b));
}
export function salvaScheda(c: Case, dove: string | "attiva" | "nuova", scheda: ProjectInput, now: string, newId: string): Case | { errore: string } {
  const nome = scheda.name.trim(); if (!nome) return { errore: "Scrivi un nome." };
  const input = copy(scheda); input.name = nome.slice(0, 60);
  if (dove === "nuova") return importaCasa(c, input, now, newId);
  const next = copy(c); if (dove === "attiva") { if (!next.attiva) return { errore: "Casa non trovata." }; next.attiva = conDatiCasa(next.attiva, input); }
  else { const entry = next.altre.find(x => x.id === dove); if (!entry) return { errore: "Casa non trovata." }; entry.input = conDatiCasa(entry.input, input); }
  return next;
}
export function verificaDaCasa(casa: ProjectInput): ProjectInput {
  const p = copy(casa); if (p.goal === "auto") p.ev.pvPlan = p.existingPv.present ? "esistente" : p.ev.pvPlan === "esistente" ? "nessuno" : p.ev.pvPlan; return p;
}
