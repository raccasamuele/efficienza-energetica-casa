import { INCENTIVE_PRESETS, type IncentivePresetId } from "./incentivi";
import type { ClimatePackage } from "./climate";
import { cashFlow, checkCashFlow, incentivePresentValue, summarizeCost, type CashFlowInput, type CashFlowResult } from "./economics";
import { balance, packagePv, pvDegradationFlows, pvProduction, type Balance } from "./electric";
import { sizePackage, sizesOf, type PackageSizing, type Sizes } from "./sizing";
import { batteryEstimate, batteryReplacementEstimate, pvEstimate } from "./costs";
import { quoteSizeNotes } from "./quality";
import { batteryActive, batteryLife, batteryParams, batteryYearlyFlows, simulateBattery } from "./battery";
import { simulateSplit, type CoolingResult } from "./cooling";
import { exportBeyondPv, fromMeter, otherUsesDemand, reconstructedOre, usesMeasuredCurve } from "./curva";
import { curveAnnualKwh } from "./misure";
import { findCatalogHp, flowTemperature, performance, hasFitDomain, heatPumpCooling, it1, simulateHeatPump, simulateHeatPumpCooling, type HeatPumpResult } from "./heatpump";
import { locationIssues } from "./location";
import { HOB_COST_ESTIMATE_SOURCE, METER_CLOSURE_ESTIMATE_SOURCE } from "./example";
import { checkProject, isDocumented, type Issue } from "./quality";
import { billGasMean, billGasYears } from "./diagnosi";
import { ESTIMATED_HEATING_POWER_FACTOR, scheduledHeating, seasonMask, simulateThermal, withContinuousPeaks, type ScheduleResult, type ThermalResult } from "./thermal";
import { activeInsulation, envelopeBuilding, envelopeCost, envelopeLabel, envelopeUpgrade, insulationName } from "./involucro";
import { withHomeValue, type HomeValueScenario } from "./valore";
import { coldWaterC, DHW_TYPE_LABEL, dhwCost, dhwDraws, dhwNeed, dhwNeedFromGas, dhwNeedFromPeople, dhwTankParams, plantLabel, simulateTank, todayBoiler, type TankResult } from "./acqua";
import { PACKAGE_IDS, PACKAGE_LABELS, type PackageId, type ProjectInput, type Q, type Replacement } from "./types";

import { evNeed, evPackage, simulateEv, type EvPackageResult } from "./auto";

export interface ServiceLine {
  service: "Riscaldamento" | "ACS" | "Cucina" | "Altri usi elettrici" | "Raffrescamento" | "Auto elettrica (ricarica a casa)";
  carrier: "gas" | "elettricità";
  generator: string;
  final_kWh: number;
  smc?: number;
}

export interface CostLines {
  gasPurchase: number;
  gasFixed: number;
  elecPurchase: number;
  elecFixed: number;
  elecPower: number;
  exportRevenue: number;
  maintenanceDelta: number;
  total: number; // acquisti + fissi + potenza (prima di export e manutenzione)
}

type TaggedReplacement = { replacement: Replacement; block: "W" | "H" | "P" };

export interface PackageResult {
  schedule?: ScheduleResult;
  id: PackageId;
  label: string;
  has: { W: boolean; H: boolean; P: boolean };
  valid: boolean;
  blockers: string[];
  conditions: string[];
  heatNeed_kWh: number;
  heatNeedPerM2: number;
  peak_kW: number;
  unheatedSpaces: ThermalResult["unheatedSpaces"];
  recoveryPeak_kW: number;
  gasSmc: number;
  gasKwh: number;
  elec: Balance;
  ev?: EvPackageResult;
  hp?: HeatPumpResult;
  cooking?: { elec: number[]; elec_kWh: number; gasMeterClosed: boolean };
  dhw?: { result: TankResult; generator: string; need_kWh: number; from: "gas" | "persone"; replacesToday: "gas" | "boiler" };
  cooling?: CoolingResult; // solo se la casa è raffrescata oggi
  coolNeed_kWh: number; // fabbisogno di raffrescamento (frigorifero), sempre calcolato
  coolingNotes: string[]; // informazioni estive fuori dai conti
  services: ServiceLine[];
  costs: CostLines;
  annualSaving: number; // spesa evitata: C_base − C_scenario (acquisti + fissi + potenza)
  annualBenefit: number; // spesa evitata + Δ cessione − Δ manutenzione (senza sostituzioni)
  investment: number;
  investmentTotal: number;
  economicsComplete: boolean;
  economicsMissing: string[];
  cash?: CashFlowResult;
  flowParts?: { annualBenefit: number; ageing: number[]; replacements: { year: number; amount: number; block: "W" | "H" | "P" }[] };
  serviceGapPct: number; // quanto cambia il freddo non fornito rispetto alla situazione attuale, % del fabbisogno
  comparable: boolean; // stesso servizio della situazione attuale, entro SERVICE_GAP_LIMIT
  otherUses_kWh: number; // altri usi elettrici dell'anno (ricavati dalla bolletta se c'è un FV esistente)
  pvKwp: number; // kWp di FV nel pacchetto: il nuovo (inserito o taglia indicativa) o quello già installato
  battery?: BatteryResult; // solo nei pacchetti con la batteria
}

/** La batteria di un pacchetto e lo stesso pacchetto senza batteria: la differenza è il valore della batteria da sola. */
export interface BatteryResult {
  capacity_kWh: number;
  charge_kWh: number;
  discharge_kWh: number;
  losses_kWh: number;
  throughput_kWh: number; // energia passata dalla batteria verso la casa nel primo anno
  cyclesPerYear: number;
  selfConsumptionPct: number; // quota della produzione usata in casa
  selfSufficiencyPct: number; // quota dei consumi coperta senza la rete
  endOfLifeYear: number; // anni fra vita di calendario e cicli, il primo che arriva
  replacementYears: number[]; // anni entro l'orizzonte in cui va sostituita
  uncoveredReplacementYears: number[]; // fine vita senza una sostituzione inserita vicino
  investment: number; // costo della sola batteria
  /** La taglia successiva (+2,5 kWh) sullo stesso FV, primo anno: quanto aggiunge davvero. */
  nextStep: { capacity: number; extraBenefit: number; extraSelfSufficiencyPct: number; extraThroughput_kWh: number; extraCost: number | null };
  without: { elec: Balance; annualBenefit: number; npv: number | null; investment: number; selfConsumptionPct: number; selfSufficiencyPct: number };
  npvBattery: number | null; // VAN con − VAN senza
}

/** Quota della produzione usata in casa (subito o passando dalla batteria), %. */
const itDay = (iso: string) => iso.split("-").reverse().join("/");

export function selfConsumption(e: Balance): number {
  return e.pv_kWh > 0 ? ((e.pv_kWh - e.export_kWh) / e.pv_kWh) * 100 : 0;
}

/** Quota dei consumi coperta senza prelevare dalla rete, %. */
export function selfSufficiency(e: Balance): number {
  return e.demand_kWh > 0 ? ((e.demand_kWh - e.import_kWh) / e.demand_kWh) * 100 : 0;
}

/** Nome del pacchetto: con un FV già installato la lettera P è la batteria. */
export function packageLabel(id: PackageId, p: ProjectInput): string {
  const envelope = envelopeLabel(p);
  const plant = plantLabel(p);
  const label = id === "W" ? envelope.long : id === "H" ? plant.long : PACKAGE_LABELS[id].replace("Serramenti", envelope.short).replace("PDC", plant.short);
  if (!p.existingPv.present) return label;
  if (id === "base") return "Situazione attuale (FV esistente)";
  return label.replace(/\bFV\b|Fotovoltaico/, "batteria").replace(/^batteria/, "Batteria");
}

/**
 * Con un FV esistente la bolletta conta solo i prelievi: gli altri usi sono il consumo annuo che, con il profilo
 * scelto e la produzione simulata, dà gli stessi prelievi. È un'ipotesi: cambia con il profilo.
 */
export function otherUsesFromBill(p: ProjectInput, climate: ClimatePackage, coolingElec: number[] | null): number | null {
  const bill = p.existingPv.gridImportKwh.value;
  const pv = packagePv(climate, p, false)!;
  const shape = otherUsesDemand(p, 1000);
  const imports = (kwh: number) => {
    let s = 0;
    for (let h = 0; h < pv.length; h++) s += Math.max((shape[h] * kwh) / 1000 + (coolingElec ? coolingElec[h] : 0) - pv[h], 0);
    return s / 1000;
  };
  if (!(bill > 0) || imports(0) >= bill) return null;
  let lo = 0;
  let hi = Math.max(1000, bill);
  while (imports(hi) < bill) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (imports(mid) < bill) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Oltre questa differenza di servizio il confronto in euro non è fra cose uguali. */
export const SERVICE_GAP_LIMIT = 5;

export interface Evaluation {
  ok: boolean;
  issues: Issue[];
  documented: boolean;
  thermal: { base: ThermalResult; windows: ThermalResult } | null; // windows è l'involucro intero
  packages: PackageResult[];
  observedGapPct: number | null;
  calibration: BillCalibration | null;
  calibrationNote: string | null; // perché non si è tarato, se c'è una bolletta
  incentive: IncentiveScenario | null;
  incentiveNote: string | null; // che cosa manca allo scenario con incentivo
  homeValue: HomeValueScenario | null;
  homeValueNote: string | null;
  sizing: PackageSizing[] | null; // taglie indicative, solo senza preventivo
}

export interface IncentiveRow {
  overCap?: boolean;
  id: PackageId;
  label: string;
  total: number; // somma delle rate
  presentValue: number;
  npv: number; // VAN del modello con l'incentivo
  tunedNpv: number | null; // VAN tarato con l'incentivo
}

/** Il VAN dei pacchetti con un incentivo indicato dall'utente. Il risultato principale non lo contiene. */
export interface IncentiveScenario {
  preset?: IncentivePresetId | "personale";
  rows: IncentiveRow[];
  years: number;
  source: string;
  date: string;
}

/** Gli stessi pacchetti con il riscaldamento riportato al livello della bolletta. Il modello resta in `packages`. */
export interface BillCalibration {
  factor: number;
  billSmc: number;
  years: number;
  packages: PackageResult[];
  yearsDetail: { start: string; gasBeforeSmc: number; gasAfterSmc: number; ggPeriod: number | null; ggNormal: number | null }[];
}

/** Oltre questi fattori lo scarto dice che qualche dato è sbagliato: riscalare nasconderebbe l'errore. */
export const CALIBRATION_RANGE = { min: 0.3, max: 1.5 };

function withEnvelope(p: ProjectInput) {
  return { building: envelopeBuilding(p), upgrade: envelopeUpgrade(p) };
}

function envelopeInvestment(p: ProjectInput): number {
  return (p.envelope.windows ? summarizeCost(p.windows.cost).total : 0) + activeInsulation(p).reduce((s, kind) => s + envelopeCost(p, kind).total, 0);
}

/** Stesso fabbisogno orario in scala; il raffrescamento non cambia. */
function scaleHeating(t: ThermalResult, k: number): ThermalResult {
  if (k === 1) return t;
  return {
    ...t,
    qHeat: t.qHeat.map((q) => q * k),
    heatNeed_kWh: t.heatNeed_kWh * k,
    peak_W: t.peak_W * k,
    recoveryPeak_W: t.recoveryPeak_W * k,
    recoveryBudget_Wh: t.recoveryBudget_Wh.map((q) => q * k),
  };
}

/** Il modello e, se c'è una bolletta utilizzabile, gli stessi pacchetti tarati su di essa. */
export function evaluate(p: ProjectInput, climate: ClimatePackage): Evaluation {
  return withHomeValue(p, climate, withIncentive(p, withCalibration(p, climate, evaluateModel(p, climate))));
}

function withIncentive(p: ProjectInput, ev: Evaluation): Evaluation {
  const inc = p.economics.incentive;
  if (!ev.ok || !inc.enabled) return ev;
  if (!inc.source.trim() || !inc.date.trim()) return { ...ev, incentiveNote: "Per lo scenario con incentivo indica la fonte e la data della regola." };
  if (!(inc.windowsPct.value > 0 || inc.heatPumpPct.value > 0 || inc.pvPct.value > 0 || inc.batteryPct.value > 0)) return { ...ev, incentiveNote: "Per lo scenario con incentivo indica almeno una percentuale." };
  const { realDiscountRate: rate, horizonYears: horizon } = p.economics;
  const years = inc.years.value;
  const hp = p.heatPump;
  // Con caldaia a fine vita conta la sola spesa in più: anche la caldaia nuova avrebbe di solito un incentivo.
  const hpSpending = (hp.included ? Math.max(0, summarizeCost(hp.cost).total - (hp.boilerEndOfLife ? hp.boilerReplacementCost.value : 0)) : 0) + (p.dhw.replace ? dhwCost(p).total : 0);
  const preset = INCENTIVE_PRESETS.find((r) => r.id === inc.preset);
  const rows: IncentiveRow[] = [];
  for (const r of ev.packages) {
    if (!r.cash) continue;
    const parts = [
      r.has.W ? (envelopeInvestment(p) * inc.windowsPct.value) / 100 : 0,
      r.has.H ? (hpSpending * inc.heatPumpPct.value) / 100 : 0,
      r.has.P && !p.existingPv.present ? ((p.pv.sizing === "indicativa" ? p.pv.pricePerKwp.value * r.pvKwp : summarizeCost(p.pv.cost).total) * inc.pvPct.value) / 100 : 0,
      r.battery ? (r.battery.investment * inc.batteryPct.value) / 100 : 0,
    ];
    const spending = (r.has.W && inc.windowsPct.value > 0 ? envelopeInvestment(p) : 0)
      + (r.has.H && inc.heatPumpPct.value > 0 ? hpSpending : 0)
      + (r.has.P && !p.existingPv.present && inc.pvPct.value > 0 ? (p.pv.sizing === "indicativa" ? p.pv.pricePerKwp.value * r.pvKwp : summarizeCost(p.pv.cost).total) : 0)
      + (r.battery && inc.batteryPct.value > 0 ? r.battery.investment : 0);
    const overCap = !!preset && spending > preset.spendingCap;
    // Oltre il tetto conta solo la spesa fino al tetto, divisa fra gli interventi in proporzione alla loro spesa.
    const total = parts.reduce((a, b) => a + b, 0) * (overCap ? preset.spendingCap / spending : 1);
    const presentValue = incentivePresentValue(total, 100, years, rate.value, horizon.value);
    const tuned = ev.calibration?.packages.find((x) => x.id === r.id)?.cash;
    rows.push({ ...(overCap ? { overCap: true } : {}), id: r.id, label: r.label, total, presentValue, npv: r.cash.npv + presentValue, tunedNpv: tuned ? tuned.npv + presentValue : null });
  }
  return { ...ev, incentive: { rows, years, source: inc.source, date: inc.date, ...(inc.preset ? { preset: inc.preset } : {}) } };
}

function withCalibration(p: ProjectInput, climate: ClimatePackage, ev: Evaluation): Evaluation {
  const obs = billGasMean(p);
  if (!ev.ok || !ev.thermal || !obs) return ev;
  const sys = p.system;
  const heatSmc = ev.thermal.base.heatNeed_kWh / sys.boilerEfficiency.value / (sys.efficiencyBasis === "PCS" ? sys.gasPcs.value : sys.gasPci.value);
  const waterCook = (sys.acsOnGas ? sys.acsGasSmc.value : 0) + (sys.cookingOnGas ? sys.cookingGasSmc.value : 0);
  const detail = billGasYears(p);
  const normalized = detail.map(y => {
    let ggPeriod: number | null = null, ggNormal: number | null = null;
    if (y.start && climate.degreeDays) {
      const [year, month] = y.start.split("-").map(Number);
      const keys = Array.from({ length: 12 }, (_, i) => { const n = year * 12 + month - 1 + i; return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`; });
      const observed = climate.degreeDays.observed, normal = climate.degreeDays.normal;
      if (normal && keys.every(k => Number.isFinite(observed[k])) && keys.every(k => Number.isFinite(normal[k.slice(5)]))) {
        ggPeriod = keys.reduce((sum, k) => sum + observed[k], 0);
        ggNormal = keys.reduce((sum, k) => sum + normal[k.slice(5)], 0);
      }
    }
    const before = Math.max(0, y.smc - waterCook);
    const after = ggPeriod && ggNormal ? before * ggNormal / ggPeriod : before;
    return { start: y.start, gasBeforeSmc: before, gasAfterSmc: after, ggPeriod, ggNormal };
  });
  const unavailable = normalized.some(x => !x.ggPeriod || !x.ggNormal);
  const billHeatSmc = normalized.reduce((sum, x) => sum + x.gasAfterSmc, 0) / normalized.length;
  if (billHeatSmc <= 0) return { ...ev, calibrationNote: "Il gas in bolletta non supera quello indicato per ACS e cucina: controlla questi dati. Nessuna taratura." };
  if (!(heatSmc > 0)) return ev;
  const factor = billHeatSmc / heatSmc;
  if (factor < CALIBRATION_RANGE.min || factor > CALIBRATION_RANGE.max)
    return { ...ev, calibrationNote: "La bolletta è troppo lontana dal modello per una taratura: controlla bolletta, superficie, trasmittanze e rendimento." };
  const tuned = evaluateModel(p, climate, factor, sizesOf(ev));
  const note = unavailable ? "Periodo non indicato o gradi giorno incompleti: alcune bollette non sono riportate alla media 2015-2024." : null;
  return tuned.ok ? { ...ev, calibration: { factor, billSmc: obs.smc, years: obs.years, packages: tuned.packages, yearsDetail: normalized }, calibrationNote: note } : ev;
}

/** Il calcolo dagli input, senza confronto con la bolletta; `heatScale` scala il fabbisogno di riscaldamento. */
/** `fixedSizes`: taglie indicative già scelte (sensibilità e taratura le tengono ferme). */
/** `only`: calcola solo questi pacchetti oltre alla situazione attuale (confronto dei preventivi); stessi numeri del calcolo completo. */
export function evaluateModel(p: ProjectInput, climate: ClimatePackage, heatScale = 1, fixedSizes?: Sizes, only?: PackageId[]): Evaluation {
  const issues = [...checkProject(p), ...locationIssues(p, climate.manifest)];
  const fail = (): Evaluation => ({ ok: false, issues, documented: false, thermal: null, packages: [], observedGapPct: null, calibration: null, calibrationNote: null, incentive: null, incentiveNote: null, homeValue: null, homeValueNote: null, sizing: null });
  if (issues.some((i) => i.severity === "errore")) return fail();
  // Chi raffresca: caldo e freddo nella stessa simulazione. Chi non raffresca: il caldo resta quello senza limite
  // estivo (stessi conti del motore 0.1.x) e il freddo viene da una seconda simulazione, solo informativa.
  const cools = p.cooling.today === "split";
  const ids = only ? PACKAGE_IDS.filter((id) => id === "base" || only.includes(id)) : PACKAGE_IDS;
  const needWindows = ids.some((id) => id.includes("W"));
  const baseUpgrade = envelopeUpgrade(p, []);
  const rawBase = simulateThermal(p.building, p.service, climate, cools ? p.cooling : undefined, baseUpgrade);
  let tBase = scaleHeating(rawBase, heatScale);
  const emptyEnvelope = !p.envelope.windows && activeInsulation(p).length === 0;
  const envelope = withEnvelope(p);
  let tWin = needWindows && !emptyEnvelope ? scaleHeating(simulateThermal(envelope.building, p.service, climate, cools ? p.cooling : undefined, envelope.upgrade), heatScale) : tBase;
  const cBase = cools ? tBase : simulateThermal(p.building, p.service, climate, p.cooling, baseUpgrade);
  const cWin = cools ? tWin : needWindows && !emptyEnvelope ? simulateThermal(envelope.building, p.service, climate, p.cooling, envelope.upgrade) : cBase;
  let tHpBase = tBase, tHpWin = tWin;
  const schedule = p.service.schedule;
  if (schedule?.mode === "fasce") {
    const continuousBase = tBase, continuousWin = tWin;
    const pMax = schedule.maxPowerKw.status === "sconosciuto" ? ESTIMATED_HEATING_POWER_FACTOR * rawBase.peak_W : schedule.maxPowerKw.value * 1000;
    const simulate = (windows: boolean, power: number | number[]) => withContinuousPeaks(scaleHeating(simulateThermal(
      windows ? envelope.building : p.building, p.service, climate, cools ? p.cooling : undefined,
      windows ? envelope.upgrade : baseUpgrade, scheduledHeating(p.service, power)), heatScale), windows ? continuousWin : continuousBase);
    tBase = simulate(false, pMax);
    tWin = needWindows && !emptyEnvelope ? simulate(true, pMax) : tBase;
    if (schedule.maxPowerKw.status === "sconosciuto")
      issues.push({ section: "Servizio", severity: "nota", message: `Potenza dell'impianto non indicata: stimata in ${it1(pMax / 1000)} kW.` });
    if (schedule.withHeatPump === "come-oggi" && p.heatPump.included && ids.some((id) => id.includes("H"))) {
      const power = climate.series.tAir.map((tAir) => {
        const flow = flowTemperature(tAir, p.system.designFlowTemp.value, p.system.designOutdoorTemp.value, p.service.setpoint.value);
        const perf = performance(tAir, flow, p.heatPump);
        // §17.2.3: la simulazione è nelle unità del modello e il fabbisogno si moltiplica dopo per la scala di taratura;
        // la potenza della macchina si divide per la stessa scala, così il fabbisogno tarato non la supera mai.
        return perf.inDomain ? perf.capW / heatScale : Infinity;
      });
      tHpBase = simulate(false, power);
      tHpWin = needWindows && !emptyEnvelope ? simulate(true, power) : tHpBase;
    }
  }
  for (const e of [...tBase.errors, ...tWin.errors, ...cBase.errors, ...cWin.errors, ...tHpBase.errors, ...tHpWin.errors]) if (!issues.some((i) => i.message === e)) issues.push({ section: "Edificio", severity: "errore", message: e });
  if (!tBase.ok || !tWin.ok || !cBase.ok || !cWin.ok || !tHpBase.ok || !tHpWin.ok) return fail();
  const hpCools = heatPumpCooling(p);
  const hpCouldCool = cools ? hpCools : heatPumpCooling({ ...p, cooling: { ...p.cooling, today: "split" } });

  const sys = p.system;
  const t = p.tariffs;
  const fuelEnergyPerSmc = sys.efficiencyBasis === "PCS" ? sys.gasPcs.value : sys.gasPci.value;
  const boiler = todayBoiler(p) ? simulateTank(dhwTankParams(p, climate, true), dhwDraws(dhwNeedFromPeople(p, climate)), climate.series.tAir, null) : undefined;
  const waterNeed = p.dhw.replace ? dhwNeed(p, climate) : null;
  if (p.dhw.replace && sys.acsOnGas) {
    const gasNeed = dhwNeedFromGas(p), peopleNeed = dhwNeedFromPeople(p, climate);
    if (gasNeed !== null && Math.abs(gasNeed - peopleNeed) > .3 * peopleNeed) {
      const litres = gasNeed * 1000 / (1.163 * (40 - coldWaterC(climate)) * 365);
      issues.push({ section: "Acqua calda", severity: "esplorativo", message: `Il gas per l'acqua calda corrisponde a circa ${Math.round(litres)} litri al giorno a 40 °C; con ${p.dhw.people.value} persone e ${p.dhw.litresPerPerson.value} litri a testa sarebbero ${Math.round(p.dhw.people.value * p.dhw.litresPerPerson.value)}: controlla il gas per l'acqua calda o le persone.` });
    }
  }
  const existing = p.existingPv.present;
  const fromBill = existing && p.existingPv.consumptionFrom === "bolletta";
  let otherUsesKwh = p.consumption.electricityKwh.value;
  if (fromBill) {
    const solved = otherUsesFromBill(p, climate, cools ? simulateSplit(cBase.qCool, cBase.tMax, climate, p.cooling).elec : null);
    if (solved === null) {
      issues.push({ section: "Consumi", severity: "errore", message: "I prelievi in bolletta sono più bassi di quelli che il modello trova anche senza altri consumi: controlla prelievi, kWp e orientamento del FV esistente." });
      return fail();
    }
    otherUsesKwh = solved;
  }
  const meter = fromMeter(p);
  if (meter) {
    const c = p.consumption.measuredCurve;
    if (!c?.immissioni) {
      issues.push({ section: "Consumi", severity: "errore", message: c ? "Consumi dalla curva del contatore: manca il file delle immissioni in rete." : "Consumi dalla curva del contatore: carica il file dei prelievi e il file delle immissioni in rete." });
      return fail();
    }
    const pvNow = packagePv(climate, p, false)!;
    otherUsesKwh = curveAnnualKwh(reconstructedOre(c, pvNow));
    const beyond = exportBeyondPv(c, pvNow);
    if (beyond > 0.1)
      issues.push({ section: "Consumi", severity: "esplorativo", message: `Le immissioni misurate superano la produzione stimata del FV esistente per il ${Math.round(beyond * 100)}% delle immissioni dell'anno: probabilmente potenza, orientamento o perdite dell'impianto non sono giusti, e l'autoconsumo ricostruito è troppo basso.` });
    const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
    const im = c.immissioni;
    if (days(c.dal, im.dal) > 31 || days(c.al, im.al) > 31)
      issues.push({ section: "Consumi", severity: "esplorativo", message: `Prelievi e immissioni coprono periodi diversi (prelievi dal ${itDay(c.dal)} al ${itDay(c.al)}, immissioni dal ${itDay(im.dal)} al ${itDay(im.al)}): il consumo ricostruito mescola anni diversi.` });
  }
  if (boiler) {
    otherUsesKwh -= boiler.elec_kWh;
    if (otherUsesKwh <= 0) {
      issues.push({ section: "Acqua calda", severity: "errore", message: "Il boiler elettrico consuma più della luce indicata: controlla i consumi elettrici, le persone o i litri." });
      return fail();
    }
  }
  // Split già compresi nella luce indicata: si toglie la stima del loro consumo, che il modello aggiunge da sé.
  // Con i prelievi in bolletta (FV esistente) o la curva del contatore gli altri usi si ricavano già in altro modo.
  if (cools && p.cooling.alreadyInConsumption && !fromBill && !meter) {
    otherUsesKwh -= simulateSplit(cBase.qCool, cBase.tMax, climate, p.cooling).elec_kWh;
    if (otherUsesKwh <= 0) {
      issues.push({ section: "Consumi", severity: "errore", message: "I condizionatori consumano più della luce indicata: controlla il consumo elettrico, oppure togli «la bolletta comprende già i condizionatori»." });
      return fail();
    }
  }
  if (p.ev.enabled && p.ev.alreadyInConsumption) {
    otherUsesKwh -= evNeed(p.ev).home_kWh * (1 + p.ev.chargeLossPct.value / 100);
    if (otherUsesKwh <= 0) {
      issues.push({ section: "Auto elettrica", severity: "errore", message: "La ricarica dell'auto consuma tutta la luce indicata o la supera: controlla consumi e chilometri. Devono restare altri usi positivi." });
      return fail();
    }
  }
  const residual = otherUsesDemand(p, otherUsesKwh, climate);
  const cookSmc = sys.cookingOnGas ? sys.cookingGasSmc.value : 0;
  const tariffsKnown = [t.gasPrice, t.elecPrice, t.gasFixed, t.elecFixed, t.powerCostPerKw, t.exportPrice, t.contractPower].every((x) => x.status !== "sconosciuto");
  const endOfLife = p.heatPump.included && p.heatPump.boilerEndOfLife;
  // controfattuale: con caldaia a fine vita, i pacchetti senza PDC hanno comunque una caldaia nuova
  const gasEfficiency = endOfLife ? p.heatPump.replacementBoilerEfficiency : sys.boilerEfficiency;
  const commonMissing = [
    ...(gasEfficiency.status === "sconosciuto" ? [endOfLife ? "Rendimento della caldaia nuova (controfattuale)" : "Rendimento della caldaia di riferimento"] : []),
    ...((sys.efficiencyBasis === "PCS" ? sys.gasPcs : sys.gasPci).status === "sconosciuto" ? ["Potere calorifico del gas di riferimento"] : []),
    ...(!fromBill && !meter && p.consumption.electricityKwh.status === "sconosciuto" ? ["Consumo elettrico degli altri usi"] : []),
    ...(fromBill && p.existingPv.gridImportKwh.status === "sconosciuto" ? ["Prelievi annui in bolletta"] : []),
    ...(existing && p.existingPv.kWp.status === "sconosciuto" ? ["Potenza del FV esistente"] : []),
    ...(p.economics.horizonYears.status === "sconosciuto" ? ["Orizzonte economico"] : []),
    ...(p.economics.realDiscountRate.status === "sconosciuto" ? ["Tasso reale"] : []),
    ...(endOfLife && p.heatPump.boilerReplacementCost.status === "sconosciuto" ? ["Costo della caldaia sostitutiva (controfattuale)"] : []),
  ];
  const otherGasUnknown = [
    ...(sys.acsOnGas && sys.acsGasSmc.status === "sconosciuto" ? ["gas per ACS"] : []),
    ...(sys.cookingOnGas && sys.cookingGasSmc.status === "sconosciuto" ? ["gas per cucina"] : []),
  ];

  const costW = summarizeCost(p.windows.cost);
  const costH = summarizeCost(p.heatPump.cost);
  const costDhw = dhwCost(p);
  const indicative = p.pv.sizing === "indicativa";
  const quoteP = summarizeCost(p.pv.cost);
  const quoteB = summarizeCost(p.battery.cost);
  const pvPerKwp = pvProduction(climate, p.pv.plane, 1, p.pv.lossPct.value);
  const pvOld = existing ? packagePv(climate, p, false) : null;
  const sizingResults: PackageSizing[] = [];
  const known = (...qs: Q[]) => qs.every((x) => x.status !== "sconosciuto");
  const estimate = (total: number, complete: boolean, what: string) => ({ total, complete, unknownItems: [`costo stimato ${what}`] });
  // nei percorsi brevi si cerca la taglia solo del pacchetto mostrato; gli altri, nascosti, usano la sua
  const sizedHere = (id: PackageId) => p.goal === "completo" || id === "P";
  let sizesP: { kWp: number; capacity: number } | undefined;
  const quoteNotes = indicative ? [] : quoteSizeNotes(p);
  const bat = p.battery;
  const batOn = batteryActive(p);
  const batParamsQuote = batteryParams(p);
  const horizon = Math.max(1, Math.round(p.economics.horizonYears.value));
  // flussi anno per anno e sostituzioni di ogni risultato; i pacchetti con la batteria hanno anche il gemello senza
  const extras = new Map<PackageResult, { ageing?: number[]; replacements: TaggedReplacement[] }>();
  const withoutBattery = new Map<PackageResult, PackageResult>();

  const results: PackageResult[] = [];
  for (const id of ids) {
    const has = { W: id.includes("W"), H: id.includes("H"), P: id.includes("P") };
    const hasHp = has.H && p.heatPump.included, hasDhw = has.H && p.dhw.replace;
    const acsSmc = sys.acsOnGas && !hasDhw ? sys.acsGasSmc.value : 0;
    const solarDhw = hasDhw && p.dhw.newType === "solare", gasBackup = solarDhw && p.dhw.solarBackup === "gas";
    const hasCooking = has.H && p.cooking?.enabled && sys.cookingOnGas;
    const cookingOnGas = sys.cookingOnGas && !hasCooking;
    const gasRemains = !hasHp || (sys.acsOnGas && (!hasDhw || gasBackup)) || cookingOnGas;
    const cooking = hasCooking ? (() => {
      const elec_kWh = cookSmc * fuelEnergyPerSmc * p.cooking!.gasHobEfficiency.value / p.cooking!.inductionEfficiency.value;
      return { elec: otherUsesDemand(p, elec_kWh, climate), elec_kWh, gasMeterClosed: !gasRemains };
    })() : undefined;
    let dhwGasSmc = 0;
    const th = hasHp ? (has.W ? tHpWin : tHpBase) : has.W ? tWin : tBase;
    const blockers: string[] = [];
    if (has.W && emptyEnvelope) blockers.push("Involucro vuoto: scegli almeno un lavoro (serramenti o isolamento) nel passo Interventi.");
    if (has.H && !p.heatPump.included && !p.dhw.replace) blockers.push("Impianto vuoto: scegli almeno la pompa di calore o lo scaldacqua nel passo Interventi.");
    if (gasBackup && !sys.acsOnGas) blockers.push("Solare termico con integrazione a gas: serve la caldaia che oggi fa l'acqua calda. Scegli la resistenza elettrica nel passo Interventi.");
    if (hasDhw && !sys.acsOnGas && !boiler) blockers.push("Per uno scaldacqua nuovo indica nel passo Impianto com'è oggi l'acqua calda (a gas o con un boiler elettrico).");
    const conditions: string[] = [];
    if (cooking && gasRemains) {
      const uses = [...(!hasHp ? ["il riscaldamento"] : []), ...(sys.acsOnGas && (!hasDhw || gasBackup) ? ["l'acqua calda"] : [])];
      const needed = [...(!hasHp ? ["la pompa di calore per il riscaldamento"] : []), ...(sys.acsOnGas && (!hasDhw || gasBackup) ? [gasBackup ? "uno scaldacqua senza integrazione a gas" : "lo scaldacqua nuovo"] : [])];
      conditions.push(`Resta il gas per ${uses.join(" e ")}: la quota fissa del gas non si toglie. Per chiudere il contatore serve anche ${needed.join(" e ")}.`);
    }
    if (hasHp && schedule?.mode === "fasce") {
      if (schedule.withHeatPump === "continuo") conditions.push("Con la pompa di calore il riscaldamento è continuo: la casa è più calda che oggi nelle ore oggi spente.");
      else if (th.schedule) conditions.push(`Con la pompa di calore si usano le stesse fasce di oggi: ${th.schedule.coldHours} ore fredde, in cui la casa resta più di 0,5 °C sotto la temperatura scelta.`);
    }
    const services: ServiceLine[] = [];
    let heatSmc = 0;
    let hp: HeatPumpResult | undefined;
    let demand = residual;
    if (hasHp) {
      const hpCoolingHours = hasHp && hpCools.ok ? (has.W ? cWin : cBase).qCool.map((q) => q > 0) : [];
      hp = simulateHeatPump(th.qHeat, climate, p.heatPump, sys, th.recovery, th.recoveryBudget_Wh, p.service.setpoint.value, hpCoolingHours, seasonMask(p.service));
      if (!hp.ok) blockers.push(...hp.blockers);
      else conditions.push(...hp.blockers);
      const cat = p.heatPump.model === "catalogo" ? findCatalogHp(p.heatPump.catalogId) : undefined;
      conditions.push(
        cat
          ? `PDC ${cat.manufacturer} ${cat.model}: errore del fit hplib sui punti di origine: COP ${it1(cat.mape.cop)}%, potenza ${it1(cat.mape.pTh)}%. La capacità disponibile è modificata dal progetto e non validata: il MAPE non ne misura l'errore. Non è una verifica di dimensionamento.`
          : "PDC con modello parametrico indicativo: nessuna macchina documentata, nessun badge «PDC validata»; carico parziale sotto la modulazione minima e ausiliari fuori modalità attiva inclusi.",
      );
      if (cat && !hasFitDomain(cat)) conditions.push("Campo dei punti di prova del fit non disponibile: aria del fit limitata provvisoriamente a −7…12 °C (valori saturati a 12 °C nelle ore più miti), mandata 25…55 °C. Questi limiti non provano l'assenza di estrapolazioni nel campo residuo: scenario indicativo.");
      if (hp.hoursExtrapolated > 0) conditions.push(`Estrapolazione del catalogo PDC in ${hp.hoursExtrapolated} ore, ${it1(hp.heatExtrapolated_kWh)} kWh termici: punto orario o riferimento di capacità a −7 °C fuori dall'inviluppo comune dei punti hplib. Consumo e VAN dipendono da questa estensione non validata; confronto indicativo. Restano i blocchi prudenziali −7 °C aria / 55 °C mandata e la saturazione dell'aria del fit a 12 °C.`);
      demand = residual.map((r, h) => r + hp!.elec[h]);
      services.push({
        service: "Riscaldamento",
        carrier: "elettricità",
        generator: cat ? `PDC ${cat.manufacturer} ${cat.model} (dati Keymark)` : "Pompa di calore (parametrica)",
        final_kWh: hp.elec_kWh,
      });
    } else {
      const fuel = th.heatNeed_kWh / gasEfficiency.value;
      heatSmc = fuel / fuelEnergyPerSmc;
      services.push({
        service: "Riscaldamento",
        carrier: "gas",
        generator: `${endOfLife ? "Caldaia nuova (controfattuale)" : "Caldaia attuale"}, rendimento ${gasEfficiency.value} su ${sys.efficiencyBasis}`,
        final_kWh: fuel,
        smc: heatSmc,
      });
    }
    if (acsSmc > 0) services.push({ service: "ACS", carrier: "gas", generator: "Invariato fra oggi e i pacchetti", final_kWh: acsSmc * fuelEnergyPerSmc, smc: acsSmc });
    if (cooking) {
      demand = demand.map((x, h) => x + cooking.elec[h]);
      services.push({ service: "Cucina", carrier: "elettricità", generator: "Piano a induzione", final_kWh: cooking.elec_kWh });
    } else if (cookSmc > 0) services.push({ service: "Cucina", carrier: "gas", generator: "Invariato", final_kWh: cookSmc * fuelEnergyPerSmc, smc: cookSmc });
    services.push({ service: "Altri usi elettrici", carrier: "elettricità", generator: fromBill ? "Ricavato dai prelievi in bolletta con il FV esistente (profilo sintetico)" : meter ? "Ricostruito da prelievi e immissioni del contatore, con l'autoconsumo stimato" : usesMeasuredCurve(p) ? "Curva misurata" : "Profilo sintetico", final_kWh: otherUsesKwh });

    const thCool = has.W ? cWin : cBase;
    const coolingNotes: string[] = [];
    let cooling: CoolingResult | undefined;
    if (cools) {
      const byHp = hasHp && hpCools.ok;
      cooling = byHp && hpCools.ok ? simulateHeatPumpCooling(thCool.qCool, climate, p.heatPump, hpCools.flow) : simulateSplit(thCool.qCool, thCool.tMax, climate, p.cooling);
      if (hasHp && !hpCools.ok) conditions.push(hpCools.reason);
      if (cooling.hoursUndersized > 0)
        conditions.push(`${cooling.hoursUndersized} ore oltre la potenza ${byHp ? "della PDC" : "degli split"} in raffrescamento (${it1(cooling.undelivered_kWh)} kWh frigoriferi non forniti): la casa supera la temperatura estiva in quelle ore.`);
      if (cooling.hoursExtrapolated > 0)
        conditions.push(`Raffrescamento con la PDC fuori dai punti di prova hplib (aria 20–35 °C) in ${cooling.hoursExtrapolated} ore: consumo estivo indicativo.`);
      demand = demand.map((d, h) => d + cooling!.elec[h]);
      services.push({ service: "Raffrescamento", carrier: "elettricità", generator: cooling.generator, final_kWh: cooling.elec_kWh });
    } else {
      coolingNotes.push(`Fabbisogno di raffrescamento: ${Math.round(thCool.coolNeed_kWh)} kWh frigoriferi, non conteggiato perché la casa non è raffrescata.`);
      if (hasHp && hpCouldCool.ok) {
        const would = simulateHeatPumpCooling(thCool.qCool, climate, p.heatPump, hpCouldCool.flow);
        coolingNotes.push(`La PDC potrebbe raffrescare con circa ${Math.round(would.elec_kWh)} kWh elettrici all'anno (non conteggiati: servizio diverso da oggi).`);
      }
    }

    let dhw: PackageResult["dhw"];
    if (hasDhw && waterNeed) {
      // Per il controllo si usa il FV inserito anche con taglia indicativa, prima della ricerca della taglia.
      const pvRif = existing ? pvOld : has.P ? pvProduction(climate, p.pv.plane, p.pv.kWp.value, p.pv.lossPct.value) : null;
      // solare termico: l'integrazione tiene solo il serbatoio a 45 °C, anche con il FV (nelle ore di sole scaldano già i pannelli)
      const surplus = pvRif && !solarDhw ? pvRif.map((x, h) => x - demand[h]) : null;
      const result = simulateTank(dhwTankParams(p, climate, false, pvRif || solarDhw ? "sole" : "termostato"), dhwDraws(waterNeed.kWh), climate.series.tAir, surplus);
      const generator = p.dhw.newType === "pdc" ? `Scaldacqua a pompa di calore (COP di scheda ${p.dhw.copRated.value.toLocaleString("it-IT")} a ${p.dhw.copRatedAirC.value.toLocaleString("it-IT")} °C)`
        : solarDhw ? `${DHW_TYPE_LABEL.solare} ${p.dhw.solarAreaM2.value.toLocaleString("it-IT")} m² ${p.dhw.solarPlane}, integrazione ${gasBackup ? "con la caldaia a gas" : "elettrica"}` : DHW_TYPE_LABEL.elettrico;
      if (gasBackup) {
        dhwGasSmc = result.backupGas_kWh / p.dhw.gasDhwEfficiency.value / fuelEnergyPerSmc;
        services.push({ service: "ACS", carrier: "gas", generator: "Caldaia di oggi, integrazione del solare termico", final_kWh: dhwGasSmc * fuelEnergyPerSmc, smc: dhwGasSmc });
      }
      dhw = { result, generator, need_kWh: waterNeed.kWh, from: waterNeed.from, replacesToday: sys.acsOnGas ? "gas" : "boiler" };
      if (pvRif && indicative) conditions.push(`Scaldacqua: controllo col sole sul FV di riferimento ${it1(existing ? p.existingPv.kWp.value : p.pv.kWp.value)} kWp, prima della ricerca della taglia indicativa.`);
    } else if (boiler) dhw = { result: boiler, generator: "Boiler elettrico di oggi", need_kWh: dhwNeedFromPeople(p, climate), from: "persone", replacesToday: "boiler" };
    if (dhw) {
      demand = demand.map((x, h) => x + dhw.result.elec[h]);
      services.push({ service: "ACS", carrier: "elettricità", generator: dhw.generator, final_kWh: dhw.result.elec_kWh });
      if (dhw.result.unmetHours > 0) conditions.push(`Il serbatoio non basta in ${dhw.result.unmetHours} ore dell'anno (${it1(dhw.result.unmet_kWh)} kWh): acqua sotto 40 °C.`);
    }

    const houseDemand = demand;
    const carPv = existing ? pvOld : has.P ? pvProduction(climate, p.pv.plane, p.pv.kWp.value, p.pv.lossPct.value) : null;
    const car = p.ev.enabled ? simulateEv(p.ev, carPv, houseDemand) : undefined;
    if (car) {
      demand = houseDemand.map((x, h) => x + car.elec[h]);
      services.push({ service: "Auto elettrica (ricarica a casa)", carrier: "elettricità", generator: "Ricarica dell'auto a casa", final_kWh: car.home_kWh });
      if (car.unmetDays > 0) conditions.push(`In ${car.unmetDays} giorni la carica di casa non basta: ${it1(car.unmet_kWh)} kWh presi fuori.`);
      if (indicative && has.P && p.ev.strategy === "sole") conditions.push(`Auto elettrica: ricarica col sole sul FV di riferimento ${it1(existing ? p.existingPv.kWp.value : p.pv.kWp.value)} kWp, prima della ricerca della taglia indicativa.`);
    }

    let kWpHere = existing ? p.existingPv.kWp.value : has.P ? p.pv.kWp.value : 0;
    let capHere = p.battery.capacityKwh.value;
    if (has.P && indicative) {
      let chosen = fixedSizes?.get(id) ?? (sizedHere(id) ? undefined : sizesP);
      let allNegative = false;
      if (!chosen) {
        const s = sizePackage(id, demand, pvPerKwp, pvOld, p, batOn);
        sizingResults.push(s);
        chosen = s.chosen;
        allNegative = s.allNegative;
      }
      if (id === "P") sizesP = chosen;
      if (!existing) kWpHere = chosen.kWp;
      capHere = chosen.capacity;
      conditions.push(`Taglia indicativa: ${existing ? `FV esistente da ${it1(kWpHere)} kWp` : `${it1(kWpHere)} kWp`}${batOn ? `, batteria ${capHere > 0 ? `da ${it1(capHere)} kWh` : "nessuna"}` : ""}: la combinazione con il VAN più alto fra quelle provate${allNegative ? ", ma anche questa ha VAN negativo: con queste ipotesi conviene non fare nulla" : ""}. Il costo è una stima da ipotesi dichiarate, non un preventivo: non sostituisce sopralluogo e preventivo.`);
    }
    if (has.P) conditions.push(...quoteNotes);
    const pvHere = existing ? pvOld : has.P ? pvProduction(climate, p.pv.plane, kWpHere, p.pv.lossPct.value) : null;
    const batHere = has.P && batOn && capHere > 0;
    const batParams = { ...batParamsQuote, capacity_kWh: capHere };
    const costP = indicative && has.P && !existing ? estimate(pvEstimate(p, kWpHere), known(p.pv.pricePerKwp), "del FV") : quoteP;
    const costB = indicative ? estimate(batteryEstimate(p, capHere), known(p.battery.pricePerKwh, existing ? p.battery.retrofitFixedCost : p.battery.fixedCost), "della batteria") : quoteB;
    const make = (withBattery: boolean): PackageResult => {
      const cond = [...conditions];
      const missing: string[] = [...commonMissing];
      const newPv = has.P && !existing;
      let elec: Balance;
      let ageing: number[] | undefined;
      let battery: BatteryResult | undefined;
      let batReplacements: Replacement[] = bat.replacements;
      if (withBattery && pvHere) {
        const sim = simulateBattery(demand, pvHere, batParams).balance;
        elec = sim;
        const life = batteryLife(bat.lifeYears.value, bat.lifeCycles.value, sim.cycles, horizon);
        // taglia indicativa: sostituzioni a fine vita allo stesso prezzo tipico
        // taglia indicativa: sostituzioni a fine vita operativa, con il costo di sostituzione (moduli e manodopera)
        if (indicative) batReplacements = life.replacementYears.map((year) => ({ label: "Sostituzione dei moduli della batteria (stima)", year, amount: { value: batteryReplacementEstimate(p, capHere), status: known(p.battery.replacementPerKwh, p.battery.replacementFixed) ? "ipotizzato" : "sconosciuto", source: p.battery.replacementPerKwh.source } }));
        ageing = batteryYearlyFlows(demand, pvHere, batParams, bat.fadePctPerYear.value, batReplacements.map((x) => Math.round(x.year)), newPv ? p.pv.degradationPct.value : 0, horizon, t.elecPrice.value, t.exportPrice.value);
        const uncovered = indicative ? [] : life.replacementYears.filter((y) => !bat.replacements.some((x) => Math.abs(x.year - y) <= 2));
        cond.push("Batteria simulata ora per ora: dentro l'ora non si vedono picchi e cali di consumo e produzione, quindi autoconsumo e risparmio possono risultare più alti del vero.");
        if (uncovered.length) cond.push(`La batteria arriva a fine vita verso l'anno ${uncovered.join(", ")} (${it1(life.endOfLifeYear)} anni fra calendario e cicli), ma non c'è una sostituzione prevista vicino a quell'anno: VAN ottimistico.`);
        battery = {
          capacity_kWh: sim.capacity_kWh,
          charge_kWh: sim.charge_kWh,
          discharge_kWh: sim.discharge_kWh,
          losses_kWh: sim.losses_kWh,
          throughput_kWh: sim.discharge_kWh,
          cyclesPerYear: sim.cycles,
          selfConsumptionPct: selfConsumption(sim),
          selfSufficiencyPct: selfSufficiency(sim),
          endOfLifeYear: life.endOfLifeYear,
          replacementYears: life.replacementYears,
          uncoveredReplacementYears: uncovered,
          investment: costB.total,
          nextStep: (() => {
            const c2 = capHere + 2.5;
            const n = simulateBattery(demand, pvHere, { ...batParams, capacity_kWh: c2 }).balance;
            return {
              capacity: c2,
              extraBenefit: (sim.import_kWh - n.import_kWh) * t.elecPrice.value - (sim.export_kWh - n.export_kWh) * t.exportPrice.value,
              extraSelfSufficiencyPct: selfSufficiency(n) - selfSufficiency(sim),
              extraThroughput_kWh: n.discharge_kWh - sim.discharge_kWh,
              extraCost: indicative ? batteryEstimate(p, c2) - batteryEstimate(p, capHere) : null,
            };
          })(),
          without: { elec: sim, annualBenefit: 0, npv: null, investment: 0, selfConsumptionPct: 0, selfSufficiencyPct: 0 },
          npvBattery: null,
        };
      } else {
        elec = balance(demand, pvHere);
        if (newPv) ageing = pvDegradationFlows(demand, pvHere!, p.pv.degradationPct.value, horizon, t.elecPrice.value, t.exportPrice.value);
      }
      const gasSmc = heatSmc + acsSmc + dhwGasSmc + (cooking ? 0 : cookSmc);
      const contractBefore = hasHp ? p.heatPump.newContractPower.value : t.contractPower.value;
      const contract = p.ev.enabled ? Math.max(contractBefore, p.ev.contractPower.value) : contractBefore;
      const ev = car ? evPackage(p, car, houseDemand, pvHere, withBattery && pvHere ? batParams : null, contractBefore) : undefined;
      if (elec.importPeak_W / 1000 > contract * 1.1)
        cond.push(`Picco orario di prelievo ${it1(elec.importPeak_W / 1000)} kW oltre la potenza contrattuale ${contract} kW: verificare la potenza.`);
      const maintenance = (has.W && p.envelope.windows ? p.windows.maintenanceDelta.value : 0) + (hasHp ? p.heatPump.maintenanceDelta.value : 0) + (hasDhw ? p.dhw.maintenanceDelta.value : 0) + (newPv ? p.pv.maintenanceDelta.value : 0) + (withBattery ? bat.maintenanceDelta.value : 0);
      const costs: CostLines = {
        gasPurchase: gasSmc * t.gasPrice.value,
        // la quota fissa resta finché resta un qualunque servizio a gas, anche se il consumo è zero o sconosciuto
        gasFixed: cooking ? (gasRemains ? t.gasFixed.value : 0) : !hasHp || (sys.acsOnGas && (!hasDhw || gasBackup)) || sys.cookingOnGas ? t.gasFixed.value : 0,
        elecPurchase: elec.import_kWh * t.elecPrice.value,
        elecFixed: t.elecFixed.value,
        elecPower: contract * t.powerCostPerKw.value,
        exportRevenue: elec.export_kWh * t.exportPrice.value,
        maintenanceDelta: maintenance,
        total: 0,
      };
      costs.total = costs.gasPurchase + costs.gasFixed + costs.elecPurchase + costs.elecFixed + costs.elecPower;

      let investment = 0;
      let investmentTotal = 0;
      if (cooking) {
        const choice = p.cooking!;
        const items = [{ label: "Piano a induzione e posa", amount: choice.hobCost, status: choice.hobCost.status === "sconosciuto" ? "sconosciuto" as const : "incluso" as const }];
        if (cooking.gasMeterClosed) items.push({ label: "Chiusura del contatore del gas", amount: choice.meterClosureCost, status: choice.meterClosureCost.status === "sconosciuto" ? "sconosciuto" : "incluso" });
        const cost = summarizeCost({ items, quoteSource: "", quoteDate: "", forSize: 0, name: "", supplier: "", validUntil: "" });
        investment += cost.total;
        investmentTotal += cost.total;
        // Zero documentato è ammesso anche per entrambe le voci (per esempio piano già disponibile).
        if (items.some((item) => item.status === "sconosciuto")) missing.push(...cost.unknownItems);
        if (cooking.gasMeterClosed && choice.meterClosureCost.status === "ipotizzato" && choice.meterClosureCost.source === METER_CLOSURE_ESTIMATE_SOURCE) cond.push(`Chiusura del contatore del gas: costo stimato ${choice.meterClosureCost.value.toLocaleString("it-IT")} € (contributo del distributore, IVA e contributo del venditore esclusi).`);
        if (choice.hobCost.status === "ipotizzato" && choice.hobCost.source === HOB_COST_ESTIMATE_SOURCE) cond.push(`Piano a induzione e posa: costo stimato ${choice.hobCost.value.toLocaleString("it-IT")} € (media italiana, non preventivo; pentole escluse).`);
        if (choice.gasHobEfficiency.status === "sconosciuto") missing.push("Rendimento del piano a gas");
        if (choice.inductionEfficiency.status === "sconosciuto") missing.push("Rendimento del piano a induzione");
      }
      const replacements: TaggedReplacement[] = [];
      if (has.W) {
        if (p.envelope.windows) {
          investment += costW.total;
          investmentTotal += costW.total;
          if (!costW.complete) missing.push(`Serramenti: ${costW.unknownItems.join(", ")}`);
          if (p.windows.maintenanceDelta.status === "sconosciuto") missing.push("Manutenzione serramenti");
        }
        for (const kind of activeInsulation(p)) {
          const m = p.envelope[kind], cost = envelopeCost(p, kind), name = insulationName(p, kind).long;
          investment += cost.total;
          investmentTotal += cost.total;
          if (!cost.complete) missing.push(`${name}: ${cost.unknownItems.join(", ")}`);
          if (m.costMode === "stima") cond.push(`${name}: costo stimato con ${m.pricePerM2.value.toLocaleString("it-IT")} €/m² su ${cost.area_m2.toLocaleString("it-IT", { maximumFractionDigits: 0 })} m² (scenario, non preventivo).`);
        }
      }
      if (hasHp) {
        investmentTotal += costH.total;
        investment += p.heatPump.boilerEndOfLife ? costH.total - p.heatPump.boilerReplacementCost.value : costH.total;
        replacements.push(...p.heatPump.replacements.map((replacement) => ({ replacement, block: "H" as const })));
        if (!costH.complete) missing.push(`PDC: ${costH.unknownItems.join(", ")}`);
        if (p.heatPump.maintenanceDelta.status === "sconosciuto") missing.push("Manutenzione PDC");
        if (p.heatPump.newContractPower.status === "sconosciuto") missing.push("Potenza contrattuale con PDC");
        if (p.heatPump.replacements.some((x) => x.amount.status === "sconosciuto")) missing.push("Importo di una sostituzione PDC");
      }
      if (hasDhw) {
        investment += costDhw.total;
        investmentTotal += costDhw.total;
        if (!costDhw.complete) missing.push(`Scaldacqua: ${costDhw.unknownItems.join(", ")}`);
        if (p.dhw.maintenanceDelta.status === "sconosciuto") missing.push("Manutenzione scaldacqua");
        if (p.dhw.costMode === "stima") cond.push(`Scaldacqua: costo stimato ${p.dhw.price.value.toLocaleString("it-IT")} € (scenario, non preventivo).`);
      }
      if (newPv) {
        investment += costP.total;
        investmentTotal += costP.total;
        replacements.push(...p.pv.replacements.map((replacement) => ({ replacement, block: "P" as const })));
        if (!costP.complete) missing.push(`FV: ${costP.unknownItems.join(", ")}`);
        if (p.pv.maintenanceDelta.status === "sconosciuto") missing.push("Manutenzione FV");
        if (p.pv.replacements.some((x) => x.amount.status === "sconosciuto")) missing.push("Importo di una sostituzione FV");
      }
      if (withBattery) {
        investment += costB.total;
        investmentTotal += costB.total;
        replacements.push(...batReplacements.map((replacement) => ({ replacement, block: "P" as const })));
        if (!costB.complete) missing.push(`Batteria: ${costB.unknownItems.join(", ")}`);
        if (bat.maintenanceDelta.status === "sconosciuto") missing.push("Manutenzione batteria");
        if (!indicative && bat.replacements.some((x) => x.amount.status === "sconosciuto")) missing.push("Importo di una sostituzione della batteria");
        for (const [q, label] of [...(indicative ? [] : [[bat.capacityKwh, "Capacità della batteria"]] as const), [bat.powerKw, "Potenza della batteria"], [bat.roundTripPct, "Rendimento della batteria"], [bat.fadePctPerYear, "Calo della capacità"]] as const)
          if (q.status === "sconosciuto") missing.push(label);
      }
      if (!tariffsKnown) missing.push("Tariffe sconosciute");
      if (otherGasUnknown.length) missing.push(`Consumi sconosciuti: ${otherGasUnknown.join(", ")}`);
      const r: PackageResult = {
        id,
        label: packageLabel(id, p),
        has,
        valid: blockers.length === 0,
        blockers,
        conditions: cond,
        heatNeed_kWh: th.heatNeed_kWh,
        ...(th.schedule ? { schedule: th.schedule } : {}),
        heatNeedPerM2: th.heatNeed_kWh / p.building.floorArea.value,
        peak_kW: th.peak_W / 1000,
        unheatedSpaces: th.unheatedSpaces,
        recoveryPeak_kW: th.recoveryPeak_W / 1000,
        gasSmc,
        gasKwh: gasSmc * fuelEnergyPerSmc,
        elec,
        ev,
        hp,
        ...(cooking ? { cooking } : {}),
        dhw,
        cooling,
        coolNeed_kWh: thCool.coolNeed_kWh,
        coolingNotes,
        services,
        costs,
        annualSaving: 0,
        annualBenefit: 0,
        investment,
        investmentTotal,
        economicsComplete: missing.length === 0 && blockers.length === 0,
        economicsMissing: missing,
        serviceGapPct: 0,
        comparable: true,
        otherUses_kWh: otherUsesKwh,
        pvKwp: has.P || existing ? kWpHere : 0,
        battery,
      };
      extras.set(r, { ageing, replacements });
      return r;
    };
    const main = make(batHere);
    results.push(main);
    if (main.battery) withoutBattery.set(main, make(false));
  }

  const base = results[0];
  const finish = (r: PackageResult) => {
    if (base.coolNeed_kWh > 0) r.serviceGapPct = (Math.abs((r.cooling?.undelivered_kWh ?? 0) - (base.cooling?.undelivered_kWh ?? 0)) / base.coolNeed_kWh) * 100;
    r.comparable = r.serviceGapPct <= SERVICE_GAP_LIMIT;
    r.economicsMissing = [...new Set([...base.economicsMissing, ...r.economicsMissing])];
    r.economicsComplete = r.valid && r.economicsMissing.length === 0;
    r.annualSaving = base.costs.total - r.costs.total;
    r.annualBenefit = r.annualSaving + (r.costs.exportRevenue - base.costs.exportRevenue) - (r.costs.maintenanceDelta - base.costs.maintenanceDelta);
    if (r.id === "base" || !r.economicsComplete) return true;
    const x = extras.get(r)!;
    const cashInput: CashFlowInput = {
      investment: r.investment,
      annualSaving: r.annualSaving,
      exportDelta: r.costs.exportRevenue - base.costs.exportRevenue,
      maintenanceDelta: r.costs.maintenanceDelta - base.costs.maintenanceDelta,
      replacements: x.replacements.map((item) => item.replacement),
      horizon: p.economics.horizonYears.value,
      rate: p.economics.realDiscountRate.value,
      yearlyDelta: x.ageing,
    };
    r.cash = cashFlow(cashInput);
    r.flowParts = {
      annualBenefit: r.annualBenefit,
      ageing: Array.from({ length: cashInput.horizon }, (_, i) => x.ageing?.[i] ?? 0),
      replacements: x.replacements.map(({ replacement, block }) => ({ year: replacement.year, amount: replacement.amount.value, block })),
    };
    return checkCashFlow(r.cash, cashInput);
  };
  for (const r of [...results, ...withoutBattery.values()]) {
    if (finish(r)) continue;
    issues.push({ section: "Economia", severity: "errore", message: `Flussi di cassa non chiusi per ${r.label}.` });
    return fail();
  }
  for (const r of results) {
    const w = withoutBattery.get(r);
    if (!r.battery || !w) continue;
    r.battery.without = { elec: w.elec, annualBenefit: w.annualBenefit, npv: w.cash ? w.cash.npv : null, investment: w.investment, selfConsumptionPct: selfConsumption(w.elec), selfSufficiencyPct: selfSufficiency(w.elec) };
    r.battery.npvBattery = r.cash && w.cash ? r.cash.npv - w.cash.npv : null;
  }

  if (meter) {
    const measured = curveAnnualKwh(p.consumption.measuredCurve!.ore);
    const modeled = base.elec.import_kWh;
    const kwh = (x: number) => `${Math.round(x).toLocaleString("it-IT")} kWh`;
    issues.push({ section: "Consumi", severity: "nota", message: `Prelievi dalla rete: il contatore misura ${kwh(measured)} all'anno, il modello ne calcola ${kwh(modeled)} (${modeled >= measured ? "+" : "−"}${Math.round(Math.abs(modeled / measured - 1) * 100)}%). Lo scarto viene dalla produzione di un anno tipico e dai consumi medi per ora: il consumo della casa è ricostruito, l'autoconsumo è stimato.` });
  }
  const obs = billGasMean(p);
  const observedGapPct = obs ? ((base.gasSmc - obs.smc) / obs.smc) * 100 : null;
  const bad = nonFinitePaths(results);
  if (bad.length) {
    issues.push({ section: "Impianto", severity: "errore", message: `Risultato non finito (${bad.slice(0, 3).join(", ")}): controlla i dati inseriti.` });
    return fail();
  }
  return { ok: true, issues, documented: isDocumented(issues), thermal: { base: tBase, windows: tWin }, packages: results, observedGapPct, calibration: null, calibrationNote: null, incentive: null, incentiveNote: null, homeValue: null, homeValueNote: null, sizing: indicative ? sizingResults : null };
}

/** Cerca numeri non finiti, anche nelle serie; solo SCOP senza calore ed EER stagionale senza freddo possono essere NaN. */
export function nonFinitePaths(o: unknown, path = "", out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof o === "number") {
    if (!Number.isFinite(o)) out.push(path);
  } else if (Array.isArray(o)) {
    for (let i = 0; i < o.length && out.length <= 5; i++) {
      const v: unknown = o[i];
      // Le serie orarie contengono molti numeri: si costruisce il percorso solo quando serve.
      if (typeof v === "number") {
        if (!Number.isFinite(v)) out.push(`${path}[${i}]`);
      } else nonFinitePaths(v, `${path}[${i}]`, out);
    }
  } else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      if ((k === "seasonalCop" || k === "seasonalEer") && typeof v === "number" && Number.isNaN(v)) continue;
      nonFinitePaths(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

/**
 * Pacchetti non dominati per investimento (≤) e beneficio annuo (≥), solo con economia completa.
 * Anche «non fare nulla» (investimento 0, beneficio 0) può dominare.
 */
export function nonDominated(packages: PackageResult[]): Set<PackageId> {
  const c = packages.filter((r) => r.id !== "base" && r.economicsComplete && r.cash);
  const pts = [{ id: "base" as PackageId, inv: 0, ben: 0 }, ...c.map((r) => ({ id: r.id, inv: r.investment, ben: r.annualBenefit }))];
  const out = new Set<PackageId>();
  for (const a of pts.slice(1)) {
    const dominated = pts.some((b) => b.id !== a.id && b.inv <= a.inv && b.ben >= a.ben && (b.inv < a.inv || b.ben > a.ben));
    if (!dominated) out.add(a.id);
  }
  return out;
}
