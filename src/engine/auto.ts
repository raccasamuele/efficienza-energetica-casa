import { HOURS, localHour, type ClimatePackage } from "./climate";
import { otherUsesDemand } from "./curva";
import { balance, packagePv, pvProduction, type Balance } from "./electric";
import { batteryParams, simulateBattery, type BatteryParams } from "./battery";
import { summarizeCost } from "./economics";
import type { PackageResult } from "./scenarios";
import type { EvInput, EvStrategy, ProjectInput } from "./types";

export const EV_PRICE_SCENARIOS = { presa: { basso: 0, centrale: 200, alto: 500 }, wallbox: { basso: 900, centrale: 1400, alto: 2200 } };
export const EV_POWER_FEE_SCENARIOS = { basso: 50, centrale: 80, alto: 120 };
export const EV_PRICE_SOURCE = "Ipotesi di scenario del 5/11/2026, non un prezzo medio verificato né un prezzo attuale. IVA compresa, posa compresa";
export const EV_STRATEGIES: EvStrategy[] = ["arrivo", "notte", "sole"];
export const EV_STRATEGY_LABEL: Record<EvStrategy, string> = { arrivo: "Appena arriva a casa", notte: "Di notte", sole: "Col sole del FV con un minimo garantito" };
export const EV_FIELDS = [
  ["kmYear", "Chilometri all'anno", "km/anno", 0, 100000],
  ["consumptionKwh100", "Consumo di scheda WLTP", "kWh/100 km", 8, 40],
  ["winterExtraPct", "Consumo in più d'inverno", "%", 0, 60],
  ["chargeLossPct", "Perdite di ricarica in più", "%", 0, 30],
  ["outsideSharePct", "Quota caricata fuori casa", "%", 0, 100],
  ["outsidePrice", "Prezzo fuori casa (ipotesi)", "€/kWh", 0, 2],
  ["daysPerWeek", "Giorni d'uso a settimana", "giorni", 1, 7],
  ["departHour", "Ora di partenza", "ora", 0, 23],
  ["returnHour", "Ora di rientro", "ora", 1, 23],
  ["carBatteryKwh", "Batteria utile dell'auto", "kWh", 10, 200],
  ["targetPct", "Carica massima impostata", "%", 50, 100],
  ["minDepartPct", "Minimo garantito alla partenza col sole", "%", 0, 100],
  ["chargerKw", "Potenza di ricarica", "kW", 1.4, 22],
  ["contractPower", "Potenza del contatore con l'auto", "kW", 1.5, 30],
  ["powerIncreaseFeePerKw", "Aumento di potenza una tantum (ipotesi)", "€/kW", 0, 500],
  ["fuelL100", "Consumo dell'auto a combustione", "l/100 km", 2, 20],
  ["fuelPrice", "Prezzo del carburante (ipotesi)", "€/l", .5, 4],
  ["price", "Prezzo della ricarica installata (scenario)", "€", 0, 10000],
] as const;

/** Giorno 0 lunedì; anno non bisestile, come il calendario del motore. */
export function evNeed(e: EvInput, hours = HOURS) {
  const days = Math.ceil(hours / 24), needs = new Array<number>(days).fill(0);
  let uses = 0;
  for (let d = 0; d < days; d++) if (d % 7 < e.daysPerWeek.value) uses++;
  let need = 0;
  for (let d = 0; d < days; d++) if (d % 7 < e.daysPerWeek.value) {
    const winter = d < 59 || d >= 334;
    needs[d] = e.kmYear.value / uses * e.consumptionKwh100.value / 100 * (winter ? 1 + e.winterExtraPct.value / 100 : 1) * 1000;
    need += needs[d];
  }
  return { needs, need_kWh: need / 1000, home_kWh: need / 1000 * (1 - e.outsideSharePct.value / 100), outside_kWh: need / 1000 * e.outsideSharePct.value / 100 };
}

export interface EvSimulation {
  elec: number[]; // W lato casa, prima della batteria domestica
  home_kWh: number;
  need_kWh: number;
  outside_kWh: number;
  unmet_kWh: number;
  unmetDays: number;
  losses_kWh: number;
  socStart_kWh: number;
  socEnd_kWh: number;
  peak_W: number; // picco della sola ricarica
}

/** Due giri dell'anno; opzioni esplicite per prove manuali su periodi ridotti. */
export function simulateEv(e: EvInput, pv: number[] | null, house: number[], strategy: EvStrategy = e.strategy, opts: { warmup?: boolean; start?: number } = {}): EvSimulation {
  const n = house.length, need = evNeed(e, n), factor = 1 + e.chargeLossPct.value / 100;
  const target = e.carBatteryKwh.value * 1000 * e.targetPct.value / 100;
  const minimum = e.carBatteryKwh.value * 1000 * e.minDepartPct.value / 100;
  const power = e.chargerKw.value * 1000, homeShare = 1 - e.outsideSharePct.value / 100;
  const run = (start: number, record: boolean) => {
    let soc = start, charged = 0, unmet = 0, unmetDays = 0, peak = 0;
    const elec = record ? new Array<number>(n) : [];
    for (let h = 0; h < n; h++) {
      const d = Math.floor(h / 24), hour = localHour(h), used = d % 7 < e.daysPerWeek.value;
      if (used && hour === e.departHour.value) {
        const trip = need.needs[d] * homeShare;
        const missing = Math.max(0, trip - soc);
        unmet += missing;
        if (missing > 1e-6) unmetDays++;
        soc = Math.max(0, soc - trip);
      }
      const home = !used || hour < e.departHour.value || hour >= e.returnHour.value;
      const night = hour >= 23 || hour < 7;
      const room = Math.max(0, (target - soc) * factor);
      let charge = 0;
      if (home) {
        if (strategy === "arrivo" || (strategy === "notte" && night)) charge = Math.min(power, room);
        else if (strategy === "sole") {
          const surplus = Math.max(0, (pv?.[h] ?? 0) - house[h]);
          if (surplus >= 1400) charge = Math.min(surplus, power, room);
          if (night && soc < minimum) charge = Math.min(power, room, (minimum - soc) * factor);
        }
      }
      soc += charge / factor;
      charged += charge;
      peak = Math.max(peak, charge);
      if (record) elec[h] = charge;
    }
    return { soc, charged, unmet, unmetDays, peak, elec };
  };
  const start = opts.start ?? (opts.warmup === false ? target : run(target, false).soc);
  const r = run(start, true);
  return { elec: r.elec, home_kWh: r.charged / 1000, need_kWh: need.need_kWh, outside_kWh: need.outside_kWh, unmet_kWh: r.unmet / 1000, unmetDays: r.unmetDays, losses_kWh: r.charged / 1000 * (1 - 1 / factor), socStart_kWh: start / 1000, socEnd_kWh: r.soc / 1000, peak_W: r.peak };
}

export interface EvPackageResult extends EvSimulation {
  strategy: EvStrategy;
  fromPv_kWh: number;
  fromBattery_kWh: number;
  fromGrid_kWh: number;
  marginalCost: number;
  overContractHours: number;
  batteryBenefit?: { withCar: number; withoutCar: number };
}

export const evBill = (p: ProjectInput, b: Balance) => b.import_kWh * p.tariffs.elecPrice.value - b.export_kWh * p.tariffs.exportPrice.value;

/** Attribuzione oraria, con la casa servita prima dell'auto anche in scarica. */
export function evPackage(p: ProjectInput, car: EvSimulation, house: number[], pv: number[] | null, battery: BatteryParams | null, contractBefore: number): EvPackageResult {
  const demand = house.map((x, h) => x + car.elec[h]);
  const sim = battery && pv ? simulateBattery(demand, pv, battery, { hourly: true }) : null;
  const withCar = sim?.balance ?? balance(demand, pv);
  const withoutCar = battery && pv ? simulateBattery(house, pv, battery).balance : balance(house, pv);
  let fromPv = 0, fromBattery = 0, over = 0;
  const contract = Math.max(contractBefore, p.ev.contractPower.value);
  for (let h = 0; h < house.length; h++) {
    const production = pv?.[h] ?? 0;
    fromPv += Math.min(car.elec[h], Math.max(0, production - house[h]));
    fromBattery += Math.max(0, (sim?.hourly?.discharge[h] ?? 0) - Math.max(0, house[h] - production));
    const imp = sim?.hourly?.import[h] ?? Math.max(0, demand[h] - production);
    if (imp > contract * 1100) over++;
  }
  return { ...car, strategy: p.ev.strategy, fromPv_kWh: fromPv / 1000, fromBattery_kWh: fromBattery / 1000, fromGrid_kWh: car.home_kWh - (fromPv + fromBattery) / 1000,
    marginalCost: evBill(p, withCar) - evBill(p, withoutCar) + (contract - contractBefore) * p.tariffs.powerCostPerKw.value,
    peak_W: withCar.importPeak_W, overContractHours: over,
    ...(battery ? { batteryBenefit: { withCar: evBill(p, balance(demand, pv)) - evBill(p, withCar), withoutCar: evBill(p, balance(house, pv)) - evBill(p, withoutCar) } } : {}),
  };
}

export function evStrategies(p: ProjectInput, climate: ClimatePackage, r: PackageResult): EvPackageResult[] {
  if (!p.ev.enabled) return [];
  let house = otherUsesDemand(p, r.otherUses_kWh, climate).map((x, h) => x + (r.hp?.elec[h] ?? 0) + (r.cooling?.elec[h] ?? 0) + (r.dhw?.result.elec[h] ?? 0));
  if (r.cooking) house = house.map((x, h) => x + r.cooking!.elec[h]);
  const pv = p.existingPv.present ? packagePv(climate, p, false) : r.has.P ? pvProduction(climate, p.pv.plane, r.pvKwp, p.pv.lossPct.value) : null;
  const reference = p.pv.sizing === "indicativa" && r.has.P && !p.existingPv.present ? pvProduction(climate, p.pv.plane, p.pv.kWp.value, p.pv.lossPct.value) : pv;
  const battery = r.battery ? { ...batteryParams(p), capacity_kWh: r.battery.capacity_kWh } : null;
  const contractBefore = r.has.H && p.heatPump.included ? p.heatPump.newContractPower.value : p.tariffs.contractPower.value;
  return EV_STRATEGIES.map((strategy) => ({ ...evPackage(p, simulateEv(p.ev, reference, house, strategy), house, pv, battery, contractBefore), strategy }));
}

export function evFuelComparison(p: ProjectInput, r: Pick<EvPackageResult, "marginalCost" | "outside_kWh" | "unmet_kWh">) {
  const fuel = p.ev.kmYear.value * p.ev.fuelL100.value / 100 * p.ev.fuelPrice.value;
  const ev = r.marginalCost + (r.outside_kWh + r.unmet_kWh) * p.ev.outsidePrice.value;
  return { fuel, ev, saving: fuel - ev };
}

export function evCost(p: ProjectInput) {
  const e = p.ev;
  const equipment = e.costMode === "preventivo" ? summarizeCost(e.cost) : { total: e.price.value, complete: e.price.status !== "sconosciuto", unknownItems: e.price.status === "sconosciuto" ? ["Prezzo della ricarica"] : [] };
  const power = Math.max(0, e.contractPower.value - p.tariffs.contractPower.value) * e.powerIncreaseFeePerKw.value;
  const powerKnown = e.contractPower.value <= p.tariffs.contractPower.value || e.powerIncreaseFeePerKw.status !== "sconosciuto";
  return { ...equipment, equipment: equipment.total, power, total: equipment.total + power, complete: equipment.complete && powerKnown, unknownItems: [...equipment.unknownItems, ...(!powerKnown ? ["Costo dell'aumento di potenza"] : [])] };
}

/** Minimo a passi di mezzo kW, da 3 kW, che evita il superamento del 10%. */
export function evPower(p: ProjectInput, r: PackageResult) {
  const current = Math.max(p.ev.contractPower.value, r.has.H && p.heatPump.included ? p.heatPump.newContractPower.value : p.tariffs.contractPower.value);
  const minimum = Math.max(3, Math.ceil(r.elec.importPeak_W / 1100 * 2 - 1e-12) / 2);
  const delta = Math.max(0, minimum - current);
  return { current, minimum, annual: delta * p.tariffs.powerCostPerKw.value, once: delta * p.ev.powerIncreaseFeePerKw.value };
}


export interface EvOwnershipRow { label: string; annuo: number; totale: number; items: { acquisto: number; energia: number; manutenzione: number; bollo: number; rivendita: number }; }
export interface EvOwnershipResult { rows: EvOwnershipRow[]; combustione: number; differenza: number; pareggio: number | null; missing: string[]; }
/** Somma semplice, senza sconto: i costi dell'auto restano fuori dall'economia dei pacchetti. */
export function evOwnership(p: ProjectInput, r: Pick<EvPackageResult, "marginalCost" | "outside_kWh" | "unmet_kWh">, label = "Elettrica, senza pannelli"): EvOwnershipResult {
  const e = p.ev, n = Math.max(1, Math.min(25, Math.round(e.years.value)));
  const known = (q: import("./types").Q) => q.status !== "sconosciuto";
  const missing: string[] = [];
  for (const [q, name] of [[e.evPrice, "Prezzo dell'elettrica"], [e.evMaintenance, "Manutenzione dell'elettrica"], [e.evTax, "Bollo dell'elettrica"], [e.icePrice, "Prezzo dell'auto a combustione"], [e.iceMaintenance, "Manutenzione dell'auto a combustione"], [e.iceTax, "Bollo dell'auto a combustione"]] as const) if (!known(q)) missing.push(name);
  if (!known(e.evResale)) missing.push("Rivendita dell'elettrica (non conteggiata)");
  if (!known(e.iceResale)) missing.push("Rivendita dell'auto a combustione (non conteggiata)");
  const outside = (r.outside_kWh + r.unmet_kWh) * e.outsidePrice.value;
  const evEnergy = r.marginalCost + outside;
  const evAnnual = evEnergy + e.evMaintenance.value + e.evTax.value;
  const iceEnergy = e.kmYear.value * e.fuelL100.value / 100 * e.fuelPrice.value;
  const iceAnnual = iceEnergy + e.iceMaintenance.value + e.iceTax.value;
  const evResale = known(e.evResale) ? e.evResale.value : 0, iceResale = known(e.iceResale) ? e.iceResale.value : 0;
  const evPurchase = e.evPrice.value - e.evIncentive.value;
  const electric = evPurchase + n * evAnnual - evResale;
  const combustion = e.icePrice.value + n * iceAnnual - iceResale;
  let pareggio: number | null = null;
  for (let year = 1; year <= n; year++) if (evPurchase + year * evAnnual <= e.icePrice.value + year * iceAnnual) { pareggio = year; break; }
  return { rows: [{ label, annuo: evAnnual, totale: electric, items: { acquisto: evPurchase, energia: evEnergy, manutenzione: e.evMaintenance.value, bollo: e.evTax.value, rivendita: evResale } }], combustione: combustion, differenza: combustion - electric, pareggio, missing };
}
