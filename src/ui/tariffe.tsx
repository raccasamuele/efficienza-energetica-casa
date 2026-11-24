import type { ClimatePackage, Evaluation, PackageResult, ProjectInput, Q, TariffCompareInput } from "../engine";
import { Foldable } from "./fold";
import { comparePower, compareTariffs, usesMeasuredCurve } from "../engine";
import { eur, fmt } from "./format";
import { InfoTip } from "./info-tip";
import { QField, TextField } from "./fields";
import { useResultDetail } from "./dettagli";

interface TariffField {
  group: keyof TariffCompareInput;
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  get: (tariff: TariffCompareInput) => Q;
  set: (tariff: TariffCompareInput, value: Q) => void;
}

const TARIFF_FIELDS: TariffField[] = [
  { group: "monoraria", key: "prezzo", label: "Prezzo dell'energia, monoraria", unit: "€/kWh", min: 0, max: 1, get: (t) => t.monoraria.prezzo, set: (t, q) => { t.monoraria.prezzo = q; } },
  { group: "monoraria", key: "fissa", label: "Quota fissa monoraria", unit: "\u20ac/anno", min: 0, max: 500, get: (t) => t.monoraria.fissa, set: (t, q) => { t.monoraria.fissa = q; } },
  { group: "bioraria", key: "f1", label: "Energia F1 (bioraria)", unit: "€/kWh", min: 0, max: 1, get: (t) => t.bioraria.f1, set: (t, q) => { t.bioraria.f1 = q; } },
  { group: "bioraria", key: "f23", label: "Energia F2 e F3 (bioraria)", unit: "€/kWh", min: 0, max: 1, get: (t) => t.bioraria.f23, set: (t, q) => { t.bioraria.f23 = q; } },
  { group: "bioraria", key: "fissa", label: "Quota fissa bioraria", unit: "\u20ac/anno", min: 0, max: 500, get: (t) => t.bioraria.fissa, set: (t, q) => { t.bioraria.fissa = q; } },
  { group: "indicizzata", key: "punF1", label: "PUN F1", unit: "€/kWh", min: 0, max: 1, get: (t) => t.indicizzata.punF1, set: (t, q) => { t.indicizzata.punF1 = q; } },
  { group: "indicizzata", key: "punF2", label: "PUN F2", unit: "€/kWh", min: 0, max: 1, get: (t) => t.indicizzata.punF2, set: (t, q) => { t.indicizzata.punF2 = q; } },
  { group: "indicizzata", key: "punF3", label: "PUN F3", unit: "€/kWh", min: 0, max: 1, get: (t) => t.indicizzata.punF3, set: (t, q) => { t.indicizzata.punF3 = q; } },
  { group: "indicizzata", key: "spread", label: "Spread del fornitore", unit: "€/kWh", min: -0.05, max: 0.2, get: (t) => t.indicizzata.spread, set: (t, q) => { t.indicizzata.spread = q; } },
  { group: "indicizzata", key: "fissa", label: "Quota fissa indicizzata", unit: "\u20ac/anno", min: 0, max: 500, get: (t) => t.indicizzata.fissa, set: (t, q) => { t.indicizzata.fissa = q; } },
];

export function TariffFields({
  p,
  up,
  doc,
}: {
  p: ProjectInput;
  up: (fn: (draft: ProjectInput) => void) => void;
  doc: boolean;
}) {
  const tariff = p.tariffCompare;
  if (!tariff) return null;

  return (
    <>
      <QField
        label="Oneri di rete e imposte per kWh"
        unit="€/kWh"
        min={0}
        max={0.5}
        q={tariff.oneriKwh}
        onChange={(value) => up((draft) => {
          if (draft.tariffCompare) draft.tariffCompare.oneriKwh = value;
        })}
        showSource={doc}
      />
      <p className="small">
        <InfoTip
          label="Dove trovo le fasce?"
          method="tariffe-luce"
          text="Copia i prezzi dalla bolletta o dalle offerte: non scarichiamo prezzi."
        >
          Gli oneri di rete e le imposte per kWh si trovano nel quadro di dettaglio della bolletta: «spesa per il trasporto e la gestione del contatore», «oneri di sistema», accise e IVA. Sono uguali per tutte le strutture. La quota fissa e la quota potenza restano a parte. I prezzi dell’energia restano costanti per tutto l’anno; il PUN è piatto dentro ogni fascia.
        </InfoTip>
      </p>
      <div className="grid">
        {TARIFF_FIELDS.map((field) => (
          <QField
            key={field.group + field.key}
            label={field.label}
            unit={field.unit}
            min={field.min}
            max={field.max}
            q={field.get(tariff)}
            onChange={(value) => up((draft) => {
              if (draft.tariffCompare) field.set(draft.tariffCompare, value);
            })}
            showSource={doc}
          />
        ))}
        <TextField
          label="Potenze da confrontare (kW)"
          value={tariff.potenze.join(", ")}
          onChange={(value) => up((draft) => {
            if (!draft.tariffCompare) return;
            const powers = value.split(",")
              .map((part) => Number(part.trim().replace(",", ".")))
              .filter((power) => Number.isFinite(power) && power > 0);
            if (powers.length) draft.tariffCompare.potenze = powers;
          })}
        />
      </div>
    </>
  );
}

function summaryText(
  comparison: ReturnType<typeof compareTariffs>,
  measured: boolean,
): string {
  if (comparison.nonDistinguibili.length > 0 && comparison.menoCara) {
    const first = comparison.righe.find((row) => row.id === comparison.menoCara)!;
    const second = comparison.righe.find((row) => row.id === comparison.nonDistinguibili[0])!;
    return "Le tariffe " + first.label.toLocaleLowerCase("it") + " e " + second.label.toLocaleLowerCase("it") + " non sono distinguibili con questi dati.";
  }
  if (!comparison.menoCara) {
    return "Inserisci i prezzi della tua offerta per confrontare le strutture.";
  }
  const winner = comparison.righe.find((row) => row.id === comparison.menoCara)!;
  // «Curva» solo con la curva del contatore: senza, i consumi seguono un profilo tipico.
  return (measured ? "Con la curva del tuo contatore" : "Con questi consumi") + " costa meno la tariffa " + winner.label.toLocaleLowerCase("it") + ": " + eur(winner.totale!) + " all'anno.";
}

export function TariffeBlock({
  p,
  climate,
  ev,
  report = false,
  detail,
}: {
  p: ProjectInput;
  climate: ClimatePackage;
  ev: Evaluation;
  report?: boolean;
  detail?: PackageResult;
}) {
  const base = ev.packages.find((result) => result.id === "base");
  const selected = detail
    ?? ev.packages.find((result) => result.id === "HP")
    ?? ev.packages[ev.packages.length - 1];
  const withIntervention = p.goal !== "tariffa" && selected?.id !== "base";
  const enabled = !!base && !!p.tariffCompare;
  // Dal worker quando la pagina lo fornisce (nessun blocco all'arrivo dei Risultati), altrimenti calcolato qui.
  const computed = useResultDetail(
    (d) => enabled ? { comparison: d.tariffs.base!, selectedComparison: withIntervention && selected ? d.tariffs[selected.id] ?? null : null, powerRows: d.power! } : null,
    () => enabled ? {
      comparison: compareTariffs(p, climate, base!),
      selectedComparison: withIntervention && selected ? compareTariffs(p, climate, selected) : null,
      powerRows: comparePower(p, climate, base!),
    } : null,
    [p, climate, ev, selected, withIntervention, enabled],
  );
  if (!base || !p.tariffCompare) return null;
  if (computed === undefined) {
    return p.goal === "tariffa"
      ? <section className={report ? "section" : "panel span-12"}><h3>Tariffe della luce</h3><p role="status">Sto calcolando il confronto delle tariffe…</p></section>
      : null;
  }
  if (!computed) return null;
  const { comparison, selectedComparison, powerRows } = computed;
  const completeRows = comparison.righe.filter((row) => row.stato === "ok");
  if (p.goal !== "tariffa" && completeRows.length < 2) return null;
  const sectionClass = report ? "section" : "panel span-12";
  // il ricavo dell'energia ceduta c'è con il FV di oggi o con quello del pacchetto mostrato
  const hasExport = p.existingPv.present || (withIntervention && !!selected?.has.P);

  // Fuori dalla domanda sulle tariffe è un approfondimento: chiuso sotto il titolo (nel Report sempre aperto).
  const folded = !report && p.goal !== "tariffa";

  return (
    <section className={sectionClass}>
      <Foldable folded={folded} title="Tariffe della luce">
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead>
            <tr>
              <th>Struttura</th>
              <th>Energia e oneri</th>
              <th>Quota fissa</th>
              <th>{withIntervention ? "Totale oggi" : "Totale"}</th>
              {withIntervention && <th>Totale con {selected.label}</th>}
              <th>Prezzo medio</th>
            </tr>
          </thead>
          <tbody>
            {comparison.righe.map((row) => {
              const selectedTotal = selectedComparison?.righe.find((item) => item.id === row.id)?.totale;
              return (
                <tr key={row.id}>
                  <td data-label="Struttura">{row.label}</td>
                  {row.stato === "ok" ? (
                    <>
                      <td data-label="Energia e oneri">{eur(row.spesaEnergia!)}</td>
                      <td data-label="Quota fissa">{eur(row.fissa!)}</td>
                      <td data-label={withIntervention ? "Totale oggi" : "Totale"}>{eur(row.totale!)}</td>
                      {withIntervention && <td data-label={`Totale con ${selected.label}`}>{selectedTotal === undefined ? "—" : eur(selectedTotal)}</td>}
                      <td data-label="Prezzo medio">{fmt(row.prezzoMedio!, 3)} €/kWh</td>
                    </>
                  ) : (
                    <td data-label="Prezzi" colSpan={withIntervention ? 5 : 4}>Prezzi mancanti: inserisci i prezzi della tua offerta.</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>{summaryText(comparison, usesMeasuredCurve(p))}</p>
      {comparison.perProfilo && new Set(comparison.perProfilo.map((item) => item.menoCara)).size > 1 && (
        <p>Dipende da quando consumi: con la curva del contatore il confronto diventa specifico.</p>
      )}
      <p>
        Energia per fascia: {(["F1", "F2", "F3"] as const).map((band) =>
          band + " " + fmt(comparison.kWhPerFascia[band]) + " kWh ("
          + fmt(comparison.kWhPerFascia[band] / (base.elec.import_kWh || 1) * 100) + "%)",
        ).join(" \u00b7 ")}.
      </p>
      <div className="table-wrap">
        <table className="data cards-sm">
          <thead>
            <tr><th>Potenza</th><th>Costo annuo della potenza</th><th>Ore oltre la potenza</th></tr>
          </thead>
          <tbody>
            {powerRows.map((row) => (
              <tr key={row.kW}>
                <td data-label="Potenza">{fmt(row.kW, 1)} kW{row.attuale ? " (oggi)" : ""}</td>
                <td data-label="Costo annuo della potenza">{eur(row.costoAnnuo)}</td>
                <td data-label="Ore oltre la potenza">{row.oreOltre}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Le medie orarie non vedono i picchi di pochi minuti (forno e lavatrice insieme): non scendere sotto la potenza di oggi solo per questo numero.</p>
      {hasExport && !report && (
        <p>Il ricavo dell’energia ceduta non cambia con la tariffa: è fuori da questo confronto.</p>
      )}
      {report ? (
        <p>
          Prezzi costanti per tutto l’anno; PUN piatto dentro ogni fascia; oneri e imposte compresi nei prezzi inseriti; picchi sotto l’ora non visibili; nessun prezzo scaricato o offerta reale.
          {hasExport && " Il ricavo dell'energia ceduta non cambia con la tariffa: è fuori da questo confronto."}
        </p>
      ) : (
        <p className="small muted">
          <InfoTip label="Limiti del confronto" text="Limiti del confronto">
            Prezzi costanti per tutto l’anno. Il PUN è piatto dentro ogni fascia. Oneri e imposte sono compresi nei prezzi inseriti. I picchi sotto l’ora non sono visibili. Non scarichiamo prezzi e non confrontiamo offerte reali.
          </InfoTip>
        </p>
      )}
      </Foldable>
    </section>
  );
}
