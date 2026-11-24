import { IssueGroups } from "./issues";
import { InfoTip } from "./info-tip";
import { checkProject, type ProjectInput } from "../engine";
import { FIELDS, fieldId, isInherited, needsEvidence } from "./metadata";
import { goalSections } from "./goals";
import { nextActions } from "./percorso-guidato";

export { documentQuote, editValue, journey, nextActions, setChoice, startProject, type Journey } from "./percorso-guidato";

export function JourneySummary({ p, expanded: _expanded = false }: { p: ProjectInput; expanded?: boolean }) {
  const rules = FIELDS.filter((r) => r.applies(p));
  const assumed = rules.filter((r) => needsEvidence(r.get(p)));
  const inherited = assumed.filter((r) => isInherited(r.get(p)));
  const shown = goalSections(p.goal, p);
  const issues = checkProject(p).filter((i) => shown.includes(i.section) || i.severity === "errore");
  const hasErrors = issues.some((i) => i.severity === "errore");
  return <section className="journey-summary no-print" aria-label="Dati da completare">
    <details open={hasErrors} key={String(hasErrors)}><summary><strong>Dati da completare</strong>{hasErrors ? " · ci sono errori da correggere" : ""}</summary>
    <p><InfoTip text={`Ipotesi numeriche: ${assumed.length}.`} label="Provenienza delle ipotesi">Di queste, {inherited.length} sono ereditate dall'esempio. Dati dichiarati con stato documentato o misurato: {rules.length - assumed.length}. Geometria {p.building.geometryMode === "forma" ? "stimata dalla forma" : "da aree inserite"}.</InfoTip></p>
    <p className="small muted"><InfoTip text="Da dove iniziare" label="Priorità dei dati">Prossimo dato da completare: priorità pratiche per prezzi, fattibilità e preventivi, non una graduatoria d'influenza calcolata.</InfoTip></p>
    <ol>{nextActions(p).map((a) => <li key={a.path}><a href={`#${fieldId(a.path)}`} data-field={a.path}>{a.label}</a><InfoTip label={a.label}>{a.reason}</InfoTip></li>)}</ol>
    <IssueGroups issues={issues} />
    <p className="small muted"><InfoTip label="Ipotesi iniziali">Scelte iniziali di forma, confini, servizi a gas, pompa di calore, profilo elettrico e tetto restano esempi finché non le verifichi nei passi. Costi e tariffe d'esempio non sono prezzi attuali né dati della tua casa.</InfoTip></p>
    </details>
  </section>;
}
