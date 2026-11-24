import { batteryEstimate, packageLabel, pvEstimate, type Evaluation, type PackageSizing, type ProjectInput, type SensitivityResult, type SizingPoint } from "../engine";
import { SelectField } from "./fields";
import type { FormProps } from "./forms";
import { eur, fmt, signedEur } from "./format";
import { InfoTip } from "./info-tip";
import { useWidth } from "./charts";

export const ESTIMATE_NOTE = "Stima, non un preventivo: il prezzo del FV è una media italiana (IEA PVPS 2024, indagine GSE); i costi della batteria sono scenari dichiarati, perché non risulta una rilevazione italiana affidabile. La taglia indicativa non sostituisce sopralluogo e preventivo.";

/** Le due strade: preventivo dell'utente o taglia indicativa calcolata dal modello. */
export function SizingChoice({ p, up }: Pick<FormProps, "p" | "up">) {
  return (
    <div className="section sizing-choice">
      <SelectField
        label="Hai già un preventivo?"
        value={p.pv.sizing}
        options={[
          { value: "preventivo", label: "Sì, inserisco taglia e preventivo" },
          { value: "indicativa", label: "No, calcola una taglia indicativa" },
        ]}
        onChange={(v) => up((d) => void (d.pv.sizing = v))}
        hint={p.pv.sizing === "indicativa"
          ? `Il modello prova insieme le taglie ${p.existingPv.present ? "della batteria sul tuo FV" : "di FV (fino al tetto) e batteria"} sui tuoi consumi ora per ora e propone quella con il VAN più alto; il gomito della curva dell'autosufficienza resta come alternativa per l'autonomia. ${ESTIMATE_NOTE}`
          : "Inserisci kWp, capacità e importi del preventivo."}
      />
    </div>
  );
}

/** Curva dell'autosufficienza sulle taglie, con taglia scelta, VAN più alto e limite del tetto. */
function SizingCurve({ points, unit, chosen, best, limit, title }: { points: SizingPoint[]; unit: string; chosen: number; best: number | null; limit?: number; title: string }) {
  const [boxRef, W] = useWidth(520);
  const H = 200, L = 40, R = 12, T = 12, B = 30;
  const xs = points.map((x) => x.size);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const x = (v: number) => L + ((W - L - R) * (v - x0)) / Math.max(1e-9, x1 - x0);
  // asse verticale sui dati, a passi tondi: su 0–100% il gomito non si vedrebbe
  const ss = points.map((pt) => pt.selfSufficiencyPct);
  const span = Math.max(...ss) - Math.min(...ss);
  const yStep = span > 40 ? 20 : span > 20 ? 10 : 5;
  const lo = Math.max(0, Math.floor(Math.min(...ss) / yStep) * yStep);
  const hi = Math.min(100, Math.max(lo + 2 * yStep, Math.ceil(Math.max(...ss) / yStep) * yStep));
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const path = points.map((pt, i) => `${i ? "L" : "M"}${x(pt.size).toFixed(1)},${y(pt.selfSufficiencyPct).toFixed(1)}`).join(" ");
  const at = (s: number) => points.find((pt) => pt.size === s);
  const c = at(chosen);
  const b = best !== null ? at(best) : undefined;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += yStep) ticks.push(v);
  const step = x1 - x0 > 12 ? 5 : x1 - x0 > 6 ? 2 : 1;
  const xt: number[] = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) xt.push(v);
  return (
    <div className="chart" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: autosufficienza per taglia, taglia indicativa ${fmt(chosen, 1)} ${unit}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end">{v}%</text>
          </g>
        ))}
        {xt.map((v) => <text key={v} x={x(v)} y={H - 10} textAnchor="middle">{fmt(v, v % 1 ? 1 : 0)}</text>)}
        {limit !== undefined && limit < x1 && (
          <g>
            <line x1={x(limit)} x2={x(limit)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="5 4" />
            <text x={x(limit) + 4} y={T + 10}>tetto</text>
          </g>
        )}
        <path d={path} fill="none" stroke="var(--s1)" strokeWidth={2.4} />
        {b && b.size !== chosen && <circle cx={x(b.size)} cy={y(b.selfSufficiencyPct)} r={6} fill="none" stroke="var(--s3)" strokeWidth={2.4}><title>Scelta economica</title></circle>}
        {c && <circle cx={x(c.size)} cy={y(c.selfSufficiencyPct)} r={6} fill="var(--accent-strong)"><title>Taglia indicativa</title></circle>}
      </svg>
      <div className="legend small">
        <span><i style={{ background: "var(--s1)" }} />autosufficienza</span>
        <span><i style={{ background: "var(--accent-strong)" }} />gomito (alternativa per autonomia)</span>
        {b && b.size !== chosen && <span><i style={{ background: "var(--s3)" }} />scelta economica</span>}
      </div>
    </div>
  );
}

function PointsTable({ points, unit, battery }: { points: SizingPoint[]; unit: string; battery: boolean }) {
  return (
    <details>
      <summary className="small">Tutte le taglie provate</summary>
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead><tr><th>Taglia</th><th className="num">Autosufficienza</th><th className="num">Autoconsumo</th>{battery && <th className="num">Cicli/anno</th>}<th className="num">VAN con prezzo tipico</th></tr></thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.size}>
                <td data-label="Taglia">{fmt(pt.size, 1)} {unit}</td>
                <td className="num" data-label="Autosufficienza">{fmt(pt.selfSufficiencyPct)}%</td>
                <td className="num" data-label="Autoconsumo">{fmt(pt.selfConsumptionPct)}%</td>
                {battery && <td className="num" data-label="Cicli/anno">{pt.size > 0 ? fmt(pt.cycles) : "—"}</td>}
                <td className="num" data-label="VAN con prezzo tipico">{pt.value === null ? "non sta sul tetto" : signedEur(pt.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function OneSizing({ s, p, range }: { s: PackageSizing; p: ProjectInput; range?: NonNullable<SensitivityResult["sizeRange"]>[number] }) {
  const existing = p.existingPv.present;
  const eco = s.economic;
  const ene = s.energetic;
  const withBattery = s.battery.length > 0;
  const limited = !existing && s.kneeKwp !== null && s.kneeKwp > s.maxKwp;
  const what = (c: { kWp: number; capacity: number }) => `${existing ? "FV esistente" : `FV ${fmt(c.kWp, 1)} kWp`}${withBattery ? (c.capacity > 0 ? ` + batteria ${fmt(c.capacity, 1)} kWh` : ", senza batteria") : ""}`;
  const extraCost = (existing ? 0 : pvEstimate(p, ene.kWp) - pvEstimate(p, eco.kWp)) + batteryEstimate(p, ene.capacity) - batteryEstimate(p, eco.capacity);
  const point = s.battery.find((x) => x.size === ene.capacity);
  return (
    <div className="sizing-one">
      <h4>{packageLabel(s.id, p)}</h4>
      <p>
        <strong>Scelta economica: {what(eco)}</strong> · VAN {signedEur(eco.npv)}, autosufficienza {fmt(eco.selfSufficiencyPct)}%.
        {s.allNegative
          ? " Tutte le combinazioni provate hanno VAN negativo: con queste ipotesi conviene non fare nulla. Questa è solo la meno sconveniente."
          : withBattery && eco.capacity === 0 ? " Con questi costi la batteria non conviene: il VAN più alto si ha senza accumulo." : ""}
      </p>
      {(ene.kWp !== eco.kWp || ene.capacity !== eco.capacity) && (
        <p>
          <strong>Alternativa per più autonomia: {what(ene)}</strong>, il «gomito» della curva dell'autosufficienza{limited ? ` (limitato dal tetto: il gomito sarebbe a ${fmt(s.kneeKwp!, 1)} kWp)` : ""}.
          {" "}Autosufficienza {fmt(ene.selfSufficiencyPct)}% invece di {fmt(eco.selfSufficiencyPct)}%, {extraCost >= 0 ? `costo stimato ${eur(extraCost)} in più` : `costo stimato ${eur(-extraCost)} in meno`}, VAN {eur(eco.npv - ene.npv)} più basso. Non è consigliata per convenienza: si sceglie per l'autonomia.
          {ene.capacity > 0 && point && ` La batteria fa ${fmt(point.cycles)} cicli all'anno.`}
          {s.breakEvenPerKwh !== null && ene.capacity > 0 && <> Quella batteria converrebbe solo se la parte per kWh costasse meno di <strong>{eur(s.breakEvenPerKwh)}/kWh</strong>, con parte fissa e sostituzioni stimate (ipotesi: {eur(p.battery.pricePerKwh.value)}/kWh).</>}
        </p>
      )}
      {range && (range.kWpMin !== range.kWpMax || range.capacityMin !== range.capacityMax) && (
        <p className="small">Con i tre profili orari sintetici la scelta economica va {!existing && `da ${fmt(range.kWpMin, 1)} a ${fmt(range.kWpMax, 1)} kWp`}{!existing && withBattery && ", "}{withBattery && `batteria da ${fmt(range.capacityMin, 1)} a ${fmt(range.capacityMax, 1)} kWh`}: con la curva del contatore questo dubbio si riduce.</p>
      )}
      {range && range.kWpMin === range.kWpMax && range.capacityMin === range.capacityMax && <p className="small muted">La scelta economica è la stessa con i tre profili orari sintetici.</p>}
      {withBattery && <p className="small muted">Quanto rende una batteria dipende da quanta produzione avanza nelle ore di sole e da quanto consumi la sera e la notte, ora per ora: non da un rapporto fisso fra kWh di batteria e kWp di pannelli.</p>}
      <div className="sizing-curves">
        {!existing && <div><p className="small muted">FV senza batteria: autosufficienza per kWp, provati fino a produrre il doppio dei consumi annui</p><SizingCurve points={s.pv} unit="kWp" chosen={ene.kWp} best={eco.kWp} limit={s.maxKwp} title="Fotovoltaico" /><PointsTable points={s.pv} unit="kWp" battery={false} /></div>}
        {withBattery && <div><p className="small muted">Batteria sul FV dell'alternativa per autonomia: autosufficienza per kWh, fino al doppio del consumo di un giorno medio</p><SizingCurve points={s.battery} unit="kWh" chosen={ene.capacity} best={null} title="Batteria" /><PointsTable points={s.battery} unit="kWh" battery /></div>}
      </div>
      <CombosTable s={s} />
    </div>
  );
}

/** Tutte le combinazioni della ricerca congiunta, dalla migliore. */
function CombosTable({ s }: { s: PackageSizing }) {
  const rows = [...s.combos].sort((a, b) => b.npv - a.npv);
  return (
    <details>
      <summary className="small">Tutte le combinazioni provate ({rows.length})</summary>
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead><tr><th>FV</th><th>Batteria</th><th className="num">Autosufficienza</th><th className="num">VAN complessivo</th></tr></thead>
          <tbody>{rows.map((c) => <tr key={`${c.kWp}-${c.capacity}`}><td data-label="FV">{fmt(c.kWp, 1)} kWp</td><td data-label="Batteria">{c.capacity > 0 ? `${fmt(c.capacity, 1)} kWh` : "nessuna"}</td><td className="num" data-label="Autosufficienza">{fmt(c.selfSufficiencyPct)}%</td><td className="num" data-label="VAN complessivo">{signedEur(c.npv)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/** Le taglie indicative dei pacchetti mostrati. */
export function SizingBlock({ ev, p, sens }: { ev: Evaluation; p: ProjectInput; sens: SensitivityResult | null }) {
  if (!ev.sizing?.length) return null;
  return (
    <div className="sizing-block">
      <p className="small"><InfoTip text="Come si sceglie la taglia" label="Metodo della taglia indicativa">Il modello prova insieme tutte le combinazioni di kWp che stanno sul tetto e di batteria (nessuna compresa), sui consumi ora per ora di ogni pacchetto, e propone quella con il VAN complessivo più alto rispetto a non installarle. Se tutte hanno VAN negativo lo dice. Come alternativa per l'autonomia mostra il «gomito» della curva dell'autosufficienza: il punto più lontano dalla retta fra la taglia più piccola e la più grande provata (FV fino a produrre il doppio dei consumi annui, batteria fino al doppio del consumo di un giorno medio).</InfoTip></p>
      {ev.sizing.map((s) => <OneSizing key={s.id} s={s} p={p} range={sens?.sizeRange?.find((x) => x.id === s.id)} />)}
      <p className="small muted">{ESTIMATE_NOTE}</p>
    </div>
  );
}
