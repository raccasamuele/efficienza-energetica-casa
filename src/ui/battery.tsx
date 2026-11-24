import { batteryProfileRange, quoteSizeNotes, type Evaluation, type PackageResult, type ProjectInput, type Q, type SensitivityResult } from "../engine";
import { Advanced, Check, QField, SelectField } from "./fields";
import { CostEditor, type FormProps } from "./forms";
import { eur, fmt, signedEur } from "./format";
import { Icon } from "./icons";
import { Brief, InfoTip } from "./info-tip";
import { PV_PLANES } from "./presets";
import { ReplacementsEditor } from "./interventions";
import { QuotesPanel } from "./quotes";
import { Group } from "./fold";
import type { ReactNode } from "react";

export const HOURLY_LIMIT = "La batteria è simulata ora per ora: dentro l'ora non si vedono i picchi e i cali di consumo e di produzione, quindi autoconsumo e risparmio possono risultare più alti del vero.";

/** Dati della batteria: con un FV nuovo è un'opzione, con il FV esistente è l'intervento. */
export function BatteryFields({ p, up, doc, folded = false, alert = false, lead }: Pick<FormProps, "p" | "up" | "doc"> & { folded?: boolean; alert?: boolean; lead?: ReactNode }) {
  const b = p.battery;
  const existing = p.existingPv.present;
  const set = (k: "capacityKwh" | "powerKw" | "roundTripPct" | "reservePct" | "fadePctPerYear" | "lifeYears" | "lifeCycles" | "maintenanceDelta" | "pricePerKwh" | "fixedCost" | "retrofitFixedCost" | "replacementPerKwh" | "replacementFixed" | "warrantyYears") => (q: Q) => up((d) => void (d.battery[k] = q));
  const quoteNote = quoteSizeNotes(p).find((m) => m.includes("batteria"));
  const on = existing || b.enabled;
  const indicative = p.pv.sizing === "indicativa";
  const size = indicative ? "taglia indicativa" : `${fmt(b.capacityKwh.value, 1)} kWh`;
  return (
    <Group folded={folded} alert={alert} icon="batteria" title={existing ? "Batteria per il fotovoltaico che hai già" : "Batteria (facoltativa)"} status={existing ? size.charAt(0).toUpperCase() + size.slice(1) : b.enabled ? `Sì, ${size}` : "No"}>
      {lead}
      <p className="small"><Brief label="Come funziona la batteria nel calcolo" method="batteria-dispacciamento">{"Si carica solo con il fotovoltaico che avanza e si scarica per i consumi della casa. Niente carica dalla rete, niente compravendita a orari, niente previsioni. Il risultato confronta lo stesso pacchetto con e senza batteria: la differenza è quanto vale la batteria da sola."}</Brief></p>
      {!existing && <Check label="Confronta anche con una batteria" checked={b.enabled} onChange={(v) => up((d) => void (d.battery.enabled = v))} />}
      {on && (
        <>
          <div className="grid">
            {indicative
              ? <>
                  <QField label="Batteria, parte per kWh (stima)" unit="€/kWh" q={b.pricePerKwh} onChange={set("pricePerKwh")} showSource={doc} hint="Scenario centrale, IVA compresa: non è un prezzo medio verificato né un preventivo. La sensibilità prova anche 400 e 900 €/kWh. La capacità la sceglie il modello." />
                  {existing
                    ? <QField label="Batteria, parte fissa su FV esistente (stima)" unit="€" q={b.retrofitFixedCost} onChange={set("retrofitFixedCost")} showSource={doc} hint="Aggiungere una batteria a un impianto già fatto di solito richiede un inverter o un convertitore in più." />
                    : <QField label="Batteria, parte fissa con FV nuovo (stima)" unit="€" q={b.fixedCost} onChange={set("fixedCost")} showSource={doc} hint="Installazione e collegamento; l'inverter ibrido è già nel prezzo del FV, non si conta due volte." />}
                </>
              : <QField label="Capacità utile" unit="kWh" q={b.capacityKwh} onChange={set("capacityKwh")} showSource={doc} hint="Quella «utile» o «utilizzabile» della scheda, non quella totale." />}
          </div>
          {quoteNote && <div className="notice" role="status">{quoteNote} <button type="button" className="btn small" onClick={() => up((d) => void (d.battery.cost.forSize = d.battery.capacityKwh.value))}>Il preventivo vale per {fmt(b.capacityKwh.value, 1)} kWh</button></div>}
          <Advanced doc={doc}>
            <div className="grid">
              <QField label="Potenza massima di carica e scarica" unit="kW" q={b.powerKw} onChange={set("powerKw")} showSource={doc} />
              <QField label="Rendimento di andata e ritorno" unit="%" q={b.roundTripPct} onChange={set("roundTripPct")} showSource={doc} hint="Quanta energia torna indietro: 90% = di 10 kWh caricati ne escono 9." />
              <QField label="Riserva sempre carica" unit="%" q={b.reservePct} onChange={set("reservePct")} showSource={doc} hint="Parte della capacità utile che l'inverter non usa mai." />
              <QField label="Degrado ipotizzato" unit="%/anno" q={b.fadePctPerYear} onChange={set("fadePctPerYear")} showSource={doc} hint="Ogni anno la batteria tiene un po' meno; torna piena con la sostituzione. È un'ipotesi, non ricavata dalla garanzia: la sensibilità prova 1 e 3%." />
              {indicative && <QField label="Sostituzione: moduli per kWh (stima)" unit="€/kWh" q={b.replacementPerKwh} onChange={set("replacementPerKwh")} showSource={doc} hint="Alla sostituzione si ricomprano i moduli, non l'inverter né l'intera installazione." />}
              {indicative && <QField label="Sostituzione: parte fissa (stima)" unit="€" q={b.replacementFixed} onChange={set("replacementFixed")} showSource={doc} />}
              <QField label="Vita operativa (scenario)" unit="anni" q={b.lifeYears} onChange={set("lifeYears")} showSource={doc} hint="Quanti anni si assume che duri prima di sostituire i moduli: non è la garanzia. La sensibilità prova 10 e 20 anni." />
              <QField label="Garanzia" unit="anni" q={b.warrantyYears} onChange={set("warrantyYears")} showSource={doc} hint="Durata della garanzia del contratto: è un minimo, non la fine vita né una misura del degrado." />
              <QField label="Vita in cicli" unit="cicli" q={b.lifeCycles} onChange={set("lifeCycles")} showSource={doc} hint="Conta il primo limite che arriva, fra anni e cicli." />
              <QField label="Manutenzione" unit="€/anno" q={b.maintenanceDelta} onChange={set("maintenanceDelta")} showSource={doc} />
            </div>
            <p className="small muted">Rendimento, calo e cicli sono valori tipici letti su schede tecniche reali, non misure: per la tua batteria usa la scheda del preventivo.</p>
          </Advanced>
          {!indicative && <Advanced doc={doc} summary="Preventivo batteria: esempio o tua offerta"><CostEditor doc={doc} kind="battery" path="battery.cost" title="Costi batteria" block={b.cost} onChange={(c) => up((d) => void (d.battery.cost = { ...c, forSize: d.battery.capacityKwh.value }))} /></Advanced>}
          {!indicative && <QuotesPanel p={p} up={up} doc={doc} kind="battery" />}
          {!indicative && <Advanced doc={doc}>
            <ReplacementsEditor horizon={p.economics.horizonYears.value} title="Sostituzioni previste della batteria" list={b.replacements} onChange={(l) => up((d) => void (d.battery.replacements = l))} doc={doc} />
          </Advanced>}
          <p className="small muted">{HOURLY_LIMIT}</p>
        </>
      )}
    </Group>
  );
}

/** Il FV già installato, nella situazione attuale. */
export function ExistingPvFields({ p, up, doc, fixed }: Pick<FormProps, "p" | "up" | "doc"> & { fixed: boolean }) {
  const e = p.existingPv;
  const set = (k: "kWp" | "lossPct" | "gridImportKwh") => (q: Q) => up((d) => void (d.existingPv[k] = q));
  return (
    <div className="section">
      <h4 style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name="fv-esistente" size={22} /> Fotovoltaico già installato</h4>
      {!fixed && <Check label="La casa ha già un impianto fotovoltaico" checked={e.present} onChange={(v) => up((d) => void (d.existingPv.present = v))} />}
      {e.present && (
        <>
          <div className="grid">
            <QField label="Potenza dell'impianto" unit="kWp" q={e.kWp} onChange={set("kWp")} showSource={doc} />
            <SelectField label="Orientamento e inclinazione" value={e.plane} options={PV_PLANES} onChange={(v) => up((d) => void (d.existingPv.plane = v))} />
            <QField label="Ombre e altre perdite" unit="%" q={e.lossPct} onChange={set("lossPct")} showSource={doc} hint="Solo quelle in più: i dati del clima comprendono già il 14% di perdite dell'impianto." />
            <SelectField
              label="Da dove prendi i consumi?"
              value={e.consumptionFrom}
              options={[
                { value: "inverter", label: "Consumo totale dall'app dell'inverter" },
                { value: "bolletta", label: "Solo la bolletta (prelievi dalla rete)" },
                { value: "contatore", label: "Dalla curva del contatore (prelievi e immissioni)" },
              ]}
              onChange={(v) => up((d) => void (d.existingPv.consumptionFrom = v))}
              hint={e.consumptionFrom === "bolletta" ? "Con il FV la bolletta conta solo ciò che prelevi. Il consumo totale si ricava dal calcolo ora per ora con il profilo scelto: è un'ipotesi e cambia con il profilo." : e.consumptionFrom === "contatore" ? "Carica sotto i file dei prelievi e delle immissioni: i consumi si ricostruiscono ora per ora, con l'autoconsumo stimato dalla produzione dell'impianto." : "Inserisci sotto il consumo annuo della casa letto nell'app."}
            />
            {e.consumptionFrom === "bolletta" && <QField label="Prelievi dalla rete in bolletta" unit="kWh/anno" q={e.gridImportKwh} onChange={set("gridImportKwh")} showSource={doc} />}
          </div>
          <p className="small muted">{e.consumptionFrom === "contatore" ? "Prelievi e immissioni sono misurati, l'autoconsumo è stimato: cambia se cambi potenza, orientamento o perdite dell'impianto." : "Con il FV il contatore misura solo i prelievi: da sola la sua curva non è la forma dei consumi e vale il profilo orario."} Eventuali incentivi già in corso sull'impianto restano fuori dal calcolo: non cambiano con la batteria. Il calo di produzione dell'impianto esistente non è nei conti: pesa allo stesso modo con e senza batteria.</p>
        </>
      )}
    </div>
  );
}

/** Il verdetto della batteria: FV senza, FV con, batteria da sola. */
export function BatteryVerdict({ r, p }: { r: PackageResult; p: ProjectInput }) {
  const b = r.battery!;
  const existing = p.existingPv.present;
  const without = b.without.npv;
  const withB = r.cash?.npv ?? null;
  const alone = b.npvBattery;
  let sentence = "Mancano dati di costo: si vedono consumi e quote, non il VAN.";
  if (alone !== null && without !== null && withB !== null) {
    if (existing) sentence = alone >= 0 ? `Con queste ipotesi la batteria conviene: VAN ${signedEur(alone)}.` : `Con queste ipotesi la batteria non conviene: VAN ${signedEur(alone)}.`;
    else if (without >= 0 && alone < 0) sentence = `Il fotovoltaico conviene (VAN ${signedEur(without)}), la batteria no (VAN ${signedEur(alone)}): con queste ipotesi conviene il fotovoltaico senza batteria.`;
    else if (without >= 0 && alone >= 0) sentence = `Convengono sia il fotovoltaico (VAN ${signedEur(without)}) sia la batteria (VAN ${signedEur(alone)}).`;
    else if (without < 0 && withB >= 0) sentence = `Il fotovoltaico da solo non conviene (VAN ${signedEur(without)}), con la batteria sì (VAN ${signedEur(withB)}).`;
    else sentence = `Con queste ipotesi non conviene né il fotovoltaico da solo (VAN ${signedEur(without)}) né con la batteria (VAN ${signedEur(withB)}).`;
  }
  const rows: [string, string, string][] = [
    ["Autoconsumo (produzione usata in casa)", `${fmt(b.without.selfConsumptionPct)}%`, `${fmt(b.selfConsumptionPct)}%`],
    ["Autosufficienza (consumi coperti senza rete)", `${fmt(b.without.selfSufficiencyPct)}%`, `${fmt(b.selfSufficiencyPct)}%`],
    ["Prelievi dalla rete", `${fmt(b.without.elec.import_kWh)} kWh`, `${fmt(r.elec.import_kWh)} kWh`],
    ["Energia immessa in rete", `${fmt(b.without.elec.export_kWh)} kWh`, `${fmt(r.elec.export_kWh)} kWh`],
    ["Risparmio annuo (primo anno)", signedEur(b.without.annualBenefit), signedEur(r.annualBenefit)],
    ["Investimento", eur(b.without.investment), eur(r.investment)],
    ["VAN", without === null ? "—" : signedEur(without), withB === null ? "—" : signedEur(withB)],
  ];
  return (
    <div className="battery-verdict">
      <p className="verdict"><strong>{sentence}</strong></p>
      <div className="kpis">
        {!existing && <div className="kpi"><div className="top"><span className="k">FV senza batteria</span><span className="kpi-icon tone-warn"><Icon name="solare" size={20} /></span></div><div className="v">{without === null ? "—" : signedEur(without)}</div><div className="d">VAN</div></div>}
        <div className="kpi"><div className="top"><span className="k">{existing ? "FV esistente + batteria" : "FV con batteria"}</span><span className="kpi-icon tone-accent"><Icon name="fv-batteria" size={20} /></span></div><div className="v">{withB === null ? "—" : signedEur(withB)}</div><div className="d">VAN</div></div>
        <div className="kpi"><div className="top"><span className="k">La batteria da sola</span><span className={`kpi-icon ${alone !== null && alone >= 0 ? "tone-ok" : "tone-bad"}`}><Icon name="batteria" size={20} /></span></div><div className="v">{alone === null ? "—" : signedEur(alone)}</div><div className="d">VAN con − VAN senza</div></div>
      </div>
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead><tr><th>Primo anno</th><th className="num">{existing ? "FV esistente" : "Senza batteria"}</th><th className="num">Con batteria</th></tr></thead>
          <tbody>{rows.map(([k, a, c]) => <tr key={k}><td data-label="Primo anno">{k}</td><td className="num" data-label={existing ? "FV esistente" : "Senza batteria"}>{a}</td><td className="num" data-label="Con batteria">{c}</td></tr>)}</tbody>
        </table>
      </div>
      <p>
        <strong>Solo la batteria:</strong> costa {eur(b.investment)}{p.pv.sizing === "indicativa" ? " (stima)" : " (dal preventivo)"} e aggiunge {signedEur(r.annualBenefit - b.without.annualBenefit)} all'anno rispetto allo stesso FV senza accumulo (primo anno, senza incentivi): VAN della sola batteria {alone === null ? "non calcolabile" : signedEur(alone)}. I risparmi dei pannelli restano al FV.
        {" "}Passando a {fmt(b.nextStep.capacity, 1)} kWh si aggiungerebbero {signedEur(b.nextStep.extraBenefit)} all'anno, {fmt(b.nextStep.extraThroughput_kWh)} kWh restituiti alla casa e {fmt(b.nextStep.extraSelfSufficiencyPct, 1)} punti di autosufficienza{b.nextStep.extraCost !== null ? `, per ${eur(b.nextStep.extraCost)} di costo stimato in più` : ""}.
      </p>
      {quoteSizeNotes(p).filter((m) => m.includes("batteria")).map((m) => <div key={m} className="notice" role="status">{m}</div>)}
      <p className="small">
        Batteria da {fmt(b.capacity_kWh, 1)} kWh utili: {fmt(b.throughput_kWh)} kWh all'anno passati dalla batteria alla casa, {fmt(b.cyclesPerYear)} cicli all'anno, {fmt(b.losses_kWh)} kWh di perdite.
        {" "}Vita operativa ipotizzata circa {fmt(b.endOfLifeYear, 1)} anni (il primo limite fra anni e cicli; garanzia {fmt(p.battery.warrantyYears.value)} anni){b.replacementYears.length ? `: entro l'orizzonte va sostituita nell'anno ${b.replacementYears.join(", ")}.` : ", oltre l'orizzonte."}
        {b.uncoveredReplacementYears.length > 0 && ` Nessuna sostituzione inserita vicino all'anno ${b.uncoveredReplacementYears.join(", ")}: VAN ottimistico.`}
      </p>
      <p className="small muted"><InfoTip text="Limite del passo orario" label="Limite del calcolo">{HOURLY_LIMIT}</InfoTip></p>
    </div>
  );
}

/** Il VAN della sola batteria sui tre profili orari, se manca la curva del contatore o c'è il FV esistente. */
export function BatteryProfileRange({ ev, sens }: { ev: Evaluation; sens: SensitivityResult | null }) {
  if (!sens) return null;
  const rows = batteryProfileRange(ev, sens);
  if (!rows.length) return null;
  return (
    <p className="small">
      Senza la curva del contatore il profilo orario conta ancora di più con la batteria. VAN della sola batteria sui tre profili sintetici:{" "}
      {rows.map((r) => `${r.label} da ${signedEur(r.npvMin)} a ${signedEur(r.npvMax)}`).join("; ")}.
    </p>
  );
}
