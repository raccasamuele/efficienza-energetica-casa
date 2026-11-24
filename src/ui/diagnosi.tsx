import { PROFILE_LABELS, electricDiagnosis, gasDiagnosis, type ClimatePackage, type PackageResult, type ProjectInput } from "../engine";
import { Foldable } from "./fold";
import { fmt } from "./format";

/** Le forme misurate e le bollette estive spiegano gli usi, senza attribuirli ai singoli apparecchi. */
/** `completo`: nel report il testo di oggi (B4); sullo schermo l'invito più breve. `folded`: chiuso sotto il titolo. */
export function DiagnosisBlock({ p, climate, base, completo = false, folded = false }: { p: ProjectInput; climate: ClimatePackage; base: PackageResult; completo?: boolean; folded?: boolean }) {
  const electric = electricDiagnosis(p, climate, base);
  const electricOnly = p.goal === "fv" || p.goal === "batteria" || p.goal === "auto";
  const gas = electricOnly ? null : gasDiagnosis(p, base);
  return (
    <div className="section">
      <Foldable folded={folded} title="Dove finisce la spesa?">
      {!electric && !gas && <p className="small">{completo
        ? electricOnly ? "Per vedere dove finisce la spesa carica la curva del contatore nel passo dei consumi." : "Per vedere dove finisce la spesa carica la curva del contatore (luce) o indica il gas di una bolletta estiva (gas), nel passo dei consumi."
        : electricOnly ? "Si vede con la curva del contatore, nel passo Consumi." : "Si vede con la curva del contatore (luce) o con il gas di una bolletta estiva (gas), nel passo Consumi."}</p>}
      {electric && <div className="section">
        <h4>Luce</h4>
        <p className="small">Di notte la casa consuma in media {fmt(electric.misurato.fondo_W)} W, anche quando tutto sembra spento: frigorifero, caldaia, router e apparecchi in attesa sono le cause più comuni (è una possibile spiegazione, non una misura dei singoli apparecchi).</p>
        <p className="small">Ridurlo di {fmt(electric.riduzione.W)} W vale circa {fmt(electric.riduzione.kWh)} kWh{electric.riduzione.eur === null ? " l'anno (prezzo non indicato)" : ` e ${fmt(electric.riduzione.eur)} € l'anno al prezzo inserito`}{electric.riduzione.soloOreSenzaSole && ", contando solo le ore senza sole"}.</p>
        <p className="small">Fra le 18 e mezzanotte consumi il {fmt(electric.misurato.serale_pct)}% dell'energia; con il profilo «{PROFILE_LABELS[p.consumption.profile]}» sarebbe il {fmt(electric.tipico.serale_pct)}%.</p>
        <p className="small">D'inverno {fmt(electric.misurato.inverno_kWhGiorno, 1)} kWh al giorno, d'estate {fmt(electric.misurato.estate_kWhGiorno, 1)}.</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Luce</th><th className="num">Contatore</th><th className="num">Tipico</th></tr></thead>
            <tbody>
              {([
                ["Fondo di notte, W", "fondo_W", 0],
                ["Sera, %", "serale_pct", 0],
                ["Inverno, kWh/giorno", "inverno_kWhGiorno", 1],
                ["Estate, kWh/giorno", "estate_kWhGiorno", 1],
              ] as const).map(([label, key, digits]) => <tr key={key}><td>{label}</td><td className="num">{fmt(electric.misurato[key], digits)}</td><td className="num">{fmt(electric.tipico[key], digits)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>}
      {gas && <div className="section">
        <h4>Gas</h4>
        {!gas.errore && <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Gas, Smc l'anno</th><th className="num">Bollette</th><th className="num">Modello</th></tr></thead>
            <tbody>
              <tr><td>Riscaldamento</td><td className="num">{fmt(gas.bolletta.riscaldamento)}</td><td className="num">{fmt(gas.modello.riscaldamento)}</td></tr>
              <tr><td>Acqua calda e cucina</td><td className="num">{fmt(gas.bolletta.acquaCucina)}</td><td className="num">{fmt(gas.modello.acquaCucina)}</td></tr>
            </tbody>
          </table>
        </div>}
        <p className="small muted">D'inverno l'acqua calda consuma un po' di più (acqua dell'acquedotto più fredda), quindi la quota estiva la sottostima.</p>
        {gas.errore && <p className="small">{gas.errore}</p>}
        {gas.suggerimento && <p className="small">{gas.suggerimento}</p>}
      </div>}
      </Foldable>
    </div>
  );
}
