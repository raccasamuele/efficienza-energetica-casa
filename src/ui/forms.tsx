import { plainClimateText } from "./testi-clima";
import { Icon, type IconName } from "./icons";
import { EvFields } from "./auto";
import { DhwTodayFields } from "./acqua";
import { useContext, useRef, useState, type ReactNode } from "react";
import { HelpDiagram, HouseDiagram } from "./illustrations";
import { GuidedChoice, QuickEnvelope, QuickSystemSummer } from "./quick";
import { fieldId } from "./metadata";
import { documentQuote, journey, setChoice } from "./journey";
import {
  PROFILE_LABELS,
  ARERA_PROFILE_SOURCE,
  absentChecklist,
  curveAnnualKwh,
  curveFromFiles,
  exportFromFiles,
  usesMeasuredCurve,
  applyLocation,
  computeGeometry,
  THERMAL_JUNCTIONS,
  estimatedJunctionLengths,
  bridgePsi,
  SHELTER_CLASSES,
  matchClimate,
  suggestClimate,
  REGISTRY_LABEL,
  type ClimateIndexEntry,
  type Comune,
  type ClimatePackage,
  type CostBlock,
  type CostStatus,
  type Issue,
  type Orientation,
  type ProjectInput,
  type Q,
  type UnheatedSpaceInput,
  type ChecklistKind,
} from "../engine";
import { Advanced, Check, FormContext, NumberInput, QField, SelectField, TextField } from "./fields";
import { BillReader } from "./bill";
import { fmt } from "./format";
import * as P from "./presets";
import { Brief, InfoTip, type MetodoId } from "./info-tip";
import { ExistingPvFields } from "./battery";
import { TariffFields } from "./tariffe";
import { defaultHeatingSchedule } from "../engine/thermal";
import type { HeatingSchedule } from "../engine/types";

function UnheatedFields({ title, data, onChange, b, setB, doc }: { title: string; data: UnheatedSpaceInput; onChange: (v: UnheatedSpaceInput) => void; b: Q; setB: (v: Q) => void; doc: boolean }) {
  const qset = (key: "areaOut" | "uOut" | "volume" | "airChange") => (v: Q) => onChange({ ...data, [key]: v });
  return <>
    <SelectField label={`Bilancio di ${title.toLocaleLowerCase("it")}`} value={data.mode} options={[{ value: "fattoreB", label: "Fattore b (attuale)" }, { value: "locale", label: "Dati del locale" }]} onChange={(v) => onChange({ ...data, mode: v as UnheatedSpaceInput["mode"] })} />
    {data.mode === "fattoreB" ? <QField label={`Fattore b ${title.toLocaleLowerCase("it")}`} q={b} onChange={setB} showSource={doc} hint="Riduce lo scambio verso l'esterno: 0 = come un locale riscaldato, 1 = come l'esterno." /> : doc && <div className="grid">
      <QField label="Superficie verso l'esterno" unit="m²" q={data.areaOut} onChange={qset("areaOut")} showSource={doc} />
      <QField label="U media verso l'esterno" unit="W/m²K" q={data.uOut} onChange={qset("uOut")} showSource={doc} />
      <QField label="Volume del locale" unit="m³" q={data.volume} onChange={qset("volume")} showSource={doc} />
      <QField label="Ricambi d'aria" unit="1/h" q={data.airChange} onChange={qset("airChange")} showSource={doc} />
    </div>}
  </>;
}

export interface FormProps {
  p: ProjectInput;
  up: (fn: (d: ProjectInput) => void) => void;
  doc: boolean;
  issues: Issue[];
}

export { IssueList } from "./issues";
import { electricOnlyGoal } from "./goals";
import { IssueList } from "./issues";

export function Sec({ title, children, intro, icon, method }: { title: string; intro?: ReactNode; children: ReactNode; icon?: IconName; method?: MetodoId }) {
  return (
    <div className="section">
      <h3>
        {icon && (
          <span className="section-icon" aria-hidden="true">
            <Icon name={icon} size={24} />
          </span>
        )}
        {title}
      </h3>
      {intro && <p className="section-intro small muted"><Brief label={title} method={method}>{intro}</Brief></p>}
      {children}
    </div>
  );
}

const ORS: Orientation[] = ["N", "E", "S", "O"];

function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function LocationForm({
  p,
  up,
  doc,
  issues,
  climate,
  index,
  comuni,
  comuniError,
  setProject,
}: FormProps & {
  climate: ClimatePackage | null;
  index: ClimateIndexEntry[] | null;
  comuni: Comune[] | null;
  comuniError: string | null;
  setProject: (p: ProjectInput) => void;
}) {
  const context = useContext(FormContext);
  const [query, setQuery] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const m = climate?.manifest;
  const nq = normName(query);
  const all =
    comuni && nq.length >= 2
      ? comuni
          .filter((c) => normName(c.name).includes(nq))
          .sort((a, b) => Number(!normName(a.name).startsWith(nq)) - Number(!normName(b.name).startsWith(nq)) || a.name.localeCompare(b.name, "it"))
      : [];
  const results = all.slice(0, 8);
  const loc = p.location;
  const matches = index && loc.code ? matchClimate(loc, index).slice(0, 6) : [];
  const current = matches.find((x) => x.entry.id === p.climateId) ?? (index && loc.code ? matchClimate(loc, index).find((x) => x.entry.id === p.climateId) : undefined);
  const pick = (c: Comune) => {
    if (context.guard?.() === false) return;
    if (!index || index.length === 0) {
      setPickError("Elenco dei climi non disponibile: riprova tra un istante o ricarica la pagina.");
      return;
    }
    const s = suggestClimate(c, index);
    if (!s) {
      setPickError(`Nessun clima disponibile per ${c.name}.`);
      return;
    }
    setPickError(null);
    setProject(applyLocation(p, c, s));
    setQuery("");
  };
  const focusItem = (i: number) => {
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>("button.pick");
    if (items && items.length) items[Math.max(0, Math.min(items.length - 1, i))].focus();
  };
  const status =
    comuniError ??
    (!comuni
      ? "Caricamento dell'elenco dei comuni…"
      : nq.length === 1
        ? "Scrivi almeno 2 lettere."
        : nq.length >= 2
          ? all.length === 0
            ? "Nessun comune trovato."
            : all.length > results.length
              ? `${all.length} comuni trovati: ne mostro ${results.length}, scrivi qualche lettera in più.`
              : `${all.length} ${all.length === 1 ? "comune trovato" : "comuni trovati"}.`
          : "");
  return (
    <>
      <Sec icon="localita" title="Comune" intro={`Scegli il comune della casa. Anagrafe ${REGISTRY_LABEL}. Zona, gradi giorno e quota comunale provengono dal DPR 412/1993 o da abbinamenti indicativi indicati nella fonte; il clima orario è quello del capoluogo scelto.`}>
        <div className="field">
          <label htmlFor={fieldId("location")}>Cerca il comune</label>
          <input
            id={fieldId("location")}
            type="search"
            autoComplete="off"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="comuni-trovati"
            aria-describedby="cerca-comune-stato"
            placeholder={comuni ? "es. Moncalieri" : "Caricamento dell'elenco dei comuni…"}
            value={query}
            disabled={!comuni || comuni.length === 0}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && results.length) {
                e.preventDefault();
                focusItem(0);
              } else if (e.key === "Enter" && results.length) {
                e.preventDefault();
                pick(results[0]);
              }
            }}
          />
          <span id="cerca-comune-stato" className={`hint ${comuniError ? "field-error" : ""}`} role="status" aria-live="polite">
            {status}
          </span>
        </div>
        {results.length > 0 && (
          <ul className="pick-list" id="comuni-trovati" aria-label="Comuni trovati" ref={listRef}>
            {results.map((c, i) => (
              <li key={c.code}>
                <button
                  type="button"
                  className="pick"
                  disabled={!index}
                  onClick={() => pick(c)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      focusItem(i + 1);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (i === 0) document.getElementById(fieldId("location"))?.focus();
                      else focusItem(i - 1);
                    } else if (e.key === "Escape") {
                      setQuery("");
                      document.getElementById(fieldId("location"))?.focus();
                    }
                  }}
                >
                  <strong>{c.name}</strong> <span className="muted">({c.sigla})</span>
                  <span className="small muted">
                    zona {c.zone} · {fmt(c.gg)} gradi giorno · {fmt(c.alt)} m{c.fonte === "vicino" ? " · dati del comune vicino" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {pickError && (
          <div className="notice bad" role="alert">
            {pickError}
          </div>
        )}
        {loc.code && (
          <div className="cards" style={{ marginTop: 10 }}>
            <div className="card"><div className="k"><InfoTip text="Comune" label="Fonte del comune">{loc.fonte}</InfoTip></div><div className="v">{loc.name} ({loc.sigla})</div></div>
            <div className="card"><div className="k">Zona climatica</div><div className="v">{loc.zone}</div><div className="small muted">{fmt(loc.gg)} gradi giorno</div></div>
            <div className="card"><div className="k"><InfoTip text="Quota di riferimento comunale" label="Quota comunale e quota della casa">Casa comunale o donatore indicato nella fonte; non è la quota della casa.</InfoTip></div><div className="v">{fmt(loc.alt)} m</div></div>
          </div>
        )}
        {loc.code && <p className="small">{loc.fonte.includes("conflitto") ? "Attenzione: i dati climatici di legge di questo comune sono discordanti e richiedono una verifica dell'atto locale." : loc.fonte.includes("vicino") || loc.fonte.includes("approssimato") ? "I dati sono ricavati da un abbinamento o da un altro comune: non sono una verifica della tua località." : "Abbinamento con la tabella comunale; non verifica tutti gli atti successivi."}</p>}
        <QField path="location.siteAltitude" min={-500} max={9000} label="Quota della casa" unit="m s.l.m." q={loc.siteAltitude ?? { value: loc.alt, status: "sconosciuto" }} showSource={doc} onChange={(q) => up((d) => void (d.location.siteAltitude = q))} hint="Se manca si usa la quota comunale o del donatore come ipotesi. La quota del clima PVGIS resta distinta." />
        {doc && <Advanced doc={false} summary="Dati locali documentati">
          <Check label="Usa un atto o un dato locale al posto di zona, GG e quota comunale" checked={!!loc.localOverride} onChange={(v) => up((d) => { if (v) d.location.localOverride = { zone: loc.zone, gg: loc.gg, alt: loc.alt, source: "" }; else delete d.location.localOverride; })} />
          {loc.localOverride && <div className="grid">
            <SelectField label="Zona locale" value={loc.localOverride.zone} options={["A", "B", "C", "D", "E", "F"].map((value) => ({ value, label: value }))} onChange={(v) => up((d) => { d.location.localOverride!.zone = v as typeof loc.zone; })} />
            <div className="field"><span>Gradi giorno locali</span><NumberInput ariaLabel="Gradi giorno locali" min={0} max={10000} integer value={loc.localOverride.gg} onChange={(v) => up((d) => { d.location.localOverride!.gg = v; })} /></div>
            <div className="field"><span>Quota comunale locale (m)</span><NumberInput ariaLabel="Quota comunale locale in metri" min={-500} max={9000} value={loc.localOverride.alt} onChange={(v) => up((d) => { d.location.localOverride!.alt = v; })} /></div>
            <TextField label="Fonte locale (atto, data e porzione di territorio)" value={loc.localOverride.source} onChange={(v) => up((d) => { d.location.localOverride!.source = v; })} />
          </div>}
          <p className="small muted"><Brief label="Dettagli e limiti">{"La fonte originale resta conservata. Autenticità e applicabilità dell'atto devono essere verificate dall'esperto; controllare anche le date della stagione."}</Brief></p>
        </Advanced>}
      </Sec>
      <Sec icon="clima" title="Clima usato" intro="Un anno tipico del clima (dati PVGIS) per capoluogo: condizioni rappresentative, non la previsione del prossimo inverno né gli estremi di progetto.">
        {matches.length > 0 && (
          <SelectField
            label="Capoluogo di riferimento per il clima"
            value={p.climateId}
            options={[
              ...(current && !matches.includes(current) ? [current] : []),
              ...matches,
            ].map((x) => ({
              value: x.entry.id,
              label: `${x.entry.name} (${x.entry.sigla}) — ${fmt(x.distanceKm)} km, dislivello ${x.altitudeDiffM > 0 ? "+" : ""}${fmt(x.altitudeDiffM)} m, zona ${x.entry.zone}${x.good ? "" : " · indicativo"}`,
            }))}
            onChange={(v) => up((d) => void (d.climateId = v))}
            hint="Proposto il capoluogo più vicino della stessa zona. Oltre 40 km, 250 m di dislivello o con zona diversa il caso resta indicativo."
          />
        )}
        {m && (
          <section className="climate-card" aria-label="Dati del clima">
            <div className="climate-card-head"><h4>{m.name}</h4><InfoTip label="Fonti e metodo del clima">Coordinate: lat {m.latitude}, lon {m.longitude}. PVGIS {m.apiVersion}, {m.radiationDatabase} / {m.meteoDatabase}. {plainClimateText(m.attribution)}</InfoTip></div>
            <dl><div><dt>Quota del clima</dt><dd>{m.elevation_m} m s.l.m.</dd></div><div><dt>Anno tipico</dt><dd>PVGIS · {m.sourceWindow[0]}–{m.sourceWindow[1]}</dd></div><div><dt>Acquisito</dt><dd>{m.acquiredAt.slice(0, 10)}</dd></div></dl>
            {m.temperatureCorrection && <p className="small">Le temperature dell'anno tipico del clima sono riportate mese per mese alla media osservata 2015-2024 (dati di <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>, CC BY 4.0). Scarto medio annuo per {m.name}: {new Intl.NumberFormat("it-IT", { signDisplay: "always", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(m.temperatureCorrection.monthlyOffset_C.reduce((a, b, i) => a + b * [31,28,31,30,31,30,31,31,30,31,30,31][i], 0) / 365)} °C.</p>}
          </section>
        )}
        <IssueList issues={issues} sections={["Località"]} />
      </Sec>
      <Sec icon="verifica" title="La tua casa è fra quelle che il programma sa calcolare?" method="modello-zona-termica" intro="Queste risposte non vengono simulate in questa versione: servono a riconoscere i casi fuori dal confronto documentato.">
        <div className="grid">
          {p.service.schedule?.mode === "fasce" ? <p className="small">Riscaldamento a fasce orarie: orari e potenza si indicano nel passo Impianto.</p> : <Check label="Riscaldamento continuo nella stagione (setpoint costante, senza lunghi spegnimenti)" checked={p.service.continuousService} onChange={(v) => up((d) => void (d.service.continuousService = v))} />}
          <Check label="Zone a temperature diverse o casa scaldata solo in parte" checked={p.service.multiZoneOrPartial} onChange={(v) => up((d) => void (d.service.multiZoneOrPartial = v))} />

        </div>
        <p className="small muted">Non calcolabili in questa versione: appartamenti e impianti centralizzati, grandi serre o verande, forte stratificazione, ombre mobili determinanti.</p>
        <IssueList issues={issues} sections={["Servizio"]} />
      </Sec>
      <Sec icon="nome" title="Nome del caso">
        <div className="grid">
          <TextField label="Nome" value={p.name} onChange={(v) => up((d) => void (d.name = v))} />
        </div>
      </Sec>
    </>
  );
}

export function BuildingForm({ p, up, doc, issues }: FormProps) {
  const b = p.building;
  const g = computeGeometry(b);
  const set = (k: keyof ProjectInput["building"]) => (q: Q) => up((d) => void ((d.building[k] as Q) = q));
  return (
    <>
      <IssueList issues={issues} errorsOnly sections={["Edificio"]} />
      {!doc && <QuickEnvelope p={p} up={up} />}
      <Sec icon="geometria" title="Geometria" method="geometria-superfici" intro="In modalità forma le aree si stimano da forma in pianta, superficie, piani e altezza: restano «ipotizzate» finché non inserisci aree nette da rilievo.">
        <HelpDiagram kind="superficie" />
        <div className="grid">
          <SelectField
            label="Come descrivi la geometria"
            value={b.geometryMode}
            options={[
              { value: "forma", label: "Forma in pianta (stima rapida)" },
              { value: "aree", label: "Aree nette da rilievo o progetto" },
            ]}
            onChange={(v) => up((d) => void (d.building.geometryMode = v))}
          />
          {b.geometryMode === "forma" && (
            <GuidedChoice p={p} up={up} path="shape"
              label="Forma in pianta"
              value={b.shape}
              options={[
                { value: "quadrata", label: "Quadrata" },
                { value: "rettangolare", label: "Rettangolare (2:1)" },
                { value: "L", label: "A L" },
                { value: "ferroCavallo", label: "A ferro di cavallo" },
              ]}
              set={(d, v) => void (d.building.shape = v)}
            />
          )}
          <QField label="Superficie utile riscaldata" unit="m²" q={b.floorArea} onChange={set("floorArea")} showSource={doc} />
          <QField label="Numero di piani riscaldati" q={b.floors} onChange={set("floors")} showSource={doc} />
          <QField label="Altezza netta dei locali" unit="m" q={b.netStoreyHeight} onChange={set("netStoreyHeight")} showSource={doc} />
        </div>
        {b.geometryMode === "forma" && <HelpDiagram kind="forme" />}
        {b.geometryMode === "forma" && (
          <Advanced doc={doc}>
            <div className="grid">
              <QField label="Spessore solaio (da altezza netta a lorda)" unit="m" q={b.slabThickness} onChange={set("slabThickness")} showSource={doc} />
            </div>
            <p className="small muted"><Brief label="Dettagli e limiti">{"Ipotesi della forma: tetto e pavimento pari alla superficie utile divisa per i piani (sottostima leggera); con «confinante» si assume adiacente il 25% (un lato) o il 50% (due lati) delle pareti."}</Brief></p>
          </Advanced>
        )}
        {b.geometryMode === "aree" && (
          <>
            <p className="small muted">Aree nette opache: escludono già le finestre. Non sommare le finestre a una parete lorda.</p>
            <HelpDiagram kind="parete" />
            <div className="grid">
              {ORS.map((o) => (
                <QField key={o} label={`Parete esterna netta ${o}`} unit="m²" q={b.wallArea[o]} onChange={(q) => up((d) => void (d.building.wallArea[o] = q))} showSource={doc} />
              ))}
              <QField label="Area confine superiore" unit="m²" q={b.upperArea} onChange={set("upperArea")} showSource={doc} />
              <QField label="Area confine inferiore" unit="m²" q={b.lowerArea} onChange={set("lowerArea")} showSource={doc} />
              {b.sides !== "isolato" && <QField label="Area pareti confinanti" unit="m²" q={b.adjacentWallArea} onChange={set("adjacentWallArea")} showSource={doc} />}
            </div>
          </>
        )}
        <div className="cards" style={{ marginTop: 10 }}>
          <div className="card"><div className="k">Volume netto</div><div className="v">{fmt(g.volume)} m³</div></div>
          <div className="card"><div className="k">Pareti esterne opache</div><div className="v">{fmt(ORS.reduce((s, o) => s + g.externalWall[o], 0))} m²</div></div>
          <div className="card"><div className="k">Finestre</div><div className="v">{fmt(ORS.reduce((s, o) => s + g.windows[o], 0), 1)} m²</div></div>
          {g.derived && <div className="card"><div className="k">Perimetro impronta</div><div className="v">{fmt(g.perimeter, 1)} m</div></div>}
        </div>
      </Sec>

      <Sec icon="confini" title="Confini" method="confini-non-riscaldati" intro="Ogni scelta diventa un tipo di confine del modello con la sua ipotesi visibile. Lo scambio con un'unità riscaldata allo stesso setpoint è nullo.">
        <div className="split">
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <GuidedChoice p={p} up={up} path="upper"
            label="Sopra"
            value={b.upper}
            options={[
              { value: "riscaldato", label: "Altra unità riscaldata" },
              { value: "sottotetto", label: "Sottotetto non riscaldato" },
              { value: "coperturaInclinata", label: "Copertura inclinata verso l'esterno" },
              { value: "coperturaPiana", label: "Copertura piana verso l'esterno" },
            ]}
            set={(d, v) => void (d.building.upper = v)}
          />
          <GuidedChoice p={p} up={up} path="lower"
            label="Sotto"
            value={b.lower}
            options={[
              { value: "riscaldato", label: "Altra unità riscaldata" },
              { value: "nonRiscaldato", label: "Locale non riscaldato (box, cantina)" },
              { value: "terreno", label: "Terreno" },
              { value: "esterno", label: "Esterno (porticato, pilotis)" },
            ]}
            set={(d, v) => void (d.building.lower = v)}
          />
          <GuidedChoice p={p} up={up} path="sides"
            label="Ai lati"
            value={b.sides}
            options={[
              { value: "isolato", label: "Edificio isolato" },
              { value: "unLato", label: "Confinante su un lato" },
              { value: "dueLati", label: "Confinante su due lati" },
            ]}
            set={(d, v) => void (d.building.sides = v)}
          />
          {b.sides !== "isolato" && (
            <SelectField
              label="Le unità confinanti sono"
              value={b.sideAdjacency}
              options={[
                { value: "riscaldato", label: "Riscaldate allo stesso setpoint" },
                { value: "nonRiscaldato", label: "Non riscaldate" },
                { value: "nonNoto", label: "Non so" },
              ]}
              onChange={(v) => up((d) => void (d.building.sideAdjacency = v))}
            />
          )}
        </div>
        <HouseDiagram b={b} />
        </div>
        {b.lower === "terreno" && <Advanced doc={doc}><QField label="Perimetro esposto del pavimento" unit="m" q={b.exposedPerimeter} onChange={set("exposedPerimeter")} showSource={doc} hint="Lunghezza del bordo del pavimento esposto verso l'esterno, senza riduzioni ulteriori per i vicini. Se non noto si usa la forma o il quadrato equivalente: resta un'ipotesi in sensibilità ±20%." /></Advanced>}
        <Advanced doc={doc} summary="Fattori dei confini (ipotizzati, in sensibilità)">
          <div className="grid">
            {b.upper === "sottotetto" && <UnheatedFields title="Sottotetto" data={b.unheatedUpper} onChange={(v) => up((d) => void (d.building.unheatedUpper = v))} b={b.bUpperUnheated} setB={set("bUpperUnheated")} doc={doc} />}
            {b.upper === "sottotetto" && <QField label="Tetto del sottotetto (quanto lo scalda il sole)" q={b.atticRoofShare} onChange={set("atticRoofShare")} presets={P.ATTIC_ROOF} showSource={doc} hint="Con il tetto non isolato il sole scalda di più il sottotetto: 0,8 non isolato, 0,3 isolato." />}
            {b.lower === "nonRiscaldato" && <UnheatedFields title="Locale inferiore" data={b.unheatedLower} onChange={(v) => up((d) => void (d.building.unheatedLower = v))} b={b.bLowerUnheated} setB={set("bLowerUnheated")} doc={doc} />}
            {b.lower === "terreno" && (
              <QField
                label="Correzione al calcolo del terreno"
                q={b.groundFactor}
                onChange={set("groundFactor")}
                showSource={doc}
            hint="Semplificazione stazionaria ispirata a UNI EN ISO 13370:2018, dalla U, area e perimetro: 1 = nessuna correzione. Parte periodica trascurata; conformità alle appendici D e NA:2025 non verificata."
              />
            )}
            {b.sides !== "isolato" && b.sideAdjacency !== "riscaldato" && <UnheatedFields title="Adiacenze laterali" data={b.unheatedSide} onChange={(v) => up((d) => void (d.building.unheatedSide = v))} b={b.bSideUnheated} setB={set("bSideUnheated")} doc={doc} />}
            {b.upper === "riscaldato" && b.lower === "riscaldato" && (b.sides === "isolato" || b.sideAdjacency === "riscaldato") && <p className="small muted">Nessun fattore da impostare per questi confini.</p>}
          </div>
        </Advanced>
      </Sec>

      <Sec icon="pareti" title="Involucro">
        <Advanced doc={doc}>
        <div className="grid">
          <QField label="U pareti esterne" unit="W/m²K" q={b.uWall} onChange={set("uWall")} presets={P.U_WALL} showSource={doc} />
          <QField label={b.upper === "sottotetto" ? "U soffitto verso sottotetto" : "U copertura"} unit="W/m²K" q={b.uUpper} onChange={set("uUpper")} presets={b.upper === "sottotetto" ? P.U_CEILING : P.U_ROOF} showSource={doc} />
          <QField label="U pavimento" unit="W/m²K" q={b.uLower} onChange={set("uLower")} presets={P.U_FLOOR} showSource={doc} />
          {b.infiltration.mode === "tenuta"
            ? <QField label="Tenuta all'aria n50 (prova di tenuta)" unit="1/h" q={b.infiltration.n50} onChange={(v) => up((d) => void (d.building.infiltration.n50 = v))} showSource={doc} hint="Ricambi orari a 50 Pa misurati con la prova di tenuta all'aria (blower door). Senza questo dato si usa il ricambio costante." />
            : <QField label="Ricambi d'aria (ventilazione e infiltrazioni)" unit="volumi/h" q={b.airChange} onChange={set("airChange")} presets={P.AIR_CHANGE} showSource={doc} />}
        </div>
        <Advanced doc={doc}>
          <div className="grid">
            <SelectField label="Modello dei ponti termici" value={b.thermalBridges.mode} options={[{value:"deltaU",label:"Maggiorazione ΔU"},{value:"lineari",label:"Ponti lineari ψ·L"}]} onChange={(v)=>up(d=>void(d.building.thermalBridges.mode=v as "deltaU"|"lineari"))} />
            {b.thermalBridges.mode === "deltaU" ? <QField label="Ponti termici: maggiorazione ΔU sulle superfici opache" unit="W/m²K" q={b.thermalBridgeDeltaU} onChange={set("thermalBridgeDeltaU")} showSource={doc} /> : <div className="grid">
              <SelectField label="Posizione dell'isolante nelle pareti" value={b.thermalBridges.wallInsulation} options={[{value:"esterno",label:"Esterno"},{value:"interno",label:"Interno"},{value:"intercapedine",label:"Intercapedine"}]} onChange={(v)=>up(d=>void(d.building.thermalBridges.wallInsulation=v as typeof b.thermalBridges.wallInsulation))} />
              <SelectField label="Struttura" value={b.thermalBridges.frame} options={[{value:"telaio",label:"Telaio in cemento armato"},{value:"muratura",label:"Muratura portante"}]} onChange={(v)=>up(d=>void(d.building.thermalBridges.frame=v as typeof b.thermalBridges.frame))} />
              <p className="small muted">Valori ψ di riferimento, Regione Lombardia. Lunghezza vuota: stima dalla geometria.</p>
              {THERMAL_JUNCTIONS.map(id=>{const j=b.thermalBridges.junctions[id],estimate=estimatedJunctionLengths(b)[id],psi=j.psi.status==="sconosciuto"?bridgePsi(b,p.location,id):j.psi.value,length=j.length.status==="sconosciuto"?estimate:j.length.value;return <div key={id}><strong>{{pilastro:"Pilastro",solaioInterpiano:"Solaio interpiano",balcone:"Balcone",angolo:"Angolo",copertura:"Copertura",davanzale:"Davanzale",spalla:"Spalla",architrave:"Architrave",cassonetto:"Cassonetto"}[id]}</strong><QField label={`ψ (tabella ${fmt(bridgePsi(b,p.location,id),2)})`} unit="W/mK" q={j.psi} onChange={v=>up(d=>void(d.building.thermalBridges.junctions[id].psi=v))} showSource={doc} allowUnknown /><QField label={`L (stima ${fmt(estimate,1)} m)`} unit="m" q={j.length} onChange={v=>up(d=>void(d.building.thermalBridges.junctions[id].length=v))} showSource={doc} allowUnknown /><div className="small muted">ψ·L: {fmt(psi*length,2)} W/K</div></div>})}
            </div>}
            <SelectField label="Ricambio d'aria" value={b.infiltration.mode} options={[{ value: "costante", label: "Costante" }, { value: "tenuta", label: "Dalla tenuta all'aria, con vento e tiraggio" }]} onChange={(v) => up((d) => void (d.building.infiltration.mode = v as "costante" | "tenuta"))} hint="Con la tenuta all'aria misurata le infiltrazioni cambiano ora per ora: crescono con il vento e con il freddo (modello ASHRAE di Sherman e Grimsrud)." />
            {b.infiltration.mode === "tenuta" && <>
              <SelectField label="Riparo dal vento" value={String(b.infiltration.shelterClass)} options={SHELTER_CLASSES.map((c) => ({ value: String(c.value), label: c.label }))} onChange={(v) => up((d) => void (d.building.infiltration.shelterClass = Number(v)))} />
              <QField label="Ricambio minimo per l'aria pulita" unit="volumi/h" q={b.infiltration.minAirChange} onChange={(v) => up((d) => void (d.building.infiltration.minAirChange = v))} showSource={doc} hint="Quanto chi abita arieggia comunque aprendo le finestre: le infiltrazioni contano solo quando lo superano." />
            </>}
            <QField label="Capacità termica per m² di pavimento" unit="kJ/m²K" q={b.heatCapacityPerArea} onChange={set("heatCapacityPerArea")} presets={P.HEAT_CAPACITY} showSource={doc} hint="Inerzia della casa: muri pesanti in laterizio o pietra = valori alti." />
          </div>
        </Advanced>
        </Advanced>
      </Sec>

      <Sec icon="serramenti" title="Serramenti attuali" method="finestre-trasmissione" intro="Le ipotesi sul vetro e sul telaio sono modificabili. In Documentata usa la scheda dell'intero serramento.">
        <Advanced doc={doc}>
        <div className="grid">
          <SelectField
            label="Come descrivi le finestre"
            value={b.windowMode}
            options={[
              { value: "frazione", label: "Rapporto sulla superficie (stima rapida)" },
              { value: "aree", label: "Aree per orientamento" },
            ]}
            onChange={(v) => up((d) => void (d.building.windowMode = v))}
          />
          {b.windowMode === "frazione" ? (
            <QField label="Area finestrata / superficie del pavimento" q={b.windowFraction} onChange={set("windowFraction")} presets={P.WINDOW_FRACTION} showSource={doc} hint="Ripartita in parti uguali su N/E/S/O." />
          ) : (
            ORS.map((o) => <QField key={o} label={`Finestre ${o}`} unit="m²" q={b.windowArea[o]} onChange={(q) => up((d) => void (d.building.windowArea[o] = q))} showSource={doc} />)
          )}
          <QField label="Uw serramento attuale" unit="W/m²K" q={b.uWindow} onChange={set("uWindow")} presets={P.U_WINDOW} showSource={doc} />
          <QField label="Fattore di ombreggiamento" q={b.shadingFactor} onChange={set("shadingFactor")} presets={P.SHADING} showSource={doc} hint="1 = nessuna ostruzione. Fattore medio: non sostituisce la verifica delle ombre sul tetto per il FV." />
          <QField label="Colore di pareti e tetto (assorbimento del sole)" q={b.solarAbsorptance} onChange={set("solarAbsorptance")} presets={P.ABSORPTANCE} showSource={doc} hint="Quanto sole scaldano pareti e tetto: 0,3 chiaro, 0,6 medio, 0,9 scuro." />
        </div>
        <Advanced doc={doc}>
          <div className="grid">
            <QField label="g del vetro attuale (fattore solare)" q={b.gWindow} onChange={set("gWindow")} presets={P.G_WINDOW} showSource={doc} hint="Frazione dell'energia solare che entra: 0,75 = 75%." />
            <QField label="Frazione di telaio" q={b.frameFraction} onChange={set("frameFraction")} showSource={doc} hint="0,25 = il telaio occupa il 25% del foro finestra." />
          </div>
        </Advanced>
        </Advanced>
      </Sec>
      <IssueList issues={issues} errorsAbove sections={["Edificio"]} />
    </>
  );
}

export function SystemForm({ p, up, doc, issues }: FormProps) {
  const s = p.system;
  const sv = p.service;
  const schedule = sv.schedule;
  const heatingUnanswered = !schedule && journey(p)?.origin === "casa" && !journey(p)?.choices.heating;
  const setSchedule = (change: Partial<HeatingSchedule>) => up((d) => { d.service.schedule = { ...(d.service.schedule ?? defaultHeatingSchedule()), ...change }; });
  const setS = (k: keyof ProjectInput["system"]) => (q: Q) => up((d) => void ((d.system[k] as Q) = q));
  return (
    <>
      <IssueList issues={issues} errorsOnly sections={["Servizio", "Impianto", "Acqua calda"]} />
      <Sec icon="temperatura" title="Servizio termico" method="termostato-stagioni" intro="Indica la temperatura abituale e quando accendi il riscaldamento nella stagione.">
        <div className="grid">
          <QField label="Temperatura abituale in casa" unit="°C" q={sv.setpoint} onChange={(q) => up((d) => void (d.service.setpoint = q))} showSource={doc} hint="Temperatura impostata sul termostato; «non so» usa l'ipotesi visibile." />
          <DateField label="Inizio stagione" v={sv.seasonStart} onChange={(v) => up((d) => void (d.service.seasonStart = v))} />
          <DateField label="Fine stagione" v={sv.seasonEnd} onChange={(v) => up((d) => void (d.service.seasonEnd = v))} />
        </div>
        {/* Nella tua casa la domanda non ha una risposta già scelta: sposta il fabbisogno del 20-30% (LOG-5). Nell'esempio resta «sempre acceso». */}
        <SelectField<"" | HeatingSchedule["mode"]> label="Come scaldi oggi?" method="riscaldamento-fasce-orarie" hint="A fasce orarie: una o due fasce uguali tutti i giorni; fuori fascia spento o a temperatura ridotta, con la potenza della caldaia limitata." value={heatingUnanswered ? "" : schedule?.mode ?? "continuo"} options={[...(heatingUnanswered ? [{ value: "" as const, label: "Scegli…" }] : []), { value: "continuo", label: "Sempre acceso alla stessa temperatura" }, { value: "fasce", label: "A fasce orarie" }]} onChange={(mode) => { if (mode) up((d) => { setChoice(d, "heating", mode); d.service.schedule = { ...(d.service.schedule ?? defaultHeatingSchedule()), mode }; }); }} />
        {heatingUnanswered && <p className="small muted">Finché non scegli, il calcolo considera il riscaldamento sempre acceso. Se accendi solo in alcune ore, il consumo calcolato scende di molto.</p>}
        {schedule?.mode === "fasce" && <>
          <p className="small muted">Gli stessi orari valgono tutti i giorni, anche nei fine settimana.</p>
          {schedule.bands.map((band, i) => <div className="grid" key={i}>
            <SelectField label={`Fascia ${i + 1}: inizio`} value={String(band.start)} options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }))} onChange={(v) => setSchedule({ bands: schedule.bands.map((b, j) => j === i ? { ...b, start: Number(v) } : b) })} />
            <SelectField label={`Fascia ${i + 1}: fine`} value={String(band.end)} options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour + 1), label: `${String(hour + 1).padStart(2, "0")}:00` }))} onChange={(v) => setSchedule({ bands: schedule.bands.map((b, j) => j === i ? { ...b, end: Number(v) } : b) })} />
            {schedule.bands.length > 1 && <button type="button" onClick={() => setSchedule({ bands: schedule.bands.filter((_, j) => j !== i) })}>Togli fascia {i + 1}</button>}
          </div>)}
          {schedule.bands.length < 2 && <button type="button" onClick={() => {
            const current = schedule.bands[0];
            const band = current.start >= 9 ? { start: 6, end: 9 } : current.end <= 17 ? { start: 17, end: 23 }
              : current.start > 0 ? { start: 0, end: current.start } : current.end < 24 ? { start: current.end, end: 24 } : null;
            if (band) setSchedule({ bands: [...schedule.bands, band].sort((a, b) => a.start - b.start) });
          }} disabled={schedule.bands[0].start === 0 && schedule.bands[0].end === 24}>Aggiungi una fascia</button>}
          <div className="grid">
            <SelectField label="Fuori fascia" value={schedule.setback} options={[{ value: "spento", label: "Spento" }, { value: "ridotta", label: "Temperatura ridotta" }]} onChange={(setback) => setSchedule({ setback })} />
            {schedule.setback === "ridotta" && <QField label="Temperatura ridotta" unit="°C" q={schedule.setbackTemp} min={5} max={sv.setpoint.value} showSource={doc} onChange={(setbackTemp) => setSchedule({ setbackTemp })} />}
            <div>
              <Check label="Potenza della caldaia verso la casa: non lo so" checked={schedule.maxPowerKw.status === "sconosciuto"} onChange={(unknown) => setSchedule({ maxPowerKw: { ...schedule.maxPowerKw, status: unknown ? "sconosciuto" : "ipotizzato", confirmed: false } })} />
              {schedule.maxPowerKw.status === "sconosciuto" ? <p className="small muted">Si stima dal picco della casa in continuo con un margine di 1,5. La potenza per l'acqua calda può essere diversa.</p> : <QField label="Potenza della caldaia verso la casa" unit="kW" q={schedule.maxPowerKw} min={2} max={100} allowUnknown={false} showSource={doc} onChange={(maxPowerKw) => setSchedule({ maxPowerKw })} hint="Potenza termica disponibile per scaldare gli ambienti. La potenza per l'acqua calda può essere diversa." />}
            </div>
            <SelectField label="Con la pompa di calore" value={schedule.withHeatPump} options={[{ value: "continuo", label: "Sempre accesa (consigliato)" }, { value: "come-oggi", label: "Stesse fasce di oggi" }]} onChange={(withHeatPump) => setSchedule({ withHeatPump })} />
          </div>
          {schedule.withHeatPump === "continuo" && <p className="small muted">Con la pompa di calore la casa resta più calda nelle ore oggi spente.</p>}
        </>}
        <Advanced doc={doc}>
          <div className="grid">
            <QField
              label="Apporti interni medi (persone, apparecchi)"
              unit="W/m²"
              q={sv.internalGains}
              onChange={(q) => up((d) => void (d.service.internalGains = q))}
              presets={[{ label: "UNI/TS 11300-1", value: P.internalGainsUNI(p.building.floorArea.value), source: P.INTERNAL_GAINS_SOURCE }]}
              showSource={doc}
            />
          </div>
        </Advanced>
      </Sec>
      <Sec icon="calore" title="Generatore attuale (gas)">
        {!doc && <SelectField label="Che caldaia hai?" value={journey(p)?.choices.boiler ?? "nonso"} options={[...P.BOILER_EFF.map((x) => ({ value: String(x.value), label: x.label })), { value: "nonso", label: "Non lo so, usa l'ipotesi visibile" }]} onChange={(v) => up((d) => { setChoice(d, "boiler", v); if (v !== "nonso" && ["ipotizzato", "sconosciuto"].includes(d.system.boilerEfficiency.status)) d.system.boilerEfficiency = { value: Number(v), status: "ipotizzato", source: "Ipotesi guidata sul rendimento della caldaia, da verificare con un tecnico" }; })} hint="Il tipo non misura il rendimento. La mandata resta un'ipotesi da verificare: non si ricava dalla parola radiatori." />}
        <HelpDiagram kind="mandata" />
        <Advanced doc={doc}>
        <div className="grid">
          <QField label="Rendimento stagionale" q={s.boilerEfficiency} onChange={setS("boilerEfficiency")} presets={P.BOILER_EFF} showSource={doc} hint="0,88 = 88%, sulla base PCI o PCS indicata." />
          <QField label="Temperatura di mandata di progetto" unit="°C" q={s.designFlowTemp} onChange={setS("designFlowTemp")} showSource={doc} hint="Da documentazione o rilievo: la parola «radiatori» non basta." />
        </div>
        <Advanced doc={doc}>
        <div className="grid">
          <SelectField
            label="Il rendimento è riferito a"
            value={s.efficiencyBasis}
            options={[
              { value: "PCI", label: "Potere calorifico inferiore (PCI)" },
              { value: "PCS", label: "Potere calorifico superiore (PCS)" },
            ]}
            onChange={(v) => up((d) => void (d.system.efficiencyBasis = v))}
            hint="Rendimento e potere calorifico devono stare sulla stessa base."
          />
          <QField label="PCS del gas" unit="kWh/Smc" q={s.gasPcs} onChange={setS("gasPcs")} showSource={doc} />
          <QField label="PCI del gas" unit="kWh/Smc" q={s.gasPci} onChange={setS("gasPci")} showSource={doc} />
          <QField label="Temperatura esterna di progetto" unit="°C" q={s.designOutdoorTemp} onChange={setS("designOutdoorTemp")} showSource={doc} hint="Punto della curva climatica in cui la mandata vale quella di progetto." />
        </div>
        </Advanced>
        </Advanced>
      </Sec>
      <SummerSection p={p} up={up} doc={doc} />
      <Sec icon="acqua" title="Acqua calda e cucina">
        <div className="grid">
          <Check label="Acqua calda sanitaria a gas" checked={s.acsOnGas} onChange={(v) => up((d) => void (d.system.acsOnGas = v))} />
          {s.acsOnGas && <Advanced doc={doc}><QField label="Gas per acqua calda sanitaria" unit="Smc/anno" q={s.acsGasSmc} onChange={setS("acsGasSmc")} showSource={doc} /></Advanced>}
          <Check label="Cucina a gas" checked={s.cookingOnGas} onChange={(v) => up((d) => void (d.system.cookingOnGas = v))} />
          {s.cookingOnGas && <Advanced doc={doc}><QField label="Gas per cucina" unit="Smc/anno" q={s.cookingGasSmc} onChange={setS("cookingGasSmc")} showSource={doc} /></Advanced>}
        </div>
        <DhwTodayFields p={p} up={up} doc={doc} />
      </Sec>
      <IssueList issues={issues} errorsAbove sections={["Servizio", "Impianto", "Acqua calda"]} />
    </>
  );
}

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Raffrescamento estivo: conta nei conti solo se la casa è raffrescata oggi. */
function SummerSection({ p, up, doc }: Pick<FormProps, "p" | "up" | "doc">) {
  const c = p.cooling;
  const setC = (k: "setpoint" | "maxDelta" | "splitEer35" | "splitCapacity" | "summerShading" | "latentFactor") => (q: Q) => up((d) => void (d.cooling[k] = q));
  const cools = c.today === "split";
  return (
    <Sec icon="fresco" title="Raffrescamento estivo" method="termostato-stagioni" intro="In casa 26 °C, ma mai più della differenza massima sotto l'aria esterna. Il raffrescamento entra nei conti solo se la casa è raffrescata oggi; altrimenti il fabbisogno estivo resta un'informazione.">
      {doc ? (
        <div className="grid">
          <SelectField label="Oggi la casa è raffrescata?" value={c.today} options={[{ value: "nessuno", label: "No" }, { value: "split", label: "Sì, con split" }]} onChange={(v) => up((d) => void (d.cooling.today = v))} />
          <SelectField
            label="Terminali dell'impianto"
            value={p.system.emitters}
            options={[{ value: "radiatori", label: "Radiatori" }, { value: "ventilconvettori", label: "Ventilconvettori" }, { value: "radiante", label: "Pavimento o soffitto radiante" }, { value: "nonNoto", label: "Non noti" }]}
            onChange={(v) => up((d) => void (d.system.emitters = v))}
            hint="La pompa di calore raffresca solo con ventilconvettori (acqua a 7 °C) o pannelli radianti (18 °C)."
          />
        </div>
      ) : (
        <QuickSystemSummer p={p} up={up} />
      )}
      <Advanced doc={doc}>
        <div className="grid">
          {cools && <QField label="EER degli split a 35 °C" q={c.splitEer35} onChange={setC("splitEer35")} showSource={doc} hint="Dalla scheda o dall'etichetta energetica dello split." />}
          {cools && <QField label="Potenza degli split" unit="kW" q={c.splitCapacity} onChange={setC("splitCapacity")} showSource={doc} hint="Somma delle potenze frigorifere nominali." />}
          <QField label="Temperatura estiva in casa" unit="°C" q={c.setpoint} onChange={setC("setpoint")} showSource={doc} />
          <QField label="Differenza massima con l'esterno" unit="K" q={c.maxDelta} onChange={setC("maxDelta")} showSource={doc} hint="Con 38 °C fuori e 10 K la casa sta a 28 °C." />
          <DateField label="Inizio raffrescamento" v={c.seasonStart} onChange={(v) => up((d) => void (d.cooling.seasonStart = v))} />
          <DateField label="Fine raffrescamento" v={c.seasonEnd} onChange={(v) => up((d) => void (d.cooling.seasonEnd = v))} />
          <QField label="Schermature estive" q={c.summerShading} onChange={setC("summerShading")} showSource={doc} hint="1 = nessuna schermatura; 0,5 = tende o persiane esterne usate di giorno." />
          <QField label="Fattore per l'umidità (latente)" q={c.latentFactor} onChange={setC("latentFactor")} showSource={doc} hint="Il modello conta solo il calore sensibile: 1,2 aggiunge il 20% per la deumidificazione." />
        </div>
      </Advanced>
    </Sec>
  );
}

function DateField({ label, v, onChange }: { label: string; v: { month: number; day: number }; onChange: (v: { month: number; day: number }) => void }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="label">{label}</span>
      <div className="row">
        <NumberInput ariaLabel={`${label}: giorno`} value={v.day} onChange={(day) => onChange({ ...v, day: Math.min(MONTH_DAYS[v.month - 1], Math.max(1, Math.round(day))) })} />
        <select aria-label={`${label}: mese`} value={v.month} onChange={(e) => onChange({ month: Number(e.target.value), day: Math.min(v.day, MONTH_DAYS[Number(e.target.value) - 1]) })}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const itDate = (iso: string) => iso.split("-").reverse().join("/");

const readMessage = (what: string, warnings: string[]) =>
  warnings.length ? `${what}, con ${warnings.length === 1 ? "un avviso" : `${warnings.length} avvisi`} di lettura. Per esempio: ${warnings[0]}.` : `${what}.`;

/** Gli anni di misura con il loro consumo: fanno vedere quanto cambia da un anno all'altro, non entrano nel calcolo. */
function MeterYears({ anni }: { anni: { dal: string; al: string; kwh: number }[] }) {
  if (anni.length < 2) return null;
  const main = anni[0].kwh;
  return (
    <div className="small">
      <strong>Anni di misura</strong>
      <ul>
        {anni.map((a, i) => (
          <li key={a.dal}>
            {i === 0 ? "ultimi 12 mesi" : i === 1 ? "12 mesi prima" : `${i * 12} mesi prima`} (dal {itDate(a.dal)} al {itDate(a.al)}): {fmt(a.kwh)} kWh
            {i > 0 && main > 0 && ` (${a.kwh >= main ? "+" : "−"}${fmt(Math.abs((a.kwh / main - 1) * 100))}%)`}
          </li>
        ))}
      </ul>
      Il calcolo usa gli ultimi 12 mesi; gli anni prima mostrano quanto cambiano i consumi da un anno all'altro.
    </div>
  );
}

/**
 * La curva del contatore: i file restano nel browser, nel progetto vanno solo le medie, senza POD. Con il FV
 * esistente servono due file, prelievi e immissioni, per ricostruire i consumi.
 */
function MeterCurve({ p, up, meter }: Pick<FormProps, "p" | "up"> & { meter: boolean }) {
  const c = p.consumption.measuredCurve;
  const [message, setMessage] = useState<string | null>(null);
  const load = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const { curve, warnings } = curveFromFiles(await Promise.all([...files].map((f) => f.text())));
      up((d) => {
        const immissioni = d.consumption.measuredCurve?.immissioni;
        d.consumption.measuredCurve = meter && immissioni ? { ...curve, immissioni } : curve;
        // con il FV il consumo annuo viene dalla curva ricostruita: il valore inserito a mano resta com'è
        if (!meter) d.consumption.electricityKwh = { value: curveAnnualKwh(curve.ore), status: "misurato", source: `${curve.fonte}, dal ${itDate(curve.dal)} al ${itDate(curve.al)}` };
      });
      setMessage(readMessage(meter ? "Prelievi letti" : "Curva letta", warnings));
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const loadExport = async (files: FileList | null) => {
    if (!files?.length || !c) return;
    try {
      const { immissioni, warnings } = exportFromFiles(await Promise.all([...files].map((f) => f.text())));
      up((d) => void (d.consumption.measuredCurve = { ...d.consumption.measuredCurve!, immissioni }));
      setMessage(readMessage("Immissioni lette", warnings));
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const fileInput = (label: string, onFiles: (f: FileList | null) => void, disabled = false) => (
    <label className="field">
      <span className="label">{label}</span>
      <input type="file" accept=".csv,text/csv" multiple disabled={disabled} aria-label={label} onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
    </label>
  );
  return (
    <div className="section">
      <h4>{meter ? "Curve del contatore: prelievi e immissioni" : "Curva del contatore (facoltativa)"}</h4>
      {c ? (
        <p className="small">
          {meter ? "Prelievi dal contatore" : "Ore di consumo dal contatore"}: {c.fonte}, dal {itDate(c.dal)} al {itDate(c.al)}, {c.giorni} giorni.{" "}
          {meter
            ? c.immissioni
              ? `Immissioni dal contatore: dal ${itDate(c.immissioni.dal)} al ${itDate(c.immissioni.al)}, ${c.immissioni.giorni} giorni. Il consumo della casa è ricostruito ora per ora: prelievi più autoconsumo, cioè la produzione stimata del FV meno le immissioni. L'autoconsumo è una stima, la produzione è quella di un media climatica 2015-2024.`
              : "Manca il file delle immissioni: senza, i consumi non si ricostruiscono."
            : "Sostituisce il profilo inventato."}{" "}
          <button type="button" className="btn small" onClick={() => up((d) => void (d.consumption.measuredCurve = null))}>{meter ? "Togli le curve" : "Togli la curva"}</button>
        </p>
      ) : (
        <p className="small">
          {meter
            ? <>Carica i file a quarti d'ora di e-distribuzione: prima quello dei <strong>prelievi</strong> (o il <em>letture.csv</em> del Portale Consumi), poi quello delle <strong>immissioni</strong> in rete, dello stesso periodo. I file restano sul tuo dispositivo: nel progetto vanno solo le medie per ora, senza POD e senza le letture.</>
            : <InfoTip text="Carica letture.csv del Portale Consumi o la curva a quarti d'ora di e-distribuzione: nel progetto vanno solo le medie per ora." label="Curva del contatore">Anche più mesi o più anni insieme. Il file resta sul tuo dispositivo: nel progetto vanno solo le medie per ora, senza POD e senza le letture.</InfoTip>}
        </p>
      )}
      {c?.anni && <MeterYears anni={c.anni} />}
      {meter ? (
        <div className="grid">
          {fileInput("File dei prelievi", load)}
          {fileInput("File delle immissioni", loadExport, !c)}
        </div>
      ) : (
        <input type="file" accept=".csv,text/csv" multiple aria-label="File dei consumi del contatore" onChange={(e) => { void load(e.target.files); e.target.value = ""; }} />
      )}
      {message && <p className="small" role="status">{message}</p>}
      <p className="small muted">
        {meter
          ? "Il file delle immissioni deve avere lo stesso formato di quello dei prelievi: nessuna fonte pubblica lo descrive, al primo file vero va ricontrollato. Il Portale Consumi dà solo i prelievi. "
          : "Se hai già il fotovoltaico, scegli sopra «Dalla curva del contatore»: servono anche le immissioni. "}
        Se raffreschi con gli split, il consumo estivo è già nel file e il modello lo aggiunge di nuovo.
      </p>
    </div>
  );
}

export function ConsumptionForm({ p, up, doc, issues, soloCasa = false }: FormProps & { soloCasa?: boolean }) {
  const c = p.consumption;
  const t = p.tariffs;
  const setT = (k: keyof ProjectInput["tariffs"]) => (q: Q) => up((d) => void ((d.tariffs[k] as Q) = q));
  const electricOnly = electricOnlyGoal(p.goal);
  const existing = p.existingPv.present;
  const fromBill = existing && p.existingPv.consumptionFrom === "bolletta";
  const meter = existing && p.existingPv.consumptionFrom === "contatore";
  return (
    <>
      <IssueList issues={issues} errorsOnly sections={["Consumi", "Tariffe", "Auto elettrica"]} />
      <HelpDiagram kind="bolletta" />
      <BillReader p={p} up={up} />
      {(p.goal === "batteria" || p.goal === "completo" || (p.goal === "auto" && p.ev.pvPlan === "esistente")) && <ExistingPvFields p={p} up={up} doc={doc} fixed={p.goal === "batteria" || p.goal === "auto"} />}
      <Sec icon="sensibilita" title={electricOnly ? "Consumi elettrici" : "Consumi osservati"} intro={electricOnly ? "Per il fotovoltaico contano i consumi elettrici e le ore in cui li fai. Il gas non cambia il risultato." : "Serve a confrontare il modello con la bolletta. Il gas in bolletta serve al confronto con l'anno tipico e a un secondo risultato tarato. Da un totale annuo non si capisce quale dato del modello è sbagliato: U, infiltrazioni, setpoint o rendimento."}>
        <div className="grid">
          {!electricOnly && <QField label="Gas totale in bolletta" unit="Smc/anno" q={c.gasSmcObserved} onChange={(q) => up((d) => void (d.consumption.gasSmcObserved = q))} showSource={doc} />}
          {!electricOnly && <div className="field"><label htmlFor="gas-start">Primo mese fatturato</label><input id="gas-start" type="month" value={c.observedStart} onChange={(e) => up((d) => void (d.consumption.observedStart = e.target.value))} /><span className="hint">Serve per riportare quell’inverno alla media 2015-2024.</span></div>}
          {!electricOnly && <TextField label="Periodo fatturato" value={c.observedPeriod} placeholder="es. ott 2025 – set 2026" onChange={(v) => up((d) => void (d.consumption.observedPeriod = v))} />}
        </div>
        {!electricOnly && <>
          <div className="section">
            <h4><InfoTip text="Altri anni di bolletta (per la taratura)" label="Altri anni di bolletta" method="taratura-gas">Un inverno da solo può essere più freddo o più mite del solito: con due o tre anni la taratura usa la media.</InfoTip></h4>
            {c.gasOtherYears.map((year, i) => <div className="grid" key={i}>
              <QField label={`Gas dell'altra annata ${i + 1}`} unit="Smc/anno" q={year.smc} min={0} max={Number.MAX_VALUE} onChange={(q) => up((d) => void (d.consumption.gasOtherYears[i].smc = q))} showSource={doc} />
              <div className="field"><label htmlFor={`gas-other-start-${i}`}>Primo mese fatturato</label><input id={`gas-other-start-${i}`} type="month" value={year.start ?? ""} onChange={(e) => up((d) => void (d.consumption.gasOtherYears[i].start = e.target.value))} /><span className="hint">Serve per confrontare quell’inverno con l’media climatica 2015-2024.</span></div>
              <TextField label={`Periodo dell'altra annata ${i + 1}`} value={year.period} onChange={(v) => up((d) => void (d.consumption.gasOtherYears[i].period = v.slice(0, 60)))} />
              <button type="button" className="btn small" onClick={() => up((d) => { d.consumption.gasOtherYears.splice(i, 1); })}>Rimuovi</button>
            </div>)}
            {c.gasOtherYears.length < 2 && <button type="button" className="btn small" onClick={() => up((d) => { if (d.consumption.gasOtherYears.length < 2) d.consumption.gasOtherYears.push({ smc: { value: 0, status: "sconosciuto", source: "" }, period: "", start: "" }); })}>+ Aggiungi un anno</button>}
          </div>
          <div className="section">
            <h4>Gas d'estate (facoltativo)</h4>
            <p className="small">Bollette fra giugno e settembre: separano acqua calda e cucina dal riscaldamento.</p>
            <div className="grid">
              <QField label="Gas del periodo estivo" unit="Smc" q={c.summerGas.smc} min={0} max={Number.MAX_VALUE} onChange={(q) => up((d) => void (d.consumption.summerGas.smc = q))} showSource={doc} />
              <div className="field"><span className="label">Giorni del periodo estivo</span><NumberInput ariaLabel="Giorni del periodo estivo" min={0} max={366} integer value={c.summerGas.days} onChange={(v) => up((d) => void (d.consumption.summerGas.days = v))} /></div>
              <TextField label="Periodo estivo" value={c.summerGas.period} onChange={(v) => up((d) => void (d.consumption.summerGas.period = v.slice(0, 60)))} />
            </div>
          </div>
        </>}
        <div className="grid">
          {!fromBill && !meter && <QField label={existing ? "Consumo elettrico totale della casa (app dell'inverter)" : "Elettricità per gli altri usi"} unit="kWh/anno" q={c.electricityKwh} onChange={(q) => up((d) => void (d.consumption.electricityKwh = q))} showSource={doc} ownLabel={existing} hint={existing ? "Prelievi più autoconsumo, come li mostra l'app dell'inverter. Senza la pompa di calore e gli split, che il modello aggiunge da sé." : "Senza carichi già simulati: la pompa di calore e, se raffreschi, gli split d'estate vengono aggiunti dal modello. Se la bolletta comprende già i condizionatori, dillo nella casella qui sotto."} />}
          {!fromBill && !meter && p.cooling.today === "split" && <div>
            <Check label="La luce indicata comprende già i condizionatori" checked={p.cooling.alreadyInConsumption} onChange={(v) => up((d) => void (d.cooling.alreadyInConsumption = v))} />
            <p className="small">{p.cooling.alreadyInConsumption ? "Togliamo dalla luce la stima del consumo dei condizionatori, così non si conta due volte." : "Il consumo dei condizionatori si aggiunge alla luce indicata. Di solito la bolletta lo comprende già: in quel caso spunta la casella."}</p>
          </div>}
          {electricOnly && (
            <SelectField label="D'estate usi i condizionatori?" value={p.cooling.today} options={[{ value: "nessuno", label: "No" }, { value: "split", label: "Sì, con condizionatori (split)" }]}
              onChange={(v) => up((d) => void (d.cooling.today = v))}
              hint={p.cooling.today === "split" ? "Il consumo dei condizionatori dipende dalla casa: si usa la casa d'esempio, dichiarata. Con «Approfondisci la casa» puoi descrivere la tua." : "Senza condizionatori la casa (muri, finestre, caldaia) non cambia il risultato del fotovoltaico."} />
          )}
          {!usesMeasuredCurve(p) && (
            <GuidedChoice p={p} up={up} path="profile"
              label="Profilo orario degli altri usi"
              value={c.profile}
              options={(Object.keys(PROFILE_LABELS) as (keyof typeof PROFILE_LABELS)[]).map((k) => ({ value: k, label: PROFILE_LABELS[k] }))}
              set={(d, v) => void (d.consumption.profile = v)}
            />
          )}
          {!usesMeasuredCurve(p) && <SelectField
            label="Andamento nell'anno"
            method="profilo-stagionale-arera"
            value={c.profileMode ?? "sintetico"}
            options={[{ value: "sintetico", label: "Uguale tutti i giorni (come finora)" }, { value: "stagionale", label: "Con le stagioni (dati medi ARERA delle case italiane)" }]}
            onChange={(v) => up((d) => void (d.consumption.profileMode = v))}
            hint={<><a href={ARERA_PROFILE_SOURCE.url} target="_blank" rel="noreferrer">ARERA, Analisi dei consumi dei clienti domestici</a>, dati {ARERA_PROFILE_SOURCE.year}, licenza {ARERA_PROFILE_SOURCE.licence}, acquisiti il {itDate(ARERA_PROFILE_SOURCE.date)}. È la media di molte case: la tua può essere diversa. La curva del tuo contatore resta il dato migliore. Medie semplici delle regioni per Nord, Centro e Sud con isole, distinte per mese, feriali, sabato e domenica. I festivi contano come domenica. Fino a 3 kW si usa la classe 1,5–3 kW, oltre la classe 3–4,5 kW. Le abitudini scelte modulano la media: «serale» accentua il picco già presente. La media comprende anche case con pompa di calore, auto elettrica e condizionatori: aggiungendoli nel calcolo si può contare due volte parte del loro andamento stagionale.</>}
          />}
        </div>
        {(!existing || meter) && <MeterCurve p={p} up={up} meter={meter} />}
      </Sec>
      <Sec icon="costi" title="Auto elettrica">{soloCasa ? <><Check label="In famiglia c'è o ci sarà un'auto elettrica" checked={p.ev.enabled} onChange={(v) => up(d => { d.ev.enabled = v; })}/><Check label="La ricarica è già compresa nei consumi della luce indicati" checked={p.ev.alreadyInConsumption} onChange={(v) => up(d => { d.ev.alreadyInConsumption = v; })}/>{p.ev.enabled && <div className="grid"><QField label="Chilometri all'anno" unit="km/anno" q={p.ev.kmYear} onChange={(q) => up(d => { d.ev.kmYear = q; })} showSource={doc}/></div>}</> : <EvFields p={p} up={up} doc={doc} />}</Sec>
      <Sec icon="costi" title="Tariffe (prezzi costanti inseriti da te)" intro="Nessun prezzo viene scaricato o considerato «attuale». Il prezzo di cessione è distinto da quello di acquisto.">
        {!doc && <p className="small">Per le tue spese trascrivi i prezzi della bolletta nelle ipotesi tecniche.</p>}
        <details className="advanced" open={p.goal === "tariffa"}>
          <summary>Confronta strutture di tariffa</summary>
          <TariffFields p={p} up={up} doc={doc} />
        </details>
        <Advanced doc={doc}>
        <div className="grid">
          <QField label="Gas: prezzo variabile" unit="€/Smc" q={t.gasPrice} onChange={setT("gasPrice")} showSource={doc} />
          <QField label="Gas: quota fissa" unit="€/anno" q={t.gasFixed} onChange={setT("gasFixed")} showSource={doc} />
          <QField label="Elettricità: prezzo variabile" unit="€/kWh" q={t.elecPrice} onChange={setT("elecPrice")} showSource={doc} />
          <QField label="Elettricità: quota fissa" unit="€/anno" q={t.elecFixed} onChange={setT("elecFixed")} showSource={doc} />
          <QField label="Elettricità: quota potenza" unit="€/kW/anno" q={t.powerCostPerKw} onChange={setT("powerCostPerKw")} showSource={doc} />
          <QField label="Potenza contrattuale attuale" unit="kW" q={t.contractPower} onChange={setT("contractPower")} showSource={doc} />
          <QField label="Prezzo di cessione FV" unit="€/kWh" q={t.exportPrice} onChange={setT("exportPrice")} showSource={doc} />
          <TextField label="Data dei prezzi" value={t.date} placeholder="es. 2026-10" onChange={(v) => up((d) => void (d.tariffs.date = v))} />
          <TextField label="Provenienza dei prezzi" value={t.source} onChange={(v) => up((d) => void (d.tariffs.source = v))} />
        </div>
        </Advanced>
      </Sec>
      <IssueList issues={issues} errorsAbove sections={["Consumi", "Tariffe", "Auto elettrica"]} />
    </>
  );
}

export function CostEditor({ block, onChange, title, doc = false, path, kind }: { block: CostBlock; onChange: (b: CostBlock) => void; title: string; doc?: boolean; path?: string; kind?: ChecklistKind }) {
  const context = useContext(FormContext);
  const absent = kind ? absentChecklist(kind, block) : [];
  const setItem = (i: number, patch: Partial<CostBlock["items"][number]>) => onChange({ ...block, items: block.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const total = block.items.reduce((s, it) => s + (it.status === "incluso" ? it.amount.value : 0), 0);
  const unknown = block.items.filter((it) => it.status === "sconosciuto").length;
  return (
    <div className="section">
      <h4 id={path ? fieldId(path) : undefined} tabIndex={-1}>{title}</h4>
      <p className="small muted">Stato voce: cosa include il preventivo. Origine dell'importo: dato documentato, misurato, ipotizzato o non noto. Le due scelte sono distinte.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Voce</th>
              <th>Importo (€)</th>
              <th>Stato voce</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {block.items.map((it, i) => (
              <tr key={i}>
                <td>
                  <input type="text" aria-label={`Voce di costo ${i + 1}`} value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} style={{ width: "100%" }} />
                </td>
                <td style={{ minWidth: doc ? 300 : 140 }}>
                  <QField label={`Origine dell'importo ${i + 1}: ${it.label}`} unit="€" path={path ? `${path}.items.${i}.amount` : undefined} min={0} max={1e6} q={it.amount} showSource={doc} onChange={(q) => setItem(i, { amount: q })} />
                </td>
                <td style={{ width: 150 }}>
                  <select aria-label={`Stato voce ${i + 1} (${it.label})`} value={it.status} onChange={(e) => setItem(i, { status: e.target.value as CostStatus })}>
                    <option value="incluso">incluso</option>
                    <option value="escluso">non necessario</option>
                    <option value="sconosciuto">non indicata</option>
                  </select>
                </td>
                <td className="no-print">
                  <button type="button" className="btn small" aria-label={`Rimuovi voce ${i + 1} (${it.label})`} onClick={() => { if (context.guard?.() !== false) onChange({ ...block, items: block.items.filter((_, k) => k !== i) }); }}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 6 }}>
        <button type="button" className="btn small no-print" onClick={() => onChange({ ...block, items: [...block.items, { label: "Nuova voce", amount: { value: 0, status: "ipotizzato" }, status: "sconosciuto" }] })}>
          + voce
        </button>
        <span className="small">
          Totale voci incluse: <strong>{fmt(total)} €</strong>
          {unknown > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{unknown} voci non indicate: economia incompleta</span>}
        </span>
      </div>
      {absent.length > 0 && (
        <div className="notice info small">
          Voci che di solito ci sono e qui non compaiono: {absent.map((c) => c.label).join(", ")}. Non valgono zero: chiedile all'installatore.{" "}
          <button type="button" className="btn small no-print" onClick={() => onChange({ ...block, items: [...block.items, ...absent.map((c) => ({ label: c.label, amount: { value: 0, status: "sconosciuto" as const }, status: "sconosciuto" as const }))] })}>
            Aggiungi le voci mancanti
          </button>
        </div>
      )}
      <div className="grid" style={{ marginTop: 6 }}>
        <TextField label="Nome dell'offerta" value={block.name} placeholder="es. Preventivo 1" onChange={(v) => onChange({ ...block, name: v })} />
        <TextField label="Fornitore (facoltativo)" value={block.supplier} onChange={(v) => onChange({ ...block, supplier: v })} />
        <TextField label="Provenienza (preventivo, ipotesi…)" value={block.quoteSource} onChange={(v) => onChange({ ...block, quoteSource: v })} />
        <TextField label="Data del preventivo" value={block.quoteDate} placeholder="es. 2026-11-03" onChange={(v) => onChange({ ...block, quoteDate: v })} />
        <TextField label="Valido fino al" value={block.validUntil} placeholder="es. 2026-12-31" onChange={(v) => onChange({ ...block, validUntil: v })} />
      </div>
      {doc && <><button type="button" className="btn" disabled={!block.quoteSource.trim() || !block.quoteDate.trim() || /esempio|preset|da sostituire/i.test(block.quoteSource)} onClick={() => onChange(documentQuote(block))}>Ho trascritto questi importi dal preventivo</button><p className="small muted">Conferma esplicita delle sole voci incluse, con riferimento e data. Scrivere la fonte non promuove automaticamente gli importi.</p></>}
    </div>
  );
}
