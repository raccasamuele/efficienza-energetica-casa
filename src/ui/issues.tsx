import { type Issue, type Section } from "../engine";
import { FIELDS, fieldId } from "./metadata";
import { InfoTip } from "./info-tip";

const GROUPS = {
  dato: { title: "Dati da misurare o documentare", help: "Serve un dato documentato o misurato, con una provenienza utile. Apri un campo per completare valore, stato e fonte." },
  tecnico: { title: "Stime tecniche da confermare", help: "Serve una stima tecnica motivata e confermata esplicitamente, oppure un dato documentato o misurato. Un preset non basta." },
  percorso: { title: "Scelte del percorso", help: "Preset, geometria stimata, impostazioni e limiti del modello possono mantenere indicativo il confronto. Verifica le scelte applicabili al tuo caso." },
};
type Group = keyof typeof GROUPS;
const CHOICES: [RegExp, string][] = [
  [/^Aree ricavate/, "Geometria dalla forma"],
  [/^Finestre da rapporto/, "Finestre da rapporto"],
  [/^Riscaldamento a orari/, "Riscaldamento discontinuo"],
  [/^Zone a temperature/, "Zone a temperature diverse"],
  [/^Prezzi senza data/, "Data delle tariffe"],
  [/^Costi serramenti/, "Preventivo serramenti"],
  [/^Costi PDC/, "Preventivo PDC"],
  [/^Costi FV/, "Preventivo FV"],
  [/^PDC con modello parametrico/, "PDC parametrica"],
];

/** Errori del motore che non iniziano con il nome del campo: il campo a cui rimandano. */
export const ERROR_FIELDS: [RegExp, string][] = [
  [/^Il numero di piani/, "building.floors"],
  [/^Il perimetro esposto/, "building.exposedPerimeter"],
  [/^La temperatura esterna di progetto/, "system.designOutdoorTemp"],
  [/^Rendimento oltre 0,98/, "system.boilerEfficiency"],
  [/^Rendimento della caldaia nuova/, "heatPump.replacementBoilerEfficiency"],
  [/^L'ora di rientro/, "ev.returnHour"],
  [/^La carica minima alla partenza/, "ev.minDepartPct"],
  [/^L'orizzonte/, "economics.horizonYears"],
  [/^Le rate dell'incentivo/, "economics.incentive.years"],
  [/^Il tetto indicato/, "pv.roofArea"],
  [/^Costo serramenti,/, "windows.cost"],
  [/^Costo PDC,/, "heatPump.cost"],
  [/^Costo ricarica auto,/, "ev.cost"],
  [/^Costo scaldacqua,/, "dhw.cost"],
  [/^Costo FV,/, "pv.cost"],
  [/^Costo batteria,/, "battery.cost"],
];

/** Dove porta il clic su un errore: il suo campo se si conosce, altrimenti il riepilogo del passo della sua sezione. */
export function errorTarget(issue: Issue): { path: string } | { section: Section } {
  const rule = FIELDS.find((r) => r.section === issue.section && issue.message.startsWith(`${r.label}:`));
  const path = rule?.path ?? ERROR_FIELDS.find(([match]) => match.test(issue.message))?.[1];
  return path ? { path } : { section: issue.section };
}

export function groupIssues(issues: Issue[]) {
  const groups: Record<Group, { label: string; path?: string; messages: string[] }[]> = { dato: [], tecnico: [], percorso: [] };
  for (const issue of issues.filter((i) => i.severity === "esplorativo")) {
    const rule = FIELDS.find((r) => r.section === issue.section && issue.message.startsWith(`${r.label}:`));
    const altitude = issue.message.startsWith("Quota della casa");
    const group: Group = rule ? rule.critical === "tecnico" ? "tecnico" : "dato" : altitude ? "dato" : "percorso";
    const label = rule?.label ?? (altitude ? "Quota della casa" : CHOICES.find(([match]) => match.test(issue.message))?.[1] ?? issue.message.split(/[:.]/)[0]);
    const path = rule?.path ?? (altitude ? "location.siteAltitude" : undefined);
    const existing = groups[group].find((x) => x.label === label && x.path === path);
    if (existing) existing.messages.push(issue.message);
    else groups[group].push({ label, path, messages: [issue.message] });
  }
  return groups;
}

export function IssueGroups({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.severity === "errore");
  const notes = issues.filter((i) => i.severity === "nota");
  const groups = groupIssues(issues);
  return <>
    {errors.length > 0 && <div className="notice bad issue-errors" role="alert"><strong>Errori da correggere ({errors.length})</strong><ul className="issues">{errors.map((i, k) => {
      const target = errorTarget(i);
      return <li key={k}>{"path" in target ? <a href={`#${fieldId(target.path)}`} data-field={target.path}>{i.message}</a> : <a href="#riepilogo-errori" data-section={target.section}>{i.message}</a>}</li>;
    })}</ul></div>}
    {(Object.keys(GROUPS) as Group[]).map((key) => groups[key].length > 0 && <div className="issue-group" key={key}>
      <div className="issue-group-title"><h4>{GROUPS[key].title} ({groups[key].length})</h4><InfoTip label={GROUPS[key].title}>{GROUPS[key].help}</InfoTip></div>
      <ul className="issue-chips" aria-label={GROUPS[key].title}>{groups[key].map((item) => <li key={item.path ?? item.label}>
        {item.path ? <a href={`#${fieldId(item.path)}`} data-field={item.path}>{item.label}</a> : <span><InfoTip text={item.label} label={item.label}>{item.messages.join(" ")}</InfoTip></span>}
      </li>)}</ul>
    </div>)}
    {notes.length > 0 && <details className="issue-notes"><summary>Note ({notes.length})</summary><ul className="issues">{notes.map((i, k) => <li key={k}>{i.message}</li>)}</ul></details>}
  </>;
}

/**
 * `errorsOnly`: solo gli errori, in cima al passo. `errorsAbove`: il riepilogo in fondo a un passo che ha già gli
 * errori in cima; li conta e rimanda lassù invece di ripeterli (proposta B della tappa E del piano dopo la 8).
 */
export function IssueList({ issues, sections, errorsOnly = false, errorsAbove = false }: { issues: Issue[]; sections: Section[]; errorsOnly?: boolean; errorsAbove?: boolean }) {
  const mine = issues.filter((i) => sections.includes(i.section));
  const list = mine.filter((i) => errorsOnly ? i.severity === "errore" : !errorsAbove || i.severity !== "errore");
  const errorsUp = errorsAbove ? mine.filter((i) => i.severity === "errore").length : 0;
  // Il clic porta al primo riepilogo del passo, cioè agli errori in cima (stesso gestore dei rimandi degli errori).
  const pointer = errorsUp > 0 && <p className="small issue-pointer">{errorsUp === 1 ? "C'è un errore da correggere: " : `Ci sono ${errorsUp} errori da correggere: `}<a href="#riepilogo-errori" data-section={sections[0]}>{errorsUp === 1 ? "è in cima al passo" : "sono in cima al passo"}</a>.</p>;
  if (!list.length) return errorsOnly ? null : pointer || <p className="small muted">Nessun problema segnalato in questa sezione.</p>;
  const hasErrors = list.some((i) => i.severity === "errore");
  return <>
    {pointer}
    <details className="issue-summary" open={hasErrors} key={String(hasErrors)}>
      <summary>Riepilogo dei dati da verificare{hasErrors ? ` · ${list.filter((i) => i.severity === "errore").length} errori` : ""}</summary>
      <IssueGroups issues={list} />
    </details>
  </>;
}
