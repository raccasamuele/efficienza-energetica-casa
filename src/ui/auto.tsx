import { useMemo } from "react";
import { evPanelBenefit, type ClimatePackage, type Evaluation, type EvInput, type PackageResult, type Q } from "../engine";
import { q } from "../engine";
import { EV_FIELDS, EV_POWER_FEE_SCENARIOS, EV_PRICE_SCENARIOS, EV_PRICE_SOURCE, EV_STRATEGIES, EV_STRATEGY_LABEL, evCost, evFuelComparison, evPower, evStrategies, evOwnership } from "../engine/auto";
import { Check, QField, SelectField, STATUS_LABEL } from "./fields";
import { CostEditor, type FormProps } from "./forms";
import { useResultDetail } from "./dettagli";
import { eur, fmt } from "./format";

type AutoProps = Pick<FormProps, "p" | "up" | "doc">;

export function EvFields({ p, up, doc }: AutoProps) {
  const e = p.ev;
  const set = <K extends keyof EvInput>(key: K, value: EvInput[K]) => up((next) => void (next.ev[key] = value));
  const autoPath = p.goal === "auto";
  const price = (value: Q) => set("price", { ...value, source: "Importo indicato dall'utente, da verificare; non è un prezzo attuale" });
  return <>
    {autoPath ? <SelectField label="Fotovoltaico" value={e.pvPlan} options={[{ value: "esistente", label: "Ho gi\u00e0 il fotovoltaico" }, { value: "nuovo", label: "Vorrei metterlo" }, { value: "nessuno", label: "Niente fotovoltaico" }]} onChange={(v) => up((next) => { next.ev.pvPlan = v; next.existingPv.present = v === "esistente"; })} /> : <Check label="In famiglia c'è o ci sarà un'auto elettrica" checked={e.enabled} onChange={(v) => set("enabled", v)} />}
    {(e.enabled || autoPath) && <>
      {!autoPath && <Check label="La ricarica è già compresa nei consumi della luce indicati" checked={e.alreadyInConsumption} onChange={(v) => set("alreadyInConsumption", v)} />}
      {e.alreadyInConsumption && <p className="small">Togliamo dagli altri usi l'energia annua di ricarica a casa, indipendentemente dall'orario scelto.</p>}
      {(e.enabled || autoPath) && <>
        <h4>Per il costo totale</h4>
        <p className="small">Prezzi scritti da te: il sito non propone prezzi di auto. Il bollo dell'elettrica: scrivi la media sugli anni.</p>
        <div className="grid">
          <div className="section">
            <h4>Auto elettrica</h4>
            <div className="grid">
              <QField ownLabel label="Prezzo dell'auto elettrica" unit={String.fromCharCode(8364)} min={0} max={200000} q={e.evPrice} showSource={doc} onChange={(v) => set("evPrice", v)} />
              <QField ownLabel label="Incentivo sull'elettrica" unit={String.fromCharCode(8364)} min={0} max={50000} q={e.evIncentive} showSource={doc} onChange={(v) => set("evIncentive", v)} />
              <QField ownLabel label="Manutenzione elettrica" unit={`${String.fromCharCode(8364)}/anno`} min={0} max={5000} q={e.evMaintenance} showSource={doc} onChange={(v) => set("evMaintenance", v)} />
              <QField ownLabel label="Bollo elettrica (media annua)" unit={`${String.fromCharCode(8364)}/anno`} min={0} max={3000} q={e.evTax} showSource={doc} onChange={(v) => set("evTax", v)} />
              <QField ownLabel label="Rivendita elettrica a fine periodo" unit={String.fromCharCode(8364)} min={0} max={200000} q={e.evResale} showSource={doc} onChange={(v) => set("evResale", v)} />
            </div>
          </div>
          <div className="section">
            <h4>Auto a combustione</h4>
            <div className="grid">
              <QField ownLabel label="Prezzo (0 se tieni l'auto che hai)" unit={String.fromCharCode(8364)} min={0} max={200000} q={e.icePrice} showSource={doc} onChange={(v) => set("icePrice", v)} />
              <QField ownLabel label="Manutenzione" unit={`${String.fromCharCode(8364)}/anno`} min={0} max={5000} q={e.iceMaintenance} showSource={doc} onChange={(v) => set("iceMaintenance", v)} />
              <QField ownLabel label="Bollo (media annua)" unit={`${String.fromCharCode(8364)}/anno`} min={0} max={3000} q={e.iceTax} showSource={doc} onChange={(v) => set("iceTax", v)} />
              <QField ownLabel label="Rivendita a fine periodo" unit={String.fromCharCode(8364)} min={0} max={200000} q={e.iceResale} showSource={doc} onChange={(v) => set("iceResale", v)} />
            </div>
          </div>
        </div>
        <QField ownLabel label="Anni di possesso" unit="anni" min={1} max={25} q={e.years} showSource={doc} onChange={(v) => set("years", v)} />
        <p className="small">{"Le voci con stato \u00abNon lo so\u00bb non si contano e rendono il totale incompleto. I prezzi restano quelli che hai scritto."}</p>
      </>}
      <p className="small">Il consumo di scheda WLTP comprende già le perdite della prova. Qui indichi solo le perdite di ricarica in più. D'inverno il consumo aumenta della percentuale scelta a dicembre, gennaio e febbraio.</p>
      <div className="grid">
        {EV_FIELDS.filter(([key]) => key !== "price").map(([key, label, unit, min, max]) => <QField key={key} ownLabel path={`ev.${key}`} label={label} unit={unit} q={e[key]} min={min} max={max} showSource={doc} onChange={(v) => set(key, v)} presets={key === "powerIncreaseFeePerKw" ? (["basso", "centrale", "alto"] as const).map((s) => ({ label: `Scenario ${s}`, value: EV_POWER_FEE_SCENARIOS[s], source: EV_PRICE_SOURCE })) : undefined} />)}
        <SelectField label="Come ricarichi a casa" value={e.charger} options={[{ value: "presa", label: "Presa domestica" }, { value: "wallbox", label: "Wallbox" }]} onChange={(v) => up((next) => {
          next.ev.charger = v;
          // Solo l'ipotesi iniziale ancora intatta può seguire il tipo: nessun importo scelto viene riscritto.
          if (next.ev.price.source === EV_PRICE_SOURCE) next.ev.price = q(EV_PRICE_SCENARIOS[v].centrale, "ipotizzato", EV_PRICE_SOURCE);
        })} />
        <SelectField label="Quando caricare (scelta usata in tutti i pacchetti)" value={e.strategy} options={EV_STRATEGIES.map((value) => ({ value, label: EV_STRATEGY_LABEL[value] }))} onChange={(v) => set("strategy", v)} />
      </div>
      <p className="small">Potenza da indicare dalla presa o dalla wallbox: per esempio 2,3 kW per una presa, 3,7–7,4 kW per una wallbox. Cambiare tipo non cambia la potenza che hai scritto.</p>
      <p className="small">Le fasce orarie arrivano con la tappa 7: per ora un solo prezzo. Di notte si carica dalle 23 alle 7. Nelle ore di sole il FV va prima alla casa, poi all'auto, poi alla batteria. La carica col sole parte da 1,4 kW disponibili; di notte recupera fino al minimo scelto.</p>
      <p className="small">I giorni d'uso sono i primi N giorni della settimana, contando lunedì come giorno 1. Negli altri giorni l'auto è sempre a casa. Il rientro è nello stesso giorno della partenza.</p>
      <SelectField label="Costo della ricarica installata" value={e.costMode} options={[{ value: "stima", label: "Stima: scenari dichiarati" }, { value: "preventivo", label: "Preventivo" }]} onChange={(v) => set("costMode", v)} />
      {e.costMode === "stima" ? <>
        <QField ownLabel label="Prezzo della ricarica installata (scenario)" unit="€" path="ev.price" q={e.price} showSource={doc} onChange={price} />
        <div className="presets">{(["basso", "centrale", "alto"] as const).map((scenario) => <button key={scenario} type="button" className="btn small" onClick={() => set("price", q(EV_PRICE_SCENARIOS[e.charger][scenario], "ipotizzato", `${EV_PRICE_SOURCE}; scenario ${scenario} scelto dall'utente`))}>Scenario {scenario} · {eur(EV_PRICE_SCENARIOS[e.charger][scenario])}</button>)}</div>
        <p className="small">{EV_PRICE_SOURCE}. Per presa: 0 / 200 / 500 €; per wallbox: 900 / 1.400 / 2.200 € (basso / centrale / alto). Un importo scritto o scelto da te resta invariato se cambi tipo.</p>
      </> : <CostEditor title="Preventivo della ricarica" kind="ev" path="ev.cost" block={e.cost} doc={doc} onChange={(v) => set("cost", v)} />}
      <p className="small">Anche gli 80 €/kW iniziali per l'aumento di potenza sono un'ipotesi centrale: scenari dichiarati basso 50, centrale 80, alto 120 €/kW, da sostituire con il preventivo. Carburante e ricarica fuori casa usano gli importi indicati da te.</p>
    </>}
  </>;
}

export function EvTable({ p, climate, ev, shown, showInputs = false }: { p: FormProps["p"]; climate: ClimatePackage; ev: Evaluation; shown?: PackageResult; showInputs?: boolean }) {
  const selected = shown ?? ev.packages.find((r) => r.id === "HP") ?? ev.packages.find((r) => r.has.P) ?? ev.packages.at(-1);
  const groups = useMemo(() => {
    if (!p.ev.enabled) return [];
    const base = ev.packages.find((r) => r.id === "base");
    return [...new Set([base, selected])].filter((r): r is PackageResult => !!r?.ev).map((r) => ({ r, rows: evStrategies(p, climate, r) }));
  }, [p, climate, ev, selected]);
  const cost = evCost(p);
  // Serve una seconda valutazione senza l'auto: nel worker quando la pagina lo fornisce.
  const shownPv = !p.existingPv.present && ev.packages.some((r) => r.id === "P" && r.ev);
  const panelBenefit = useResultDetail((d) => shownPv ? d.panelBenefit : null, () => shownPv ? evPanelBenefit(p, climate, ev) : null, [p, climate, ev, shownPv]) ?? null;
  if (!p.ev.enabled || !groups.length) return null;
  return <>
    {(() => {
      // la riga senza pannelli nuovi usa sempre la situazione attuale: nel quadro completo il pacchetto mostrato può avere il FV
      const r = ev.packages.find((x) => x.id === "base" && x.ev) ?? groups[0].r;
      const total = evOwnership(p, r.ev!, (p.ev.pvPlan === "esistente" || p.existingPv.present) ? "Elettrica, con il FV che hai" : "Elettrica, senza pannelli");
      const electric = total.rows[0];
      const pvPackage = !p.existingPv.present ? ev.packages.find((x) => x.id === "P" && x.ev) : undefined;
      const withPv = pvPackage?.ev ? evOwnership(p, pvPackage.ev, "Elettrica, con i pannelli nuovi").rows[0] : null;
      const years = Math.max(1, Math.min(25, Math.round(p.ev.years.value)));
      const withPvDelta = withPv ? total.combustione - withPv.totale : null;
      const withPvDiff = withPvDelta === null ? null : Math.abs(withPvDelta);
      const withPvRelation = withPvDelta === null ? "" : withPvDelta >= 0 ? "in meno" : "in pi\u00f9";
      const diff = Math.abs(total.differenza);
      const relation = total.differenza >= 0 ? "in meno" : "in pi\u00f9";
      return <section className="panel" aria-label="Costo totale dell'auto">
        <h3>Costo totale dell'auto</h3>
        <p>In {years} anni l'elettrica costa {eur(diff)} {relation} dell'auto a combustione.{withPvDiff !== null ? ` Con i pannelli: ${eur(withPvDiff)} ${withPvRelation} dell'auto a combustione.` : ""}{electric.items.acquisto <= p.ev.icePrice.value ? "" : total.pareggio ? ` Recupera la differenza di prezzo in ${total.pareggio} anni.` : " Il pareggio sul prezzo d'acquisto non arriva nel periodo scelto."}</p>
        {total.missing.length > 0 && <p><strong>Totale incompleto.</strong> Mancano: {total.missing.join(", ")}.</p>}
        <div className="table-wrap"><table className="data cards-sm"><thead><tr><th>Auto</th><th>Acquisto (meno incentivo)</th><th>Spesa all'anno</th><th>Rivendita</th><th>Totale in {years} anni</th></tr></thead>
          <tbody><tr><td data-label="Auto">Auto a combustione</td><td className="num" data-label="Acquisto (meno incentivo)">{eur(p.ev.icePrice.value)}</td><td className="num" data-label="Spesa all'anno">{eur(p.ev.kmYear.value * p.ev.fuelL100.value / 100 * p.ev.fuelPrice.value + p.ev.iceMaintenance.value + p.ev.iceTax.value)}</td><td className="num" data-label="Rivendita">{p.ev.iceResale.status === "sconosciuto" ? "Non lo so, non conteggiata" : eur(p.ev.iceResale.value)}</td><td className="num" data-label={`Totale in ${years} anni`}>{eur(total.combustione)}</td></tr>
          <tr><td data-label="Auto">{electric.label}</td><td className="num" data-label="Acquisto (meno incentivo)">{eur(electric.items.acquisto)}</td><td className="num" data-label="Spesa all'anno">{eur(electric.annuo)}</td><td className="num" data-label="Rivendita">{p.ev.evResale.status === "sconosciuto" ? "Non lo so, non conteggiata" : eur(p.ev.evResale.value)}</td><td className="num" data-label={`Totale in ${years} anni`}>{eur(electric.totale)}</td></tr>{withPv && <tr><td data-label="Auto">{withPv.label}</td><td className="num" data-label="Acquisto (meno incentivo)">{eur(withPv.items.acquisto)}</td><td className="num" data-label="Spesa all'anno">{eur(withPv.annuo)}</td><td className="num" data-label="Rivendita">{p.ev.evResale.status === "sconosciuto" ? "Non lo so, non conteggiata" : eur(p.ev.evResale.value)}</td><td className="num" data-label={`Totale in ${years} anni`}>{eur(withPv.totale)}</td></tr>}</tbody></table></div>
        <p className="small">{"Somma semplice a prezzi costanti, senza attualizzazione. Spesa elettrica: ricarica a casa pi\u00f9 energia fuori casa; l'energia gi\u00e0 nella bolletta non viene contata due volte."}</p>
      </section>;
    })()}
    {panelBenefit && <p>I pannelli valgono {eur(panelBenefit.withNpv)} in {p.economics.horizonYears.value} anni con l'auto, {eur(panelBenefit.withoutNpv)} senza: l'auto aggiunge {eur(panelBenefit.added)}.</p>}
    <h3>Auto elettrica</h3>
    <p className="small">Scelta usata nei pacchetti: <strong>{EV_STRATEGY_LABEL[p.ev.strategy]}</strong>. Nelle ore di sole il FV va prima alla casa, poi all'auto, poi alla batteria.</p>
    {groups.map(({ r, rows }) => {
      const chosen = rows.find((s) => s.strategy === p.ev.strategy)!, sun = rows.find((s) => s.strategy === "sole")!, arrival = rows.find((s) => s.strategy === "arrivo")!;
      const fuel = evFuelComparison(p, chosen), power = evPower(p, r);
      const pct = (n: number, total: number) => total > 0 ? `${fmt(n / total * 100, 1)}%` : "—";
      return <div key={r.id}>
        <h4>{r.label}</h4>
        <div className="table-wrap"><table className="data cards-sm">
          <thead><tr><th>Quando caricare</th><th>Energia a casa</th><th>Dal FV</th><th>Dalla batteria di casa</th><th>Spesa annua a casa</th><th>Picco di prelievo</th><th>Ore oltre la potenza</th></tr></thead>
          <tbody>{rows.map((s) => <tr key={s.strategy} className={s.strategy === p.ev.strategy ? "selected" : ""}><td data-label="Quando caricare"><strong>{EV_STRATEGY_LABEL[s.strategy]}</strong>{s.strategy === p.ev.strategy && <div className="small">Usata nei pacchetti</div>}</td><td className="num" data-label="Energia a casa">{fmt(s.home_kWh)} kWh</td><td className="num" data-label="Dal FV">{pct(s.fromPv_kWh, s.home_kWh)}</td><td className="num" data-label="Dalla batteria di casa">{pct(s.fromBattery_kWh, s.home_kWh)}<div className="small">{fmt(s.fromBattery_kWh)} kWh</div></td><td className="num" data-label="Spesa annua a casa">{eur(s.marginalCost)}/anno</td><td className="num" data-label="Picco di prelievo">{fmt(s.peak_W / 1000, 1)} kW</td><td className="num" data-label="Ore oltre la potenza">{fmt(s.overContractHours)}</td></tr>)}</tbody>
        </table></div>
        {(r.has.P || p.existingPv.present) && <p>Con il FV, caricare col sole costa {eur(sun.marginalCost)} l'anno contro {eur(arrival.marginalCost)} appena arrivi: {sun.marginalCost <= arrival.marginalCost ? `${eur(arrival.marginalCost - sun.marginalCost)} in meno` : `${eur(sun.marginalCost - arrival.marginalCost)} in più`}.</p>}
        {rows.filter((s) => s.unmetDays > 0).map((s) => <p className="small" key={s.strategy}>{EV_STRATEGY_LABEL[s.strategy]}: in {fmt(s.unmetDays)} giorni la carica di casa non basta: {fmt(s.unmet_kWh)} kWh presi fuori.</p>)}
        {chosen.batteryBenefit && <p className="small">Risparmio annuo della batteria di casa: {eur(chosen.batteryBenefit.withCar)} con l'auto, {eur(chosen.batteryBenefit.withoutCar)} senza l'auto. La batteria di casa può scaricarsi anche verso l'auto.</p>}
        <p className="small">Confronto col carburante: {eur(fuel.fuel)}/anno per l'auto a combustione, {eur(fuel.ev)}/anno per l'elettrica; {fuel.saving >= 0 ? `l'elettrica costa ${eur(Math.abs(fuel.saving))} l'anno in meno` : `l'elettrica costa ${eur(Math.abs(fuel.saving))} l'anno in più`}. Fuori casa: {fmt(chosen.outside_kWh + chosen.unmet_kWh)} kWh, {eur((chosen.outside_kWh + chosen.unmet_kWh) * p.ev.outsidePrice.value)}. Si confrontano solo carburante e ricarica, senza prezzo d'acquisto delle auto.</p>
        <p className="small">Contatore del pacchetto: {fmt(power.current, 1)} kW. Potenza minima che evita il superamento del 10% sul picco orario: {fmt(power.minimum, 1)} kW (passi di 0,5 kW da 3 kW). Se serve aumentare: {eur(power.annual)}/anno in più e {eur(power.once)} una tantum, con i costi per kW indicati.</p>
        {r.conditions.filter((s) => s.startsWith("Auto elettrica:")).map((s) => <p className="small" key={s}>{s}</p>)}
      </div>;
    })}
    <h4>Investimento della ricarica</h4>
    <p>{eur(cost.total)}{!cost.complete && " (incompleto)"}: {eur(cost.equipment)} per presa o wallbox installata ({p.ev.costMode === "stima" ? "scenario, non preventivo" : "preventivo"}), più {eur(cost.power)} per l'aumento di potenza scelto rispetto a oggi. Questi costi, il carburante e la ricarica fuori casa sono solo qui: non entrano in investimento, VAN e rientro dei pacchetti.</p>
    {!cost.complete && <p className="small">Da completare: {cost.unknownItems.join(", ")}. Gli importi non noti sono ipotesi.</p>}
    <p className="small">Aumento di potenza una tantum: {fmt(p.ev.powerIncreaseFeePerKw.value)} €/kW usati; scenari dichiarati {EV_POWER_FEE_SCENARIOS.basso} / {EV_POWER_FEE_SCENARIOS.centrale} / {EV_POWER_FEE_SCENARIOS.alto} €/kW (basso / centrale / alto), non prezzi attuali. Fonte: {p.ev.powerIncreaseFeePerKw.source || "non indicata"}; stato {STATUS_LABEL[p.ev.powerIncreaseFeePerKw.status]}.</p>
    {p.ev.costMode === "stima" ? <p className="small">{EV_PRICE_SOURCE}. Importo usato: {eur(p.ev.price.value)}; stato {STATUS_LABEL[p.ev.price.status]}; fonte: {p.ev.price.source || "non indicata"}.</p> : <>
      <p className="small">Preventivo: {p.ev.cost.quoteSource || "fonte non indicata"}; {p.ev.cost.quoteDate || "data non indicata"}.</p>
      <ul>{p.ev.cost.items.map((item, i) => <li key={i}>{item.label}: {item.status === "escluso" ? "non necessario" : item.status === "sconosciuto" ? "non indicato" : eur(item.amount.value)}</li>)}</ul>
    </>}
    <p className="small">La spesa a casa è la differenza di bolletta con e senza auto, con le stesse taglie di FV e batteria: comprende acquisti, minori ricavi di cessione e quota potenza. L'elettricità di casa è già nei conti dei pacchetti.</p>
    <p className="small muted">Le fasce orarie arrivano con la tappa 7: per ora un solo prezzo. Notte dalle 23 alle 7; ricarica col sole da 1,4 kW disponibili, con recupero notturno fino al minimo scelto. Giorno 1 lunedì, primi N giorni d'uso; stesso tragitto nei giorni d'uso, niente viaggi lunghi né ferie. Inverno: percentuale fissa in dicembre, gennaio e febbraio. Potenza costante, senza ridurla per il contatore; i picchi sono medie orarie. La batteria di casa può scaricarsi nell'auto. Nessuna energia torna dall'auto alla casa o alla rete. La quota fuori casa non aggiunge perdite. Se già nella luce, la ricarica viene scorporata su base annua. Importi di wallbox, aumento di potenza e carburante sono ipotesi, non prezzi attuali.</p>
    {showInputs && <>
      <h4>Ipotesi dell'auto</h4>
      <p className="small">{p.ev.charger === "presa" ? "Presa domestica" : "Wallbox"}; ricarica {p.ev.alreadyInConsumption ? "già compresa" : "non compresa"} nei consumi della luce.</p>
      <div className="table-wrap"><table className="data cards-sm"><thead><tr><th>Dato</th><th>Valore usato</th><th>Stato e fonte</th></tr></thead><tbody>{EV_FIELDS.filter(([key]) => key !== "price" || p.ev.costMode === "stima").map(([key, label, unit]) => <tr key={key}><td data-label="Dato">{label}</td><td data-label="Valore usato">{fmt(p.ev[key].value, 2)} {unit}</td><td data-label="Stato e fonte">{STATUS_LABEL[p.ev[key].status]} · {p.ev[key].source || "fonte non indicata"}</td></tr>)}</tbody></table></div>
    </>}
  </>;
}
