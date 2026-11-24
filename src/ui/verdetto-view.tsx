import type { Evaluation, ProjectInput, SensitivityResult } from "../engine";
import { eur, signedEur } from "./format";
import { goalInfo } from "./goals";
import { investmentText, stabilitaFrase, verdetto, verdettoFrase } from "./verdetto";

export function Verdetto({ ev, p, sens }: { ev: Evaluation; p: ProjectInput; sens: SensitivityResult | null }) {
  const v = verdetto(ev, p, sens);
  if (!v) return null;
  const r = ev.packages.find((row) => row.id === v.id);
  const phrase = verdettoFrase(v, ev, p);
  return (
    <section className="panel verdetto">
      <h3>{goalInfo(p.goal).question}</h3>
      <p className={`verdetto-frase ${v.caso === "conviene" ? "tone-ok" : "tone-warn"}`}>{phrase}</p>
      {v.caso !== "mancano-dati" && r && <>
        <div className="kpis">
          <div className="kpi"><span className="k">Spesa all'anno</span><div className="v">{eur(v.spesaOggi)} → {eur(v.spesaDopo)}</div></div>
          <div className="kpi"><span className="k">Spesa iniziale</span><div className="v">{investmentText(r)}</div></div>
          <div className="kpi"><span className="k">{v.rate !== null ? "Rate che ricevi" : "Rientro"}</span><div className="v">{v.rate ?? v.rientro}</div></div>
        </div>
        {v.conIncentivo && v.senzaIncentivo && <>
          <p className="small muted">{v.senzaIncentivo.id === v.id ? `Senza incentivo: ${signedEur(v.senzaIncentivo.npv)}.` : `Senza incentivo: ${v.senzaIncentivo.label}, ${signedEur(v.senzaIncentivo.npv)}.`}</p>
          <p className="small muted">L'incentivo vale solo se ogni anno hai abbastanza imposte da cui toglierlo.</p>
        </>}
        {v.tarato && <p className="small muted">Conti riportati ai consumi della tua bolletta.</p>}
        {sens === null ? <p className="small muted">Controllo della stabilità in corso…</p> : v.stabile !== null && <p className="small muted">{stabilitaFrase(v)}</p>}
        {ev.incentive === null && <p className="small muted">Senza incentivi: se ne hai diritto, aggiungili nel passo Interventi.</p>}
      </>}
    </section>
  );
}
