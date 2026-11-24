import { RULES, type ProjectInput, type Q, type RangeRule, type Section } from "../engine";

import { EV_FIELDS } from "../engine/auto";

const UNITS: Record<string, string> = {
  hobCost: "€", meterClosureCost: "€",
  setbackTemp: "°C", maxPowerKw: "kW",
  floorArea: "m²", floors: "piani", netStoreyHeight: "m", slabThickness: "m", upperArea: "m²", lowerArea: "m²", adjacentWallArea: "m²", exposedPerimeter: "m",
  uWall: "W/m²K", uUpper: "W/m²K", uLower: "W/m²K", uWindow: "W/m²K", thermalBridgeDeltaU: "W/m²K", heatCapacityPerArea: "kJ/m²K", airChange: "volumi/h",
  setpoint: "°C", internalGains: "W/m²", gasPcs: "kWh/Smc", gasPci: "kWh/Smc", designFlowTemp: "°C", designOutdoorTemp: "°C", acsGasSmc: "Smc/anno", cookingGasSmc: "Smc/anno",
  electricityKwh: "kWh/anno", gasSmcObserved: "Smc/anno", gasPrice: "€/Smc", gasFixed: "€/anno", elecPrice: "€/kWh", elecFixed: "€/anno", powerCostPerKw: "€/kW/anno", contractPower: "kW", exportPrice: "€/kWh",
  maxDelta: "K", splitCapacity: "kW", splitEer35: "adimensionale", eer35: "adimensionale",
  pTO_W: "W", pOFF_W: "W", pCK_W: "W", extraPump_W: "W", minModulation: "frazione", cyclingCd: "adimensionale",
  maintenanceDelta: "€/anno", nominalCapacity: "kW", capacitySlope: "1/K", minOutdoorTemp: "°C", maxFlowTemp: "°C", newContractPower: "kW", boilerReplacementCost: "€", kWp: "kWp", lossPct: "%", degradationPct: "%/anno", horizonYears: "anni", windowsPct: "%", heatPumpPct: "%", pvPct: "%", batteryPct: "%", years: "anni",
  capacityKwh: "kWh", powerKw: "kW", roundTripPct: "%", reservePct: "%", fadePctPerYear: "%/anno", lifeYears: "anni", lifeCycles: "cicli", gridImportKwh: "kWh/anno",
  roofArea: "m²", areaPerKwp: "m²/kWp", pricePerKwp: "€/kWp", pricePerKwh: "€/kWh",
  areaOut: "m²", uOut: "W/m²K", volume: "m³",
  thicknessCm: "cm", lambda: "W/mK", uFinal: "W/m²K", sharePct: "%", bridgeDeltaU: "W/m²K", pricePerM2: "€/m²",
  marketValue: "€",
  todayTankLitres: "litri", todayPowerKw: "kW", todayStandbyW: "W", people: "persone", litresPerPerson: "litri/giorno a persona", tankLitres: "litri", hpThermalKw: "kW", backupKw: "kW", copRated: "adimensionale", copRatedAirC: "°C", roomTemp: "°C", standbyW: "W", minAirC: "°C", price: "€", solarAreaM2: "m²", solarA1: "W/(m²·K)", solarA2: "W/(m²·K²)", solarLoopLossPct: "%", solarPumpW: "W",
};

/** Un solo catalogo di etichette, unità e intervalli per form, guida e stampa. */
const QUICK_LABELS: Record<string, string> = { "service.setpoint": "Temperatura abituale in casa", "building.netStoreyHeight": "Altezza approssimata dei locali", "building.floors": "Numero di piani riscaldati" };
export const FIELDS = RULES.map((r) => ({ ...r, quickLabel: QUICK_LABELS[r.path], unit: r.path.startsWith("ev.") ? EV_FIELDS.find((f) => `ev.${f[0]}` === r.path)![2] : /\.(wallArea|windowArea)\./.test(r.path) ? "m²" : UNITS[r.path.split(".").at(-1)!] ?? "adimensionale" }));
export const fieldId = (path: string) => `campo-${path.replace(/[^\w-]/g, "-")}`;
export const isInherited = (q: Q) => /esempio|ereditat[oa]/i.test(q.source ?? "");
export const needsEvidence = (q: Q) => q.status === "ipotizzato" || q.status === "sconosciuto";

export function fieldError(q: Q, rule?: Pick<RangeRule, "min" | "max" | "path">): string | undefined {
  if (!rule) return undefined;
  if (rule.path === "building.exposedPerimeter" && q.status !== "sconosciuto" && q.value <= 0) return "Inserisci un perimetro esposto positivo oppure dichiara «non so».";
  if (!Number.isFinite(q.value) || q.value < rule.min || q.value > rule.max) return `Inserisci un valore tra ${rule.min.toLocaleString("it-IT")} e ${rule.max.toLocaleString("it-IT")}.`;
  if (["building.floors", "economics.horizonYears", "economics.incentive.years"].includes(rule.path) && !Number.isInteger(q.value)) return "Inserisci un numero intero.";
}

export const sectionStep = (section: Section) => ({ Località: "localita", Edificio: "edificio", Servizio: "impianto", Impianto: "impianto", "Acqua calda": "interventi", Consumi: "consumi", "Auto elettrica": "consumi", Tariffe: "consumi", Serramenti: "interventi", Isolamento: "interventi", "Pompa di calore": "interventi", Fotovoltaico: "interventi", Economia: "interventi" })[section];

export function focusField(path: string) {
  focusControl(fieldId(path));
}

export function focusControl(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let node = el.parentElement; node; node = node.parentElement) if (node instanceof HTMLDetailsElement) node.open = true;
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
}

export function ruleFor(p: ProjectInput | undefined, q: Q) {
  return p ? FIELDS.find((r) => !(r.path.startsWith("cooking.") && !p.cooking) && r.get(p) === q) : undefined;
}
