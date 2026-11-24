import type { Goal, ProjectInput } from "../engine";
import { Icon } from "./icons";
import { GOALS } from "./goals";

export type GoalChange = { kind: "ok" } | { kind: "confirm"; text: string } | { kind: "blocked"; text: string };
const BATTERY_QUESTION = "Ho già il fotovoltaico: mi conviene la batteria?";
export function goalChange(casa: ProjectInput, g: Goal): GoalChange {
  if (g === "fv" && casa.existingPv.present) return { kind: "blocked", text: `La tua casa ha già il fotovoltaico (scheda «La mia casa»). Per sapere se ti conviene la batteria scegli «${BATTERY_QUESTION}». Se il fotovoltaico non c'è più, toglilo dalla scheda della casa.` };
  if (g === "batteria" && !casa.existingPv.present) return { kind: "confirm", text: "La domanda parte da un fotovoltaico già installato, ma nella scheda della tua casa non c'è. Lo aggiungo alla casa? Poi completi i suoi dati (potenza, orientamento)." };
  if (g === "auto" && !casa.ev.enabled) return { kind: "confirm", text: "La domanda sull'auto aggiunge un'auto elettrica alla tua casa: conterà anche nelle altre domande, e puoi toglierla dalla scheda. Continuo?" };
  return { kind: "ok" };
}
export function switchGoal(casa: ProjectInput, g: Goal, mode: ProjectInput["mode"], confirmed = false): ProjectInput {
  const p = structuredClone(casa);
  p.goal = g; p.mode = mode;
  if (g === "fv") p.battery.enabled = true;
  if (g === "batteria" && confirmed) p.existingPv.present = true;
  if (g === "auto") {
    if (!p.ev.enabled && confirmed) p.ev.enabled = true;
    p.battery.enabled = false;
    if (p.existingPv.present) p.ev.pvPlan = "esistente";
    else if (p.ev.pvPlan === "esistente") p.ev.pvPlan = "nessuno";
  }
  return p;
}

import { casaRows } from "./casa-righe";
export { casaRows, type CasaRow } from "./casa-righe";
const stateText = { tuo: "dato tuo", ipotesi: "ipotesi dall'esempio", manca: "da completare" };
export function CasaCard({ p, onEdit, onNew, compact = false }: { p: ProjectInput; onEdit: () => void; onResume?: () => void; onNew?: () => void; compact?: boolean }) {
  return <section className={`resume-card casa-card${compact ? " compact" : ""}`} aria-label="La mia casa">
    <div className="casa-heading"><Icon name="casa" size={28}/><div><h2>La mia casa</h2><strong>{p.name}</strong></div></div>
    <dl className="casa-rows">{casaRows(p).map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd><small>{stateText[r.state]}</small></div>)}</dl>
    <div className="toolbar"><button type="button" className="btn" onClick={onEdit}>Modifica la casa</button>{onNew && <button type="button" className="btn" onClick={onNew}>Nuova casa da zero</button>}</div>
    <p className="small muted">I dati della casa valgono per tutte le domande. Restano solo in questo browser: per portarli su un altro computer usa «Salva il progetto».</p>
  </section>;
}
export const savedInput = (p: ProjectInput, example: boolean): ProjectInput | null => example ? null : p;
export function projectForCasaEdit(p: ProjectInput): ProjectInput { const view = structuredClone(p); view.goal = "completo"; return view; }
export const goalNames = GOALS;
