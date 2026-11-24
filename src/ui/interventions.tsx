import { Brief, InfoTip } from "./info-tip";
import { useContext, useId } from "react";
import { INCENTIVE_PRESETS, applyIncentivePreset, HP_CATALOG, HP_CATALOG_SOURCE, PARAMETRIC_AUX_DEFAULTS, activeInsulation, catalogPower, findCatalogHp, n50AfterWindows, quoteSizeNotes, type ClimatePackage, type ProjectInput, type Q, type Replacement } from "../engine";

import { fmt } from "./format";
import { Advanced, Check, FormContext, NumberInput, QField, SelectField, TextField } from "./fields";
import { CostEditor, IssueList, type FormProps } from "./forms";
import { QuotesPanel } from "./quotes";
import * as P from "./presets";
import { HelpDiagram } from "./illustrations";
import { BatteryFields } from "./battery";
import { SizingChoice } from "./sizing";
import { goalInfo } from "./goals";
import { InsulationFields } from "./involucro";
import { HomeValueFields } from "./valore";
import { DhwFields } from "./acqua";
import { Group } from "./fold";
import { defaultCookingSwitch, HOB_COST_ESTIMATE_SOURCE, METER_CLOSURE_ESTIMATE_SOURCE } from "../engine/example";

const PLANES = P.PV_PLANES;
const yesNo = (b: boolean) => (b ? "sì" : "no");

export function ReplacementsEditor({ title, list, onChange, doc, horizon }: { title: string; list: Replacement[]; onChange: (l: Replacement[]) => void; doc: boolean; horizon: number }) {
  const context = useContext(FormContext);
  const baseId = useId();
  const set = (i: number, patch: Partial<Replacement>) => onChange(list.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="section">
      <h4>{title}</h4>
      {list.length === 0 && <p className="small muted">Nessuna sostituzione prevista nell'orizzonte.</p>}
      {list.map((r, i) => (
        <div className="grid" key={i}>
          <TextField label={`Voce ${i + 1}`} value={r.label} onChange={(v) => set(i, { label: v })} />
          <div className="field">
            <label htmlFor={`${baseId}-anno-${i}`}>Anno</label>
            <NumberInput id={`${baseId}-anno-${i}`} min={1} max={horizon} integer value={r.year} onChange={(v) => set(i, { year: v })} />
          </div>
          <QField label="Importo" unit="€" min={0} max={1e6} q={r.amount} onChange={(q) => set(i, { amount: q })} showSource={doc} />
        </div>
      ))}
      <div className="toolbar no-print">
        <button type="button" className="btn small" onClick={() => onChange([...list, { label: "Sostituzione", year: 12, amount: { value: 0, status: "sconosciuto" } }])}>
          + sostituzione
        </button>
        {list.length > 0 && (
          <button type="button" className="btn small" onClick={() => { if (context.guard?.() !== false) onChange(list.slice(0, -1)); }}>
            Rimuovi l'ultima sostituzione
          </button>
        )}
      </div>
    </div>
  );
}

export function InterventionsForm({ p, up, doc, issues, climate }: FormProps & { climate?: ClimatePackage | null }) {
  const w = p.windows;
  const hp = p.heatPump;
  const pv = p.pv;
  const setW = (k: keyof ProjectInput["windows"]) => (q: Q) => up((d) => void ((d.windows[k] as Q) = q));
  const setH = (k: keyof ProjectInput["heatPump"]) => (q: Q) => up((d) => void ((d.heatPump[k] as Q) = q));
  const setP = (k: keyof ProjectInput["pv"]) => (q: Q) => up((d) => void ((d.pv[k] as Q) = q));
  const inc = p.economics.incentive;
  const incentivePreset = INCENTIVE_PRESETS.find((r) => r.id === inc.preset);
  const setI = (k: "windowsPct" | "heatPumpPct" | "pvPct" | "batteryPct" | "years") => (q: Q) => up((d) => void (d.economics.incentive[k] = q));
  const cat = findCatalogHp(hp.catalogId);
  const parts = goalInfo(p.goal).parts;
  const existing = p.existingPv.present;
  const showW = parts.includes("windows");
  const showH = parts.includes("heatPump");
  const showP = parts.includes("pv") && !existing && (p.goal !== "auto" || p.ev.pvPlan === "nuovo");
  const showB = parts.includes("battery") && (existing || parts.includes("pv"));
  const indicative = pv.sizing === "indicativa";
  // Proposta D della tappa E del piano dopo la 8: nel quadro completo i gruppi sono riquadri chiusi con una riga di
  // stato; si aprono da soli se contengono un errore. Nelle altre domande (uno o due gruppi) e in modalità
  // documentata restano aperti come sempre.
  const folded = p.goal === "completo" && !doc;
  const alert = (...sections: string[]) => issues.some((i) => i.severity === "errore" && sections.includes(i.section));
  const sizing = (showP || (showB && existing)) && <SizingChoice p={p} up={up} />;
  return (
    <>
      <p className="small muted"><InfoTip text={doc ? "Ogni pacchetto si ricalcola sulla stessa casa, non sommando risparmi." : "Ogni pacchetto si ricalcola sulla stessa casa, partendo da esempi dichiarati (non prodotti consigliati)."} label="Dettagli e limiti">Ogni pacchetto viene ricalcolato sullo stesso edificio, non sommando risparmi. Inserisci preventivi reali o ipotesi di costo dichiarate: una voce mancante non vale zero.{!doc && " Gli interventi partono da esempi dichiarati: non sono prodotti o taglie consigliati. Apri le ipotesi per adattare schede e preventivi; i dati mancanti rendono VAN e rientro incompleti."}</InfoTip></p>
      <IssueList issues={issues} errorsOnly sections={["Serramenti", "Isolamento", "Pompa di calore", "Acqua calda", "Fotovoltaico", "Economia"]} />
      {p.goal === "auto" && p.ev.pvPlan !== "nuovo" && <p>Nessun intervento sulla casa: il confronto riguarda solo l'auto.</p>}
      {showW && <Group folded={folded} alert={alert("Serramenti", "Isolamento")} icon="serramenti" title="Involucro: serramenti e isolamento" status={`Serramenti nuovi: ${yesNo(p.envelope.windows)} · isolamento: ${yesNo(activeInsulation(p).length > 0)}`}>
        <p className="small">Nei risultati i lavori scelti formano un solo pacchetto; una tabella dà il valore di ognuno.</p>
        <Check label="Cambio i serramenti" checked={p.envelope.windows} onChange={(v) => up((d) => void (d.envelope.windows = v))} />
        {p.envelope.windows && <>
        <h4>Serramenti nuovi</h4>
        <Advanced doc={doc}>
        <div className="grid">
          <QField label="Uw nuovo serramento (vetro + telaio)" unit="W/m²K" q={w.uWindow} onChange={setW("uWindow")} showSource={doc} />
          <QField label="Ricambi d'aria dopo l'intervento" unit="volumi/h" q={w.airChange} onChange={setW("airChange")} showSource={doc} hint="Ipotesi sulla riduzione delle infiltrazioni: è in sensibilità." />
          {p.building.infiltration.mode === "tenuta" && <QField label="Tenuta all'aria n50 dopo i serramenti" unit="1/h" q={w.n50After} onChange={setW("n50After")} showSource={doc} hint={`Se non lo sai si usa ${fmt(n50AfterWindows(p.building, w).value, 1)} 1/h: la stessa riduzione dei ricambi d'aria.`} />}
        </div>
        <Advanced doc={doc}>
          <div className="grid">
            <QField label="g nuovo vetro (fattore solare)" q={w.gWindow} onChange={setW("gWindow")} presets={P.G_WINDOW} showSource={doc} hint="0,6 = 60%." />
            <QField label="Frazione di telaio" q={w.frameFraction} onChange={setW("frameFraction")} showSource={doc} />
            <QField label="Variazione manutenzione" unit="€/anno" q={w.maintenanceDelta} onChange={setW("maintenanceDelta")} showSource={doc} />
          </div>
        </Advanced>
        </Advanced>
        <Advanced doc={doc} summary="Preventivo serramenti: esempio o tua offerta"><CostEditor doc={doc} kind="windows" path="windows.cost" title="Costi serramenti" block={w.cost} onChange={(b) => up((d) => void (d.windows.cost = b))} /></Advanced>
        <QuotesPanel p={p} up={up} doc={doc} kind="windows" />
        </>}
        <InsulationFields p={p} up={up} doc={doc} />
      </Group>}

      {showH && <Group folded={folded} alert={alert("Pompa di calore", "Acqua calda")} icon="pdc" title="Impianto: pompa di calore e acqua calda" status={`Pompa di calore: ${yesNo(hp.included)} · scaldacqua nuovo: ${yesNo(p.dhw.replace)}${p.system.cookingOnGas ? ` · induzione: ${yesNo(!!p.cooking?.enabled)}` : ""}`}>
        <Check label="Pompa di calore per il riscaldamento" checked={hp.included} onChange={(v) => up((d) => void (d.heatPump.included = v))} />
        {hp.included && <>
        <h4>Pompa di calore (solo riscaldamento)</h4>
        <p className="small"><Brief label="Dettagli e limiti">{"La pompa di calore riscalda la casa. Per acqua calda e cucina puoi scegliere sotto lo scaldacqua nuovo e il piano a induzione. Una mandata sconosciuta rende il confronto con riserve: verificare con un tecnico."}</Brief></p>
        <Advanced doc={doc}>
        <div className="grid">
          <SelectField
            label="Macchina"
            value={hp.model === "catalogo" ? hp.catalogId : "parametrico"}
            options={[
              ...HP_CATALOG.map((m) => ({ value: m.id, label: `${m.manufacturer} – ${m.model} (${fmt(m.ratedPowerMediumT_kW, 1)} kW nominali, mandata 55 °C, clima medio${m.eer ? "; raffresca, dati hplib" : ""})` })),
              { value: "parametrico", label: "Modello parametrico (scenario indicativo)" },
            ]}
            onChange={(v) =>
              up((d) => {
                if (v === "parametrico") {
                  d.heatPump.model = "parametrico";
                  d.heatPump.pTO_W = structuredClone(PARAMETRIC_AUX_DEFAULTS.pTO_W);
                  d.heatPump.pOFF_W = structuredClone(PARAMETRIC_AUX_DEFAULTS.pOFF_W);
                  d.heatPump.pCK_W = structuredClone(PARAMETRIC_AUX_DEFAULTS.pCK_W);
                }
                else {
                  d.heatPump.model = "catalogo";
                  d.heatPump.catalogId = v;
                  const aux = findCatalogHp(v)?.aux;
                  if (aux) for (const [key, value] of [["pTO_W", aux.pTO_W], ["pOFF_W", aux.pOFF_W], ["pCK_W", aux.pCK_W]] as const)
                    d.heatPump[key] = { value, status: "documentato", source: `${aux.source ?? "Keymark via hplib"}; ${aux.page}`, date: aux.accessDate };
                }
              })
            }
            hint="Dati HP Keymark via hplib: verificare la variante esatta del preventivo. Non è una taglia raccomandata."
          />
          <QField label="Potenza contrattuale con PDC" unit="kW" q={hp.newContractPower} onChange={setH("newContractPower")} showSource={doc} />
        </div>
        {hp.model === "catalogo" && cat && (
          <div className="notice info">
            <strong><InfoTip text={`${cat.manufacturer} ${cat.model}`} label="Scheda e limiti della pompa di calore">
            · Keymark {cat.certificate?.registration ?? "registrazione non verificata"}, {cat.keymarkDate ?? "data non indicata"} · {cat.refrigerant ?? "refrigerante n.d."} · SCOP {fmt(cat.scop, 2)} (bassa temperatura, clima medio) · TOL {fmt(cat.tol_C)} °C: limite della dichiarazione usata; WTOL {fmt(cat.maxFlow_C)} °C, non limite delle condizioni provate della curva.
            <br />
            <span className="small">
              Potenza calcolata a −7 °C: {fmt(catalogPower(cat, -7, 35) / 1000, 1)} kW con mandata 35 °C, {fmt(catalogPower(cat, -7, 55) / 1000, 1)} kW con mandata 55 °C. Errore del fit hplib sui punti di origine: COP {fmt(cat.mape.cop, 1)}%, potenza {fmt(cat.mape.pTh, 1)}%. La capacità disponibile è modificata dal progetto e non validata: il MAPE non ne misura l'errore.
              Fonte: {HP_CATALOG_SOURCE}.
              <br />{cat.fitDomain?.conditions} {cat.certificate?.verification}. Revisione del documento: {cat.certificate?.revision ?? "non verificata"}. Regole dello schema: {cat.certificate?.schemeRevision ?? "non verificate"}. {cat.certificate?.standardsEdition}. {cat.certificate && <a href={cat.certificate.url ?? cat.certificate.page} target="_blank" rel="noreferrer">Report Keymark</a>}
              <br />Condizioni provate comuni COP/P_el: inviluppo dei punti {cat.fitDomain?.points.map(([a, w]) => `A${a}/W${w}`).join(", ")}. Fuori inviluppo si dichiara l'estrapolazione con ore ed energia per pacchetto; il confronto resta indicativo. Restano i blocchi prudenziali sotto −7 °C e oltre 55 °C di mandata, con aria del fit saturata a 12 °C nelle ore miti.
            </span></InfoTip></strong>
          </div>
        )}
        {hp.model === "parametrico" && (
          <div className="notice">
            Modello <strong>parametrico indicativo</strong>: non rappresenta una macchina documentata. Nessuna estrapolazione fuori dalle condizioni provate e nessuna resistenza di backup implicita: se la potenza non basta, il pacchetto è segnato come non calcolabile, con il motivo.
          </div>
        )}
        {hp.model === "parametrico" && (
          <div className="grid">
            <QField label="Potenza nominale a 7 °C esterni, mandata 35 °C (A7/W35)" unit="kW" q={hp.nominalCapacity} onChange={setH("nominalCapacity")} showSource={doc} hint="Valore di scenario, non una taglia raccomandata." />
          </div>
        )}
        {hp.model === "parametrico" && (
        <Advanced doc={doc} summary="Parametri del modello PDC (scenario)">
          <div className="grid">
            <QField label="Rendimento rispetto al ciclo ideale (Carnot)" q={hp.carnotEfficiency} onChange={setH("carnotEfficiency")} showSource={doc} hint="0,45 = la macchina ottiene il 45% del COP teorico." />
            <QField label="Variazione di potenza per grado di T esterna" unit="1/K" q={hp.capacitySlope} onChange={setH("capacitySlope")} showSource={doc} hint="0,025 = −2,5% di potenza per ogni grado sotto 7 °C." />
            <QField label="Fattore di sbrinamento (fra −7 e +5 °C)" q={hp.defrostFactor} onChange={setH("defrostFactor")} showSource={doc} hint="Riduce COP e potenza: 0,9 = −10%." />
            <QField label="T esterna minima di funzionamento" unit="°C" q={hp.minOutdoorTemp} onChange={setH("minOutdoorTemp")} showSource={doc} />
            <QField label="Mandata massima" unit="°C" q={hp.maxFlowTemp} onChange={setH("maxFlowTemp")} showSource={doc} />
            <QField label="Modulazione minima" unit="frazione" q={hp.minModulation} onChange={setH("minModulation")} showSource={doc} hint="Sotto questa frazione della potenza disponibile la macchina cicla. Ipotesi se il certificato non la dichiara." />
            <QField label="Degrado nei cicli Cd" q={hp.cyclingCd} onChange={setH("cyclingCd")} showSource={doc} hint="Valore convenzionale 0,9 se non misurato; applicato al solo modello parametrico." />
            <QField label="P termostato spento" unit="W" q={hp.pTO_W} onChange={setH("pTO_W")} showSource={doc} />
            <QField label="P spenta" unit="W" q={hp.pOFF_W} onChange={setH("pOFF_W")} showSource={doc} />
            <QField label="P riscaldatore carter" unit="W" q={hp.pCK_W} onChange={setH("pCK_W")} showSource={doc} />
            <QField label="Pompa primaria aggiuntiva" unit="W" q={hp.extraPump_W} onChange={setH("extraPump_W")} showSource={doc} />
          </div>
        </Advanced>
        )}
        {hp.model === "catalogo" && <Advanced doc={doc} summary="Ausiliari dichiarati della macchina">
          {cat?.aux ? <p className="small">P_OFF {cat.aux.pOFF_W} W · P_TO {cat.aux.pTO_W} W · P_CK {cat.aux.pCK_W} W. Fonte: {cat.aux.source ?? "certificato Keymark"}, {cat.aux.page}, accesso {cat.aux.accessDate}. I campi tecnici usano questi valori per la macchina selezionata.</p> : <p className="small">Valori ausiliari del modello parametrico; fonte e stato ipotizzato sono indicati nei campi tecnici.</p>}
          <div className="grid">
            <QField label="P termostato spento" unit="W" q={hp.pTO_W} onChange={setH("pTO_W")} showSource={doc} />
            <QField label="P spenta" unit="W" q={hp.pOFF_W} onChange={setH("pOFF_W")} showSource={doc} />
            <QField label="P riscaldatore carter" unit="W" q={hp.pCK_W} onChange={setH("pCK_W")} showSource={doc} />
            <QField label="Pompa primaria aggiuntiva" unit="W" q={hp.extraPump_W} onChange={setH("extraPump_W")} showSource={doc} />
          </div>
          <p className="small">Il fit del catalogo include già il degrado Cdh della curva EN 14825; il modello non applica una seconda correzione per cicli.</p>
        </Advanced>}
        <div className="grid" style={{ marginTop: 8 }}>
          <QField label="Variazione manutenzione rispetto alla caldaia" unit="€/anno" q={hp.maintenanceDelta} onChange={setH("maintenanceDelta")} showSource={doc} />
        </div>
        <div className="grid" style={{ marginTop: 8 }}>
          <Check
            label="La caldaia attuale è a fine vita (confronto con una caldaia nuova)"
            checked={hp.boilerEndOfLife}
            onChange={(v) => up((d) => void (d.heatPump.boilerEndOfLife = v))}
          />
          {hp.boilerEndOfLife && (
            <>
              <QField label="Costo della caldaia sostitutiva" unit="€" q={hp.boilerReplacementCost} onChange={setH("boilerReplacementCost")} showSource={doc} hint="Viene sottratto per ottenere l'investimento incrementale della pompa di calore." />
              <QField
                label="Rendimento della caldaia nuova"
                q={hp.replacementBoilerEfficiency}
                onChange={setH("replacementBoilerEfficiency")}
                presets={P.BOILER_EFF}
                showSource={doc}
                hint="Usato per tutti i pacchetti senza pompa di calore: il confronto è con la sostituzione convenzionale."
              />
            </>
          )}
        </div>
        <div className="grid"><QField label="Fattore di variazione del COP" q={hp.copFactor} onChange={setH("copFactor")} showSource={doc} hint="1 = nessuna variazione; modifica solo la prestazione, non la capacità. Vale per catalogo e modello parametrico." /></div>
        <div className="grid" style={{ marginTop: 8 }}>
          <Check label="PDC reversibile (può raffrescare con ventilconvettori o pannelli radianti)" checked={hp.reversible} onChange={(v) => up((d) => void (d.heatPump.reversible = v))} />
          {hp.model === "parametrico" && <QField label="EER della pompa di calore a 35 °C" q={hp.eer35} onChange={setH("eer35")} showSource={doc} hint="Ad aria 35 °C e acqua a 7 °C, dalla scheda; per il catalogo vale il fit hplib." />}
          <QField label="Fattore di variazione dell'EER" q={hp.eerFactor} onChange={setH("eerFactor")} showSource={doc} hint="1 = nessuna variazione; usato dalla sensibilità estiva." />
        </div>
        {hp.reversible && hp.model === "catalogo" && cat && !cat.eer && <p className="small muted">Questa macchina non ha dati di raffrescamento in hplib: d'estate restano gli split.</p>}
        </Advanced>
        <Advanced doc={doc} summary="Preventivo PDC: esempio o tua offerta"><CostEditor doc={doc} kind="heatPump" path="heatPump.cost" title="Costi pompa di calore" block={hp.cost} onChange={(b) => up((d) => void (d.heatPump.cost = b))} /></Advanced>
        <QuotesPanel p={p} up={up} doc={doc} kind="heatPump" />
        <Advanced doc={doc}>
        <ReplacementsEditor horizon={p.economics.horizonYears.value} title="Sostituzioni previste PDC" list={hp.replacements} onChange={(l) => up((d) => void (d.heatPump.replacements = l))} doc={doc} />
        </Advanced>
        </>}
        <DhwFields p={p} up={up} doc={doc} climate={climate} />
        {p.system.cookingOnGas && <>
          <Check label="Passo anche al piano a induzione" checked={!!p.cooking?.enabled} onChange={(enabled) => up((d) => { d.cooking = { ...(d.cooking ?? defaultCookingSwitch()), enabled }; })} />
          {p.cooking?.enabled && <>
            <div className="grid">
              <div>
                <QField path="cooking.hobCost" label="Piano a induzione e posa" unit="€" q={p.cooking.hobCost} onChange={(q) => up((d) => void (d.cooking!.hobCost = q.value !== p.cooking!.hobCost.value && q.source === HOB_COST_ESTIMATE_SOURCE ? { ...q, source: "Valore indicato da te, da verificare con il preventivo" } : q))} showSource={doc} hint="Stima media italiana: piano 675 € (Altroconsumo, 2024) e posa 150 € (Cronoshare, 2026). Pentole escluse: se ti servono, aggiungile." />
                {p.cooking.hobCost.status === "ipotizzato" && p.cooking.hobCost.source === HOB_COST_ESTIMATE_SOURCE && <p className="small muted">È una stima media italiana: scrivi qui il prezzo del tuo preventivo.</p>}
              </div>
              <div>
                <QField path="cooking.meterClosureCost" label="Chiusura del contatore del gas" unit="€" q={p.cooking.meterClosureCost} onChange={(q) => up((d) => void (d.cooking!.meterClosureCost = q.value !== p.cooking!.meterClosureCost.value && q.source === METER_CLOSURE_ESTIMATE_SOURCE ? { ...q, source: "Valore indicato da te, da verificare con il venditore" } : q))} showSource={doc} hint="Entra nella spesa solo se nel pacchetto non resta nessun uso del gas. Stima: 30 € di contributo del distributore (prezzo regolato da ARERA per i contatori di casa), IVA esclusa." />
                {p.cooking.meterClosureCost.status === "ipotizzato" && p.cooking.meterClosureCost.source === METER_CLOSURE_ESTIMATE_SOURCE && <p className="small muted">È una stima: il venditore può aggiungere un suo contributo e l'IVA. Scrivi qui quanto ti chiede.</p>}
              </div>
            </div>
            <Advanced doc={doc}>
              <div className="grid">
                <QField path="cooking.gasHobEfficiency" label="Rendimento del piano a gas" q={p.cooking.gasHobEfficiency} onChange={(q) => up((d) => void (d.cooking!.gasHobEfficiency = q))} showSource={doc} hint="0,55 = 55%. Valore di laboratorio: dipende da pentole e abitudini; in sensibilità varia di 10 punti." />
                <QField path="cooking.inductionEfficiency" label="Rendimento del piano a induzione" q={p.cooking.inductionEfficiency} onChange={(q) => up((d) => void (d.cooking!.inductionEfficiency = q))} showSource={doc} hint="0,85 = 85%. La cottura segue le stesse ore degli altri usi elettrici, anche con un profilo stagionale o misurato." />
              </div>
            </Advanced>
            <p className="small">{!hp.included
              ? "Resta il gas per il riscaldamento: la quota fissa del gas non si toglie. Per chiudere il contatore serve anche la pompa di calore e, se l'acqua calda resta a gas, lo scaldacqua nuovo senza integrazione a gas."
              : p.system.acsOnGas && (!p.dhw.replace || (p.dhw.newType === "solare" && p.dhw.solarBackup === "gas"))
                ? "Resta il gas per l'acqua calda: la quota fissa del gas non si toglie. Per chiudere il contatore serve anche lo scaldacqua nuovo senza integrazione a gas."
                : `Con ${p.dhw.replace ? "lo scaldacqua nuovo" : "la pompa di calore"} e il piano a induzione la casa non usa più gas: nei conti sparisce la quota fissa del gas (${fmt(p.tariffs.gasFixed.value)} € all'anno) e si aggiunge la chiusura del contatore.`}</p>
          </>}
        </>}
      </Group>}

      {!folded && sizing}
      {showP && <Group folded={folded} alert={alert("Fotovoltaico")} icon="solare" title="Fotovoltaico" status={indicative ? "Taglia indicativa, calcolata sui tuoi consumi" : `${fmt(pv.kWp.value, 1)} kWp`}>
        {folded && sizing}
        <HelpDiagram kind="tetto" />
        {indicative && (
          <div className="grid">
            <QField label="Tetto utilizzabile" unit="m²" q={pv.roofArea} onChange={setP("roofArea")} showSource={doc} hint="Superficie libera e ben esposta dove si possono mettere i pannelli. Limita i kWp della taglia indicativa." />
            <QField label="Prezzo tipico del FV (stima)" unit="€/kWp" q={pv.pricePerKwp} onChange={setP("pricePerKwp")} showSource={doc} hint="Media nazionale, IVA compresa: non è un preventivo. Se ne conosci uno più vicino a te, scrivilo." />
          </div>
        )}
        {indicative && <Advanced doc={doc} summary="Quanto tetto occupa un kWp"><div className="grid"><QField label="Superficie per kWp" unit="m²/kWp" q={pv.areaPerKwp} onChange={setP("areaPerKwp")} showSource={doc} /></div></Advanced>}
        <Advanced doc={doc}>
        <div className="grid">
          {!indicative && <QField label="Potenza" unit="kWp" q={pv.kWp} onChange={setP("kWp")} showSource={doc} />}
          <QField label="Ombre e altre perdite" unit="%" q={pv.lossPct} onChange={setP("lossPct")} showSource={doc} hint="Solo quelle in più: camini, alberi, edifici vicini, sporco. I dati del clima comprendono già il 14% di perdite dell'impianto." />
          <QField label="Degrado dei moduli" unit="%/anno" q={pv.degradationPct} onChange={setP("degradationPct")} showSource={doc} hint="Di quanto cala la produzione ogni anno. Pesa sul VAN, non sul risparmio del primo anno." />
          <SelectField label="Orientamento e inclinazione" value={pv.plane} options={PLANES} onChange={(v) => up((d) => void (d.pv.plane = v))} hint="Configurazioni precalcolate sullo stesso anno tipico del termico." />
          <QField label="Manutenzione" unit="€/anno" q={pv.maintenanceDelta} onChange={setP("maintenanceDelta")} showSource={doc} />
        </div>
        </Advanced>
        {!indicative && quoteSizeNotes(p).filter((m) => m.includes("FV")).map((m) => <div key={m} className="notice" role="status">{m} <button type="button" className="btn small" onClick={() => up((d) => void (d.pv.cost.forSize = d.pv.kWp.value))}>Il preventivo vale per {fmt(pv.kWp.value, 1)} kWp</button></div>)}
        {!indicative && <Advanced doc={doc} summary="Preventivo FV: esempio o tua offerta"><CostEditor doc={doc} kind="pv" path="pv.cost" title="Costi fotovoltaico" block={pv.cost} onChange={(b) => up((d) => void (d.pv.cost = { ...b, forSize: d.pv.kWp.value }))} /></Advanced>}
        {!indicative && <QuotesPanel p={p} up={up} doc={doc} kind="pv" />}
        <Advanced doc={doc}>
        <ReplacementsEditor horizon={p.economics.horizonYears.value} title="Sostituzioni previste FV" list={pv.replacements} onChange={(l) => up((d) => void (d.pv.replacements = l))} doc={doc} />
        </Advanced>
      </Group>}
      {showB && <BatteryFields p={p} up={up} doc={doc} folded={folded} alert={alert("Fotovoltaico")} lead={folded && !showP ? sizing : null} />}

      {(p.goal !== "auto" || p.ev.pvPlan === "nuovo") && <Group folded={folded} alert={alert("Economia")} icon="costi" title="Parametri economici" status={`Orizzonte ${fmt(p.economics.horizonYears.value)} anni · incentivo: ${inc.enabled ? incentivePreset?.label ?? "una tua regola" : "nessuno"}`}>
        <p className="small muted"><Brief label="Dettagli e limiti">{"Valori monetari reali e tasso reale: non mescolare inflazione nominale con sconto reale. Il VAN principale non contiene incentivi. VAN = valore attuale netto dei flussi sull'orizzonte."}</Brief></p>
        <Advanced doc={doc}>
        <div className="grid">
          <QField label="Orizzonte" unit="anni" q={p.economics.horizonYears} onChange={(q) => up((d) => void (d.economics.horizonYears = q))} showSource={doc} />
          <QField label="Tasso di sconto reale" q={p.economics.realDiscountRate} onChange={(q) => up((d) => void (d.economics.realDiscountRate = q))} showSource={doc} allowUnknown={false} hint="0,03 = 3% all'anno" />
        </div>
        </Advanced>
      {p.goal === "completo" && <div className="section"><h3>Piano nel tempo</h3><p className="small muted">Indica budget e tempi dei tre blocchi. «Non lo so»: budget senza vincolo, caldaia alla data di oggi.</p>
        {([ ["budgetNow","Soldi disponibili subito",1000000], ["budgetPerYear","Soldi in più ogni anno",200000] ] as const).map(([key,label,max])=><label className="field" key={key}><span>{label}</span><input aria-label={label} type="number" min="0" max={max} value={p.plan?.[key].status==="sconosciuto"?"":p.plan?.[key].value??0} placeholder="Non lo so" onChange={e=>up(d=>{d.plan ??= {budgetNow:{value:0,status:"sconosciuto"},budgetPerYear:{value:0,status:"sconosciuto"},boilerYear:{value:0,status:"sconosciuto"},carYear:{value:0,status:"ipotizzato"},custom:{W:0,H:0,P:0}}; const q=d.plan![key]; if(e.target.value!=="") q.value=Number(e.target.value); q.status=e.target.value===""?"sconosciuto":"ipotizzato";})}/></label>)}
        <label className="field"><span>Entro che anno va cambiata la caldaia</span><select aria-label="Entro che anno va cambiata la caldaia" value={p.plan?.boilerYear.status==="sconosciuto"?"":p.plan?.boilerYear.value??""} onChange={e=>up(d=>{const q=d.plan!.boilerYear;q.status=e.target.value===""?"sconosciuto":"ipotizzato";q.value=Number(e.target.value)||0;})}><option value="">Non lo so</option>{[0,1,2,3,4,5].map(y=><option key={y} value={y}>{y===0?"oggi":`fra ${y} ${y===1?"anno":"anni"}`}</option>)}</select></label>
        {p.ev.enabled && <label className="field"><span>In che anno arriva l’auto elettrica</span><select aria-label="In che anno arriva l’auto elettrica" value={p.plan?.carYear.value??0} onChange={e=>up(d=>{d.plan!.carYear.value=Number(e.target.value);d.plan!.carYear.status="ipotizzato";})}>{[0,1,2,3,4,5].map(y=><option key={y} value={y}>{y===0?"già presente":`fra ${y} ${y===1?"anno":"anni"}`}</option>)}</select></label>}
        <h4>Il tuo percorso</h4>{(["W","H","P"] as const).map((b,i)=><label className="field" key={b}><span>{["Involucro","Impianto","FV e batteria"][i]}</span><select aria-label={`Anno ${b}`} value={p.plan?.custom[b]??"mai"} onChange={e=>up(d=>{d.plan!.custom[b]=e.target.value==="mai"?null:Number(e.target.value);})}><option value="0">subito</option>{[1,2,3,4,5].map(y=><option key={y} value={y}>{`fra ${y} ${y===1?"anno":"anni"}`}</option>)}<option value="mai">mai</option></select></label>)}
      </div>}

        <SelectField label="Incentivo" value={inc.enabled ? incentivePreset?.id ?? "personale" : "nessuno"}
          options={[{ value: "nessuno", label: "Nessuno" }, ...INCENTIVE_PRESETS.map((r) => ({ value: r.id, label: r.label })), { value: "personale", label: "Un'altra regola (la scrivo io)" }]}
          onChange={(value) => up((d) => {
            const incentive = d.economics.incentive;
            if (value === "nessuno") incentive.enabled = false;
            else if (value === "personale") { incentive.enabled = true; incentive.preset = "personale"; }
            else {
              const rule = INCENTIVE_PRESETS.find((r) => r.id === value);
              if (rule) applyIncentivePreset(incentive, rule.id);
            }
          })} />
        <p className="small muted">Il Conto Termico 3.0 del GSE (contributo per pompe di calore e solare termico) non è preimpostato: se lo usi, scegli “Un'altra regola”.</p>
        <p className="small">Le regole dell'elenco hanno fonte e data di controllo; il risultato con l'incentivo resta a parte, il confronto principale non cambia.</p>
        {inc.enabled && incentivePreset && <p className="small">{fmt(incentivePreset.pct)}% della spesa in {incentivePreset.years} rate annue uguali, fino a {fmt(incentivePreset.spendingCap)} € di spesa per casa. Vale solo se ogni anno hai abbastanza imposte da cui toglierla. Fonte: <a href={incentivePreset.url} target="_blank" rel="noopener noreferrer">{incentivePreset.source}</a>, controllata il {incentivePreset.checked.split("-").reverse().join("/")}.</p>}
        {inc.enabled && !incentivePreset && (
          <>
            <div className="grid">
              {showW && <QField ownLabel label={activeInsulation(p).length ? "Involucro: quota della spesa" : "Serramenti: quota della spesa"} unit="%" q={inc.windowsPct} onChange={setI("windowsPct")} showSource={doc} allowUnknown={false} />}
              {showH && <QField ownLabel label={p.dhw.replace ? "Impianto: quota della spesa" : "PDC: quota della spesa"} unit="%" q={inc.heatPumpPct} onChange={setI("heatPumpPct")} showSource={doc} allowUnknown={false} hint="Con caldaia a fine vita si applica alla sola spesa in più rispetto alla caldaia nuova." />}
              {showP && <QField label="FV: quota della spesa" unit="%" q={inc.pvPct} onChange={setI("pvPct")} showSource={doc} allowUnknown={false} />}
              {showB && (existing || p.battery.enabled) && <QField label="Batteria: quota della spesa" unit="%" q={inc.batteryPct} onChange={setI("batteryPct")} showSource={doc} allowUnknown={false} />}
              <QField label="Rate annue uguali" unit="anni" q={inc.years} onChange={setI("years")} showSource={doc} allowUnknown={false} />
              <TextField label="Fonte della regola" value={inc.source} placeholder="es. legge di bilancio, sito dell'Agenzia delle Entrate" onChange={(v) => up((d) => void (d.economics.incentive.source = v))} />
              <TextField label="Data di controllo della regola" value={inc.date} placeholder="es. 2026-11" onChange={(v) => up((d) => void (d.economics.incentive.date = v))} />
            </div>
          </>
        )}
        <HomeValueFields p={p} up={up} doc={doc} />
      </Group>}
      <IssueList issues={issues} errorsAbove sections={["Serramenti", "Isolamento", "Pompa di calore", "Acqua calda", "Fotovoltaico", "Economia"]} />
    </>
  );
}
