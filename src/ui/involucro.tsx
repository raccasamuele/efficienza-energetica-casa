import { activeInsulation, envelopeCost, insulatedU, insulationApplies, insulationCurrentU, insulationName, insulationPriceType, INSULATION_KINDS, INSULATION_PRICE_SCENARIOS, INSULATION_PRICE_SOURCE, type EnvelopeBreakdown, type InsulationKind, type InsulationMeasure, type ProjectInput, type Q } from "../engine";
import { Advanced, Check, QField, SelectField, type Preset } from "./fields";
import { CostEditor, type FormProps } from "./forms";
import { eur, fmt } from "./format";
import * as P from "./presets";

export function InsulationFields({ p, up, doc }: Pick<FormProps, "p" | "up" | "doc">) {
  return <>{INSULATION_KINDS.filter((kind) => insulationApplies(p, kind)).map((kind) => {
    const m = p.envelope[kind], name = insulationName(p, kind).long;
    const label = kind === "walls" ? "Cappotto (isolamento delle pareti esterne)" : kind === "roof" ? p.building.upper === "sottotetto" ? "Isolamento del sottotetto (solaio verso il sottotetto)" : "Isolamento del tetto" : p.building.lower === "esterno" ? "Isolamento del solaio verso l'esterno (portico, pilotis)" : "Isolamento del solaio verso locali non riscaldati";
    const set = <K extends keyof InsulationMeasure>(key: K, value: InsulationMeasure[K]) => up((d) => void (d.envelope[kind][key] = value));
    const field = (key: "thicknessCm" | "lambda" | "uFinal" | "sharePct" | "bridgeDeltaU" | "pricePerM2", label: string, unit: string, hint?: string, presets?: Preset[]) =>
      <QField ownLabel label={label} unit={unit} q={m[key]} onChange={(q: Q) => set(key, q)} showSource={doc} hint={hint} presets={presets} />;
    const prices = INSULATION_PRICE_SCENARIOS[insulationPriceType(p, kind)];
    const cost = envelopeCost(p, kind);
    return <div className="section" key={kind}>
      <Check label={label} checked={m.enabled} onChange={(v) => set("enabled", v)} />
      {m.enabled && <>
        <SelectField label="Come lo descrivi" value={m.method} options={[{ value: "spessore", label: "Spessore e conduttività dell'isolante" }, { value: "uFinale", label: "U finale dalla scheda o dal progetto" }]} onChange={(v) => set("method", v)} />
        <div className="grid">
          {m.method === "spessore" ? <>{field("thicknessCm", "Spessore dell'isolante", "cm")}{field("lambda", "Conduttività dell'isolante (λ)", "W/mK", undefined, P.INSULATION_LAMBDA)}</> : field("uFinal", "U dopo il lavoro", "W/m²K")}
        </div>
        <p className="small">U da {fmt(insulationCurrentU(p, kind), 2)} a {fmt(insulatedU(insulationCurrentU(p, kind), m), 2)} W/m²K su {fmt(cost.area_m2)} m²</p>
        <Advanced doc={doc}>
          {field("sharePct", "Parte della superficie isolata", "%")}
          <SelectField label="Ponti termici dopo il lavoro" value={m.bridges} options={[{ value: "comeOggi", label: `Come oggi (ΔU ${fmt(p.building.thermalBridgeDeltaU.value, 2)})` }, { value: "valore", label: "Valore dichiarato" }]} onChange={(v) => set("bridges", v)} hint="Un cappotto ben posato di solito li riduce: scrivilo solo se lo dice il progetto o il preventivo." />
          {m.bridges === "valore" && field("bridgeDeltaU", "ΔU dei ponti termici dopo il lavoro", "W/m²K")}
        </Advanced>
        <SelectField label="Costo" value={m.costMode} options={[{ value: "stima", label: "Stima per m² (scenario, non preventivo)" }, { value: "preventivo", label: "Preventivo" }]} onChange={(v) => set("costMode", v)} />
        {m.costMode === "stima" ? <>
          {field("pricePerM2", "Prezzo per m² (stima)", "€/m²", "Chiavi in mano con IVA: ipotesi di scenario, non un prezzo medio verificato né un preventivo. La sensibilità prova anche lo scenario basso e quello alto.", (["basso", "centrale", "alto"] as const).map((scenario) => ({ label: `Scenario ${scenario}`, value: prices[scenario], source: INSULATION_PRICE_SOURCE })))}
          <p className="small">≈ {eur(cost.total)} per {fmt(cost.area_m2)} m²</p>
        </> : <Advanced doc={doc} summary={`Preventivo ${name.toLocaleLowerCase("it")}`}><CostEditor kind={kind} path={`envelope.${kind}.cost`} title={`Costi ${name}`} block={m.cost} onChange={(b) => set("cost", b)} doc={doc} /></Advanced>}
      </>}
    </div>;
  })}</>;
}

export function envelopeDescription(p: ProjectInput): string {
  const kinds = activeInsulation(p);
  if (!kinds.length && p.envelope.windows) return "solo serramenti";
  if (!kinds.length) return "nessun lavoro (involucro vuoto)";
  return [...(p.envelope.windows ? ["serramenti"] : []), ...kinds.map((kind) => {
    const m = p.envelope[kind], now = insulationCurrentU(p, kind);
    const work = m.method === "spessore" ? `${fmt(m.thicknessCm.value)} cm λ ${fmt(m.lambda.value, 3)}` : `U finale ${fmt(m.uFinal.value, 2)}`;
    return `${insulationName(p, kind).short.toLocaleLowerCase("it")} ${work} su ${fmt(envelopeCost(p, kind).area_m2)} m² (U da ${fmt(now, 2)} a ${fmt(insulatedU(now, m), 2)}), ponti ${m.bridges === "comeOggi" ? "come oggi" : `ΔU ${fmt(m.bridgeDeltaU.value, 2)}`}`;
  })].join("; ");
}

export function EnvelopeValueTable({ value, p }: { value: EnvelopeBreakdown; p: ProjectInput }) {
  const rows = [...value.parts, { ...value.together, id: "together", label: "Tutto insieme" }];
  const estimated = (id: string) => id === "together" ? activeInsulation(p).some((kind) => p.envelope[kind].costMode === "stima") : id !== "windows" && p.envelope[id as InsulationKind].costMode === "stima";
  return <>
    <h3>Quanto vale ogni lavoro sull'involucro</h3>
    <div className="table-wrap">
      <table className="data cards-sm">
        <thead><tr><th>Lavoro</th><th>Fabbisogno risparmiato</th><th>Gas risparmiato</th><th>Euro l'anno</th><th>Costo</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}>
          <td data-label="Lavoro">{r.label}</td><td className="num" data-label="Fabbisogno risparmiato">{fmt(r.heatSaved_kWh)} kWh ({fmt(r.heatSavedPct, 1)}%)</td><td className="num" data-label="Gas risparmiato">{fmt(r.gasSaved_smc)} Smc</td><td className="num" data-label="Euro l'anno">{r.eurSaved === null ? "—" : eur(r.eurSaved)}</td><td className="num" data-label="Costo">{eur(r.cost)}{!r.costComplete ? " · da chiarire" : estimated(r.id) ? " · stima" : ""}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {/* con il riscaldamento continuo le dispersioni evitate si sommano: l'insieme vale meno solo dove sole e apporti interni bastano già */}
    <p className="small">{value.together.heatSaved_kWh - value.sumOfParts_kWh > 0.02 * value.sumOfParts_kWh
      ? `Insieme risparmiano ${fmt(value.together.heatSaved_kWh)} kWh, un po' più della somma dei lavori da soli (${fmt(value.sumOfParts_kWh)} kWh): le parti della casa scambiano calore fra loro.`
      : value.sumOfParts_kWh - value.together.heatSaved_kWh < 0.02 * value.sumOfParts_kWh
      ? `Insieme risparmiano ${fmt(value.together.heatSaved_kWh)} kWh, quasi quanto la somma dei lavori da soli (${fmt(value.sumOfParts_kWh)} kWh).`
      : `Insieme risparmiano ${fmt(value.together.heatSaved_kWh)} kWh, ${fmt(value.sumOfParts_kWh - value.together.heatSaved_kWh)} kWh in meno della somma dei lavori da soli: con meno dispersioni sole e apporti interni coprono una parte più grande del fabbisogno che resta.`}</p>
    <p className="small muted">Confronto prima della taratura sulla bolletta, con la caldaia: con la pompa di calore gli euro sono diversi.</p>
  </>;
}
