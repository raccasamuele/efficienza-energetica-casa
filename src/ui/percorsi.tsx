import type { PackageResult, PathsResult, PathResult, PlanInput } from "../engine";
import { eur } from "./format";
import { BLOCCHI_PIANO, budgetPercorsoText, etichettaPercorso, NOTE_PIANO, pianoPrimaFrase, quandoText, rientroPercorsoText, stabilitaPercorsoText } from "./piano-testi";
import { CashFlowChart } from "./charts";
import { InfoTip } from "./info-tip";

/** `completo`: nel report le note restano visibili per intero (B4); sullo schermo vanno nel «?». */
export function PianoNelTempo({ result, running, plan, completo = false }: { result: PathsResult | null; running?: boolean; plan?: PlanInput; completo?: boolean }) {
  if (running || !result) return <section className="section" aria-label="Piano nel tempo"><h3>Piano nel tempo</h3><p>Calcolo in corso…</p></section>;
  const paths = [...result.proposed, ...(result.custom ? [result.custom] : [])];
  if (!paths.length) return null;
  const first = pianoPrimaFrase(result, plan);
  const label = (x: PathResult, i: number) => etichettaPercorso(result, x, i);
  // Stesso grafico dei pacchetti: ogni percorso passa come una serie con il suo cumulato attualizzato.
  // cambi di segno del cumulato, senza contare gli anni a zero prima della prima spesa
  const crossings = (c: number[]) => { const d = c.filter((v) => v !== 0); return d.slice(1).filter((v, t) => (d[t] < 0) !== (v < 0)).length; };
  const series = paths.map((x, i) => ({ id: `percorso-${i}`, label: label(x, i), cash: { cumulative: x.cumulative, discountedPayback: x.discountedPayback, crossings: crossings(x.cumulative) } }) as unknown as PackageResult);
  return <section className="section piano-tempo" aria-label="Piano nel tempo">
    <h3>Piano nel tempo</h3>
    {first && <p>{first}</p>}
    <div className="table-wrap"><table className="data cards-sm cards-compact"><thead><tr><th>Percorso</th><th>Involucro</th><th>Impianto</th><th>FV e batteria</th><th>Spesa anno 0</th><th>Spesa anno 1</th><th>Spesa anno 2</th><th>Spesa anno 3</th><th>Spesa anno 4</th><th>Spesa anno 5</th><th>VAN</th><th>Rientro</th><th>Budget</th><th>Stabilità</th></tr></thead><tbody>{paths.map((x,i)=><tr key={i}><td data-label="Percorso" title={x.name}><strong>{label(x, i)}</strong></td>{(["W","H","P"] as const).map(b=><td key={b} data-label={BLOCCHI_PIANO[b]}>{quandoText(x.years[b])}</td>)}{x.spendingByYear.map((amount,y)=><td key={y} data-label={`Spesa anno ${y}`} className={amount === 0 ? "card-zero" : undefined}>{eur(amount)}</td>)}<td data-label="VAN">{eur(x.npv)}</td><td data-label="Rientro">{rientroPercorsoText(x)}</td><td data-label="Budget">{budgetPercorsoText(x)}</td><td data-label="Stabilità">{stabilitaPercorsoText(x)}</td></tr>)}</tbody></table></div>
    <CashFlowChart packages={series} horizon={paths[0].cumulative.length - 1} completo={completo} />
    {completo
      ? <p className="small muted">{NOTE_PIANO}</p>
      : <p className="small muted"><InfoTip text="Confronto senza valore residuo né incentivi." label="Limiti del piano nel tempo" method="piano-nel-tempo">{NOTE_PIANO}</InfoTip></p>}{result.notes.map((n,i)=><p className="small muted" key={i}>{n}</p>)}
  </section>;
}
