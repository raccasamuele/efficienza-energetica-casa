import { ENERGY_CLASSES, PREMIUM_SOURCE, type Evaluation } from "../engine";
import { Check, QField, SelectField } from "./fields";
import type { FormProps } from "./forms";
import { eur, fmt, signedEur } from "./format";

export function HomeValueFields({ p, up, doc }: Pick<FormProps, "p" | "up" | "doc">) {
  const value = p.economics.homeValue;
  return <>
    <Check label="Prova uno scenario con il valore della casa" checked={value.enabled} onChange={(enabled) => up((d) => void (d.economics.homeValue.enabled = enabled))} />
    {value.enabled && <>
      <p className="small">Le case con una classe energetica migliore si vendono di solito a prezzi più alti. Il programma stima la classe dopo i lavori e l'aumento di valore da uno studio della Banca d'Italia: è un'indicazione, non una perizia né un APE. Il confronto principale non cambia.</p>
      <div className="grid">
        <SelectField label="Classe energetica di oggi (dall'APE)" value={value.energyClass} options={[...ENERGY_CLASSES.map((c) => ({ value: c, label: c })), { value: "nonSo", label: "Non lo so (ipotesi: F)" }]} onChange={(energyClass) => up((d) => void (d.economics.homeValue.energyClass = energyClass))} />
        <QField ownLabel label="Valore di mercato della casa oggi" unit="€" q={value.marketValue} onChange={(marketValue) => up((d) => void (d.economics.homeValue.marketValue = marketValue))} showSource={doc} hint="Una stima tua o di un'agenzia: il programma non conosce i prezzi delle case. Senza valore vedi solo le percentuali." />
      </div>
    </>}
  </>;
}

export function HomeValueBlock({ ev }: { ev: Evaluation }) {
  if (!ev.homeValue) return ev.homeValueNote ? <p className="small">{ev.homeValueNote}</p> : null;
  const { rows, classAssumed, column, zone, horizon } = ev.homeValue;
  const noMarketValue = rows.some((r) => r.premiumEur === null);
  return <>
    <p className="small">Stima indicativa, non una perizia né un APE. A parità di zona e di stato della casa, una classe energetica migliore vale in media di più: nella zona climatica {zone}, secondo lo studio della Banca d'Italia sugli annunci 2018–2022. L'aumento si conta alla fine dei {horizon} anni, come se vendessi allora: il risparmio in bolletta degli anni prima è già nel VAN.</p>
    {classAssumed && <p className="small">Classe di oggi non indicata: ipotesi F, una delle più frequenti fra le case in vendita.</p>}
    <div className="table-wrap">
      <table className="data cards-sm">
        <thead><tr><th>Pacchetto</th><th>Classe stimata</th><th>Valore in più</th><th>Oggi vale</th><th>VAN</th><th>VAN con il valore della casa</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td data-label="Pacchetto">{r.label}</td><td data-label="Classe stimata">{r.classBefore} → {r.classAfter}</td>
          <td className="num" data-label="Valore in più">{r.premiumPct > 0 ? "+" : ""}{fmt(r.premiumPct, 1)}%{r.premiumEur !== null && <div className="small">{signedEur(r.premiumEur)}</div>}</td>
          <td className="num" data-label="Oggi vale">{eur(r.presentValue)}</td><td className="num" data-label="VAN">{signedEur(r.npv)}</td><td className="num" data-label="VAN con il valore della casa">{signedEur(r.npvWithValue)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {noMarketValue && <p className="small">Indica il valore di mercato della casa nel passo Interventi per vedere gli euro.</p>}
    <p className="small muted">Prezzi chiesti negli annunci, non prezzi di vendita; nelle province delle grandi città l'aumento in percentuale è di solito più basso, e fra province varia molto (per la classe A dal 7 al 45%). La classe dopo i lavori è stimata dall'energia primaria del modello (riscaldamento e acqua calda a gas, pompa di calore e raffrescamento meno il fotovoltaico della stessa ora; fattori del DM 26/6/2015), partendo dal centro della classe di oggi: non è un APE. Un lavoro che non fa cambiare classe qui vale zero, anche se migliora un po' la casa; le classi da A1 ad A4 valgono uguale, perché lo studio le raggruppa. Elettrodomestici e batteria non contano. Fonte: {PREMIUM_SOURCE}.</p>
    {column === "AB" && <p className="small muted">Nella colonna A-B la classe B vale più della A: i coefficienti sono quelli pubblicati.</p>}
  </>;
}
