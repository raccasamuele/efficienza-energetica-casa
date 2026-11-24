import { coldWaterC, dhwCost, dhwNeed, dhwNeedFromGas, dhwPriceSource, dhwSolarShare, DHW_PRICE_SCENARIOS, todayBoiler, type ClimatePackage, type DhwInput, type Evaluation, type Q } from "../engine";
import { Advanced, Check, QField, SelectField } from "./fields";
import { CostEditor, type FormProps } from "./forms";
import { eur, fmt } from "./format";

type WaterProps = Pick<FormProps, "p" | "up" | "doc">;

export function DhwTodayFields({ p, up, doc }: WaterProps) {
  const d = p.dhw;
  const set = (key: "todayTankLitres" | "todayPowerKw" | "todayStandbyW" | "gasDhwEfficiency" | "people" | "litresPerPerson") => (value: Q) => up((next) => void (next.dhw[key] = value));
  return <>
    {p.system.acsOnGas ? <Advanced doc={doc}><QField label="Rendimento della caldaia per l'acqua calda" q={d.gasDhwEfficiency} onChange={set("gasDhwEfficiency")} showSource={doc} hint="Serve a ricavare quanta acqua calda usi, se la cambi con uno scaldacqua." /></Advanced> : <>
      <Check label="Acqua calda con un boiler elettrico (è già nei consumi della luce)" checked={d.todayElectric} onChange={(v) => up((next) => void (next.dhw.todayElectric = v))} />
      {d.todayElectric && <Advanced doc={doc}><div className="grid">
        <QField label="Serbatoio del boiler di oggi" q={d.todayTankLitres} onChange={set("todayTankLitres")} showSource={doc} />
        <QField label="Potenza del boiler di oggi" q={d.todayPowerKw} onChange={set("todayPowerKw")} showSource={doc} />
        <QField label="Perdita del boiler di oggi" q={d.todayStandbyW} onChange={set("todayStandbyW")} showSource={doc} hint="Dalla scheda o dall'etichetta energetica: perdita in kWh al giorno × 1000 / 24." />
      </div></Advanced>}
    </>}
    {(todayBoiler(p) || d.replace) && <div className="grid">
      <QField label="Persone in casa" q={d.people} onChange={set("people")} showSource={doc} />
      <QField label="Litri al giorno a persona" q={d.litresPerPerson} onChange={set("litresPerPerson")} showSource={doc} hint="35 poco, 50 medio, 75 molto" />
    </div>}
  </>;
}

export function DhwFields({ p, up, doc, climate }: WaterProps & { climate?: ClimatePackage | null }) {
  const d = p.dhw;
  const set = <K extends keyof DhwInput>(key: K, value: DhwInput[K]) => up((next) => void (next.dhw[key] = value));
  const field = (key: "tankLitres" | "hpThermalKw" | "copRated" | "copRatedAirC" | "minAirC" | "backupKw" | "roomTemp" | "standbyW" | "maintenanceDelta" | "solarAreaM2" | "solarEta0" | "solarA1" | "solarA2" | "solarLoopLossPct" | "solarPumpW", label: string, hint?: string) => <QField ownLabel label={label} q={d[key]} onChange={(q) => set(key, q)} showSource={doc} hint={hint} />;
  const need = climate ? dhwNeed(p, climate) : dhwNeedFromGas(p) === null ? null : { kWh: dhwNeedFromGas(p)!, from: "gas" };
  const source = need?.from === "gas" ? "dal gas di oggi" : `da ${fmt(d.people.value)} persone × ${fmt(d.litresPerPerson.value)} litri`;
  const prices = DHW_PRICE_SCENARIOS[d.newType], solar = d.newType === "solare", gasBackup = solar && d.solarBackup === "gas";
  const planes = (["S", "E", "O"] as const).flatMap((o) => ([35, 20] as const).map((t) => ({ value: `${o}${t}` as DhwInput["solarPlane"], label: `${{ S: "Sud", E: "Est", O: "Ovest" }[o]}, inclinati ${t}°` })));
  return <>
    <Check label="Scaldacqua nuovo" checked={d.replace} onChange={(v) => set("replace", v)} />
    {d.replace && <>
      <p className="small">{solar ? <>I pannelli scaldano il serbatoio col sole fino a 80 °C. Quando il sole non basta, {gasBackup ? "la caldaia di oggi" : "la resistenza"} tiene l'acqua a 45 °C. Anche con il fotovoltaico la resistenza non scalda col sole in più: in quelle ore scaldano già i pannelli.</> : "Con il fotovoltaico lo scaldacqua scalda di giorno nelle ore con energia in più, fino a 60 °C, e la sera solo se l'acqua scende sotto 45 °C. Senza fotovoltaico scalda quando serve, fino a 55 °C."}</p>
      <div className="grid">
        <SelectField label="Tipo di scaldacqua" value={d.newType} options={[{ value: "pdc", label: "A pompa di calore" }, { value: "elettrico", label: "Boiler elettrico" }, { value: "solare", label: "Solare termico" }]} onChange={(v) => set("newType", v)} />
        {field("tankLitres", "Serbatoio nuovo", solar ? "Per il solare di solito 50–75 litri per m² di pannelli." : undefined)}
        {solar && <>
          {field("solarAreaM2", "Superficie dei pannelli", "Sulla scheda: la stessa area (lorda o di apertura) dei coefficienti qui sotto.")}
          <SelectField label="Pannelli rivolti a" value={d.solarPlane} options={planes} onChange={(v) => set("solarPlane", v)} />
          <SelectField label="Quando il sole non basta" value={d.solarBackup} options={[{ value: "elettrico", label: "Resistenza elettrica nel serbatoio" }, ...(p.system.acsOnGas || d.solarBackup === "gas" ? [{ value: "gas" as const, label: "Caldaia a gas di oggi" }] : [])]} onChange={(v) => set("solarBackup", v)} />
        </>}
        {d.newType === "pdc" && <>
          {field("hpThermalKw", "Potenza termica dello scaldacqua")}
          {field("copRated", "COP della scheda (EN 16147)")}
          {field("copRatedAirC", "Aria della prova", "Sulla scheda: COP a 7 °C se prende l'aria fuori, a 15 o 20 °C se la prende da un locale.")}
          <SelectField label="Prende l'aria" value={d.airSource} options={[{ value: "esterno", label: "Dall'esterno" }, { value: "locale", label: "Da un locale non riscaldato" }]} onChange={(v) => set("airSource", v)} />
        </>}
        {!gasBackup && field("backupKw", "Resistenza elettrica")}
      </div>
      <Advanced doc={doc}><div className="grid">
        {d.newType === "pdc" && field("minAirC", "Aria minima per la PDC dello scaldacqua")}
        {solar && <>
          {field("solarEta0", "Rendimento ottico η0", "Dalla scheda Solar Keymark (ISO 9806).")}
          {field("solarA1", "Coefficiente di perdita a1")}{field("solarA2", "Coefficiente di perdita a2")}
          {field("solarLoopLossPct", "Perdite di tubi e scambiatore")}{field("solarPumpW", "Pompa del circuito solare")}
        </>}
        {field("roomTemp", "Temperatura del locale")}{field("standbyW", "Perdita del serbatoio")}
      </div></Advanced>
      <p className="small">Acqua calda all'anno: {fmt(need?.kWh)} kWh utili ({source})</p>
      <SelectField label="Costo" value={d.costMode} options={[{ value: "stima", label: "Stima (scenario, non preventivo)" }, { value: "preventivo", label: "Preventivo" }]} onChange={(v) => set("costMode", v)} />
      {d.costMode === "stima" ? <>
        <QField ownLabel label={solar ? "Prezzo del solare termico (stima)" : "Prezzo dello scaldacqua (stima)"} q={d.price} onChange={(q) => set("price", q)} showSource={doc} presets={(["basso", "centrale", "alto"] as const).map((s) => ({ label: `Scenario ${s}`, value: prices[s], source: dhwPriceSource(d.newType) }))} />
        <p className="small">≈ {eur(dhwCost(p).total)} (scenario, non preventivo).</p>
      </> : <Advanced doc={doc} summary="Preventivo scaldacqua"><CostEditor title="Costi scaldacqua" kind="dhw" path="dhw.cost" block={d.cost} doc={doc} onChange={(v) => set("cost", v)} /></Advanced>}
      {field("maintenanceDelta", "Manutenzione dello scaldacqua")}
    </>}
  </>;
}

export function DhwTable({ p, climate, ev }: { p: FormProps["p"]; climate: ClimatePackage; ev: Evaluation }) {
  // situazione attuale (con il boiler di oggi) e pacchetti con lo scaldacqua nuovo: gli altri ripetono il boiler di oggi
  const rows = ev.packages.filter((r) => r.dhw && (r.id === "base" || r.dhw.generator !== "Boiler elettrico di oggi"));
  if (!rows.length) return null;
  const ref = rows.find((r) => r.has.H && p.dhw.replace) ?? rows[0];
  const water = ref.dhw!, solarCols = rows.some((r) => r.dhw!.result.solar_kWh > 0);
  return <>
    <h3>Acqua calda</h3>
    <div className="table-wrap"><table className="data cards-sm">
      <thead><tr><th>Generatore</th><th>Elettricità</th><th>COP medio</th><th>Dal fotovoltaico</th>{solarCols && <><th>Dal sole (pannelli)</th><th>Gas d'integrazione</th></>}<th>Ore sotto 40 °C</th></tr></thead>
      <tbody>{rows.map((r) => {
        const dhw = r.dhw!, share = dhwSolarShare(p, climate, r);
        return <tr key={r.id}><td data-label="Generatore"><strong>{r.label}</strong><div className="small">{dhw.generator.replace(/^Scaldacqua a pompa di calore \((.*)\)$/, "$1")}</div></td><td className="num" data-label="Elettricità">{fmt(dhw.result.elec_kWh)} kWh/anno</td><td className="num" data-label="COP medio">{dhw.result.cop > 0 ? fmt(dhw.result.cop, 2) : "—"}</td><td className="num" data-label="Dal fotovoltaico">{share === null ? "—" : `${fmt(share, 1)}%`}</td>{solarCols && <><td className="num" data-label="Dal sole (pannelli)">{dhw.result.solar_kWh > 0 ? `${fmt(dhw.result.solar_kWh)} kWh (${fmt(dhw.result.solar_kWh / (dhw.result.solar_kWh + dhw.result.heat_kWh) * 100)}%)` : "—"}</td><td className="num" data-label="Gas d'integrazione">{dhw.result.backupGas_kWh > 0 ? `${fmt(r.services.find((s) => s.service === "ACS" && s.carrier === "gas")?.smc, 0)} Smc` : "—"}</td></>}<td className="num" data-label="Ore sotto 40 °C">{fmt(dhw.result.unmetHours)}</td></tr>;
      })}</tbody>
    </table></div>
    <p className="small">Acqua calda all'anno {fmt(water.need_kWh)} kWh utili, {water.from === "gas" ? "dal gas di oggi" : `da ${fmt(p.dhw.people.value)} persone × ${fmt(p.dhw.litresPerPerson.value)} litri`}. Acqua fredda a {fmt(coldWaterC(climate), 1)} °C (media dell'anno), prelievi a mattina, pranzo e sera.</p>
    <p className="small muted">Acqua fredda alla temperatura media annua dell'aria del luogo, tutto l'anno; prelievi con un profilo giornaliero semplificato (mattina, pranzo, sera), uguale tutti i giorni. Serbatoio a una sola temperatura (niente stratificazione); COP dalla scheda (EN 16147) riportato alle altre temperature con il rapporto di Carnot; perdite del serbatoio contate a parte (leggermente prudente, perché il COP di scheda le comprende già in parte). Con l'aria presa da un locale, il locale è a temperatura fissa: non si conta il freddo che lo scaldacqua porta in casa. La pompa di calore per il riscaldamento non fa l'acqua calda: lo scaldacqua è un apparecchio a parte.{solarCols && " Solare termico: sole sui pannelli stimato dall'irraggiamento orizzontale del luogo (diretta e diffusa con la correlazione di Erbs, cielo isotropo), curva del pannello di scheda senza correzione per l'angolo del sole, perdite di tubi e scambiatore in percentuale fissa, niente ombre né neve; l'integrazione tiene il serbatoio a 45 °C; oltre 80 °C l'impianto si ferma. Niente ciclo antilegionella."}</p>
  </>;
}
