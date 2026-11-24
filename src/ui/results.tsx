import { Icon } from "./icons";
import { useResultDetail } from "./dettagli";
import { useMemo, useRef, useState } from "react";
import { billGasMean, nonDominated, usesMeasuredCurve, fromMeter, curveAnnualKwh, selfConsumption, selfSufficiency, usefulSource, type Evaluation, type PackageId, type PackageResult, type ProjectInput, type QuoteComparison, type SensitivityResult } from "../engine";
import { BillCalibrationBlock, ComparableNote, IncentiveBlock, ProfileRangeBlock } from "./calibration";
import { CashFlowChart, CostBars, Donut, type DonutSlice } from "./charts";
import { eur, fmt, signedEur, heatingScheduleText, heatingScheduleWarning } from "./format";
import { HelpDiagram } from "./illustrations";
import { FIELDS, needsEvidence } from "./metadata";
import { InfoTip } from "./info-tip";
import { BatteryProfileRange, BatteryVerdict } from "./battery";
import { SizingBlock } from "./sizing";
import { QuoteComparisons } from "./quotes";
import { DiagnosisBlock } from "./diagnosi";
import { airChangeSummary, envelopeBreakdown, envelopeLabel, plantLabel } from "../engine";
import { EnvelopeValueTable } from "./involucro";
import { HomeValueBlock } from "./valore";
import { EvTable } from "./auto";
import { DhwTable } from "./acqua";
import { PianoNelTempo } from "./percorsi";
import type { ClimatePackage, PathsResult } from "../engine";
import { TariffeBlock } from "./tariffe";
import { investmentText, paybackText } from "./verdetto";
import { limitiModello } from "./limiti";
import { electricOnlyGoal } from "./goals";
import { Verdetto } from "./verdetto-view";

type SortKey = "ordine" | "van" | "investimento" | "risparmio";

function statusBadge(r: PackageResult) {
  if (r.id === "base") return <span className="badge info">riferimento</span>;
  if (!r.valid) return <span className="badge bad">non calcolabile</span>;
  if (!r.economicsComplete) return <span className="badge warn">economia incompleta</span>;
  if (r.conditions.length) return <span className="badge warn">con riserve</span>;
  return <span className="badge ok">calcolato</span>;
}

export function Results({ ev, p, sens, climate, quotes = [], paths = null, pathsRunning = false }: { ev: Evaluation; p: ProjectInput; sens: SensitivityResult | null; climate: ClimatePackage; quotes?: QuoteComparison[]; paths?: PathsResult | null; pathsRunning?: boolean }) {
  const [sort, setSort] = useState<SortKey>("ordine");
  const [selected, setSelected] = useState<PackageId[]>(() => ["W", "H", "P", "HP"].filter((id) => ev.packages.some((r) => r.id === id)) as PackageId[]);
  const [detail, setDetail] = useState<PackageId>(() => (ev.packages.some((r) => r.id === "HP") ? "HP" : ev.packages[ev.packages.length - 1].id));
  const electricOnly = electricOnlyGoal(p.goal);
  const detailRef = useRef<HTMLDivElement>(null);
  const nd = useMemo(() => nonDominated(ev.packages), [ev]);
  const envelopeValue = useResultDetail((d) => ev.packages.some((r) => r.id === "W") ? d.envelope : null, () => ev.packages.some((r) => r.id === "W") ? envelopeBreakdown(p, climate, ev) : null, [p, climate, ev]) ?? null;
  const horizon = Math.round(p.economics.horizonYears.value);
  const unresolved = new Set(sens?.packages.filter((x) => x.unresolved).map((x) => x.id) ?? []);
  const rows = [...ev.packages];
  if (sort !== "ordine") {
    const key = (r: PackageResult) =>
      r.id === "base" ? Infinity : sort === "van" ? -(r.cash?.npv ?? -Infinity) : sort === "investimento" ? (r.valid ? r.investment : Infinity) : -(r.valid ? r.annualBenefit : -Infinity);
    rows.sort((a, b) => key(a) - key(b));
  }
  const base = ev.packages[0];
  const det = ev.packages.find((r) => r.id === detail) ?? base;
  const withBattery = det.battery ? det : ev.packages.find((r) => r.battery);
  const pvPackage = ev.packages.find((r) => r.id === "P");

  const best = sens?.nominalBest ? ev.packages.find((r) => r.id === sens.nominalBest) : null;
  const gap = ev.observedGapPct;
  const observed = p.consumption.gasSmcObserved;
  const billMean = billGasMean(p);
  const multipleYears = !!billMean && billMean.years > 1;
  const hypothetical = !multipleYears && observed.status === "ipotizzato";
  const counts = FIELDS.filter((r) => r.applies(p));
  const assumptions = counts.filter((r) => needsEvidence(r.get(p))).length;
  const dataComplete = counts.every((r) => {
    const q = r.get(p);
    return usefulSource(q) && (!needsEvidence(q) || (r.critical === "tecnico" && q.status === "ipotizzato" && q.confirmed === true));
  }) && [p.windows.cost, p.heatPump.cost, p.pv.cost].every((cost) => cost.quoteDate && cost.items.every((item) => item.status === "escluso" || (item.status === "incluso" && !needsEvidence(item.amount) && usefulSource(item.amount))))
    && !!p.location.code && !!p.location.siteAltitude && !needsEvidence(p.location.siteAltitude) && usefulSource(p.location.siteAltitude) && !!p.tariffs.date;
  const serviceSlices: DonutSlice[] = (() => {
    const colors: Record<string, string> = { Riscaldamento: "var(--s1)", ACS: "var(--s3)", Cucina: "var(--s4)", "Altri usi elettrici": "var(--s2)", Raffrescamento: "var(--s5)" };
    return base.services.map((s) => ({ label: s.service, value: s.final_kWh, color: colors[s.service] ?? "var(--s5)" }));
  })();

  return (
    <>
      {p.goal === "tariffa" && <TariffeBlock p={p} climate={climate} ev={ev} detail={det} />}
      {p.goal === "auto" && p.ev.enabled && <section className="panel span-12"><EvTable p={p} climate={climate} ev={ev} shown={ev.packages.find((r) => r.id === "P") ?? base} /></section>}
      <Verdetto ev={ev} p={p} sens={sens} />
      {electricOnly ? <div className="kpis">
        <div className="kpi">
          <div className="top">
            <span className="k">Consumi elettrici della casa</span>
            <span className="kpi-icon tone-info"><Icon name="bolletta" size={20} /></span>
          </div>
          <div className="v">{fmt(base.elec.demand_kWh)} kWh</div>
          <div className="d">{base.cooling ? `condizionatori compresi (${fmt(base.cooling.elec_kWh)} kWh)` : "all'anno, senza condizionatori"}</div>
          {fromMeter(p) && p.consumption.measuredCurve && <div className="d">ricostruiti dal contatore · prelievi misurati {fmt(curveAnnualKwh(p.consumption.measuredCurve.ore))} kWh, calcolati {fmt(base.elec.import_kWh)} kWh</div>}
        </div>
        <div className="kpi">
          <div className="top">
            <span className="k">Produzione del fotovoltaico</span>
            <span className="kpi-icon tone-warn"><Icon name="solare" size={20} /></span>
          </div>
          <div className="v">{fmt(pvPackage?.elec.pv_kWh ?? base.elec.pv_kWh)} kWh</div>
          <div className="d">{p.existingPv.present ? `impianto esistente da ${fmt(p.existingPv.kWp.value, 1)} kWp` : `${fmt(pvPackage?.pvKwp ?? p.pv.kWp.value, 1)} kWp nuovi${p.pv.sizing === "indicativa" ? " (taglia indicativa)" : ""}`} · anno tipico</div>
        </div>
        <div className="kpi">
          <div className="top">
            <span className="k">Autoconsumo · autosufficienza</span>
            <span className="kpi-icon tone-accent"><Icon name="fv-batteria" size={20} /></span>
          </div>
          <div className="v">{pvPackage ? `${fmt(selfConsumption(pvPackage.elec))}% · ${fmt(selfSufficiency(pvPackage.elec))}%` : "—"}</div>
          <div className="d">{pvPackage?.battery ? `con la batteria; senza ${fmt(pvPackage.battery.without.selfConsumptionPct)}% · ${fmt(pvPackage.battery.without.selfSufficiencyPct)}%` : "senza batteria"}</div>
        </div>
        <div className="kpi">
          <div className="top">
            <span className="k">Spesa elettrica attuale modellata</span>
            <span className="kpi-icon tone-info"><Icon name="costi" size={20} /></span>
          </div>
          <div className="v">{eur(base.costs.elecPurchase + base.costs.elecFixed + base.costs.elecPower - base.costs.exportRevenue)}</div>
          <div className="d">prelievi, quote fisse e potenza{base.costs.exportRevenue > 0 ? ", meno l'energia ritirata" : ""}, a prezzi costanti inseriti</div>
        </div>
      </div> : <div className="kpis">
        <div className="kpi">
          <div className="top">
            <span className="k">Fabbisogno utile di riscaldamento</span>
            <span className="kpi-icon tone-warn"><Icon name="calore" size={20} /></span>
          </div>
          <div className="v">{fmt(base.heatNeed_kWh)} kWh</div>
          {ev.thermal?.base.schedule && <>
            <div className="d">{heatingScheduleText(ev.thermal.base.schedule)}</div>
            <div className="d">{ev.thermal.base.schedule.estimated ? "Potenza dell'impianto non indicata: stimata in" : "Potenza verso la casa:"} {fmt(ev.thermal.base.schedule.pMax_W! / 1000, 1)} kW</div>
            {heatingScheduleWarning(ev.thermal.base.schedule, p.service.setpoint.value) && <p className="notice warn">{heatingScheduleWarning(ev.thermal.base.schedule, p.service.setpoint.value)}</p>}
          </>}
          {(() => { const a = ev.thermal && airChangeSummary(ev.thermal.base, p.service); const w = ev.thermal && airChangeSummary(ev.thermal.windows, p.service); return a ? <div className="d">Ricambio d'aria in inverno {fmt(a.meanHeating, 2)} vol/h{w && ev.thermal!.windows !== ev.thermal!.base ? ` · ${fmt(w.meanHeating, 2)} con l'involucro` : ""} · minimo per l'aria pulita nel {fmt(a.minShareHeating * 100, 0)}% delle ore</div> : null; })()}
          {p.building.thermalBridges.mode === "lineari" && <div className="d">Ponti termici H: {fmt(ev.thermal?.base.envelope.H_tbToday ?? 0, 2)} W/K oggi · {fmt(ev.thermal?.windows.envelope.H_tb ?? 0, 2)} W/K nell’involucro</div>}
          <div className="d">{fmt(base.heatNeedPerM2)} kWh/m² · picco {fmt(base.peak_kW, 1)} kW</div>
        </div>
        <div className="kpi">
          <div className="top">
            <span className="k">{hypothetical ? "Confronto con un consumo ipotetico" : !billMean && observed.status === "sconosciuto" ? "Consumo osservato dichiarato non noto" : "Gas modellato / trascritto dalla bolletta"}</span>
            <span className="kpi-icon tone-accent"><Icon name="sensibilita" size={20} /></span>
          </div>
          <div className="v">
            {fmt(base.gasSmc)} <span className="small muted">/ {billMean ? fmt(billMean.smc) : "—"} Smc/anno</span>
          </div>
          <div className="d">
            {gap !== null ? (
              <span className="badge info">
                {gap > 0 ? "+" : ""}
                {fmt(gap)}% di scarto
              </span>
            ) : (
              observed.status === "sconosciuto" ? "Dato presente ma dichiarato non noto: confronto non eseguito." : "Consumo positivo non disponibile per il confronto."
            )}
          </div>
          <p className="small muted"><InfoTip text="Lo scarto non misura l'accuratezza del modello." label="Confronto con la bolletta" method="taratura-gas">{multipleYears ? `La media di ${billMean.years} anni di bollette è ${fmt(billMean.smc)} Smc.` : hypothetical ? "Il consumo di confronto è un'ipotesi, non una verifica con la tua bolletta." : observed.status !== "sconosciuto" ? `Periodo: ${p.consumption.observedPeriod || "non indicato"}. Origine: ${observed.source || "non indicata"}.` : "Inserisci stato e provenienza quando hai la bolletta."}</InfoTip></p>
        </div>
        <div className="kpi">
          <div className="top">
            <span className="k">Fabbisogno di raffrescamento</span>
            <span className="kpi-icon tone-info"><Icon name="fresco" size={20} /></span>
          </div>
          <div className="v">{fmt(base.coolNeed_kWh)} kWh</div>
          <div className="d">
            {base.cooling
              ? `${fmt(base.cooling.elec_kWh)} kWh elettrici con ${base.cooling.generator.startsWith("Split") ? "gli split" : "la pompa di calore"}${Number.isFinite(base.cooling.seasonalEer) ? ` · EER stagionale ${fmt(base.cooling.seasonalEer, 1)}` : ""}`
              : "frigoriferi, fuori dai conti: la casa non è raffrescata"}
          </div>
        </div>
        <div className="kpi">
          <div className="top">
            <span className="k">Spesa annua attuale modellata</span>
            <span className="kpi-icon tone-info"><Icon name="costi" size={20} /></span>
          </div>
          <div className="v">{eur(base.costs.total)}</div>
          <div className="d">a prezzi costanti inseriti</div>
        </div>
        <div className="kpi">
          <div className="top">
            <span className="k">Guadagno più alto in {horizon} anni (VAN)</span>
            <span className={`kpi-icon ${!sens ? "tone-info" : best ? "tone-ok" : "tone-bad"}`}>{!sens || best ? <Icon name="crescita" size={20} /> : <Icon name="calo" size={20} />}</span>
          </div>
          <div className="v">{!sens ? "…" : best?.cash ? signedEur(best.cash.npv) : "Nessuno"}</div>
          <div className="d">
            {best ? `${best.label} · primo nel ${Math.round((sens?.bestStableShare ?? 0) * 100)}% delle varianti${best.comparable ? "" : " · da non confrontare con gli altri"}` : sens ? "nessun pacchetto completo con VAN ≥ 0" : "sensibilità in calcolo…"}
            {ev.incentive !== null && " · senza incentivo"}
          </div>
        </div>
      </div>}
      <div className="result-status">
        <p><strong>Dati:</strong> <InfoTip text={dataComplete ? "completi e tracciabili" : `stima con ${assumptions} ipotesi`} label="Stato dei dati">{dataComplete ? "" : "Completa i dati per un confronto documentato. "}{counts.length - assumptions} dati numerici dichiarati e {assumptions} ipotesi numeriche. Documenta provenienza, rilievi e preventivi e verifica le scelte del percorso. Lo stato dei dati indica la tracciabilità degli input, non l'accuratezza del modello.</InfoTip></p>
        <p><strong>Modello:</strong> {electricOnly ? <InfoTip text="Bilancio ora per ora" label="Limiti del modello">{limitiModello(p)}</InfoTip> : <InfoTip text="PDC indicativa" label="Limiti del modello" method={p.heatPump.model === "catalogo" ? "pdc-modello-catalogo" : "pdc-modello-parametrico"}>{limitiModello(p)}</InfoTip>}</p>
      </div>

      {ev.packages.some((r) => r.unheatedSpaces.length) ? <details className="fold"><summary>Locali non riscaldati</summary><div className="table-wrap"><table className="data cards-sm"><thead><tr><th>Pacchetto</th><th>Locale</th><th>b attuale</th><th>b dopo</th><th>Temperatura media in inverno</th></tr></thead><tbody>{ev.packages.flatMap((r, i) => r.unheatedSpaces.filter((x) => i === 0 || Math.abs(x.bAfter - x.bToday) > 1e-6).map((x) => <tr key={`${r.id}-${x.id}`}><td data-label="Pacchetto">{r.label}</td><td data-label="Locale">{x.id === "upper" ? "Sottotetto" : x.id === "lower" ? "Locale inferiore" : "Adiacenze laterali"}</td><td data-label="b attuale">{fmt(x.bToday, 3)}</td><td data-label="b dopo">{fmt(x.bAfter, 3)}</td><td data-label="Temperatura media in inverno">{fmt(x.meanHeatingTemperature, 1)} °C</td></tr>))}</tbody></table></div></details> : null}

      {ev.sizing && ev.sizing.length > 0 && (
        <section className="panel">
          <div className="card-head">
            <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name="domanda" size={28} /> Taglia indicativa</h3>
            <span className="badge warn">stima, non preventivo</span>
          </div>
          <SizingBlock ev={ev} p={p} sens={sens} />
        </section>
      )}

      {withBattery && (
        <section className="panel">
          <div className="card-head">
            <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon name="batteria" size={28} /> La batteria da sola · {withBattery.label}</h3>
          </div>
          <BatteryVerdict r={withBattery} p={p} />
          {!usesMeasuredCurve(p) && <BatteryProfileRange ev={ev} sens={sens} />}
        </section>
      )}

      {quotes.length > 0 && (
        <section className="panel">
          <QuoteComparisons quotes={quotes} horizon={horizon} />
        </section>
      )}

      <div className="dash-grid">
        <section className="panel span-12">
          <div className="card-head">
            <h3>Confronto dei pacchetti</h3>
            <label className="small muted no-print">
              Ordina per{" "}
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="btn small">
                <option value="ordine">ordine standard</option>
                <option value="van">VAN</option>
                <option value="investimento">investimento</option>
                <option value="risparmio">risparmio annuo</option>
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table className="data cards-sm cards-compact">
              <thead>
                <tr>
                  <th>Pacchetto</th>
                  <th>Stato</th>
                  <th>Spesa annua</th>
                  <th>Risparmio annuo</th>
                  <th>Investimento</th>
                  <th>VAN {horizon} anni</th>
                  <th>Rientro</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`${r.valid ? "" : "invalid"} ${detail === r.id ? "selected" : ""}`}>
                    <td data-label="Pacchetto">
                      <button
                        type="button"
                        className="pkg-name"
                        onClick={() => {
                          setDetail(r.id);
                          requestAnimationFrame(() => {
                            detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            detailRef.current?.focus({ preventScroll: true });
                          });
                        }}
                        aria-pressed={detail === r.id}
                        title="Mostra il dettaglio"
                      >
                        <PackageIcons r={r} envelopeShort={envelopeLabel(p).short} plantShort={plantLabel(p).short} />
                        <span>
                          {r.label}
                          {nd.has(r.id) && <span className="small" style={{ display: "block", color: "var(--accent-text)", fontWeight: 500 }}>buon compromesso</span>}
                          {unresolved.has(r.id) && <span className="small" style={{ display: "block", color: "var(--warn-text)", fontWeight: 500 }}>troppo vicino per scegliere</span>}
                          {!r.comparable && <span className="small" style={{ display: "block", color: "var(--warn-text)", fontWeight: 500 }}>da non confrontare con gli altri</span>}
                        </span>
                      </button>
                    </td>
                    <td data-label="Stato">{statusBadge(r)}</td>
                    <td className="num" data-label="Spesa annua">{r.valid ? eur(r.costs.total) : "—"}</td>
                    <td className="num" data-label="Risparmio annuo">{r.id === "base" ? "—" : r.valid ? signedEur(r.annualBenefit) : "—"}</td>
                    <td className="num" data-label="Investimento">
                      {investmentText(r)}
                      {r.hp && p.heatPump.boilerEndOfLife && <div className="small muted">totale {eur(r.investmentTotal)}</div>}
                    </td>
                    <td className="num" data-label={`VAN ${horizon} anni`}>{r.cash ? signedEur(r.cash.npv) : "—"}</td>
                    <td className="num" data-label="Rientro">{r.id === "base" ? "—" : paybackText(r, horizon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            <InfoTip text="Scegli un pacchetto per vedere il dettaglio." label="Come leggere il confronto" method="economia-spesa-annua">Risparmio annuo = spesa evitata + ricavo di cessione − manutenzione aggiuntiva, a prezzi costanti (sostituzioni nel VAN). Buon compromesso: né un altro pacchetto né il “non fare nulla” costano meno rendendo di più. VAN = valore attuale netto.</InfoTip>
          </p>
          <ComparableNote ev={ev} />
          {!usesMeasuredCurve(p) && <ProfileRangeBlock ev={ev} sens={sens} />}
        </section>

        {p.goal === "completo" && <div className="span-12"><PianoNelTempo result={paths} running={pathsRunning} plan={p.plan} /></div>}

        {p.goal !== "tariffa" && <TariffeBlock p={p} climate={climate} ev={ev} detail={det} />}
        {envelopeValue && <section className="panel span-12"><EnvelopeValueTable value={envelopeValue} p={p} /></section>}
        {p.ev.enabled && p.goal !== "auto" && <section className="panel span-12"><EvTable p={p} climate={climate} ev={ev} shown={det} /></section>}
        {ev.packages.some((r) => r.dhw) && <section className="panel span-12"><DhwTable p={p} climate={climate} ev={ev} /></section>}

        <section className="panel span-12">
          <DiagnosisBlock p={p} climate={climate} base={base} folded={p.goal !== "tariffa"} />
          {!electricOnly && (ev.calibration || ev.calibrationNote) && <>
            <div className="card-head">
              <h3>Con i consumi della bolletta</h3>
            </div>
            <BillCalibrationBlock ev={ev} p={p} />
          </>}
        </section>

        {(ev.incentive || ev.incentiveNote) && (
          <section className="panel span-12">
            <div className="card-head">
              <h3>Con un incentivo</h3>
            </div>
            <IncentiveBlock ev={ev} />
          </section>
        )}
        {(ev.homeValue || ev.homeValueNote) && (
          <section className="panel span-12">
            <div className="card-head">
              <h3>Se un giorno vendi: valore della casa</h3>
            </div>
            <HomeValueBlock ev={ev} />
          </section>
        )}

        <section className="panel span-8">
          <div className="card-head">
            <h3>Flusso di cassa cumulato</h3>
            <span className="small muted">al massimo 4 pacchetti</span>
          </div>
          <div className="toolbar no-print" style={{ marginBottom: 6 }}>
            {ev.packages
              .filter((r) => r.id !== "base")
              .map((r) => (
                <label key={r.id} className="check small">
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    disabled={!selected.includes(r.id) && selected.length >= 4}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))}
                  />
                  {r.label}
                </label>
              ))}
          </div>
          <CashFlowChart packages={ev.packages.filter((r) => selected.includes(r.id))} horizon={horizon} />
        </section>

        <section className="panel span-4">
          <div className="card-head">
            <h3>Energia finale oggi</h3>
            <span className="badge accent">{p.location.name || "—"}</span>
          </div>
          <Donut slices={serviceSlices} unit="kWh" centerLabel="MWh/anno" />
          <p className="small muted" style={{ marginTop: 12 }}>
            <InfoTip text="Servizi attuali nell'anno tipico." label="Chi fa che cosa: riscaldamento, acqua calda, cucina">Nei pacchetti con l'impianto, acqua calda e cucina cambiano se scegli lo scaldacqua nuovo e il piano a induzione. La cottura segue la stessa forma oraria degli altri usi elettrici.
            {ev.thermal && (!ev.thermal.base.schedule || p.service.schedule?.withHeatPump === "continuo") && ev.thermal.base.recoveryPeak_W > ev.thermal.base.peak_W * 1.2 && ` Transitorio di ${fmt(ev.thermal.base.recoveryPeak_W / 1000, 1)} kW a inizio stagione: con la pompa di calore è recuperato entro 72 h.`}</InfoTip>
          </p>
        </section>

        <section className="panel span-12">
          <div className="card-head">
            <h3><InfoTip text="Spesa annua per voce" label="Spesa annua per voce" method="economia-spesa-annua">Lo scarto con la bolletta è diagnostico: anno tipico e anno osservato hanno clima e abitudini diverse; non tara il modello.</InfoTip></h3>
          </div>
          <CostBars packages={ev.packages} />
        </section>

        <section className="panel span-12" ref={detailRef} tabIndex={-1}>
          <PackageDetail r={det} base={base} envelopeShort={envelopeLabel(p).short} plantShort={plantLabel(p).short} />
        </section>
      </div>
    </>
  );
}

/** Icone degli interventi contenuti nel pacchetto. */
function PackageIcons({ r, envelopeShort, plantShort }: { r: PackageResult; envelopeShort: string; plantShort: string }) {
  if (r.id === "base")
    return (
      <span className="pkg-dot tone-info">
        <Icon name="casa" size={16} />
      </span>
    );
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {r.has.W && (
        <span className="pkg-dot tone-accent" title={envelopeShort}>
          <Icon name="serramenti" size={15} />
        </span>
      )}
      {r.has.H && (
        <span className="pkg-dot tone-ok" title={plantShort === "PDC" ? "Pompa di calore" : plantShort}>
          <Icon name="pdc" size={15} />
        </span>
      )}
      {r.has.P && !r.battery && (
        <span className="pkg-dot tone-warn" title="Fotovoltaico">
          <Icon name="solare" size={15} />
        </span>
      )}
      {r.battery && (
        <span className="pkg-dot tone-warn" title="Fotovoltaico con batteria">
          <Icon name="fv-batteria" size={15} />
        </span>
      )}
    </span>
  );
}

/**
 * Titolo del riquadro chiuso con i dati tecnici del pacchetto (proposta C della tappa E del piano dopo la 8), o null
 * se il pacchetto non ne ha. I limiti (estrapolazioni, potenza) restano anche fra le condizioni del risultato.
 */
export function technicalTitle(r: PackageResult): string | null {
  const parts = [r.hp && "pompa di calore", (r.cooling || r.coolingNotes.length > 0) && "raffrescamento", r.has.P && "fotovoltaico", r.battery && "batteria"].filter((x): x is string => !!x);
  return parts.length ? `Dati tecnici: ${parts.join(", ").replace(/, ([^,]*)$/, " e $1")}` : null;
}

function PackageDetail({ r, base, envelopeShort, plantShort }: { r: PackageResult; base: PackageResult; envelopeShort: string; plantShort: string }) {
  return (
    <div>
      <div className="card-head">
        <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PackageIcons r={r} envelopeShort={envelopeShort} plantShort={plantShort} /> Dettaglio: {r.label}
        </h3>
        {statusBadge(r)}
      </div>
      {r.blockers.length > 0 && (
        <div className="notice bad">
          <strong>Perché non si può calcolare:</strong>
          <ul className="issues">{r.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {r.conditions.length > 0 && (
        <details className="notice fold">
          <summary>Condizioni di questo risultato ({r.conditions.length})</summary>
          <ul className="issues">{r.conditions.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </details>
      )}
      {r.economicsMissing.length > 0 && (
        <div className="notice">
          <strong>Economia incompleta</strong> (si mostrano consumi e spesa operativa, non VAN né rientro): {r.economicsMissing.join("; ")}.
        </div>
      )}
      <details className="fold">
      <summary>Chi fa che cosa: riscaldamento, acqua calda, cucina</summary>
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead>
            <tr><th>Servizio</th><th>Vettore</th><th>Generatore</th><th>Energia finale</th></tr>
          </thead>
          <tbody>
            {r.services.map((s, i) => (
              <tr key={i}>
                <td data-label="Servizio">{s.service}</td>
                <td data-label="Vettore">{s.carrier}</td>
                <td data-label="Generatore">{s.generator}</td>
                <td className="num" data-label="Energia finale">{fmt(s.final_kWh)} kWh{s.smc !== undefined && <span className="muted"> ({fmt(s.smc)} Smc)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
      {technicalTitle(r) && <details className="fold">
      <summary>{technicalTitle(r)}</summary>
      {r.hp && (
        <p className="small" style={{ marginTop: 6 }}>
          Pompa di calore: SCOP senza ausiliari {fmt(r.hp.seasonalCopNoAux, 2)}, con ausiliari e cicli {fmt(r.hp.seasonalCop, 2)} · ausiliari {fmt(r.hp.elecAux_kWh)} kWh, cicli {fmt(r.hp.elecCycling_kWh)} kWh · ore oltre la potenza {r.hp.hoursUndersized} · ore fuori dalle condizioni provate {r.hp.hoursOutOfDomain}.{" "}
          {r.hp.hoursExtrapolated > 0 ? (
            <InfoTip text={`In ${fmt(r.hp.hoursExtrapolated)} ore la pompa di calore lavora fuori dai dati di prova: consumi e VAN di questo pacchetto sono indicativi.`} label="Limiti della pompa di calore" method="pdc-dominio-capacita">{`In ${fmt(r.hp.hoursExtrapolated)} ore, per ${fmt(r.hp.heatExtrapolated_kWh)} kWh di calore, le condizioni sono fuori dai punti di prova usati per la curva: il programma estende la stima. Consumi e VAN che ne dipendono restano indicativi.`} Controllare la capacità nell'anno tipico del clima non verifica gli estremi invernali e non dimensiona l'impianto.</InfoTip>
          ) : (
            <InfoTip text="La pompa di calore lavora sempre dentro i dati di prova della curva." label="Limiti della pompa di calore" method="pdc-dominio-capacita">In tutte le ore dell'anno tipo le condizioni restano dentro i punti di prova usati per la curva. Controllare la capacità nell'anno tipico del clima non verifica gli estremi invernali e non dimensiona l'impianto.</InfoTip>
          )}
        </p>
      )}
      {r.cooling && (
        <p className="small" style={{ marginTop: 6 }}>
          Raffrescamento: {r.cooling.generator} · fabbisogno {fmt(r.coolNeed_kWh)} kWh frigoriferi · {fmt(r.cooling.elec_kWh)} kWh elettrici
          {Number.isFinite(r.cooling.seasonalEer) && ` · EER stagionale modellato ${fmt(r.cooling.seasonalEer, 1)}`}
          {r.cooling.hoursUndersized > 0 && ` · ${fmt(r.cooling.hoursUndersized)} ore oltre la potenza`}. Solo calore sensibile: l'umidità è nella sensibilità.
        </p>
      )}
      {r.coolingNotes.length > 0 && (
        <p className="small muted" style={{ marginTop: 6 }}>
          {r.coolingNotes.join(" ")}
        </p>
      )}
      {r.has.P && <HelpDiagram kind="fv" />}
      {r.battery && (
        <p className="small" style={{ marginTop: 6 }}>
          Batteria: {fmt(r.battery.capacity_kWh, 1)} kWh utili · {fmt(r.battery.throughput_kWh)} kWh all'anno verso la casa · {fmt(r.battery.cyclesPerYear)} cicli all'anno · VAN della batteria da sola {r.battery.npvBattery === null ? "non calcolabile" : signedEur(r.battery.npvBattery)}.
        </p>
      )}
      </details>}
      <h4>Conti dell'anno, voce per voce</h4>
      <div className="table-wrap">
        <table className="data cards-sm cards-compact">
          <thead>
            <tr><th>Voce</th><th>Situazione attuale</th><th>{r.label}</th></tr>
          </thead>
          <tbody>
            {(
              [
                ["Gas: acquisti", "gasPurchase"],
                ["Gas: quota fissa", "gasFixed"],
                ["Elettricità: acquisti", "elecPurchase"],
                ["Elettricità: quota fissa", "elecFixed"],
                ["Elettricità: quota potenza", "elecPower"],
                ["Totale (prima di cessione e manutenzione)", "total"],
                ["Ricavo di cessione", "exportRevenue"],
                ["Manutenzione aggiuntiva", "maintenanceDelta"],
              ] as const
            ).map(([label, k]) => (
              <tr key={k}>
                <td data-label="Voce">{label}</td>
                <td className="num" data-label="Situazione attuale">{eur(base.costs[k])}</td>
                <td className="num" data-label={r.label}>{r.valid ? eur(r.costs[k]) : "—"}{r.valid && k === "gasFixed" && r.cooking?.gasMeterClosed && " · contatore chiuso"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
