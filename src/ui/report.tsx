import { plainClimateText } from "./testi-clima";
import {
  ENGINE_VERSION,
  packageLabel,
  PRESET_VERSION,
  PROFILE_LABELS,
  ARERA_PROFILE_SOURCE,
  type ClimatePackage,
  type CostBlock,
  type Evaluation,
  type ProjectInput,
  type Section,
  type SensitivityResult,
} from "../engine";
import { effectiveLocation, findCatalogHp, fromMeter, quoteName, quotesOf, usesMeasuredCurve, type PvPlane, type QuoteComparison } from "../engine";
import { BillCalibrationBlock, ComparableNote, IncentiveBlock, ProfileRangeBlock } from "./calibration";
import { STATUS_LABEL } from "./fields";
import { FIELDS } from "./metadata";
import { BatteryProfileRange, BatteryVerdict, HOURLY_LIMIT } from "./battery";
import { goalInfo, goalSections } from "./goals";
import { SizingBlock } from "./sizing";
import { QuoteComparisons } from "./quotes";
import { DiagnosisBlock } from "./diagnosi";
import { useResultDetail } from "./dettagli";
import { METODO_CASA } from "./info-tip";
import { activeInsulation, airChangeSummary, dhwCost, envelopeBreakdown, envelopeCost, insulationName } from "../engine";
import { EnvelopeValueTable, envelopeDescription } from "./involucro";
import { HomeValueBlock } from "./valore";
import { EvTable } from "./auto";
import { DhwTable } from "./acqua";
import { PianoNelTempo } from "./percorsi";
import type { PathsResult } from "../engine";
import { Verdetto } from "./verdetto-view";
import { TariffeBlock } from "./tariffe";
import { bridgeTable } from "../engine/thermalBridges";

const PLANE_LABELS: Record<PvPlane, string> = { S35: "Sud, 35°", S20: "Sud, 20°", E35: "Est, 35°", E20: "Est, 20°", O35: "Ovest, 35°", O20: "Ovest, 20°" };
import { eur, fmt, fmtUpTo, signedEur, heatingScheduleText, heatingScheduleWarning } from "./format";

const SECTIONS: Section[] = ["Edificio", "Servizio", "Impianto", "Acqua calda", "Consumi", "Tariffe", "Serramenti", "Isolamento", "Pompa di calore", "Fotovoltaico", "Economia"];

const CHOICE_LABELS: Record<string, string> = {
  rapida: "rapida (preset)",
  documentata: "documentata",
  forma: "da forma in pianta",
  aree: "aree da rilievo",
  frazione: "rapporto sulla superficie",
  quadrata: "quadrata",
  rettangolare: "rettangolare 2:1",
  L: "a L",
  ferroCavallo: "a ferro di cavallo",
  riscaldato: "unità riscaldata",
  sottotetto: "sottotetto non riscaldato",
  coperturaInclinata: "copertura inclinata",
  coperturaPiana: "copertura piana",
  nonRiscaldato: "locale non riscaldato",
  terreno: "terreno",
  esterno: "esterno",
  isolato: "edificio isolato",
  unLato: "confinante su un lato",
  dueLati: "confinante su due lati",
  nonNoto: "non noto",
};
const c = (v: string) => CHOICE_LABELS[v] ?? v;
const COST_STATUS: Record<string, string> = { incluso: "incluso", escluso: "non necessario", sconosciuto: "non indicata" };
const two = (n: number) => String(n).padStart(2, "0");
const itDay = (iso: string) => iso.split("-").reverse().join("/");

/** Da dove vengono le ore dei consumi: curva misurata, curva ricostruita con le immissioni o profilo sintetico. */
function meterRow(p: ProjectInput): [string, string] {
  const m = p.consumption.measuredCurve;
  if ((!m || !usesMeasuredCurve(p)) && p.consumption.profileMode === "stagionale") return ["Profilo elettrico (medio ARERA con le stagioni)", `${PROFILE_LABELS[p.consumption.profile]}; ${ARERA_PROFILE_SOURCE.source}; licenza ${ARERA_PROFILE_SOURCE.licence}; ${ARERA_PROFILE_SOURCE.url}`];
  if (!m || !usesMeasuredCurve(p)) return ["Profilo elettrico (sintetico)", PROFILE_LABELS[p.consumption.profile]];
  const years = m.anni && m.anni.length > 1 ? `; anni di misura: ${m.anni.map((a) => `${fmt(a.kwh)} kWh dal ${itDay(a.dal)}`).join(", ")}` : "";
  const prelievi = `${m.fonte}: dal ${itDay(m.dal)} al ${itDay(m.al)}, ${m.giorni} giorni${years}`;
  if (!fromMeter(p) || !m.immissioni) return ["Curva misurata degli altri usi", prelievi];
  return ["Consumi dal contatore", `Ricostruito da prelievi e immissioni del contatore, con l'autoconsumo stimato. Prelievi ${prelievi}; immissioni dal ${itDay(m.immissioni.dal)} al ${itDay(m.immissioni.al)}, ${m.immissioni.giorni} giorni`];
}

const EMITTER_LABELS = { radiatori: "Radiatori", ventilconvettori: "Ventilconvettori", radiante: "Pavimento o soffitto radiante", nonNoto: "Non noti" } as const;

function CostTable({ title, block }: { title: string; block: CostBlock }) {
  return (
    <>
      <h4>{title}</h4>
      <p className="small">
        {block.name.trim() && <>Offerta: {block.name} · </>}{block.supplier.trim() && <>fornitore: {block.supplier} · </>}Provenienza: {block.quoteSource || "non indicata"} · data: {block.quoteDate || "non indicata"}{block.validUntil.trim() && <> · valida fino al {block.validUntil}</>}
      </p>
      <div className="table-wrap">
        <table className="data report-costs">
          <thead>
            <tr><th>Voce</th><th>Importo</th><th>Stato voce</th><th>Stato importo e fonte</th></tr>
          </thead>
          <tbody>
            {block.items.map((it, i) => (
              <tr key={i}>
                <td>{it.label}</td>
                <td className="num">{eur(it.amount.value)}</td>
                <td>{COST_STATUS[it.status]}</td>
                <td>{STATUS_LABEL[it.amount.status]} · {it.amount.source || "fonte non indicata"} · {it.amount.date || "data non indicata"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Report({ p, ev, climate, sens, quotes = [], paths = null }: { p: ProjectInput; ev: Evaluation; climate: ClimatePackage; sens: SensitivityResult | null; quotes?: QuoteComparison[]; paths?: PathsResult | null }) {
  const envelopeValue = useResultDetail((d) => ev.packages.some((r) => r.id === "W") ? d.envelope : null, () => ev.packages.some((r) => r.id === "W") ? envelopeBreakdown(p, climate, ev) : null, [p, climate, ev]) ?? null;
  const m = climate.manifest;
  const b = p.building;
  const s = p.service;
  const rules = FIELDS.filter((r) => r.applies(p));
  const counts = rules.reduce<Record<string, number>>((acc, r) => ((acc[STATUS_LABEL[r.get(p).status]] = (acc[STATUS_LABEL[r.get(p).status]] ?? 0) + 1), acc), {});
  const hpCat = p.heatPump.model === "catalogo" ? findCatalogHp(p.heatPump.catalogId) : undefined;
  const loc = effectiveLocation(p.location);
  const goal = goalInfo(p.goal);
  const parts = goal.parts;
  const electricOnly = p.goal === "fv" || p.goal === "batteria" || p.goal === "auto" || p.goal === "tariffa";
  const existing = p.existingPv.present;
  const batteryUsed = existing || p.battery.enabled;
  const hidden = (["Edificio", "Servizio", "Impianto", "Serramenti", "Isolamento", "Pompa di calore", "Acqua calda"] as Section[]).filter((x) => !goalSections(p.goal, p).includes(x));
  const choices: [string, string][] = [
    ["Domanda", goal.question],
    ...(parts.includes("windows") ? [["Involucro", envelopeDescription(p)] as [string, string]] : []),
    ["FV già installato", existing ? `${fmt(p.existingPv.kWp.value, 1)} kWp, ${PLANE_LABELS[p.existingPv.plane]}, perdite in più ${fmt(p.existingPv.lossPct.value, 1)}%; consumi ${p.existingPv.consumptionFrom === "bolletta" ? `ricavati dai prelievi in bolletta (${fmt(p.existingPv.gridImportKwh.value)} kWh) con il profilo scelto` : "dall'app dell'inverter"}` : "no"],
    ["Taglia di FV e batteria", p.pv.sizing === "indicativa" ? `indicativa, calcolata dal modello (tetto utilizzabile ${fmt(p.pv.roofArea.value)} m², ${fmt(p.pv.areaPerKwp.value, 1)} m² per kWp)` : "dal preventivo"],
    ["Batteria", batteryUsed ? `${p.pv.sizing === "indicativa" ? "capacità indicativa per pacchetto" : `${fmt(p.battery.capacityKwh.value, 1)} kWh utili`}, ${fmt(p.battery.powerKw.value, 1)} kW, rendimento ${fmt(p.battery.roundTripPct.value)}%, riserva ${fmt(p.battery.reservePct.value)}%, calo ${fmt(p.battery.fadePctPerYear.value, 1)}% all'anno, vita ${fmt(p.battery.lifeYears.value)} anni o ${fmt(p.battery.lifeCycles.value)} cicli` : "non considerata"],
    ["Comune", loc.code ? `${loc.name} (${loc.sigla}) · zona ${loc.zone} · ${fmt(loc.gg)} gradi giorno · quota usata ${fmt(loc.alt)} m. ${loc.fonte}${loc.localOverride ? ` Fonte locale: ${loc.localOverride.source}.` : ""}${loc.siteAltitude ? ` Quota della casa: ${loc.siteAltitude.status}, fonte ${loc.siteAltitude.source || "non indicata"}.` : " Quota della casa sconosciuta: ipotesi dalla quota comunale/donatore."}` : "non scelto"],
    ["Clima usato", `${m.name} (anno tipico del clima, dati PVGIS ${m.apiVersion})`],
    ["Pompa di calore", hpCat ? `${hpCat.manufacturer} ${hpCat.model} (famiglia ${hpCat.family}; HP Keymark ${hpCat.certificate?.registration ?? "n.d."}, ${hpCat.keymarkDate ?? "data n.d."}; ${hpCat.certificate?.verification}). Fit: ${hpCat.fitDomain?.conditions}` : "modello parametrico indicativo"],
    ["Modalità", c(p.mode)],
    ["Geometria", b.geometryMode === "forma" ? `${c(b.geometryMode)}, ${c(b.shape)}` : c(b.geometryMode)],
    ["Finestre", c(b.windowMode)],
    ["Confine superiore", c(b.upper)],
    ["Confine inferiore", c(b.lower)],
    ["Lati", b.sides === "isolato" ? c(b.sides) : `${c(b.sides)} (${c(b.sideAdjacency)})`],
    ["Stagione di riscaldamento", `${two(s.seasonStart.day)}/${two(s.seasonStart.month)} – ${two(s.seasonEnd.day)}/${two(s.seasonEnd.month)}`],
    ...(s.schedule?.mode === "fasce" ? [
      ["Come scaldi oggi", `${s.schedule.bands.map((b) => `${two(b.start)}–${two(b.end)}`).join(" e ")}; fuori fascia ${s.schedule.setback === "spento" ? "spento" : `${fmt(s.schedule.setbackTemp.value, 1)} °C`}; con la pompa di calore ${s.schedule.withHeatPump === "continuo" ? "sempre accesa" : "stesse fasce di oggi"}`],
      ["Riscaldamento a fasce", ev.thermal?.base.schedule ? heatingScheduleText(ev.thermal.base.schedule) : "non calcolato"],
      ["Potenza verso la casa", ev.thermal?.base.schedule ? `${fmt(ev.thermal.base.schedule.pMax_W! / 1000, 1)} kW${ev.thermal.base.schedule.estimated ? " (stimata: potenza dell'impianto non indicata)" : ""}` : "non calcolata"],
    ] as [string, string][] : []),
    ["Casi che il programma sa calcolare", [s.schedule?.mode === "fasce" ? "servizio a fasce orarie" : s.continuousService ? "servizio continuo" : "servizio NON continuo", s.multiZoneOrPartial ? "più zone/parziale" : "una zona", p.cooling.today === "split" ? "raffrescamento con split" : "casa non raffrescata"].join(", ")],
    ["Raffrescamento estivo", p.cooling.today === "split" ? `con split, dal ${two(p.cooling.seasonStart.day)}/${two(p.cooling.seasonStart.month)} al ${two(p.cooling.seasonEnd.day)}/${two(p.cooling.seasonEnd.month)}` : "casa non raffrescata: fabbisogno solo informativo"],
    ["Terminali dell'impianto", EMITTER_LABELS[p.system.emitters]],
    ["Rendimento caldaia riferito a", p.system.efficiencyBasis],
    ["Acqua calda a gas / cucina a gas", `${p.system.acsOnGas ? "sì" : "no"} / ${p.system.cookingOnGas ? "sì" : "no"}`],
    ["Piano a induzione nei pacchetti con impianto", p.cooking?.enabled && p.system.cookingOnGas ? "sì; chiusura del contatore solo se non resta nessun uso del gas" : "cucina invariata"],
    meterRow(p),
    ["Periodo della bolletta", p.consumption.observedPeriod || "non indicato"],
    ["Prezzi: data e provenienza", `${p.tariffs.date || "senza data"} · ${p.tariffs.source || "provenienza non indicata"}`],
    ["FV: orientamento e inclinazione", PLANE_LABELS[p.pv.plane]],
    ["FV: ombre e altre perdite, degrado", `${fmt(p.pv.lossPct.value, 1)}%, ${fmt(p.pv.degradationPct.value, 1)}% all'anno`],
    ["Caldaia a fine vita", p.heatPump.included && p.heatPump.boilerEndOfLife ? "sì (confronto con caldaia nuova)" : "no (confronto con mantenimento)"],
  ];
  return (
    <>
      <div className="toolbar no-print" style={{ marginBottom: 10 }}>
        <button type="button" className="btn primary" onClick={() => window.print()}>
          Stampa o salva in PDF
        </button>
      </div>
      <div className="section">
        <h2>Casa — confronto preliminare degli interventi energetici</h2>
        {p.goal !== "completo" && <p><strong>Domanda: {goal.question}</strong> Il report mostra solo i pacchetti di questa domanda.{hidden.length > 0 && ` Dati non chiesti (${hidden.join(", ").toLocaleLowerCase("it")}): restano le ipotesi dichiarate dell'esempio, elencate sotto.`}{electricOnly && p.cooling.today !== "split" && " Senza condizionatori questi dati non cambiano il risultato del fotovoltaico né della batteria."}</p>}
        <p>
          <strong>{p.name}</strong> · {ev.documented ? "Confronto documentato nei casi che il programma sa calcolare" : "Stima con ipotesi da completare"} · generato il {new Date().toLocaleString("it-IT")}
        </p>
        <p className="small">
          Motore {ENGINE_VERSION} · preset {PRESET_VERSION} · clima <span className="mono">{m.climateId}</span> (sha256 del file grezzo <span className="mono">{m.rawSha256.slice(0, 16)}…</span>)
        </p>
        <div className="notice">
          Preanalisi a scopo di confronto: non è un APE, una classe energetica, una perizia, un dimensionamento dell'impianto né un risparmio garantito. Le ipotesi e i limiti sono elencati sotto.
        </div>
      </div>

      <Verdetto ev={ev} p={p} sens={sens} />
      {p.goal === "completo" && paths && <PianoNelTempo result={paths} plan={p.plan} completo />}

      <div className="section">
        <h3>Risultati</h3>
        <div className="table-wrap">
          <table className="data report-results">
            <thead>
              {electricOnly
                ? <tr><th>Pacchetto</th><th>Stato</th><th>Produzione FV</th><th>El. acquistata</th><th>El. immessa</th><th>Spesa annua</th><th>Risparmio annuo</th><th>Investimento</th><th>Guadagno in {p.economics.horizonYears.value} anni (VAN)</th></tr>
                : <tr><th>Pacchetto</th><th>Stato</th><th>Fabbisogno utile</th><th>Gas</th><th>El. acquistata</th><th>Spesa annua</th><th>Risparmio annuo</th><th>Investimento</th><th>Guadagno in {p.economics.horizonYears.value} anni (VAN)</th></tr>}
            </thead>
            <tbody>
              {ev.packages.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td>{!r.valid ? "non calcolabile" : r.id === "base" ? "riferimento" : !r.economicsComplete ? "economia incompleta" : r.conditions.length ? "con riserve" : "calcolato"}{r.comparable ? "" : " · da non confrontare con gli altri"}</td>
                  {electricOnly ? <td className="num">{fmt(r.elec.pv_kWh)} kWh</td> : <td className="num">{fmt(r.heatNeed_kWh)} kWh</td>}
                  {!electricOnly && <td className="num">{fmt(r.gasSmc)} Smc</td>}
                  <td className="num">{r.valid ? `${fmt(r.elec.import_kWh)} kWh` : "—"}</td>
                  {electricOnly && <td className="num">{r.valid ? `${fmt(r.elec.export_kWh)} kWh` : "—"}</td>}
                  <td className="num">{r.valid ? eur(r.costs.total) : "—"}</td>
                  <td className="num">{r.id === "base" || !r.valid ? "—" : signedEur(r.annualBenefit)}</td>
                  <td className="num">{r.id === "base" || !r.valid ? "—" : r.economicsComplete ? eur(r.investment) : `≥ ${eur(r.investment)}`}</td>
                  <td className="num">{r.cash ? signedEur(r.cash.npv) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {envelopeValue && <EnvelopeValueTable value={envelopeValue} p={p} />}
        {(() => { const a = ev.thermal && airChangeSummary(ev.thermal.base, p.service); const w = ev.thermal && airChangeSummary(ev.thermal.windows, p.service); const m = ev.thermal?.base.envelope.infiltration; return a && m ? <div className="section"><h3>Infiltrazioni dalla tenuta all'aria</h3><p>n50 {fmt(m.n50, 1)} 1/h, area di perdita {fmt(m.leakageArea_cm2, 0)} cm², classe di riparo {p.building.infiltration.shelterClass}, minimo {fmt(m.minAirChange, 2)} vol/h. Ricambio medio: {fmt(a.meanYear, 2)} vol/h nell'anno, {fmt(a.meanHeating, 2)} in inverno{w && ev.thermal!.windows !== ev.thermal!.base ? `, ${fmt(w.meanHeating, 2)} in inverno con l'involucro (n50 ${fmt(ev.thermal!.windows.envelope.infiltration?.n50 ?? NaN, 1)})` : ""}. Il minimo prevale nel {fmt(a.minShareHeating * 100, 0)}% delle ore di riscaldamento. Modello ASHRAE di Sherman e Grimsrud.</p></div> : null; })()}
        {p.building.thermalBridges.mode === "lineari" && <div className="section"><h3>Ponti termici lineari</h3><p>H oggi {fmt(ev.thermal?.base.envelope.H_tbToday ?? 0,2)} W/K · nell’involucro {fmt(ev.thermal?.windows.envelope.H_tb ?? 0,2)} W/K.</p><div className="table-wrap"><table className="data"><thead><tr><th>Giunto</th><th>ψ oggi</th><th>L</th><th>ψ·L oggi</th><th>ψ·L cappotto</th></tr></thead><tbody>{bridgeTable(p.building,p.location,p.envelope.walls.enabled?p.envelope.walls.sharePct.value/100:0).map(r=><tr key={r.id}><td>{r.id}</td><td className="num">{fmt(r.psi,2)} W/mK</td><td className="num">{fmt(r.length,2)} m</td><td className="num">{fmt(r.h,2)} W/K</td><td className="num">{fmt(r.after,2)} W/K</td></tr>)}</tbody></table></div></div>}        {!electricOnly && ev.packages.some((r) => r.unheatedSpaces.length) ? <div className="section"><h3>Locali non riscaldati</h3><div className="table-wrap"><table className="data"><thead><tr><th>Pacchetto</th><th>Locale</th><th>b attuale</th><th>b nel pacchetto</th><th>Temperatura media in inverno</th></tr></thead><tbody>{ev.packages.flatMap((r, i) => r.unheatedSpaces.filter((x) => i === 0 || Math.abs(x.bAfter - x.bToday) > 1e-6).map((x) => <tr key={`${r.id}-${x.id}`}><td>{r.label}</td><td>{x.id === "upper" ? "Sottotetto" : x.id === "lower" ? "Locale inferiore" : "Adiacenze laterali"}</td><td className="num">{fmt(x.bToday, 3)}</td><td className="num">{fmt(x.bAfter, 3)}</td><td className="num">{fmt(x.meanHeatingTemperature, 1)} °C</td></tr>))}</tbody></table></div></div> : null}
        {p.ev.enabled && <EvTable p={p} climate={climate} ev={ev} showInputs />}
        {ev.packages.some((r) => r.dhw) && <DhwTable p={p} climate={climate} ev={ev} />}
        {ev.packages
          .filter((r) => r.blockers.length || r.conditions.length || r.economicsMissing.length)
          .map((r) => (
            <p className="small" key={r.id}>
              <strong>{r.label}:</strong> {[...r.blockers, ...r.conditions].join(" ")}
              {r.economicsMissing.length > 0 && ` Economia incompleta: ${r.economicsMissing.join("; ")}.`}
            </p>
          ))}
        <ComparableNote ev={ev} />
        {!usesMeasuredCurve(p) && <ProfileRangeBlock ev={ev} sens={sens} completo />}
        {!electricOnly && ev.observedGapPct !== null && (
          <p className="small">
            Gas modellato nell'anno tipico {ev.observedGapPct > 0 ? "+" : ""}
            {fmt(ev.observedGapPct)}% rispetto {p.consumption.gasSmcObserved.status === "ipotizzato" ? "al consumo ipotetico" : "al consumo dichiarato dalla bolletta"}: confronto diagnostico, non misura di accuratezza.
            {p.consumption.gasSmcObserved.status !== "ipotizzato" && ` Periodo: ${p.consumption.observedPeriod || "non indicato"}. Origine: ${p.consumption.gasSmcObserved.source || "non indicata"}.`}
          </p>
        )}
      </div>

      <TariffeBlock p={p} climate={climate} ev={ev} report />
      {ev.sizing && ev.sizing.length > 0 && (
        <div className="section">
          <h3>Taglia indicativa (stima, non preventivo)</h3>
          <SizingBlock ev={ev} p={p} sens={sens} />
        </div>
      )}
      {ev.packages.filter((r) => r.battery).map((r) => (
        <div className="section" key={`b-${r.id}`}>
          <h3>La batteria da sola · {r.label}</h3>
          <BatteryVerdict r={r} p={p} />
        </div>
      ))}
      {ev.packages.some((r) => r.battery) && !usesMeasuredCurve(p) && <div className="section"><BatteryProfileRange ev={ev} sens={sens} /></div>}
      {quotes.length > 0 && <div className="section"><QuoteComparisons quotes={quotes} horizon={Math.round(p.economics.horizonYears.value)} /></div>}

      <div className="section">
        <DiagnosisBlock p={p} climate={climate} base={ev.packages[0]} completo />
        {!electricOnly && (ev.calibration || ev.calibrationNote) && <>
          <h3>Con i consumi della bolletta</h3>
          <BillCalibrationBlock ev={ev} p={p} completo />
        </>}
      </div>
      {(ev.incentive || ev.incentiveNote) && (
        <div className="section">
          <h3>Con un incentivo</h3>
          <IncentiveBlock ev={ev} />
        </div>
      )}
      {(ev.homeValue || ev.homeValueNote) && (
        <div className="section">
          <h3>Se un giorno vendi: valore della casa</h3>
          <HomeValueBlock ev={ev} />
        </div>
      )}

      {(!electricOnly || p.cooling.today === "split") && <div className="section">
        <h3>Raffrescamento estivo</h3>
        <ul className="small">
          {ev.packages.map((r) => (
            <li key={r.id}>
              <strong>{r.label}</strong>: fabbisogno {fmt(r.coolNeed_kWh)} kWh frigoriferi
              {r.cooling
                ? ` · ${r.cooling.generator} · ${fmt(r.cooling.elec_kWh)} kWh elettrici${Number.isFinite(r.cooling.seasonalEer) ? ` · EER stagionale ${fmt(r.cooling.seasonalEer, 1)}` : ""}${r.cooling.hoursUndersized > 0 ? ` · ${fmt(r.cooling.hoursUndersized)} ore oltre la potenza (${fmt(r.cooling.undelivered_kWh)} kWh non forniti)` : ""}.`
                : `. ${r.coolingNotes.join(" ")}`}
            </li>
          ))}
        </ul>
      </div>}

      {sens && (
        <div className="section">
          <h3>Sensibilità</h3>
          <p className="small">
            {sens.nominalBest
              ? `VAN più alto (non negativo) con i valori nominali: ${packageLabel(sens.nominalBest, p)}; resta primo in ${Math.round((sens.bestStableShare ?? 0) * 100)}% delle varianti.`
              : "Nessun pacchetto con economia completa ha VAN non negativo con i valori nominali."}{" "}
            {sens.failedVariants.length > 0 && `Varianti non calcolabili: ${sens.failedVariants.join(", ")}.`}
            {ev.packages.some((r) => r.battery) && " I pacchetti con il fotovoltaico qui comprendono la batteria; lo stesso pacchetto senza batteria è nella sezione «La batteria da sola»."}
          </p>
          <ul className="small">
            {sens.packages.map((x) => (
              <li key={x.id}>
                {packageLabel(x.id, p)}: risparmio annuo {Number.isFinite(x.benefitMin) ? `${signedEur(x.benefitMin)} … ${signedEur(x.benefitMax)}` : "—"}
                {x.npvMin !== null && `, VAN ${eur(x.npvMin)} … ${eur(x.npvMax)}`}
                {x.batteryNpvMin !== null && `, VAN della sola batteria ${eur(x.batteryNpvMin)} … ${eur(x.batteryNpvMax ?? x.batteryNpvMin)}`}
                {x.unresolved && " — troppo vicino per scegliere"}
                {x.invalidIn.length > 0 && ` — non calcolabile in ${x.invalidIn.length} varianti`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="section">
        <h3>Scelte e casi che il programma sa calcolare</h3>
        <div className="table-wrap">
          <table className="data report-choices">
            <tbody>
              {choices.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td style={{ textAlign: "left" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h3>Qualità dei dati</h3>
        <p className="small">Campi numerici pertinenti: {Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ")}</p>
        <ul className="issues">
          {ev.issues.map((i, k) => (
            <li key={k} className={i.severity}>
              [{i.section}] {i.message}
            </li>
          ))}
        </ul>
      </div>

      <div className="section">
        <h3>Dati inseriti</h3>
        {SECTIONS.map((sec) => {
          const rs = rules.filter((r) => r.section === sec);
          if (!rs.length) return null;
          return (
            <div key={sec} style={{ marginBottom: 10 }}>
              <h4>{sec}</h4>
              <div className="table-wrap">
                <table className="data report-inputs">
                  <thead>
                    <tr><th>Dato</th><th>Valore e unità</th><th>Stato</th><th>Fonte, data e conferma</th></tr>
                  </thead>
                  <tbody>
                    {rs.map((r) => {
                      const q = r.get(p);
                      return (
                        <tr key={r.path}>
                          <td>{r.label}</td>
                          <td className="num">{fmtUpTo(q.value, 3)} {r.unit}</td>
                          <td>{STATUS_LABEL[q.status]}</td>
                          <td className="small" style={{ textAlign: "left" }}>{q.source ?? "fonte non indicata"} · {q.date ?? "data non indicata"}{q.confirmed ? " · stima tecnica confermata esplicitamente" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {parts.includes("windows") && p.envelope.windows && <CostTable title="Costi serramenti" block={p.windows.cost} />}
        {parts.includes("windows") && activeInsulation(p).map((kind) => {
          const m = p.envelope[kind];
          return m.costMode === "preventivo" ? <CostTable key={kind} title={`Costi ${insulationName(p, kind).long}`} block={m.cost} /> : <p className="small" key={kind}>Costo stimato, non da preventivo: {fmt(m.pricePerM2.value)} €/m² su {fmt(envelopeCost(p, kind).area_m2)} m² ({m.pricePerM2.source}).</p>;
        })}
        {parts.includes("heatPump") && p.heatPump.included && <CostTable title="Costi pompa di calore" block={p.heatPump.cost} />}
        {parts.includes("heatPump") && p.dhw.replace && (p.dhw.costMode === "preventivo" ? <CostTable title="Costi scaldacqua" block={p.dhw.cost} /> : <p className="small">Scaldacqua: costo stimato {eur(dhwCost(p).total)} (scenario, non preventivo). {p.dhw.price.source}</p>)}
        {p.pv.sizing === "indicativa" && <p className="small">Costi stimati, non da preventivo, IVA compresa: FV {fmt(p.pv.pricePerKwp.value)} €/kWp ({p.pv.pricePerKwp.source}){batteryUsed ? `; batteria ${fmt(p.battery.pricePerKwh.value)} €/kWh più ${fmt(existing ? p.battery.retrofitFixedCost.value : p.battery.fixedCost.value)} € di parte fissa ${existing ? "su FV esistente" : "insieme al FV nuovo"} (${p.battery.pricePerKwh.source}); sostituzione a fine vita operativa: ${fmt(p.battery.replacementPerKwh.value)} €/kWh più ${fmt(p.battery.replacementFixed.value)} €, solo moduli e manodopera` : ""}.</p>}
        {p.pv.sizing !== "indicativa" && parts.includes("pv") && !existing && <CostTable title="Costi fotovoltaico" block={p.pv.cost} />}
        {p.pv.sizing !== "indicativa" && batteryUsed && parts.includes("battery") && <CostTable title="Costi batteria" block={p.battery.cost} />}
        {quotes.flatMap((c) => quotesOf(p, c.kind).slice(1).map((q, i) => <CostTable key={`${c.kind}-${i}`} title={`Costi ${c.title.toLowerCase()}, «${quoteName(q.cost, i + 1)}» (alternativa)`} block={q.cost} />))}
        {[
          ...(parts.includes("heatPump") && p.heatPump.included ? p.heatPump.replacements.map((r) => ["PDC", r] as const) : []),
          ...(parts.includes("pv") && !existing ? p.pv.replacements.map((r) => ["FV", r] as const) : []),
          ...(batteryUsed && parts.includes("battery") && p.pv.sizing !== "indicativa" ? p.battery.replacements.map((r) => ["batteria", r] as const) : []),
        ].map(([k, r], i) => (
          <p className="small" key={i}>
            Sostituzione {k}: {r.label}, anno {r.year}, {eur(r.amount.value)} ({STATUS_LABEL[r.amount.status]})
          </p>
        ))}
      </div>

      <div className="section">
        <h3>Clima</h3>
        <p className="small">
          {m.name}: {plainClimateText(m.note)} {plainClimateText(m.attribution)} Mesi dell'anno tipico del clima: {m.monthsSelected.map((x) => `${x.month}/${x.year}`).join(", ")}.
        </p>
        <ul className="small">
          {ev.packages.filter((r) => r.hp).map((r) => <li key={`cop-${r.id}`}>{r.label}: COP stagionale senza ausiliari {fmt(r.hp!.seasonalCopNoAux, 2)}; con ausiliari e cicli {fmt(r.hp!.seasonalCop, 2)} (ausiliari {fmt(r.hp!.elecAux_kWh)} kWh, cicli {fmt(r.hp!.elecCycling_kWh)} kWh).</li>)}
          {m.transformations.map((t) => (
            <li key={t}>{plainClimateText(t)}</li>
          ))}
        </ul>
      </div>

      <div className="section">
        <h3>Ipotesi e limiti del modello</h3>
        <p className="small">Fonti originali: <a href="https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.xlsx">ISTAT, comuni al 21/02/2026</a> · <a href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/general-information/usage-conditions-data-protection_en">JRC, PVGIS</a> · <a href="https://github.com/FZJ-IEK3-VSA/hplib/tree/125c2ef6c3fc38043368daac1352557fd2a90106">hplib, revisione acquisita</a> · <a href="https://store.uni.com/uni-en-iso-13790-2008">UNI EN ISO 13790:2008, stato</a>. Riscontro delle fonti: 28/10/2026, con copertura e limiti in NOTICE.md. Trasformazioni del progetto: facciate e FV con pvlib sull'anno tipico del clima; regressioni COP/P_el e capacità modificata del catalogo; geometria e preset come ipotesi. Le elaborazioni non sono dati misurati del sito. Dati di temperatura: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (modello «Best match»: IFS HRES, ERA5 ed ERA5-Land; contiene informazioni del Copernicus Climate Change Service), CC BY 4.0. Autori e licenze di tutti i dati e del software, con OpenStreetMap, ISTAT e ARERA: <a href="./crediti.html">casa.raccasamuele.it/crediti.html</a>.</p>
        <ul className="small">
          {s.schedule?.mode === "fasce" && <li>Fasce uguali tutti i giorni; potenza limitata e rendimento della caldaia costante anche nelle riprese. Temperature fuori fascia non confrontate con EnergyPlus. {ev.thermal?.base.schedule && heatingScheduleText(ev.thermal.base.schedule)} {ev.thermal?.base.schedule && heatingScheduleWarning(ev.thermal.base.schedule, s.setpoint.value)} {s.schedule.maxPowerKw.status === "sconosciuto" && "Potenza stimata pari a 1,5 volte il picco continuo della casa attuale, prima della taratura."} {s.schedule.withHeatPump === "continuo" && "Con la pompa di calore il riscaldamento è continuo: la casa è più calda che oggi nelle ore oggi spente."}</li>}
          {activeInsulation(p).length > 0 && <li>Isolamento: prezzi per m² di scenario; ponti termici dopo il lavoro come oggi se non dichiarati; mandata della pompa di calore invariata dopo l'isolamento; umidità e condensa non verificate; pareti verso locali non riscaldati e pavimento su terreno non isolati.</li>}
          <li>Modello monozona orario a due nodi (rete 5R1C della UNI EN ISO 13790, appendice C), con la temperatura operante al setpoint: una sola temperatura per tutta la casa, senza differenze fra le stanze né verifica del comfort. Nessuna conformità UNI/ISO dichiarata.</li>
          <li>{s.schedule?.mode !== "fasce" && "Servizio continuo equivalente a setpoint costante nella stagione dichiarata. "}D'estate la casa sta alla temperatura estiva, mai più della differenza massima sotto l'aria esterna; il raffrescamento entra nei conti solo se la casa è raffrescata oggi. Solo calore sensibile: umidità (deumidificazione) e raffrescamento notturno con le finestre non sono modellati; l'umidità è nella sensibilità come carico estivo +20%.</li>
          <li>Apporti solari solo dalle finestre (g × (1 − telaio) × ombreggiamento × 0,9), apporti interni costanti.</li>
          {p.cooking?.enabled && p.system.cookingOnGas && <li>Piano a induzione: rendimenti di laboratorio, dipendenti da pentole e abitudini. La cottura segue la stessa forma oraria degli altri usi elettrici. Piano, pentole, posa e chiusura del contatore sono costi indicati dall'utente, esclusi dalla spesa incentivata. La quota fissa del gas sparisce solo se non resta alcun servizio a gas.</li>}
          <li>Terreno: H equivalente verso la media annua dell'aria, parte periodica trascurata. Locali non riscaldati con il metodo del fattore b verso l'aria esterna oraria.</li>
          {!(s.schedule?.mode === "fasce" && s.schedule.withHeatPump === "come-oggi") && <li>Inizio stagione: con la pompa di calore la casa torna al setpoint in al massimo 72 h, rinviando solo l'energia accumulata da recuperare; oltre, lo scenario è non calcolabile.</li>}
          <li>
            {hpCat
              ? `Pompa di calore ${hpCat.manufacturer} ${hpCat.model}: errore del fit hplib sui punti di origine: COP ${fmt(hpCat.mape.cop, 1)}%, potenza ${fmt(hpCat.mape.pTh, 1)}%. La capacità disponibile è modificata dal progetto e non validata: il MAPE non ne misura l'errore. Condizioni provate comuni: inviluppo dei punti ${hpCat.fitDomain?.points.map(([a, w]) => `A${a}/W${w}`).join(", ")}; fuori inviluppo ore ed energia estrapolate sono dichiarate per pacchetto. Sotto −7 °C o oltre 55 °C di mandata lo scenario è non calcolabile; nelle ore miti aria del fit saturata a 12 °C. Documento: ${hpCat.certificate?.url ?? hpCat.certificate?.page}; acquisito ${hpCat.certificate?.acquiredAt ?? "non acquisito"}; SHA256 ${hpCat.certificate?.sha256 ?? "non disponibile"}; revisione ${hpCat.certificate?.revision ?? "non verificata"}; regole ${hpCat.certificate?.schemeRevision ?? "non verificate"}. ${hpCat.certificate?.standardsEdition}. Nessun backup implicito, non è un dimensionamento. Acqua calda invariata.`
              : "Pompa di calore parametrica indicativa (Carnot ridotto, curva climatica di mandata, sbrinamento su COP e potenza): nessuna macchina documentata, nessuna estrapolazione, nessun backup implicito; cicli sotto modulazione minima e ausiliari in altri modi compresi. Acqua calda invariata."}
          </li>
          <li>Consumi elettrici con {usesMeasuredCurve(p) ? (fromMeter(p) ? "la forma media ricostruita da prelievi e immissioni del contatore, con l'autoconsumo stimato dalla produzione di un anno tipico," : "la forma media della curva misurata (ultimi 12 mesi)") : p.consumption.profileMode === "stagionale" ? "curve medie ARERA con le stagioni" : "curve orarie sintetiche"} normalizzate al totale; bilancio FV su base oraria, senza simultaneità suboraria.</li>
          {p.consumption.profileMode === "stagionale" && !usesMeasuredCurve(p) && <li>ARERA {ARERA_PROFILE_SOURCE.year}: media semplice delle regioni per area, modulata con le abitudini scelte. Calendario 2025 con i festivi come domeniche. La media comprende case con pompa di calore, auto e condizionatori: aggiungendoli si può contare due volte parte del loro andamento stagionale. È la media di molte case: la tua può essere diversa. La curva del contatore resta il dato migliore.</li>}
          <li>Produzione FV dall'anno tipico con 14% di perdite DC, meno ombre e altre perdite dichiarate; il degrado dei moduli riduce il flusso di cassa anno per anno.</li>
          <li>Economia a prezzi costanti reali inseriti; nessun incentivo nel risultato principale, nessun valore residuo; voci o importi sconosciuti rendono l'economia incompleta.</li>
          {batteryUsed && <li>Batteria: {HOURLY_LIMIT} Si carica solo dal fotovoltaico e si scarica solo per la casa (niente rete, orari o previsioni). Rendimento e cicli sono valori tipici di schede tecniche (Tesla Powerwall 2, Pylontech US5000), non misure. Garanzia ({fmt(p.battery.warrantyYears.value)} anni), degrado ipotizzato ({fmt(p.battery.fadePctPerYear.value, 1)}% all'anno, lineare) e vita operativa ({fmt(p.battery.lifeYears.value)} anni) sono dati distinti: degrado e vita sono scenari, non ricavati dalla garanzia; la capacità torna piena nell'anno della sostituzione.</li>}
          {existing && <li>FV già installato: con prelievi e immissioni si ricostruisce il consumo; negli altri casi si usa il profilo scelto, sintetico o medio ARERA con le stagioni (intervallo sulle tre abitudini). {p.existingPv.consumptionFrom === "bolletta" ? "Il consumo totale è ricavato dai prelievi in bolletta con il bilancio orario: è un'ipotesi che cambia con il profilo." : "Il consumo totale è quello dichiarato dall'app dell'inverter."} Incentivi già in corso sull'impianto e calo della sua produzione non sono nei conti: pesano allo stesso modo con e senza batteria.</li>}
          {p.goal !== "completo" && <li>Domanda «{goal.question}»: i dati dei passi non chiesti restano le ipotesi dell'esempio. Con «Approfondisci la casa» si passa al quadro completo senza perdere i dati.</li>}
          <li>I preset sono provvisori ({PRESET_VERSION}) e non ancora validati con dati pubblici e benchmark.</li>
        </ul>
        <p className="small">Il metodo di calcolo, con equazioni ed esempi, è descritto in <a href={METODO_CASA}>raccasamuele.it/metodo/casa</a>.</p>
      </div>
    </>
  );
}
