import { CLIMATE_ALIASES, isClimateId, type ClimatePackage } from "./climate";
import { INCENTIVE_PRESETS } from "./incentivi";
import { exampleProject } from "./example";
import { checkProject, cookingSwitchErrors, enumChecks, heatingScheduleErrors, inactiveOutOfRangeWarning } from "./quality";
import { checkLocation, comuneByCode, locationFromComune, type Comune } from "./location";
import { MAX_QUOTES, QUOTE_KINDS, quotesOf } from "./preventivi";
import { findCatalogHp, PARAMETRIC_AUX_DEFAULTS } from "./heatpump";
import { ENGINE_VERSION, PRESET_VERSION, SCHEMA_VERSION, type ProjectFile, type ProjectInput, type Q } from "./types";

export function toProjectFile(input: ProjectInput, climate: ClimatePackage | null): ProjectFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    presetVersion: PRESET_VERSION,
    climateId: input.climateId,
    climateSha256: climate ? climate.manifest.rawSha256 : "",
    savedAt: new Date().toISOString(),
    input,
  };
}

const STATUSES = new Set(["documentato", "misurato", "ipotizzato", "sconosciuto"]);
const MAX_BYTES = 2_000_000;

function isQ(x: unknown): x is Q {
  const o = x as Q;
  return !!o && typeof o === "object" && typeof o.value === "number" && Number.isFinite(o.value) && STATUSES.has(o.status);
}

/** Confronta la forma del file con il modello d'esempio: ogni Q atteso deve essere un Q valido. */
const NULLABLE = new Set(["input.plan.custom.W", "input.plan.custom.H", "input.plan.custom.P"]);

function checkShape(ref: unknown, val: unknown, path: string, errors: string[]) {
  if (errors.length > 20) return;
  if (isQ(ref)) {
    if (!isQ(val)) errors.push(`${path}: atteso {value numerico finito, status}`);
    else if (val.source !== undefined && typeof val.source !== "string") errors.push(`${path}.source: deve essere testo`);
    else if (val.date !== undefined && typeof val.date !== "string") errors.push(`${path}.date: deve essere testo`);
    else if (val.confirmed !== undefined && typeof val.confirmed !== "boolean") errors.push(`${path}.confirmed: deve essere booleano`);
    return;
  }
  if (Array.isArray(ref)) {
    const item = ref.length > 0 ? ref[0] : path === "input.consumption.gasOtherYears" ? { smc: exampleProject().consumption.summerGas.smc, period: "", start: "" } : path.endsWith("replacements") ? exampleProject().pv.replacements[0] : quoteRef(path);
    if (!Array.isArray(val)) errors.push(`${path}: attesa una lista`);
    else if (val.length > 50) errors.push(`${path}: troppi elementi`);
    else if (item !== undefined) val.forEach((v, i) => checkShape(item, v, `${path}[${i}]`, errors));
    return;
  }
  if (ref && typeof ref === "object") {
    if (!val || typeof val !== "object" || Array.isArray(val)) {
      errors.push(`${path}: atteso un oggetto`);
      return;
    }
    for (const k of Object.keys(ref)) {
      if (k === "start" && (val as Record<string, unknown>)[k] === undefined) continue;
      checkShape((ref as Record<string, unknown>)[k], (val as Record<string, unknown>)[k], path ? `${path}.${k}` : k, errors);
    }
    return;
  }
  // nel percorso dell'utente «mai» è null: ammesso solo qui
  if (val === null && NULLABLE.has(path)) return;
  if (typeof ref !== typeof val) errors.push(`${path}: tipo ${typeof val} invece di ${typeof ref}`);
  else if (typeof val === "number" && !Number.isFinite(val)) errors.push(`${path}: atteso un numero finito`);
}

/** Modello di un preventivo alternativo: il preventivo in uso dell'esempio. */
function quoteRef(path: string): unknown {
  const kind = QUOTE_KINDS.find((k) => path === `input.${k}.otherQuotes`);
  return kind ? quotesOf(exampleProject(), kind)[0] : undefined;
}

/** Include anche numeri in campi aggiuntivi e in array: nessun overflow JSON passa inosservato. */
function checkFiniteNumbers(val: unknown, path: string, errors: string[], depth = 0) {
  if (errors.length > 20) return;
  if (depth > 80) { errors.push(`${path}: struttura troppo profonda`); return; }
  if (typeof val === "number" && !Number.isFinite(val)) errors.push(`${path}: atteso un numero finito`);
  else if (val && typeof val === "object")
    for (const [key, v] of Object.entries(val)) checkFiniteNumbers(v, `${path}.${key}`, errors, depth + 1);
}

/** Completa i campi mancanti (aggiunti in versioni successive) con i valori dell'esempio, segnalandoli. */
function fillMissing(ref: unknown, val: unknown, path: string, added: string[]): unknown {
  if (val === undefined) {
    added.push(path);
    return structuredClone(ref);
  }
  if (isQ(ref) || Array.isArray(ref) || !ref || typeof ref !== "object" || !val || typeof val !== "object" || Array.isArray(val)) return val;
  const out: Record<string, unknown> = { ...(val as Record<string, unknown>) };
  for (const k of Object.keys(ref)) out[k] = fillMissing((ref as Record<string, unknown>)[k], out[k], path ? `${path}.${k}` : k, added);
  return out;
}

// funzioni spente se assenti: completarle non cambia i risultati, quindi non serve un avviso.
// Eccezione dichiarata: l'assorbimento del sole (motore 0.6.0) si completa con 0,6 «ipotizzato» senza avviso,
// perché con la nuova versione del motore cambiano comunque tutti i numeri (docs/validazione/CORREZIONE-MOTORE.md §3).
const OFF_BY_DEFAULT = new Set(["input.cooking", "input.cooling.alreadyInConsumption","input.consumption.profileMode", "input.service.schedule", "input.building.infiltration", "input.windows.n50After", "input.building.thermalBridges", "input.building.solarAbsorptance", "input.building.atticRoofShare", "input.building.unheatedUpper", "input.building.unheatedLower", "input.building.unheatedSide", ...QUOTE_KINDS.map((k) => `input.${k}.otherQuotes`), "input.ev", "input.plan", "input.tariffCompare", ...["oneriKwh","monoraria.prezzo","monoraria.fissa","bioraria.f1","bioraria.f23","bioraria.fissa","indicizzata.punF1","indicizzata.punF2","indicizzata.punF3","indicizzata.spread","indicizzata.fissa","potenze"].map(k=>`input.tariffCompare.${k}`), ...["pvPlan", "years", "evPrice", "evIncentive", "evMaintenance", "evTax", "evResale", "icePrice", "iceMaintenance", "iceTax", "iceResale"].map((k) => `input.ev.${k}`), "input.dhw", ...["solarAreaM2", "solarPlane", "solarEta0", "solarA1", "solarA2", "solarLoopLossPct", "solarPumpW", "solarBackup"].map((k) => `input.dhw.${k}`), "input.heatPump.included", "input.envelope", "input.consumption.measuredCurve", "input.consumption.observedStart", "input.consumption.gasOtherYears", "input.consumption.summerGas", "input.economics.incentive", "input.economics.incentive.batteryPct", "input.economics.homeValue", "input.battery", "input.existingPv", "input.goal", "input.pv.sizing", "input.pv.roofArea", "input.pv.areaPerKwp", "input.pv.pricePerKwp", "input.battery.pricePerKwh"]);

export interface ImportResult {
  file?: ProjectFile;
  errors: string[];
  warnings: string[];
  /** Solo per la bozza: errori di intervallo e coerenza fisica ammessi perché il lavoro è in corso. */
  incomplete: string[];
}

export interface ParseOptions {
  /**
   * Bozza dell'editor: basta l'integrità (schema, tipi, valori ammessi, numeri finiti, località).
   * Intervalli e coerenza fisica restano da correggere nei passi, e bloccano risultati ed esportazione.
   */
  draft?: boolean;
}

/** I file importati sono dati non fidati: si controllano dimensione, versione, tipi e numeri finiti. */
export function parseProjectFile(text: string, climate: ClimatePackage | null, comuni?: readonly Comune[], options: ParseOptions = {}): ImportResult {
  const warnings: string[] = [];
  const incomplete: string[] = [];
  const fail = (errors: string[]): ImportResult => ({ errors, warnings, incomplete });
  if (text.length > MAX_BYTES) return fail(["File troppo grande."]);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail(["Il file non è JSON valido."]);
  }
  const f = data as ProjectFile;
  // La versione si cita solo se è un numero: il testo di un file qualsiasi non finisce nel messaggio
  // (docs/sicurezza/TEST-2026-11-23.md, punto 5).
  if (!f || typeof f !== "object" || f.schemaVersion !== SCHEMA_VERSION) return fail([`Versione di schema non supportata (${typeof f?.schemaVersion === "number" ? f.schemaVersion : "assente o non numerica"}).`]);
  const errors: string[] = [];
  checkFiniteNumbers(f, "file", errors);
  if (errors.length) return fail(errors);
  if (!f.input || typeof f.input !== "object") return fail(["Campo «input» mancante."]);
  errors.push(...heatingScheduleErrors(f.input.service?.schedule, f.input.service?.setpoint?.value ?? exampleProject().service.setpoint.value));
  errors.push(...cookingSwitchErrors(f.input.cooking));
  if (errors.length) return fail(errors);
  // motore 0.1.x: la casella dei consumi estivi è sostituita dai dati del raffrescamento
  const oldService = (f.input as { service?: { summerCoolingRelevant?: unknown } }).service;
  if (oldService?.summerCoolingRelevant === true && (f.input as { cooling?: unknown }).cooling === undefined)
    warnings.push("Il raffrescamento ora si calcola: indica nel passo Servizio e impianto se e come raffreschi.");
  const added: string[] = [];
  f.input = fillMissing(exampleProject(), f.input, "input", added) as ProjectInput;
  for (const key of ["pTO_W", "pOFF_W", "pCK_W", "extraPump_W"] as const) {
    if (!added.includes(`input.heatPump.${key}`)) continue;
    const aux = f.input.heatPump.model === "catalogo" ? findCatalogHp(f.input.heatPump.catalogId)?.aux : undefined;
    if (aux && key !== "extraPump_W") {
      const value = key === "pTO_W" ? aux.pTO_W : key === "pOFF_W" ? aux.pOFF_W : aux.pCK_W;
      f.input.heatPump[key] = { value, status: "documentato", source: `${aux.source ?? "certificato Keymark"}; ${aux.page}`, date: aux.accessDate };
    } else if (key !== "extraPump_W") {
      f.input.heatPump[key] = structuredClone(PARAMETRIC_AUX_DEFAULTS[key]);
    } else {
      f.input.heatPump[key] = { value: 0, status: "ipotizzato", source: "Non risulta una pompa primaria esclusiva della PDC nel modello.", date: "2026-11-09" };
    }
  }
  // confronto delle tariffe assente nei progetti salvati prima: i prezzi dell'esempio non devono sembrare dell'utente
  const tc = f.input.tariffCompare;
  if (tc && added.includes("input.tariffCompare")) {
    const prices: Q[] = [tc.oneriKwh, ...Object.values(tc.monoraria), ...Object.values(tc.bioraria), ...Object.values(tc.indicizzata)];
    for (const price of prices) price.status = "sconosciuto";
  } else if (tc && added.includes("input.tariffCompare.oneriKwh")) {
    tc.oneriKwh.status = "sconosciuto";
  }
  if (added.includes("input.location")) {
    // un progetto senza comune non deve ereditare il comune dell'esempio: comune da scegliere di nuovo
    f.input.location = { code: "", name: "", sigla: "", zone: "E", gg: 0, alt: 0, lat: 0, lon: 0, fonte: "" };
    warnings.push("Il progetto è di una versione precedente senza comune: scegli di nuovo il comune nel passo Località.");
  }
  // preventivi salvati prima della taglia del preventivo: taglia non indicata (0), nessun avviso inventato
  for (const k of ["windows", "heatPump", "pv", "battery"] as const)
    if (added.includes(`input.${k}.cost.forSize`) && !added.includes(`input.${k}`)) f.input[k].cost.forSize = 0;
  // nome, fornitore e validità dell'offerta (tappa 2): vuoti, come nei progetti di prima
  const hpDefaults = new Set(["input.heatPump.minModulation", "input.heatPump.cyclingCd", "input.heatPump.pTO_W", "input.heatPump.pOFF_W", "input.heatPump.pCK_W", "input.heatPump.extraPump_W"]);
  const others = added.filter((a) => !a.endsWith(".start") && a !== "input.location" && !OFF_BY_DEFAULT.has(a) && !hpDefaults.has(a) && !/\.cost\.(forSize|name|supplier|validUntil)$/.test(a));
  if (others.length) warnings.push(`Campi assenti completati con i valori d'esempio (da verificare): ${others.slice(0, 6).join(", ")}${others.length > 6 ? "…" : ""}.`);
  checkShape(exampleProject(), f.input, "input", errors);
  if (errors.length) return fail(errors);
  const inc = f.input.economics.incentive;
  if (inc.preset !== undefined && !INCENTIVE_PRESETS.some((r) => r.id === inc.preset)) inc.preset = "personale";
  else if (inc.preset === undefined && inc.enabled) inc.preset = "personale";
  const c = f.input.consumption;
  if (c.gasOtherYears.length > 2) errors.push("Altre annate di gas: al massimo due.");
  if (!Number.isInteger(c.summerGas.days) || c.summerGas.days < 0 || c.summerGas.days > 366) errors.push("Gas d'estate: giorni fra 0 e 366.");
  for (const [path, gas] of [["input.consumption.summerGas", c.summerGas], ...c.gasOtherYears.map((y, i) => [`input.consumption.gasOtherYears[${i}]`, y] as const)] as const) {
    if (gas.smc.value < 0) errors.push(`${path}.smc: il consumo deve essere almeno zero.`);
    if ("start" in gas && gas.start && !/^\d{4}-(0[1-9]|1[0-2])$/.test(gas.start)) errors.push(`${path}.start: formato atteso AAAA-MM.`);
    if (gas.period.length > 60) errors.push(`${path}.period: al massimo 60 caratteri.`);
  }
  if (errors.length) return fail(errors);
  for (const k of QUOTE_KINDS)
    if (f.input[k].otherQuotes.length > MAX_QUOTES - 1) errors.push(`input.${k}.otherQuotes: al massimo ${MAX_QUOTES} preventivi per intervento.`);
  for (const [path, value, allowed] of enumChecks(f.input))
    if (!allowed.includes(value as string)) errors.push(`${path}: valore «${String(value).slice(0, 40)}» non ammesso.`);
  if (typeof f.input.climateId === "string" && CLIMATE_ALIASES[f.input.climateId]) {
    warnings.push(`Clima «${f.input.climateId}» convertito nel pacchetto del capoluogo ${CLIMATE_ALIASES[f.input.climateId]}.`);
    f.input.climateId = CLIMATE_ALIASES[f.input.climateId];
  }
  if (!isClimateId(f.input.climateId)) errors.push(`climateId «${String(f.input.climateId).slice(0, 40)}» non supportato.`);
  const loc = f.input.location;
  if (loc && !["A", "B", "C", "D", "E", "F"].includes(loc.zone)) errors.push("location.zone: zona climatica non valida.");
  if (f.input.schemaVersion !== SCHEMA_VERSION) errors.push("input.schemaVersion: versione non supportata.");
  errors.push(...checkLocation(loc, comuni));
  // Campi attivi: intervallo e coerenza fisica (checkProject). Campi non attivi fuori intervallo: non entrano nei
  // calcoli, si conservano con un avviso, così ciò che l'app esporta si reimporta.
  const physical = checkProject(f.input).filter((i) => i.severity === "errore").map((i) => i.message);
  if (options.draft) incomplete.push(...physical);
  else errors.push(...physical);
  if (errors.length) return fail(errors);
  const inactive = inactiveOutOfRangeWarning(f.input);
  if (inactive) warnings.push(inactive);
  if (!comuni) warnings.push("Anagrafe dei comuni non disponibile: località validata solo nei numeri (finiti e negli intervalli ammessi); codice e dati del comune non verificati.");
  else {
    const comune = comuneByCode(loc.code, comuni);
    if (comune) {
      const current = locationFromComune(comune);
      if (loc.localOverride) current.localOverride = loc.localOverride;
      if (loc.siteAltitude) current.siteAltitude = loc.siteAltitude;
      const changed = (Object.keys(current) as (keyof typeof current)[]).filter((k) => loc[k] !== current[k]);
      if (changed.length) {
        f.input.location = current;
        warnings.push(`Località aggiornata all'anagrafe corrente: ${changed.map((k) => `${k} ${loc[k]} → ${current[k]}`).join("; ")}. I risultati vengono ricalcolati con i dati aggiornati.`);
      }
    }
  }
  if (f.engineVersion !== ENGINE_VERSION) warnings.push(`Progetto salvato con motore ${f.engineVersion}: i risultati vengono ricalcolati con ${ENGINE_VERSION}.`);
  if (climate && f.climateSha256 && f.climateSha256 !== climate.manifest.rawSha256)
    warnings.push("Il pacchetto clima disponibile è diverso da quello del salvataggio: risultati non riproducibili identici.");
  return { file: f, errors, warnings, incomplete };
}
