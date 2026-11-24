import { useContext, type ReactNode } from "react";
import {
  HP_CATALOG,
  MAX_QUOTES,
  activateQuote,
  addQuote,
  quoteName,
  quotesOf,
  removeQuote,
  summarizeCost,
  type ProjectInput,
  type Q,
  type QuoteComparison,
  type QuoteKind,
  type QuoteOf,
} from "../engine";
import { FormContext, QField, SelectField } from "./fields";
import { InfoTip } from "./info-tip";
import { eur, fmt } from "./format";
import { CostEditor, type FormProps } from "./forms";
import { ReplacementsEditor } from "./interventions";
import { PREVENTIVI_INTRO, rientroPreventivoText } from "./preventivi-testi";

type Up = FormProps["up"];

/** Le specifiche tecniche che cambiano da un'offerta all'altra; il resto dell'intervento è comune. */
function QuoteSpecs({ kind, q, set }: { kind: QuoteKind; q: QuoteOf<QuoteKind>; set: (fn: (q: QuoteOf<QuoteKind>) => void) => void }) {
  const qf = (label: string, unit: string, value: Q, key: string, min: number, max: number, sizes = false) => (
    <QField
      ownLabel
      label={label}
      unit={unit}
      min={min}
      max={max}
      q={value}
      showSource={false}
      onChange={(v) => set((x) => {
        (x as unknown as Record<string, Q>)[key] = v;
        if (sizes) x.cost.forSize = v.value;
      })}
    />
  );
  if (kind === "pv") return <div className="grid">{qf("Potenza dell'offerta", "kWp", (q as QuoteOf<"pv">).kWp, "kWp", 0.5, 20, true)}</div>;
  if (kind === "battery") {
    const b = q as QuoteOf<"battery">;
    return (
      <div className="grid">
        {qf("Capacità utile", "kWh", b.capacityKwh, "capacityKwh", 0, 50, true)}
        {qf("Potenza di carica e scarica", "kW", b.powerKw, "powerKw", 0.3, 30)}
        {qf("Rendimento di andata e ritorno", "%", b.roundTripPct, "roundTripPct", 50, 100)}
        {qf("Garanzia", "anni", b.warrantyYears, "warrantyYears", 0, 30)}
      </div>
    );
  }
  if (kind === "windows") {
    const w = q as QuoteOf<"windows">;
    return <div className="grid">{qf("Uw del serramento offerto", "W/m²K", w.uWindow, "uWindow", 0.5, 3)}{qf("g del vetro offerto", "", w.gWindow, "gWindow", 0.1, 0.9)}</div>;
  }
  const h = q as QuoteOf<"heatPump">;
  return (
    <div className="grid">
      <SelectField
        label="Macchina dell'offerta"
        value={h.model === "catalogo" ? h.catalogId : "parametrico"}
        options={[...HP_CATALOG.map((m) => ({ value: m.id, label: `${m.manufacturer} – ${m.model} (${fmt(m.ratedPowerMediumT_kW, 1)} kW nominali)` })), { value: "parametrico", label: "Modello parametrico (scenario indicativo)" }]}
        onChange={(v) => set((x) => {
          const y = x as QuoteOf<"heatPump">;
          if (v === "parametrico") y.model = "parametrico";
          else { y.model = "catalogo"; y.catalogId = v; }
        })}
        hint="Se la macchina dell'offerta non è nel catalogo, usa il modello parametrico con la sua potenza nominale."
      />
      {h.model === "parametrico" && qf("Potenza nominale A7/W35", "kW", h.nominalCapacity, "nominalCapacity", 2, 40)}
    </div>
  );
}

function QuoteCard({ p, up, doc, kind, index }: { p: ProjectInput; up: Up; doc: boolean; kind: QuoteKind; index: number }) {
  const context = useContext(FormContext);
  const q = quotesOf(p, kind)[index];
  const set = (fn: (q: QuoteOf<QuoteKind>) => void) => up((d) => fn(d[kind].otherQuotes[index - 1]));
  const cost = summarizeCost(q.cost);
  const name = quoteName(q.cost, index);
  const replacements = "replacements" in q ? q.replacements : null;
  return (
    <details className="quote-card">
      <summary>
        <strong>{name}</strong>{q.cost.supplier.trim() && ` · ${q.cost.supplier}`} · {eur(cost.total)}{!cost.complete && " · voci da chiarire"}
      </summary>
      <QuoteSpecs kind={kind} q={q} set={set} />
      <CostEditor doc={doc} kind={kind} title={`Costi di «${name}»`} block={q.cost} onChange={(c) => set((x) => void (x.cost = c))} />
      {replacements && (
        <ReplacementsEditor
          horizon={p.economics.horizonYears.value}
          title={`Sostituzioni previste con «${name}»`}
          list={replacements}
          onChange={(l) => set((x) => void ((x as QuoteOf<"pv">).replacements = l))}
          doc={doc}
        />
      )}
      <div className="toolbar no-print">
        <button type="button" className="btn small primary" onClick={() => up((d) => activateQuote(d, kind, index))}>Usa questo preventivo nei risultati</button>
        <button type="button" className="btn small" onClick={() => { if (context.guard?.() !== false) up((d) => removeQuote(d, kind, index)); }}>Rimuovi questo preventivo</button>
      </div>
    </details>
  );
}

/** Altri preventivi dello stesso intervento: al massimo tre in tutto, compreso quello in uso. */
export function QuotesPanel({ p, up, doc, kind }: { p: ProjectInput; up: Up; doc: boolean; kind: QuoteKind }) {
  const quotes = quotesOf(p, kind);
  const full = quotes.length >= MAX_QUOTES;
  return (
    <div className="section quotes">
      <h4>Altri preventivi ({quotes.length} di {MAX_QUOTES})</h4>
      <p className="small muted">
        <InfoTip text={`In uso nei risultati: «${quoteName(quotes[0].cost, 0)}».`} label="Altri preventivi">Aggiungi le altre offerte che hai ricevuto: ognuna si calcola sulla stessa casa e con le stesse ipotesi, e nei risultati trovi il confronto. Un preventivo nuovo parte dalle voci che di solito ci sono, tutte «non indicate».</InfoTip>
      </p>
      {quotes.slice(1).map((_, i) => <QuoteCard key={i} p={p} up={up} doc={doc} kind={kind} index={i + 1} />)}
      <div className="toolbar no-print">
        <button type="button" className="btn small" disabled={full} onClick={() => up((d) => void addQuote(d, kind))}>+ Aggiungi un altro preventivo</button>
        {full && <span className="small muted">Al massimo {MAX_QUOTES} preventivi per intervento.</span>}
      </div>
    </div>
  );
}

const paybackText = rientroPreventivoText;

/** Una colonna per preventivo: sul telefono ogni voce diventa una scheda. */
export function QuoteComparisonBlock({ c, horizon }: { c: QuoteComparison; horizon: number }) {
  const rows = c.rows;
  const line = (label: string, cell: (r: (typeof rows)[number]) => ReactNode) => (
    <tr>
      <td data-label="Voce">{label}</td>
      {rows.map((r) => <td key={r.index} className="num" data-label={r.name}>{cell(r)}</td>)}
    </tr>
  );
  const electric = c.kind === "pv" || c.kind === "battery";
  return (
    <div className="quote-comparison">
      <h4>{c.title}</h4>
      {c.notes.map((n) => <p key={n} className="small muted">{n}</p>)}
      <div className="table-wrap">
        <table className="data quotes-table cards-sm">
          <thead>
            <tr>
              <th scope="col">Preventivo</th>
              {rows.map((r) => <th key={r.index} scope="col">{r.name}{r.active && <> <span className="badge info">in uso</span></>}</th>)}
            </tr>
          </thead>
          <tbody>
            {line("Fornitore", (r) => r.supplier.trim() || "—")}
            {line("Data · validità", (r) => `${r.quoteDate || "—"} · ${r.validUntil || "—"}`)}
            {line(c.kind === "windows" ? "Serramento" : "Offerta", (r) => r.size.text)}
            {line("Costo (voci incluse)", (r) => <>{eur(r.total)}{!r.costComplete && " (incompleto)"}</>)}
            {line(c.unitLabel, (r) => (r.perUnit === null ? "—" : eur(r.perUnit)))}
            {line("Voci da chiarire", (r) => (r.unclear.length ? r.unclear.length : "nessuna"))}
            {line("Beneficio il primo anno", (r) => eur(r.annualBenefit))}
            {line(`VAN a ${horizon} anni`, (r) => (r.npv === null ? (r.ok ? "incompleto" : "non calcolato") : eur(r.npv)))}
            {line("Rientro", (r) => (r.npv === null ? "—" : paybackText(r.payback, horizon)))}
            {electric && line("Autosufficienza", (r) => (r.selfSufficiencyPct === null ? "—" : `${fmt(r.selfSufficiencyPct, 0)}%`))}
            {c.kind === "battery" && line("VAN della sola batteria", (r) => eur(r.npvBattery))}
          </tbody>
        </table>
      </div>
      <ul className="small">
        {c.differences.map((d) => <li key={d}>{d}</li>)}
      </ul>
      {rows.some((r) => r.unclear.length || r.warnings.length || r.errors.length) && (
        <ul className="small">
          {rows.flatMap((r) => [
            ...r.errors.slice(0, 2).map((e) => <li key={`${r.index}e${e}`}><strong>{r.name}</strong>: {e}</li>),
            ...(r.unclear.length ? [<li key={`${r.index}u`}><strong>{r.name}</strong>, da chiedere all'installatore: {r.unclear.join(", ")}.</li>] : []),
            ...r.warnings.map((w) => <li key={`${r.index}w${w}`}><strong>{r.name}</strong>: {w}</li>),
          ])}
        </ul>
      )}
    </div>
  );
}

/** Tutti i confronti: nei risultati e nel report. */
export function QuoteComparisons({ quotes, horizon }: { quotes: QuoteComparison[]; horizon: number }) {
  if (!quotes.length) return null;
  return (
    <>
      <h3>Confronto dei preventivi</h3>
      <p className="small muted">
        {PREVENTIVI_INTRO}
      </p>
      {quotes.map((c) => <QuoteComparisonBlock key={c.kind} c={c} horizon={horizon} />)}
    </>
  );
}
