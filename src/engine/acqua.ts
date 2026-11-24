import { HOURS, localHour, mean, type ClimatePackage } from "./climate";
import { summarizeCost } from "./economics";
import { otherUsesDemand } from "./curva";
import { packagePv, pvProduction } from "./electric";
import type { PackageResult } from "./scenarios";
import type { ProjectInput, PvPlane } from "./types";

export const DHW_DELIVERY_C = 40;
/** Profilo giornaliero dei prelievi per ora civile: mattina, pranzo e sera. */
export const DHW_DRAW_SHARE: Record<number, number> = { 6: .05, 7: .15, 8: .10, 9: .05, 12: .05, 13: .10, 18: .05, 19: .10, 20: .15, 21: .15, 22: .05 };
export const TANK_SET_C = 55, TANK_MIN_C = 45, TANK_SUN_C = 60, TANK_HYST_K = 5;
/** Oltre questa temperatura l'impianto solare si ferma e il calore in più non si usa; la caldaia d'integrazione ha potenza in abbondanza. */
export const TANK_SOLAR_MAX_C = 80, GAS_BACKUP_W = 24000;
export const DHW_PRICE_SCENARIOS = { pdc: { basso: 2200, centrale: 3000, alto: 4200 }, elettrico: { basso: 350, centrale: 550, alto: 850 }, solare: { basso: 3500, centrale: 5000, alto: 7000 } };
export const DHW_PRICE_SOURCE = "Ipotesi di scenario, non un prezzo medio verificato: scaldacqua installato, IVA compresa. Per lo scaldacqua a pompa di calore da circa 200 litri i prezzi di vendita online del solo apparecchio erano circa 1.500–2.700 € al 5/11/2026; posa, collegamenti e smaltimento del vecchio sono ipotizzati. Scenari basso / centrale / alto nella sensibilità";

export const DHW_SOLAR_PRICE_SOURCE = "Ipotesi di scenario del 5/11/2026, non un prezzo medio verificato né un prezzo attuale: solare termico a circolazione forzata con circa 4 m² di pannelli, serbatoio con due serpentini da 200–300 litri, posa e collegamento alla caldaia o alla resistenza, IVA compresa. Scenari basso / centrale / alto nella sensibilità";
export const SOLAR_CURVE_SOURCE = "Valori tipici di un pannello piano vetrato, ordine di grandezza delle schede Solar Keymark (ISO 9806): da sostituire con quelli della scheda, riferiti alla stessa area indicata per la superficie";
export const dhwPriceSource = (type: ProjectInput["dhw"]["newType"]): string => type === "solare" ? DHW_SOLAR_PRICE_SOURCE : DHW_PRICE_SOURCE;
export const DHW_TYPE_LABEL: Record<ProjectInput["dhw"]["newType"], string> = { pdc: "Scaldacqua a pompa di calore", elettrico: "Boiler elettrico nuovo", solare: "Solare termico" };

const RAD = Math.PI / 180;
/** Frazione diffusa dell'orizzontale dall'indice di serenità (correlazione di Erbs, 1982). */
export function erbsDiffuseFraction(kt: number): number {
  if (kt <= .22) return 1 - .09 * kt;
  if (kt <= .8) return .9511 - .1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return .165;
}

/**
 * Irraggiamento su un piano inclinato (W/m²) dall'orizzontale del pacchetto clima: posizione del sole con le formule NOAA
 * all'ora di PVGIS, diretta e diffusa con Erbs, cielo isotropo, terreno 0,2 (come pvlib nel pacchetto). Azimut da nord, sud = 180.
 */
export function planeIrradiance(climate: ClimatePackage, tiltDeg: number, azimuthDeg: number): number[] {
  const { latitude, longitude, irradianceTimeOffset_h } = climate.manifest;
  const phi = latitude * RAD, beta = tiltDeg * RAD, az = azimuthDeg * RAD;
  const nE = Math.sin(beta) * Math.sin(az), nN = Math.sin(beta) * Math.cos(az), nU = Math.cos(beta);
  return climate.series.ghi.map((ghi, h) => {
    if (ghi <= 0) return 0;
    const t = h + irradianceTimeOffset_h, day = Math.floor(t / 24), hour = t - day * 24;
    const g = 2 * Math.PI / 365 * (day + (hour - 12) / 24);
    const eqMin = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
    const decl = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
    const ha = ((hour * 60 + eqMin + 4 * longitude) / 4 - 180) * RAD;
    const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
    const sunE = -Math.cos(decl) * Math.sin(ha), sunN = Math.cos(phi) * Math.sin(decl) - Math.sin(phi) * Math.cos(decl) * Math.cos(ha);
    const cosT = nE * sunE + nN * sunN + nU * cosZ;
    let dni = 0, dhi = ghi;
    if (cosZ > .065) {
      const kt = Math.min(1, ghi / (1367 * (1 + .033 * Math.cos(2 * Math.PI * (day + 1) / 365)) * cosZ));
      dhi = ghi * erbsDiffuseFraction(kt); dni = (ghi - dhi) / cosZ;
    }
    return Math.max(0, dni * Math.max(0, cosT) + dhi * (1 + nU) / 2 + ghi * .2 * (1 - nU) / 2);
  });
}

const planeCache = new WeakMap<ClimatePackage, Map<PvPlane, number[]>>();
/** Irraggiamento sui pannelli solari, sugli stessi sei piani del fotovoltaico. */
export function collectorIrradiance(climate: ClimatePackage, plane: PvPlane): number[] {
  let byPlane = planeCache.get(climate);
  if (!byPlane) planeCache.set(climate, byPlane = new Map());
  let g = byPlane.get(plane);
  if (!g) byPlane.set(plane, g = planeIrradiance(climate, Number(plane.slice(1)), { E: 90, S: 180, O: 270 }[plane[0] as "E" | "S" | "O"]));
  return g;
}

export function todayBoiler(p: ProjectInput): boolean { return p.dhw.todayElectric && !p.system.acsOnGas; }
export const coldWaterC = (climate: ClimatePackage): number => mean(climate.series.tAir);

export function dhwNeedFromPeople(p: ProjectInput, climate: ClimatePackage): number {
  return p.dhw.people.value * p.dhw.litresPerPerson.value * 1.163 * (DHW_DELIVERY_C - coldWaterC(climate)) * 365 / 1000;
}

export function dhwNeedFromGas(p: ProjectInput): number | null {
  return !p.system.acsOnGas || p.system.acsGasSmc.status === "sconosciuto" ? null : p.system.acsGasSmc.value * (p.system.efficiencyBasis === "PCS" ? p.system.gasPcs.value : p.system.gasPci.value) * p.dhw.gasDhwEfficiency.value;
}

export function dhwNeed(p: ProjectInput, climate: ClimatePackage): { kWh: number; from: "gas" | "persone" } {
  const gas = dhwNeedFromGas(p);
  return gas === null ? { kWh: dhwNeedFromPeople(p, climate), from: "persone" } : { kWh: gas, from: "gas" };
}

export function dhwDraws(needKwh: number): number[] {
  return Array.from({ length: HOURS }, (_, h) => needKwh * 1000 / 365 * (DHW_DRAW_SHARE[localHour(h)] ?? 0));
}

export interface TankParams {
  litres: number; standbyW: number; roomC: number; coldC: number;
  heater: "pdc" | "resistenza"; hpThermalW: number; backupW: number;
  copRated: number; copRatedAirC: number; airSource: "esterno" | "locale"; minAirC: number;
  control: "termostato" | "sole";
  /** Pannelli solari (4C); senza, il serbatoio è quello della 4B. */
  collector?: CollectorParams;
  /** Integrazione con la caldaia a gas: la «resistenza» è la caldaia e non consuma elettricità. */
  backupFuel?: "elettricità" | "gas";
}

export interface CollectorParams {
  areaM2: number; eta0: number; a1: number; a2: number; loopLossPct: number; pumpW: number;
  irradiance: number[]; // W/m² sul piano dei pannelli
}

export interface TankResult {
  elec: number[]; heat: number[]; draw: number[]; loss: number[]; stored: number[]; // W per ora; stored in Wh a fine ora
  elec_kWh: number; heat_kWh: number; draw_kWh: number; loss_kWh: number; storedStart_kWh: number; storedEnd_kWh: number;
  resistance_kWh: number; unmetHours: number; unmet_kWh: number; cop: number;
  solar: number[]; solar_kWh: number; dumped_kWh: number; pump_kWh: number; backupGas_kWh: number; // calore del sole e gas dell'integrazione
}

/** Serbatoio a temperatura unica; nessuna correzione dell'energia quando il servizio non basta. */
export function simulateTank(t: TankParams, drawW: number[], tAir: number[], surplusW: number[] | null): TankResult {
  const capacity = t.litres * 1.163, ua = t.standbyW / 45;
  const energy = (temp: number) => capacity * (temp - t.coldC);
  const carnot = (air: number, water: number) => (water + 5 + 273.15) / Math.max(5, water + 5 - air);
  const c = t.collector, gasBackup = t.backupFuel === "gas";
  let stored = energy(TANK_SET_C), resistance = 0, hpHeat = 0, hpElec = 0, backupGas = 0;
  const out: TankResult = { elec: [], heat: [], draw: [...drawW], loss: [], stored: [], elec_kWh: 0, heat_kWh: 0, draw_kWh: 0, loss_kWh: 0, storedStart_kWh: stored / 1000, storedEnd_kWh: 0, resistance_kWh: 0, unmetHours: 0, unmet_kWh: 0, cop: 0, solar: [], solar_kWh: 0, dumped_kWh: 0, pump_kWh: 0, backupGas_kWh: 0 };
  for (let h = 0; h < drawW.length; h++) {
    const temp = t.coldC + stored / capacity;
    const loss = Math.max(0, ua * (temp - t.roomC));
    const e0 = stored - drawW[h] - loss;
    // calore del sole dopo prelievi e perdite, alla temperatura d'inizio ora, fino a TANK_SOLAR_MAX_C
    let solar = 0, pump = 0;
    if (c && c.irradiance[h] > 0) {
      const dT = temp - tAir[h];
      const gain = c.areaM2 * Math.max(0, c.eta0 * c.irradiance[h] - c.a1 * dT - c.a2 * dT * dT) * (1 - c.loopLossPct / 100);
      solar = Math.min(gain, Math.max(0, energy(TANK_SOLAR_MAX_C) - e0));
      out.dumped_kWh += (gain - solar) / 1000;
      if (solar > 0) pump = c.pumpW;
    }
    const e1 = e0 + solar;
    const air = t.airSource === "locale" ? t.roomC : tAir[h];
    const byHp = t.heater === "pdc" && air >= t.minAirC;
    const cop = Math.max(1, Math.min(7, t.copRated * carnot(air, temp) / carnot(t.copRatedAirC, 50)));
    const electricPower = byHp ? t.hpThermalW / cop : t.backupW;
    let target: number | null = null;
    if (t.control === "sole") {
      if (surplusW && surplusW[h] >= .5 * electricPower) target = TANK_SUN_C;
      else if (e1 < energy(TANK_MIN_C)) target = TANK_MIN_C;
    } else if (e1 < energy(TANK_SET_C - TANK_HYST_K)) target = TANK_SET_C;
    const need = target === null ? 0 : Math.max(0, energy(target) - e1);
    const heatHp = byHp ? Math.min(t.hpThermalW, need) : 0;
    let heatResistance = byHp ? 0 : Math.min(t.backupW, need);
    heatResistance += Math.min(Math.max(0, t.backupW - heatResistance), Math.max(0, energy(DHW_DELIVERY_C) - e1 - heatHp - heatResistance));
    const heat = heatHp + heatResistance, elec = heatHp / cop + (gasBackup ? 0 : heatResistance) + pump;
    stored = e1 + heat;
    if (stored < energy(DHW_DELIVERY_C)) { out.unmetHours++; out.unmet_kWh += (energy(DHW_DELIVERY_C) - stored) / 1000; }
    out.elec.push(elec); out.heat.push(heat); out.loss.push(loss); out.stored.push(stored); out.solar.push(solar);
    out.solar_kWh += solar / 1000; out.pump_kWh += pump / 1000;
    out.elec_kWh += elec / 1000; out.heat_kWh += heat / 1000; out.draw_kWh += drawW[h] / 1000; out.loss_kWh += loss / 1000;
    if (gasBackup) backupGas += heatResistance; else resistance += heatResistance;
    hpHeat += heatHp; hpElec += heatHp / cop;
  }
  out.storedEnd_kWh = stored / 1000; out.resistance_kWh = resistance / 1000; out.cop = hpElec > 0 ? hpHeat / hpElec : 0; out.backupGas_kWh = backupGas / 1000;
  return out;
}

export function dhwTankParams(p: ProjectInput, climate: ClimatePackage, today = false, control: TankParams["control"] = "termostato"): TankParams {
  const d = p.dhw, solar = !today && d.newType === "solare", gas = solar && d.solarBackup === "gas";
  return { litres: (today ? d.todayTankLitres : d.tankLitres).value, standbyW: (today ? d.todayStandbyW : d.standbyW).value, roomC: d.roomTemp.value, coldC: coldWaterC(climate), heater: today || d.newType !== "pdc" ? "resistenza" : "pdc", hpThermalW: d.hpThermalKw.value * 1000, backupW: gas ? GAS_BACKUP_W : (today ? d.todayPowerKw : d.backupKw).value * 1000, copRated: d.copRated.value, copRatedAirC: d.copRatedAirC.value, airSource: d.airSource, minAirC: d.minAirC.value, control,
    ...(solar ? { backupFuel: gas ? "gas" as const : "elettricità" as const, collector: { areaM2: d.solarAreaM2.value, eta0: d.solarEta0.value, a1: d.solarA1.value, a2: d.solarA2.value, loopLossPct: d.solarLoopLossPct.value, pumpW: d.solarPumpW.value, irradiance: collectorIrradiance(climate, d.solarPlane) } } : {}) };
}

export function dhwCost(p: ProjectInput) {
  if (p.dhw.costMode === "preventivo") return summarizeCost(p.dhw.cost);
  const complete = p.dhw.price.status !== "sconosciuto";
  return { total: p.dhw.price.value, complete, unknownItems: complete ? [] : ["prezzo"] };
}

export function plantLabel(p: ProjectInput): { long: string; short: string } {
  if (!p.dhw.replace) return p.heatPump.included ? { long: "Pompa di calore", short: "PDC" } : { long: "Impianto", short: "Impianto" };
  const solar = p.dhw.newType === "solare";
  return p.heatPump.included ? { long: `Impianto (PDC, ${solar ? "solare termico" : "scaldacqua"})`, short: "Impianto" } : { long: DHW_TYPE_LABEL[p.dhw.newType], short: solar ? "Solare termico" : "Scaldacqua" };
}

/** Quota dello scaldacqua coperta dal FV della stessa ora, dopo tutti gli altri consumi. */
export function dhwSolarShare(p: ProjectInput, climate: ClimatePackage, r: PackageResult): number | null {
  const pv = p.existingPv.present ? packagePv(climate, p, false) : r.has.P ? pvProduction(climate, p.pv.plane, r.pvKwp, p.pv.lossPct.value) : null;
  if (!pv || !r.dhw) return null;
  let other = otherUsesDemand(p, r.otherUses_kWh, climate);
  if (r.cooking) other = other.map((x, h) => x + r.cooking!.elec[h]);
  let covered = 0;
  for (let h = 0; h < HOURS; h++) covered += Math.min(r.dhw.result.elec[h], Math.max(0, pv[h] - other[h] - (r.hp?.elec[h] ?? 0) - (r.cooling?.elec[h] ?? 0)));
  return r.dhw.result.elec_kWh > 0 ? covered / (r.dhw.result.elec_kWh * 1000) * 100 : 0;
}
