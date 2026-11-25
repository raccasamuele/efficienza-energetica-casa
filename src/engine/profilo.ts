import { HOURS, type ClimatePackage } from "./climate";
import { CURVE_CELLS, consumptionCurve, curveCell, curveDescription, curvePvKwp, otherUsesDemand } from "./curva";
import { packagePv, pvProduction } from "./electric";
import { batteryParams, simulateBattery } from "./battery";
import { applyLocation, comuneByCode, suggestClimate, type Comune } from "./location";
import type { ClimateIndexEntry } from "./climate";
import type { PackageResult } from "./scenarios";
import { ENGINE_VERSION, type ProjectInput, type PvPlane, type Q, type DataStatus } from "./types";

/**
 * Profilo energetico della casa: il file comune con il simulatore CER.
 * Specifica: documento del formato nel simulatore CER (docs/formato_profilo_energetico.md; la CER è il lettore di riferimento, `cersim.profilo`).
 * Uno scenario per la situazione attuale e per ogni pacchetto valido: consumi elettrici prima del FV, FV, batteria e
 * prelievi dopo FV e batteria (lo stesso contenuto di `curva-consumi`). Niente nome del progetto, POD o importi.
 */
export interface ProfileCurve {
  kwh_annui: number;
  ore: number[];
}

export interface ProfileScenario {
  id: string;
  nome: string;
  attuale: boolean;
  consumi: ProfileCurve & {
    natura: "calcolato" | "misurato";
    stato: DataStatus;
    giorni?: number;
    dal?: string;
    al?: string;
    usi?: { altri_usi_kwh?: number; pompa_di_calore_kwh?: number; raffrescamento_kwh?: number };
  };
  fv: { kwp: number; inclinazione: number; orientamento: number; perdite_pct: number; esistente: boolean } | null;
  batteria: { capacita_kwh: number; potenza_kw: number; rendimento_pct: number; riserva_pct: number } | null;
  prelievi: ProfileCurve;
  stima?: { immissioni_kwh?: number; autoconsumo_kwh?: number };
}

/** Prezzo dell'elettricità nella bolletta della casa, €/kWh con le imposte (versione 2 del formato). */
export interface ProfileBill {
  eur_kwh: number;
  stato: DataStatus;
  fasce?: { F1: number; F2: number; F3: number };
}

export interface EnergyProfile {
  formato: "profilo-energetico";
  /** 2 solo se c'è `bolletta`: senza, il file resta leggibile dai lettori della versione 1. */
  versione: 1 | 2;
  fonte: string;
  motore?: string | null;
  data: string;
  descrizione?: string | null;
  comune: { codice_istat: string; nome: string; lat: number; lon: number } | null;
  scenari: ProfileScenario[];
  esclusi: string[];
  bolletta?: ProfileBill;
}

export const PROFILE_FORMAT = "profilo-energetico";
export const PROFILE_EXCLUDED = ["codice POD", "nomi e indirizzo", "codice cliente", "letture del contatore con le date", "importi"];
/** Perdite di sistema già comprese nei dati FV del clima (vedi example.ts): per PVGIS si sommano alle ombre. */
export const CLIMATE_PV_LOSS_PCT = 14;
const MAX_PROFILE_BYTES = 2_000_000;

const PLANE: Record<PvPlane, { inclinazione: number; orientamento: number }> = {
  E20: { inclinazione: 20, orientamento: -90 }, E35: { inclinazione: 35, orientamento: -90 },
  S20: { inclinazione: 20, orientamento: 0 }, S35: { inclinazione: 35, orientamento: 0 },
  O20: { inclinazione: 20, orientamento: 90 }, O35: { inclinazione: 35, orientamento: 90 },
};

/** Perdite totali per PVGIS: quelle di sistema del clima più ombre e perdite aggiunte nel progetto. */
export const pvgisLoss = (lossPct: number) => Math.round(1000 * (1 - (1 - CLIMATE_PV_LOSS_PCT / 100) * (1 - lossPct / 100))) / 10;
/** Il contrario: le perdite da aggiungere a quelle del clima. */
export const extraLoss = (perditePct: number) => Math.max(0, Math.round(1000 * (1 - (1 - perditePct / 100) / (1 - CLIMATE_PV_LOSS_PCT / 100))) / 10);

/** La falda del clima più vicina a inclinazione e orientamento (convenzione PVGIS: 0 sud, −90 est, 90 ovest). */
export function nearestPlane(inclinazione: number, orientamento: number): PvPlane {
  const side = orientamento < -45 ? "E" : orientamento > 45 ? "O" : "S";
  return `${side}${inclinazione < 27.5 ? 20 : 35}` as PvPlane;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Le serie orarie (W) di un pacchetto: consumi prima del FV, produzione, prelievi e immissioni dopo l'eventuale batteria. */
export function packageSeries(p: ProjectInput, climate: ClimatePackage, r: PackageResult) {
  const other = otherUsesDemand(p, r.otherUses_kWh, climate);
  let demand = other.map((x, h) => x + (r.hp ? r.hp.elec[h] : 0) + (r.cooling ? r.cooling.elec[h] : 0) + (r.dhw ? r.dhw.result.elec[h] : 0) + (r.ev ? r.ev.elec[h] : 0));
  if (r.cooking) demand = demand.map((x, h) => x + r.cooking!.elec[h]);
  const pv = p.existingPv.present ? packagePv(climate, p, false) : r.has.P ? pvProduction(climate, p.pv.plane, r.pvKwp, p.pv.lossPct.value) : null;
  if (r.battery && pv) {
    const h = simulateBattery(demand, pv, { ...batteryParams(p), capacity_kWh: r.battery.capacity_kWh }, { hourly: true }).hourly!;
    return { demand, pv, import: h.import, export: h.export };
  }
  const imp = new Array<number>(HOURS), exp = new Array<number>(HOURS);
  for (let h = 0; h < HOURS; h++) {
    const v = pv ? pv[h] : 0;
    imp[h] = Math.max(demand[h] - v, 0);
    exp[h] = Math.max(v - demand[h], 0);
  }
  return { demand, pv, import: imp, export: exp };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / 1000;

/** Anche il download dei soli prelievi usa la serie completa della casa, auto compresa. Formato invariato. */
export function packageConsumptionCurve(p: ProjectInput, climate: ClimatePackage, r: PackageResult) {
  if (!r.valid) throw new Error("Pacchetto non valido: nessuna curva da esportare.");
  return consumptionCurve(packageSeries(p, climate, r).import, curveDescription(p, r), curvePvKwp(p, r), r.battery?.capacity_kWh ?? 0);
}

function curveOf(series_W: number[]): ProfileCurve {
  const c = consumptionCurve(series_W, "profilo");
  return { kwh_annui: c.kwh_annui, ore: c.ore };
}

/** Prelievi a 864 celle, ammessi anche tutti a zero (FV e batteria grandi). */
function importCurveOf(series_W: number[]): ProfileCurve {
  if (series_W.some((v) => v > 0)) return curveOf(series_W);
  return { kwh_annui: 0, ore: new Array<number>(CURVE_CELLS).fill(0) };
}

/** Uno scenario del profilo da un pacchetto valido. */
export function profileScenario(p: ProjectInput, climate: ClimatePackage, r: PackageResult): ProfileScenario {
  const s = packageSeries(p, climate, r);
  const e = p.existingPv;
  const fv = e.present
    ? { kwp: e.kWp.value, ...PLANE[e.plane], perdite_pct: pvgisLoss(e.lossPct.value), esistente: true }
    : r.has.P ? { kwp: r.pvKwp, ...PLANE[p.pv.plane], perdite_pct: pvgisLoss(p.pv.lossPct.value), esistente: false } : null;
  const b = p.battery;
  const consumi = curveOf(s.demand);
  return {
    id: r.id,
    nome: r.label,
    attuale: r.id === "base",
    consumi: {
      natura: "calcolato",
      stato: p.consumption.electricityKwh.status,
      ...consumi,
      usi: {
        // Il formato v1 ha tre voci: lo scaldacqua e l'auto sono compresi negli altri usi.
        altri_usi_kwh: r.cooking ? r1(r.otherUses_kWh + (r.dhw ? r.dhw.result.elec_kWh : 0) + (r.ev ? r.ev.home_kWh : 0) + r.cooking.elec_kWh) : r1(r.otherUses_kWh + (r.dhw ? r.dhw.result.elec_kWh : 0) + (r.ev ? r.ev.home_kWh : 0)),
        ...(r.hp ? { pompa_di_calore_kwh: r1(sum(r.hp.elec)) } : {}),
        ...(r.cooling ? { raffrescamento_kwh: r1(sum(r.cooling.elec)) } : {}),
      },
    },
    fv,
    batteria: r.battery && fv ? { capacita_kwh: r.battery.capacity_kWh, potenza_kw: b.powerKw.value, rendimento_pct: b.roundTripPct.value, riserva_pct: b.reservePct.value } : null,
    prelievi: fv ? importCurveOf(s.import) : { ...consumi },
    ...(fv ? { stima: { immissioni_kwh: r1(sum(s.export)), autoconsumo_kwh: r1(sum(s.demand) - sum(s.import)) } } : {}),
  };
}

/** Il profilo energetico della casa: situazione attuale e pacchetti validi. */
export function exportEnergyProfile(p: ProjectInput, climate: ClimatePackage, packages: PackageResult[], today = new Date()): EnergyProfile {
  const valid = packages.filter((r) => r.valid);
  if (!valid.length) throw new Error("Nessun pacchetto valido: il profilo non ha scenari da portare.");
  const loc = p.location;
  const price = p.tariffs.elecPrice;
  // Il prezzo variabile del progetto, imposte comprese: alla CER serve per il risparmio in bolletta dell'autoconsumo.
  const bolletta: ProfileBill | null = price.status !== "sconosciuto" && isNum(price.value) && price.value >= 0 && price.value <= 1
    ? { eur_kwh: price.value, stato: price.status } : null;
  return {
    formato: PROFILE_FORMAT,
    versione: bolletta ? 2 : 1,
    fonte: "simulatore-casa",
    motore: `casa-1R1C ${ENGINE_VERSION}`,
    data: today.toISOString().slice(0, 10),
    descrizione: loc.name ? `Casa a ${loc.name}` : "Casa",
    comune: /^\d{6}$/.test(loc.code) ? { codice_istat: loc.code, nome: loc.name, lat: loc.lat, lon: loc.lon } : null,
    scenari: valid.map((r) => profileScenario(p, climate, r)),
    esclusi: [...PROFILE_EXCLUDED],
    ...(bolletta ? { bolletta } : {}),
  };
}

// --- lettura -----------------------------------------------------------------------------------------------------

const STATUSES: DataStatus[] = ["documentato", "misurato", "ipotizzato", "sconosciuto"];
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export interface ProfileImport {
  input?: ProjectInput;
  errors: string[];
  warnings: string[];
}

/** Il testo è un profilo energetico (e non un progetto di Casa)? */
export function isEnergyProfile(text: string): boolean {
  try {
    const d: unknown = JSON.parse(text);
    return isObj(d) && d.formato === PROFILE_FORMAT;
  } catch {
    return false;
  }
}

/** Controlli essenziali di un profilo non fidato: formato, versione, scenario attuale, 864 celle finite. */
export function parseEnergyProfile(text: string): { profile?: EnergyProfile; errors: string[] } {
  if (text.length > MAX_PROFILE_BYTES) return { errors: ["File troppo grande per un profilo energetico."] };
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return { errors: ["Il file non è JSON valido."] };
  }
  if (!isObj(d) || d.formato !== PROFILE_FORMAT) return { errors: ["Non è un profilo energetico."] };
  if (d.versione !== 1 && d.versione !== 2) return { errors: [`Versione ${String(d.versione)} del profilo non supportata: questo simulatore legge la 1 e la 2.`] };
  if (!Array.isArray(d.scenari) || d.scenari.length < 1 || d.scenari.length > 20) return { errors: ["Il profilo deve avere da 1 a 20 scenari."] };
  const errors: string[] = [];
  for (const [i, s] of (d.scenari as unknown[]).entries()) {
    const c = isObj(s) && isObj(s.consumi) ? s.consumi : null;
    if (!isObj(s) || typeof s.id !== "string" || typeof s.nome !== "string" || typeof s.attuale !== "boolean" || !c) errors.push(`Scenario ${i + 1}: id, nome, attuale e consumi obbligatori.`);
    else if (!isNum(c.kwh_annui) || c.kwh_annui < 0 || !Array.isArray(c.ore) || c.ore.length !== CURVE_CELLS || !c.ore.every((v) => isNum(v) && v >= 0)) errors.push(`Scenario «${s.nome}»: consumi annui e ${CURVE_CELLS} valori orari finiti e non negativi.`);
    else if (!STATUSES.includes(c.stato as DataStatus)) errors.push(`Scenario «${s.nome}»: stato dei consumi non valido.`);
  }
  if (d.bolletta !== undefined && (d.versione !== 2 || !isObj(d.bolletta) || !isNum(d.bolletta.eur_kwh) || d.bolletta.eur_kwh < 0 || d.bolletta.eur_kwh > 1 || !STATUSES.includes(d.bolletta.stato as DataStatus))) errors.push("Prezzo della bolletta non valido: serve la versione 2, un prezzo tra 0 e 1 €/kWh e il suo stato.");
  if (d.comune !== null && !(isObj(d.comune) && typeof d.comune.codice_istat === "string" && typeof d.comune.nome === "string")) errors.push("Comune non valido.");
  return errors.length ? { errors } : { profile: d as unknown as EnergyProfile, errors };
}

/**
 * Un progetto nuovo dal profilo: comune, consumo elettrico (con la curva misurata se il profilo la porta) e FV già
 * installato, dallo scenario della situazione attuale. Il resto resta quello di `base` (le ipotesi dichiarate di un
 * progetto nuovo). Una batteria già installata non si rappresenta: si avvisa.
 */
export function projectFromProfile(text: string, base: ProjectInput, comuni?: readonly Comune[], climateIndex?: ClimateIndexEntry[]): ProfileImport {
  const { profile, errors } = parseEnergyProfile(text);
  if (!profile) return { errors, warnings: [] };
  const s = profile.scenari.find((x) => x.attuale);
  if (!s) return { errors: ["Il profilo non ha la situazione attuale: in Casa si parte da quella."], warnings: [] };
  const warnings: string[] = [];
  let p: ProjectInput = structuredClone(base);
  const origin = `profilo energetico (${profile.fonte}, ${profile.data})`;
  const q = (value: number, status: DataStatus, what: string): Q => ({ value, status, source: `${what} dal ${origin}` });

  // comune e clima
  const comune = profile.comune && comuni ? comuneByCode(profile.comune.codice_istat, comuni) : undefined;
  const match = comune && climateIndex?.length ? suggestClimate(comune, climateIndex) : null;
  if (comune && match) p = applyLocation(p, comune, match);
  else if (profile.comune) warnings.push(`Comune «${profile.comune.nome}» non trovato nell'anagrafe o clima non disponibile: sceglilo nel passo Località.`);
  else warnings.push("Il profilo non indica il comune: sceglilo nel passo Località.");

  // consumi: gli altri usi se il profilo li distingue, altrimenti tutto il consumo elettrico
  const c = s.consumi;
  const other = c.usi?.altri_usi_kwh;
  p.consumption.electricityKwh = q(isNum(other) ? other : c.kwh_annui, c.stato, isNum(other) ? "Altri usi elettrici" : "Consumo elettrico");
  if (!isNum(other) && (c.usi?.pompa_di_calore_kwh || c.usi?.raffrescamento_kwh)) warnings.push("Il consumo elettrico del profilo comprende pompa di calore o raffrescamento: controllalo nel passo Consumi.");
  const fv = s.fv;
  if (c.natura === "misurato" && !fv && isNum(c.giorni) && typeof c.dal === "string" && typeof c.al === "string") {
    p.consumption.measuredCurve = { ore: c.ore.map((v) => Math.round(v * 1e5) / 1e5), giorni: c.giorni, dal: c.dal, al: c.al, fonte: `Curva misurata dal ${origin}` };
    warnings.push("Dal profilo arriva la curva misurata del contatore: la forma oraria dei consumi è quella vera.");
  }

  // FV già installato
  if (fv?.esistente && isNum(fv.kwp) && fv.kwp > 0) {
    const plane = nearestPlane(fv.inclinazione, fv.orientamento);
    p.existingPv = {
      ...p.existingPv,
      present: true,
      kWp: q(fv.kwp, "documentato", "Potenza del FV"),
      plane,
      lossPct: q(extraLoss(fv.perdite_pct), "ipotizzato", "Ombre e perdite oltre il 14% del clima"),
      consumptionFrom: "inverter",
    };
    if (PLANE[plane].inclinazione !== fv.inclinazione || PLANE[plane].orientamento !== fv.orientamento)
      warnings.push(`Falda del FV approssimata a ${plane}: Casa usa inclinazioni di 20° o 35° verso est, sud o ovest.`);
  }
  // prezzo variabile dell'elettricità
  const bill = profile.bolletta;
  if (bill && bill.stato !== "sconosciuto") p.tariffs.elecPrice = q(bill.eur_kwh, bill.stato, "Prezzo variabile dell'elettricità");
  if (s.batteria) warnings.push("Il profilo ha una batteria nella situazione attuale: Casa non rappresenta una batteria già installata, la valuta solo come intervento.");
  if (!profile.scenari.some((x) => x.attuale && x.consumi.natura === "misurato")) warnings.push("Consumi del profilo calcolati, non misurati: se hai la curva del contatore caricala nel passo Consumi.");
  warnings.push("Edificio, impianto e interventi partono dalle ipotesi di un progetto nuovo: completali nei passi.");
  return { input: p, errors: [], warnings };
}

/** Cella della curva per l'ora h del calendario sintetico (riesportata per i test incrociati). */
export const profileCell = curveCell;
