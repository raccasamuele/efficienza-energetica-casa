import { Brief } from "./info-tip";
import { packageLabel, type ProjectInput, type SensitivityResult } from "../engine";
import { eur, signedEur } from "./format";
import { ESITO, nonCalcolabileText, primoInVariante, primoStabileText, SENS_BATTERIA, SENS_INVERTE, SENS_LIMITI, SENS_NESSUNO, SENS_TROPPO_VICINO } from "./sensibilita-testi";

export function SensitivityView({ sens, running, p }: { sens: SensitivityResult | null; running: boolean; p: ProjectInput }) {
  if (!sens) return <p className="muted" role="status">{running ? "Calcolo della sensibilità in corso…" : "Sensibilità non disponibile: correggi prima gli errori."}</p>;
  return (
    <>
      {running && (
        <p className="small muted" role="status">
          Aggiornamento in corso…
        </p>
      )}
      <p className="small muted"><Brief label="Dettagli e limiti">{SENS_LIMITI}</Brief></p>
      <div className="cards">
        <div className="card">
          <div className="k">Guadagno in {p.economics.horizonYears.value} anni (VAN): pacchetto con il valore più alto e non negativo (valori nominali)</div>
          <div className="v">{sens.nominalBest ? packageLabel(sens.nominalBest, p) : "Nessuno"}</div>
          <div className="small muted">
            {sens.nominalBest === null
              ? SENS_NESSUNO
              : primoStabileText(sens.bestStableShare)}
          </div>
        </div>
      </div>
      {(p.battery.enabled || p.existingPv.present) && <p className="small muted">{SENS_BATTERIA}</p>}
      {sens.bestStableShare !== null && sens.bestStableShare < 1 && (
        <div className="notice">{SENS_INVERTE}</div>
      )}
      <div className="section" style={{ marginTop: 12 }}>
        <h3>Intervalli per pacchetto</h3>
        <div className="table-wrap">
          <table className="data cards-sm">
            <thead>
              <tr>
                <th>Pacchetto</th>
                <th>Risparmio annuo (min … max)</th>
                <th>VAN (min … max)</th>
                <th>Esito</th>
              </tr>
            </thead>
            <tbody>
              {sens.packages.map((x) => (
                <tr key={x.id}>
                  <td data-label="Pacchetto">{packageLabel(x.id, p)}{x.batteryNpvMin !== null && <div className="small muted">batteria da sola: {eur(x.batteryNpvMin)} … {eur(x.batteryNpvMax ?? x.batteryNpvMin)}</div>}</td>
                  <td className="num" data-label="Risparmio annuo (min … max)">{Number.isFinite(x.benefitMin) ? `${signedEur(x.benefitMin)} … ${signedEur(x.benefitMax)}` : "—"}</td>
                  <td className="num" data-label="VAN (min … max)">{x.npvMin !== null ? `${eur(x.npvMin)} … ${eur(x.npvMax)}` : "—"}</td>
                  <td data-label="Esito">
                    {x.unresolved && <span className="badge warn">{ESITO.vicino}</span>}
                    {x.invalidIn.length > 0 && (
                      <details>
                        <summary className="badge bad">{nonCalcolabileText(x.invalidIn.length)}</summary>
                        <ul className="small" style={{ textAlign: "left" }}>
                          {x.invalidIn.map((v) => (
                            <li key={v}>{v}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {!x.unresolved && !x.invalidIn.length && <span className="badge ok">{ESITO.stabile}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}><Brief label="Dettagli e limiti">{SENS_TROPPO_VICINO}</Brief></p>
      </div>
      <details className="section fold">
        <summary>Le {sens.variants.length} varianti, una per una</summary>
        <div className="table-wrap">
          <table className="data cards-sm">
            <thead>
              <tr>
                <th>Variante</th>
                <th>Primo per VAN</th>
              </tr>
            </thead>
            <tbody>
              {sens.variants.map((v) => (
                <tr key={v.id}>
                  <td data-label="Variante">{v.label}</td>
                  <td data-label="Primo per VAN">{primoInVariante(v, p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
