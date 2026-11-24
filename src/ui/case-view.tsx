import type { Goal } from "../engine";
import { useState } from "react";
import { GOAL_OPTIONS, goalInfo } from "./goals";
import { CasaCard } from "./casa";
import { Icon } from "./icons";
import type { Case, RigaConfronto } from "./case";
import { eur, fmt } from "./format";
import { InfoTip } from "./info-tip";

export type CaseListProps = {
  value: Case; onUse: (id: string) => void; onDuplicate: (id: string | "attiva") => void;
  onRename: (id: string | "attiva", name: string) => void; onDelete: (id: string | "attiva", name: string) => void;
  onAdd: () => void; onCompare: () => void; onEdit?: (id?: string | "attiva") => void; onResume?: () => void; onOpen?: () => void;
};

/** Pagina d'inizio: solo un riquadro che apre «Le mie case», più «Riprendi» per continuare subito. */
export function CaseBadge({ value, onOpen, onResume }: { value: Case; onOpen: () => void; onResume?: () => void }) {
  const n = Number(!!value.attiva) + value.altre.length;
  const a = value.attiva;
  return <div className="case-badge" role="region" aria-label="La mia casa">
    <button type="button" className="case-badge-open" onClick={onOpen}>
      <Icon name="casa" size={40} />
      <span className="case-badge-text">
        <strong>Le mie case</strong>
        <span>{a ? <>La mia casa: «{a.name}»{a.location.name ? ` · ${a.location.name}` : ""}</> : n ? "Nessuna casa in uso" : "Nessuna casa salvata"}</span>
        <span className="small muted">{n ? `${n === 1 ? "1 casa salvata" : `${n} case salvate`} in questo browser · apri per vederle, modificarle e confrontarle` : "Aggiungi la tua casa: la usano tutte le domande."}</span>
      </span>
      <span className="case-badge-arrow" aria-hidden="true">›</span>
    </button>
    {a && onResume && <div className="case-badge-resume"><span className="small">Hai un lavoro salvato in questo browser · {goalInfo(a.goal).short}</span><button type="button" className="btn primary" onClick={onResume}>Riprendi</button></div>}
  </div>;
}
export function CaseList({ value, onUse, onDuplicate, onRename, onDelete, onAdd, onCompare, onEdit = () => {}, onImport, onProfile, profileError }: CaseListProps & { value: Case; onImport?: () => void; onProfile?: () => void; profileError?: string | null }) {
  const full = Number(!!value.attiva) + value.altre.length >= 10;
  const actions = (id: string | "attiva", name: string) => <div className="toolbar case-actions">{id !== "attiva" && <button type="button" className="btn" onClick={() => onEdit(id)}>Modifica la casa</button>}
    {id !== "attiva" && <button className="btn primary" type="button" onClick={() => onUse(id)}>Usa questa</button>}
    <button className="btn" type="button" disabled={full} onClick={() => onDuplicate(id)}>Duplica</button>
    <form className="case-rename" onSubmit={(e) => { e.preventDefault(); const field = e.currentTarget.elements.namedItem("nome") as HTMLInputElement; onRename(id, field.value); }}><input name="nome" aria-label={`Nuovo nome per ${name}`} defaultValue={name} maxLength={60}/><button className="btn" type="submit">Rinomina</button></form>
    <button className="btn danger" type="button" onClick={() => onDelete(id, name)}>{id === "attiva" ? "Elimina questa casa" : "Elimina"}</button>
  </div>;
  return <div className="case-list">
    {value.attiva ? <><section className="panel"><CasaCard p={value.attiva} onEdit={() => onEdit("attiva")}/>{actions("attiva", value.attiva.name)}</section><p className="small muted">Comunità energetica: <button type="button" className="text-link" onClick={onProfile}>scarica il profilo di questa casa</button> · <a href="https://cer.raccasamuele.it" target="_blank" rel="noreferrer">il simulatore</a> è un sito a parte. <InfoTip label="Profilo energetico" method="profilo-energetico">Un file con i consumi ora per ora della casa com'è oggi, da caricare nel simulatore della comunità energetica. Non contiene il nome della casa. Gli interventi delle domande non entrano.</InfoTip></p>{profileError && <div className="notice bad" role="alert">{profileError}</div>}</> : <section className="panel"><h2>{value.altre.length ? "Nessuna casa in uso" : "Non hai ancora una casa salvata."}</h2>{value.altre.length > 0 && <p>Puoi usare una delle altre case oppure iniziare una nuova casa.</p>}</section>}
    {value.altre.length > 0 && <section className="panel"><h2>Le altre case</h2>{value.altre.map((c) => <article className="other-case" key={c.id}><div><h3>{c.input.name}</h3><p>{c.input.location.name || "da scegliere"} · Ultima domanda: {goalInfo(c.input.goal).short}</p></div>{actions(c.id, c.input.name)}</article>)}</section>}
    <section className="case-list-footer"><button className="btn" type="button" disabled={full} onClick={onAdd}>Aggiungi una casa</button><span className="case-import"><button className="btn" type="button" disabled={full} onClick={onImport}>Importa una casa</button> <InfoTip label="Importa una casa">Un file salvato con «Salva il progetto» o un profilo energetico.</InfoTip></span>{full && <p className="small muted">Al massimo 10 case in questo browser: eliminane una per aggiungerne un'altra.</p>}{Number(!!value.attiva) + value.altre.length >= 2 && <button className="btn primary" type="button" onClick={onCompare}>Confronta le case</button>}</section>
  </div>;
}

export function CompareTable({ rows }: { rows: RigaConfronto[] }) {
  const headers = ["Casa", "Comune", "Spesa all'anno oggi", "Soluzione migliore", "Investimento", "Spesa all'anno dopo", "VAN", "Rientro"];
  return <div className="compare-wrap"><table className="compare-table"><thead><tr>{headers.map((x) => <th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.id}>
    <th scope="row" data-label="Casa">{r.nome}</th><td data-label="Comune">{r.comune}</td>
    {r.stato === "ok" ? <><td data-label="Spesa all'anno oggi">{eur(r.spesaOggi ?? 0)}</td><td data-label="Soluzione migliore">{r.migliore?.label ?? "VAN non calcolabile: manca un preventivo"}</td><td data-label="Investimento">{r.migliore ? eur(r.migliore.investimento) : "—"}</td><td data-label="Spesa all'anno dopo">{r.migliore ? eur(r.migliore.spesa) : "—"}</td><td data-label="VAN">{r.migliore?.van == null ? "non calcolabile: manca un preventivo" : eur(r.migliore.van)}</td><td data-label="Rientro">{r.migliore?.rientro == null ? "oltre l'orizzonte" : `${fmt(r.migliore.rientro, 1)} anni`}</td></> : <td className="compare-reason" colSpan={6} data-label="Esito">{r.stato}: {r.motivo}</td>}
  </tr>)}</tbody></table><p className="small muted">Ogni casa usa i propri dati e le proprie ipotesi, ai valori centrali (senza la sensibilità). Le case con dati d'esempio non sono confrontabili come case vere.</p></div>;
}

export function CompareCases({ onCompare, rows, running, onBack }: { value: Case; onCompare: (g: Goal) => void; rows: RigaConfronto[] | null; running?: string | null; onBack: () => void }) {
  const [goal, setGoal] = useState<Goal>("pdc");
  return <section className="panel compare-page"><button type="button" className="btn" onClick={onBack}>Torna alle mie case</button><h2>Confronta le case</h2><label>Domanda <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)}>{GOAL_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.short}</option>)}</select></label><button type="button" className="btn primary" onClick={() => onCompare(goal)}>Confronta</button>{running && <p role="status">{running}</p>}{rows && <CompareTable rows={rows}/>}</section>;
}
