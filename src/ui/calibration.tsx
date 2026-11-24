import { INCENTIVE_PRESETS, SERVICE_GAP_LIMIT, profileRange, type Evaluation, type ProjectInput, type SensitivityResult } from "../engine";
import { eur, fmt, signedEur } from "./format";
import { InfoTip } from "./info-tip";
import { tettoFrase } from "./verdetto";

/** Il confronto fra il VAN del modello e quello con il riscaldamento riportato al livello della bolletta. */
/** `completo`: nel report il testo di oggi per intero (B4); sullo schermo la frase breve e il resto nel «?». */
export function BillCalibrationBlock({ ev, p, completo = false }: { ev: Evaluation; p: ProjectInput; completo?: boolean }) {
  if (!ev.calibration) return ev.calibrationNote ? <p className="small">{ev.calibrationNote}</p> : null;
  const { factor, billSmc, years, packages } = ev.calibration;
  const base = ev.packages[0];
  const hypothetical = years === 1 && p.consumption.gasSmcObserved.status === "ipotizzato";
  const rows = ev.packages.filter((r) => r.id !== "base");
  return (
    <>
      {completo ? <p className="small">
        Il modello stima {fmt(base.gasSmc)} Smc all'anno, {years > 1 ? `la media di ${years} anni di bollette è` : hypothetical ? "il consumo ipotetico di confronto è" : "la bolletta dice"} {fmt(billSmc)} Smc. Qui sotto il riscaldamento di tutti i pacchetti è moltiplicato per {fmt(factor, 2)}, così la casa di oggi consuma come in bolletta.
        {hypothetical && " È un consumo ipotetico: inserisci quello della tua bolletta."}{years === 1 && " Una sola bolletta risente dell'inverno di quell'anno: meglio la media di 2 o 3 anni."} Non è una misura dell'accuratezza del modello.
      </p> : <p className="small">
        <InfoTip text={`Il modello stima ${fmt(base.gasSmc)} Smc all'anno, ${years > 1 ? `la media di ${years} anni di bollette è` : hypothetical ? "il consumo ipotetico di confronto è" : "la bolletta dice"} ${fmt(billSmc)} Smc: qui sotto il riscaldamento di tutti i pacchetti è moltiplicato per ${fmt(factor, 2)}.`} label="Taratura sulla bolletta" method="taratura-gas">Così la casa di oggi consuma come in bolletta.{years === 1 && " Una sola bolletta risente dell'inverno di quell'anno: meglio la media di 2 o 3 anni."} Non è una misura dell'accuratezza del modello.</InfoTip>
        {hypothetical && " È un consumo ipotetico: inserisci quello della tua bolletta."}
      </p>}
      {ev.calibration.yearsDetail.some((y) => y.ggPeriod !== null && y.ggNormal !== null) && <p className="small">{ev.calibration.yearsDetail.filter((y) => y.ggPeriod !== null && y.ggNormal !== null).map((y, i) => {
        const [year, month] = y.start.split("-").map(Number);
        const mese = new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
        return <span key={`${y.start}-${i}`}>{i ? " " : ""}L'inverno iniziato a {mese} {year} ha avuto {fmt(y.ggPeriod!)} GG contro {fmt(y.ggNormal!)} della media 2015-2024: la bolletta riportata alla media vale {fmt(y.gasAfterSmc)} Smc invece di {fmt(y.gasBeforeSmc)}. </span>;
      })}</p>}
      {ev.calibrationNote && <p className="small">{ev.calibrationNote}</p>}
      {!!ev.calibration.yearsDetail.length && <div className="table-wrap">
        <table className="data cards-sm">
          <thead><tr><th>Annata</th><th className="num">GG del periodo</th><th className="num">GG media 2015-2024</th><th className="num">Gas riscaldamento</th><th className="num">Riportato alla media 2015-2024</th></tr></thead>
          <tbody>{ev.calibration.yearsDetail.map((y, i) => <tr key={`${y.start}-${i}`}><td data-label="Annata">{y.start || "Periodo non indicato"}</td><td className="num" data-label="GG del periodo">{y.ggPeriod === null ? "n.d." : fmt(y.ggPeriod)}</td><td className="num" data-label="GG media 2015-2024">{y.ggNormal === null ? "n.d." : fmt(y.ggNormal)}</td><td className="num" data-label="Gas riscaldamento">{fmt(y.gasBeforeSmc)} Smc</td><td className="num" data-label="Riportato alla media 2015-2024">{fmt(y.gasAfterSmc)} Smc</td></tr>)}</tbody>
        </table>
      </div>}
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead>
            <tr>
              <th>Pacchetto</th>
              <th className="num">VAN del modello</th>
              <th className="num">VAN tarato</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tuned = packages.find((x) => x.id === r.id);
              return (
                <tr key={r.id}>
                  <td data-label="Pacchetto">{r.label}</td>
                  <td className="num" data-label="VAN del modello">{r.cash ? signedEur(r.cash.npv) : "—"}</td>
                  <td className="num" data-label="VAN tarato">{tuned?.cash ? signedEur(tuned.cash.npv) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Lo scenario con un incentivo indicato dall'utente: mai dentro il risultato principale. */
export function IncentiveBlock({ ev }: { ev: Evaluation }) {
  if (!ev.incentive) return ev.incentiveNote ? <p className="small">{ev.incentiveNote}</p> : null;
  const { rows, years, source, date } = ev.incentive;
  const preset = INCENTIVE_PRESETS.find((r) => r.id === ev.incentive?.preset);
  const tuned = rows.some((r) => r.tunedNpv !== null);
  const tetto = tettoFrase(ev);
  return (
    <>
      <p className="small">
        Paghi tutta la spesa all'inizio e ricevi {years} rate annue uguali, senza sconto immediato. Le rate valgono solo se ogni anno hai abbastanza imposte da cui detrarle: chi ne ha poche ne perde una parte. {preset ? `Regola: ${preset.label}. Fonte: ${source}, controllata il ${date.split("-").reverse().join("/")}.` : `Regola indicata da te: ${source}, controllata il ${date}.`} Controlla massimali e condizioni.
      </p>
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead>
            <tr>
              <th>Pacchetto</th>
              <th className="num">Totale delle rate</th>
              <th className="num">Valore attuale</th>
              <th className="num">VAN con incentivo</th>
              {tuned && <th className="num">VAN tarato con incentivo</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Pacchetto">{r.label}</td>
                <td className="num" data-label="Totale delle rate">{eur(r.total)}</td>
                <td className="num" data-label="Valore attuale">{eur(r.presentValue)}</td>
                <td className="num" data-label="VAN con incentivo">{signedEur(r.npv)}</td>
                {tuned && <td className="num" data-label="VAN tarato con incentivo">{r.tunedNpv === null ? "—" : signedEur(r.tunedNpv)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tetto && <p className="small">{tetto}</p>}
    </>
  );
}

/** Senza curva misurata, quanto il VAN del FV dipende dalle ore in cui si consuma. */
export function ProfileRangeBlock({ ev, sens, completo = false }: { ev: Evaluation; sens: SensitivityResult | null; completo?: boolean }) {
  const rows = sens ? profileRange(ev, sens) : [];
  if (!rows.length) return null;
  const ranges = rows.map((r) => `${r.label} da ${signedEur(r.npvMin)} a ${signedEur(r.npvMax)}`).join("; ");
  if (!completo) return (
    <p className="small">
      <strong>Quanto dipende dalle tue abitudini:</strong> con il profilo orario più e meno favorevole il VAN va {ranges}. <InfoTip text="La curva del contatore (passo Consumi) toglie il dubbio." label="Profili orari">Le ore di consumo sono tre profili inventati, non misure.</InfoTip>
    </p>
  );
  return (
    <p className="small">
      <strong>Quanto dipende dalle tue abitudini.</strong> Le ore di consumo sono tre profili inventati, non misure. Con il profilo più e meno favorevole il VAN va: {ranges}. Con la curva del tuo contatore (passo Consumi) questo dubbio sparisce.
    </p>
  );
}

/** Spiega l'etichetta «non confrontabile». */
export function ComparableNote({ ev }: { ev: Evaluation }) {
  const rows = ev.packages.filter((r) => !r.comparable);
  if (!rows.length) return null;
  return (
    <p className="small">
      <strong>Non confrontabile:</strong> {rows.map((r) => r.label).join(", ")} in estate {rows.length > 1 ? "forniscono" : "fornisce"} una quantità di freddo diversa dalla situazione attuale, oltre il {SERVICE_GAP_LIMIT}% del fabbisogno. Il VAN confronta servizi diversi: non dice da solo quale conviene.
    </p>
  );
}
