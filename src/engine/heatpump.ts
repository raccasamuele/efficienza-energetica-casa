import { HOURS, type ClimatePackage } from "./climate";
import catalog from "./data/heatpumps.json";
import { EER_MAX, EER_MIN, coolingFromLoad, type CoolingResult } from "./cooling";
import { DEFAULT_HEATING_SEASON, RECOVERY_HOURS } from "./thermal";
import type { HeatPumpIntervention, ProjectInput, SystemInput } from "./types";

export const PARAMETRIC_AUX_DEFAULTS = {
  pTO_W: { value: 16, status: "ipotizzato", source: "Mediana degli otto modelli hplib del catalogo; stima parametrica provvisoria.", date: "2026-11-09" },
  pOFF_W: { value: 16, status: "ipotizzato", source: "Mediana degli otto modelli hplib del catalogo; stima parametrica provvisoria.", date: "2026-11-09" },
  pCK_W: { value: 0, status: "ipotizzato", source: "Mediana degli otto modelli hplib del catalogo; stima parametrica provvisoria.", date: "2026-11-09" },
} as const;

export interface CatalogHeatPump {
  id: string;
  manufacturer: string;
  model: string;
  family?: string;
  variant?: string;
  csvRow?: number;
  scopConditions?: string;
  certificate?: { registration: string | null; revision: string | null; schemeRevision?: string | null; standardsEdition?: string; url?: string; page: string; sha256?: string; acquiredAt?: string; verification: string };
  keymarkDate: string | null;
  refrigerant: string | null;
  ratedPowerLowT_kW: number;
  ratedPowerMediumT_kW: number;
  scop: number;
  tol_C: number;
  maxFlow_C: number;
  pElRef_W: number;
  pThRef_W: number;
  pEl: number[];
  cop: number[];
  mape: { pTh: number; pEl: number; cop: number };
  aux?: { pOFF_W: number; pTO_W: number; pSB_W: number; pCK_W: number; page: string; accessDate: string; source?: string };
  fitDomain?: { points: [number, number][]; source: string; copPoints?: [number, number][]; conditions?: string }; // inviluppo comune ai fit COP e P_el
  extrapolationPolicy?: "segnala"; // solo se il risultato conta ed espone le ore estrapolate
  // raffrescamento hplib (modalità 2), solo per le macchine reversibili che li hanno
  eer?: number[];
  pElC?: number[];
  pElCRef_W?: number;
  eerRef?: number;
  mapeCooling?: { eer: number; pEl: number };
}

/** Punti osservati dei dati di raffrescamento EN 14825 usati da hplib: aria 20–35 °C, mandata 7 o 18 °C. */
export const COOL_DOMAIN = { airMin: 20, airMax: 35, flows: [7, 18] };

/**
 * Prestazione in raffrescamento di una macchina di catalogo, come hplib.simulate in modalità 2 (aria/acqua):
 * EER = p1·T_aria + p2·T_mandata + p3 + p4·T_aria; P_el = P_el_c_ref·(p1c·T' + p2c·T_mandata + p3c + p4c·T'),
 * con T' = max(T_aria, 25); potenza frigorifera EER·P_el. Null se la macchina non ha i parametri.
 */
export function catalogCooling(m: CatalogHeatPump, tAir: number, tFlow: number): { eer: number; pThC_W: number; extrapolated: boolean } | null {
  if (!m.eer || !m.pElC || !m.pElCRef_W) return null;
  const extrapolated = tAir < COOL_DOMAIN.airMin || tAir > COOL_DOMAIN.airMax || !COOL_DOMAIN.flows.includes(tFlow);
  let eer = m.eer[0] * tAir + m.eer[1] * tFlow + m.eer[2] + m.eer[3] * tAir;
  const t = Math.max(tAir, 25);
  let pEl = (m.pElC[0] * t + m.pElC[1] * tFlow + m.pElC[2] + m.pElC[3] * t) * m.pElCRef_W;
  if (pEl < 0) {
    eer = 0;
    pEl = 0;
  }
  if (eer <= 1) return { eer: 0, pThC_W: 0, extrapolated };
  return { eer, pThC_W: eer * pEl, extrapolated };
}

export const HP_CATALOG: CatalogHeatPump[] = catalog.models as unknown as CatalogHeatPump[];
export const HP_CATALOG_SOURCE: string = catalog.source;
export const findCatalogHp = (id: string) => HP_CATALOG.find((m) => m.id === id);

/** Temperatura dell'aria oltre la quale si usano i valori a 12 °C (ultimo punto EN 14825): scelta conservativa. */
const CAT_T_HIGH = 12;
/** Limite prudenziale provvisorio, non il dominio osservato del fit: TOL non lo documenta. */
const CAT_T_LOW = -7;
/** Da −7 °C in su si assume disponibile almeno la potenza dichiarata a −7 °C (la curva EN 14825 segue il carico). */
const CAT_T_REF = -7;
/** Mandata massima prudenziale del progetto: non è il limite osservato del fit. */
const CAT_FLOW_MAX = 55;

export function hasFitDomain(m: CatalogHeatPump): boolean {
  const d = m.fitDomain;
  return !!d?.source.trim() && !!d.points && d.points.length >= 3 && d.points.every((p) => p.length === 2 && p.every(Number.isFinite)) && domainHull(d.points).length >= 3;
}

const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function domainHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (ps: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of ps) {
      while (h.length > 1 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Interpolazione solo nell'inviluppo convesso dei punti osservati, mai nel solo rettangolo TOL/WTOL. */
export function inCatalogFitDomain(m: CatalogHeatPump, tAir: number, tFlow: number): boolean {
  if (!Number.isFinite(tAir) || !Number.isFinite(tFlow) || !hasFitDomain(m)) return false;
  const hull = domainHull(m.fitDomain!.points);
  return hull.every((p, i) => cross(p, hull[(i + 1) % hull.length], [tAir, tFlow]) >= -1e-9);
}

function catalogInputs(m: CatalogHeatPump, tAir: number, tFlow: number): [number, number] | null {
  if (![tAir, tFlow].every(Number.isFinite) || tAir < m.tol_C || tFlow > Math.min(m.maxFlow_C, CAT_FLOW_MAX)) return null;
  if (hasFitDomain(m) && m.extrapolationPolicy !== "segnala") return inCatalogFitDomain(m, tAir, tFlow) ? [tAir, tFlow] : null;
  // Dati attuali senza punti di origine: limite prudenziale, con incertezza dichiarata nel risultato.
  if (tAir < CAT_T_LOW || tFlow < HP_DOMAIN.tFlowMin) return null;
  return [Math.min(tAir, CAT_T_HIGH), tFlow];
}

function catalogFit(m: CatalogHeatPump, tAir: number, tFlow: number) {
  const ta = tAir;
  const c = m.cop[0] * ta + m.cop[1] * tFlow + m.cop[2] + m.cop[3] * ta;
  const pel = m.pElRef_W * (m.pEl[0] * ta + m.pEl[1] * tFlow + m.pEl[2] + m.pEl[3] * ta);
  return { cop: c, pTh: pel * c };
}

/** Potenza termica disponibile di una macchina del catalogo (W), come usata nel calcolo. */
export function catalogPower(m: CatalogHeatPump, tAir: number, tFlow: number): number {
  const input = catalogInputs(m, tAir, tFlow);
  if (!input) return 0;
  const here = catalogFit(m, ...input).pTh;
  const refInput = catalogInputs(m, CAT_T_REF, tFlow);
  if (!refInput) return here; // non si estende il fit nemmeno per costruire la correzione di capacità
  const ref = catalogFit(m, ...refInput).pTh;
  // sopra −7 °C almeno la potenza a −7 °C; sotto, mai più della potenza a −7 °C (il fit segue la curva di carico EN 14825)
  return tAir >= CAT_T_REF ? Math.max(here, ref) : Math.min(here, ref);
}

export interface Performance {
  inDomain: boolean;
  cop: number;
  capW: number;
  extrapolated?: boolean;
}

/** Prestazione in un'ora: modello di catalogo (dati Keymark via hplib) o parametrico. */
export function performance(tAir: number, tFlow: number, hp: HeatPumpIntervention): Performance {
  if (![tAir, tFlow, hp.copFactor.value].every(Number.isFinite) || hp.copFactor.value <= 0) return { inDomain: false, cop: NaN, capW: 0 };
  if (hp.model === "catalogo") {
    const m = findCatalogHp(hp.catalogId);
    if (!m) return { inDomain: false, cop: NaN, capW: 0 };
    const input = catalogInputs(m, tAir, tFlow);
    if (!input) return { inDomain: false, cop: NaN, capW: 0 };
    const here = catalogFit(m, ...input);
    const capW = catalogPower(m, tAir, tFlow);
    if (!(here.cop > 1) || !(capW > 0)) return { inDomain: false, cop: NaN, capW: 0 };
    const ref = catalogInputs(m, CAT_T_REF, tFlow);
    const extrapolated = hasFitDomain(m) && (!inCatalogFitDomain(m, tAir, tFlow) || !!ref && !inCatalogFitDomain(m, ...ref));
    return { inDomain: true, cop: Math.min(COP_MAX, here.cop) * hp.copFactor.value, capW, extrapolated };
  }
  const inDomain =
    tAir >= hp.minOutdoorTemp.value &&
    tAir >= HP_DOMAIN.tOutMin &&
    tAir <= HP_DOMAIN.tOutMax &&
    capacityRel(tAir, hp) >= CAP_REL_MIN &&
    tFlow >= HP_DOMAIN.tFlowMin &&
    tFlow <= hp.maxFlowTemp.value &&
    tFlow <= HP_DOMAIN.tFlowMax;
  return inDomain ? { inDomain, cop: cop(tAir, tFlow, hp) * hp.copFactor.value, capW: capacityW(tAir, hp) } : { inDomain, cop: NaN, capW: 0 };
}

/**
 * Modello PDC parametrico ESPLORATIVO (non una macchina documentata):
 * COP = η_Carnot · T_cond / (T_cond − T_evap), con T_cond = T_mandata + 5 K e T_evap = T_est − 5 K;
 * fattore di sbrinamento fra −7 e +5 °C su COP e potenza; potenza lineare in T_est attorno ad A7.
 * Nessuna estrapolazione fuori dominio e nessun backup implicito. Il carico parziale è corretto sotto la modulazione minima.
 */
const DT_COND = 5;
const DT_EVAP = 5;
const COP_MIN = 1;
const COP_MAX = 8;
const CAP_REL_MIN = 0.3;
const CAP_REL_MAX = 1.3;

export const HP_DOMAIN = { tOutMin: -20, tOutMax: 35, tFlowMin: 25, tFlowMax: 65 };

export const it1 = (v: number) => v.toFixed(1).replace(".", ",");

const inDefrost = (tOut: number) => tOut > -7 && tOut < 5;

/** Curva climatica: mandata in funzione della temperatura esterna, ancorata al punto di progetto e al setpoint. */
export function flowTemperature(tOut: number, designFlow: number, designOut: number, tIndoor = 20): number {
  if (tOut >= tIndoor) return HP_DOMAIN.tFlowMin;
  const x = Math.min(1, (tIndoor - tOut) / Math.max(1, tIndoor - designOut));
  const t = tIndoor + (designFlow - tIndoor) * Math.pow(x, 1 / 1.3);
  return Math.max(HP_DOMAIN.tFlowMin, t);
}

export function cop(tOut: number, tFlow: number, hp: HeatPumpIntervention): number {
  const tc = tFlow + DT_COND + 273.15;
  const te = tOut - DT_EVAP + 273.15;
  let c = (hp.carnotEfficiency.value * tc) / Math.max(1, tc - te);
  if (inDefrost(tOut)) c *= hp.defrostFactor.value;
  return Math.min(COP_MAX, Math.max(COP_MIN, c));
}

/** Potenza relativa a A7 prima dei limiti: sotto CAP_REL_MIN l'ora è fuori dal dominio del modello. */
export function capacityRel(tOut: number, hp: HeatPumpIntervention): number {
  return 1 + hp.capacitySlope.value * (tOut - 7);
}

export function capacityW(tOut: number, hp: HeatPumpIntervention): number {
  const rel = Math.min(CAP_REL_MAX, Math.max(CAP_REL_MIN, capacityRel(tOut, hp)));
  return hp.nominalCapacity.value * 1000 * rel * (inDefrost(tOut) ? hp.defrostFactor.value : 1);
}

/** COP ridotto per cicli sotto la potenza minima modulabile. */
export function cyclingCop(copValue: number, cr: number, cd: number): number {
  if (cr === 1 || cd === 1) return copValue;
  return copValue * cr / (cd * cr + 1 - cd);
}

/** Assegna ogni ora dell'anno a un solo modo del riscaldamento. */
export type HeatPumpMode = "attivo" | "termostato" | "spenta" | "carter" | "raffrescamento";
export function assignHeatPumpModes(qHeat: number[], tAir: number[], heatingSeason: boolean[], coolingHours: boolean[] = []): HeatPumpMode[] {
  return Array.from({ length: HOURS }, (_, h) => {
    if (qHeat[h] > 0) return "attivo";
    if (coolingHours[h]) return "raffrescamento";
    if (heatingSeason[h]) return tAir[h] < 10 ? "carter" : "termostato";
    return "spenta";
  });
}
export function heatPumpModeHours(qHeat: number[], tAir: number[], heatingSeason: boolean[], coolingHours: boolean[] = []): { attivo: number; termostato: number; standby: number; spenta: number; carter: number } {
  const modes = { attivo: 0, termostato: 0, standby: 0, spenta: 0, carter: 0 };
  for (const mode of assignHeatPumpModes(qHeat, tAir, heatingSeason, coolingHours)) if (mode !== "raffrescamento") modes[mode]++;
  return modes;
}

export interface HeatPumpResult {
  ok: boolean;
  blockers: string[];
  elec: number[]; // W
  elec_kWh: number;
  seasonalCop: number;
  seasonalCopNoAux: number;
  elecAux_kWh: number;
  elecCycling_kWh: number;
  hoursUndersized: number;
  hoursBelowMinModulation: number;
  hoursOutOfDomain: number;
  hoursExtrapolated: number;
  heatExtrapolated_kWh: number;
  recoveryDeferred_kWh: number;
  minFlowMargin: number;
}

/**
 * Nelle ore di recupero a inizio stagione la PDC può rinviare alle ore successive solo l'energia
 * accumulata da recuperare (C·(Tset − T) a inizio stagione), conservandola. Ogni altra ora con
 * fabbisogno oltre la potenza, o un deficit residuo a fine finestra, rendono lo scenario non valido.
 */
export function simulateHeatPump(
  qHeat: number[],
  climate: ClimatePackage,
  hp: HeatPumpIntervention,
  sys: SystemInput,
  recovery: boolean[] = [],
  recoveryBudget_Wh: number[] = [],
  setpoint = 20,
  coolingHours: boolean[] = [],
  heatingSeason: boolean[] = DEFAULT_HEATING_SEASON,
): HeatPumpResult {
  const blockers: string[] = [];
  const elec = new Array<number>(HOURS).fill(0);
  let undersized = 0;
  let belowModulation = 0;
  let outOfDomain = 0;
  let extrapolated = 0;
  let extrapolatedHeat = 0;
  let heat = 0;
  let e = 0;
  let auxWh = 0;
  let cyclingWh = 0;
  let worstUnder = 0;
  let deficit = 0; // Wh rinviati ancora da fornire
  let budget = 0; // Wh ancora rinviabili nella finestra corrente
  let deferredTotal = 0;
  let recoveryLeft = 0;
  const modes = assignHeatPumpModes(qHeat, climate.series.tAir, heatingSeason, coolingHours);
  for (let h = 0; h < HOURS; h++) {
    const inRecovery = recovery[h] === true;
    if (recoveryBudget_Wh[h] > 0) budget = recoveryBudget_Wh[h];
    if (!inRecovery && deficit > 0) {
      recoveryLeft += deficit;
      deficit = 0;
    }
    const q = qHeat[h] + (inRecovery ? deficit : 0);
    if (q <= 0) {
      let pAux = 0;
      if (modes[h] === "raffrescamento") continue;
      if (modes[h] === "termostato") pAux = hp.pTO_W.value;
      else if (modes[h] === "carter") pAux = hp.pTO_W.value + hp.pCK_W.value;
      else if (modes[h] === "spenta") pAux = hp.pOFF_W.value;
      auxWh += pAux;
      elec[h] = pAux;
      e += pAux;
      continue;
    }
    const tOut = climate.series.tAir[h];
    const tFlow = flowTemperature(tOut, sys.designFlowTemp.value, sys.designOutdoorTemp.value, setpoint);
    const perf = performance(tOut, tFlow, hp);
    if (!perf.inDomain) {
      outOfDomain++;
      if (inRecovery) {
        recoveryLeft += deficit;
        deficit = 0;
      }
      continue;
    }
    if (inRecovery) deficit = 0;
    const cap = perf.capW;
    let delivered = q;
    if (q > cap * 1.0001) {
      const excess = q - cap;
      const newDeferral = Math.max(0, excess - (q - qHeat[h])); // al netto del deficit già rinviato
      if (inRecovery && newDeferral <= budget) {
        delivered = cap;
        deficit = excess;
        budget -= newDeferral;
        deferredTotal = Math.max(deferredTotal, excess);
      } else {
        undersized++;
        worstUnder = Math.max(worstUnder, excess);
        continue;
      }
    }
    let c = perf.cop;
    if (hp.model === "parametrico" && hp.minModulation.value > 0 && delivered / cap < hp.minModulation.value) {
      belowModulation++;
      const cr = delivered / (hp.minModulation.value * cap);
      const degraded = cyclingCop(c, cr, hp.cyclingCd.value);
      cyclingWh += delivered / degraded - delivered / c;
      c = degraded;
    }
    if (perf.extrapolated) {
      extrapolated++;
      extrapolatedHeat += delivered;
    }
    const activeAux = hp.extraPump_W.value;
    elec[h] = delivered / c + activeAux;
    heat += delivered;
    e += delivered / c + activeAux;
    auxWh += activeAux;
  }
  recoveryLeft += deficit;
  if (recoveryLeft > 1)
    blockers.push(
      `Recupero di inizio stagione non completato entro ${RECOVERY_HOURS} h (${it1(recoveryLeft / 1000)} kWh non forniti): potenza insufficiente.`,
    );
  if (sys.designFlowTemp.status === "sconosciuto")
    blockers.push("Temperatura di mandata sconosciuta: il risultato PDC è solo uno scenario condizionato alla mandata ipotizzata.");
  if (outOfDomain > 0)
    blockers.push(`${outOfDomain} ore con temperatura esterna, potenza relativa o mandata fuori dalle condizioni in cui il modello è valido: ${hp.model === "catalogo" ? "queste ore sono bloccate; le estrapolazioni consentite entro i limiti prudenziali sono conteggiate separatamente" : "nessuna estrapolazione"}, confronto PDC non completo.`);
  if (undersized > 0)
    blockers.push(
      `${undersized} ore con fabbisogno superiore alla potenza disponibile (scarto massimo ${it1(worstUnder / 1000)} kW): nessun backup implicito, confronto PDC non completo.`,
    );
  if (deferredTotal > 0)
    blockers.push(
      `A inizio stagione la PDC riporta la casa al setpoint in più ore (fino a ${it1(deferredTotal / 1000)} kWh rinviati entro ${RECOVERY_HOURS} h): servizio temporaneamente sotto setpoint rispetto al caso ideale.`,
    );
  const ok = outOfDomain === 0 && undersized === 0 && recoveryLeft <= 1;
  return {
    ok,
    blockers,
    elec,
    elec_kWh: e / 1000,
    seasonalCop: e > 0 ? heat / e : NaN,
    seasonalCopNoAux: e - auxWh - cyclingWh > 0 ? heat / (e - auxWh - cyclingWh) : NaN,
    elecAux_kWh: auxWh / 1000,
    elecCycling_kWh: cyclingWh / 1000,
    hoursUndersized: undersized,
    hoursBelowMinModulation: belowModulation,
    hoursOutOfDomain: outOfDomain,
    hoursExtrapolated: extrapolated,
    heatExtrapolated_kWh: extrapolatedHeat / 1000,
    recoveryDeferred_kWh: deferredTotal / 1000,
    minFlowMargin: hp.maxFlowTemp.value - sys.designFlowTemp.value,
  };
}

/** Mandata d'acqua fredda: 7 °C con i ventilconvettori, 18 °C con i pannelli radianti (sopra il punto di rugiada). */
export const COOL_FLOW = { ventilconvettori: 7, radiante: 18 };

/** EER parametrico esplorativo della PDC: Carnot ridotto tarato sull'EER dichiarato ad aria 35 °C e mandata 7 °C. */
export function parametricEer(tAir: number, tFlow: number, eer35: number): number {
  const carnot = (te: number, tc: number) => (te + 273.15) / Math.max(1, tc - te);
  const eer = (eer35 / carnot(7 - 5, 35 + 10)) * carnot(tFlow - 5, tAir + 10);
  return Math.min(EER_MAX, Math.max(EER_MIN, eer));
}

/** La PDC del progetto può raffrescare? Solo se oggi si raffresca, con terminali adatti e una macchina reversibile. */
export function heatPumpCooling(p: ProjectInput): { ok: true; flow: number } | { ok: false; reason: string } {
  const hp = p.heatPump;
  if (p.cooling.today !== "split") return { ok: false, reason: "La casa non è raffrescata oggi: la PDC non aggiunge raffrescamento ai conti." };
  const em = p.system.emitters;
  if (em === "radiatori") return { ok: false, reason: "Con i radiatori la PDC non può raffrescare: restano gli split." };
  if (em === "nonNoto") return { ok: false, reason: "Con terminali non noti la PDC non raffresca nel confronto: restano gli split." };
  if (!hp.reversible) return { ok: false, reason: "PDC non reversibile: restano gli split." };
  if (hp.model === "catalogo") {
    const cat = findCatalogHp(hp.catalogId);
    if (!cat?.eer) return { ok: false, reason: `${cat ? `${cat.manufacturer} ${cat.model}` : "Macchina del catalogo"} senza dati di raffrescamento in hplib: restano gli split.` };
  }
  return { ok: true, flow: COOL_FLOW[em] };
}

/** Raffrescamento con la PDC: catalogo con i fit hplib (ore fuori dai punti osservati contate), oppure parametrica. */
export function simulateHeatPumpCooling(qCool: number[], climate: ClimatePackage, hp: HeatPumpIntervention, flow: number): CoolingResult {
  const f = hp.eerFactor.value;
  const cat = hp.model === "catalogo" ? findCatalogHp(hp.catalogId) : undefined;
  if (cat?.eer) {
    return coolingFromLoad(
      qCool,
      (h) => {
        const c = catalogCooling(cat, climate.series.tAir[h], flow)!;
        return { eer: c.eer > 0 ? c.eer * f : 1, capW: c.pThC_W, extrapolated: c.extrapolated };
      },
      `PDC reversibile ${cat.manufacturer} ${cat.model} (dati hplib), mandata ${flow} °C`,
    );
  }
  const capW = hp.nominalCapacity.value * 1000;
  return coolingFromLoad(qCool, (h) => ({ eer: parametricEer(climate.series.tAir[h], flow, hp.eer35.value) * f, capW }), `PDC reversibile (parametrica), mandata ${flow} °C`);
}
