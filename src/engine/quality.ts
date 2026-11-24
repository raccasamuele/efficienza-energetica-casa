import { inDayPeriod, isValidDate } from "./climate";
import { findCatalogHp, hasFitDomain } from "./heatpump";
import { computeGeometry, ORIENTATIONS } from "./geometry";
import { measuredCurveErrors } from "./misure";
import { usesMeasuredCurve } from "./curva";
import { profileArea } from "./electric";
import { KWP_MIN, maxKwpForRoof } from "./sizing";
import type { DataStatus, ProjectInput, Q } from "./types";
import { activeInsulation, INSULATION_KINDS, INSULATION_PRICE_SCENARIOS, insulatedU, insulationApplies, insulationCurrentU, insulationName, insulationPriceType } from "./involucro";
import { ENERGY_CLASSES } from "./valore";
import { DHW_PRICE_SCENARIOS, todayBoiler } from "./acqua";
import { unheatedHue } from "./thermal";

import { EV_FIELDS } from "./auto";

/** Controllo completo anche nei file importati: nessun completamento silenzioso di una scelta parziale. */
export function heatingScheduleErrors(value: unknown, setpoint: number): string[] {
  if (value === undefined) return [];
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const prefix = "service.schedule (riscaldamento a orari)";
  if (!object(value)) return [`${prefix}: atteso un oggetto.`];
  const errors: string[] = [];
  const error = (message: string) => errors.push(`${prefix}: ${message}`);
  if (typeof value.mode !== "string" || !["continuo", "fasce"].includes(value.mode)) error("modo non ammesso.");
  if (typeof value.setback !== "string" || !["spento", "ridotta"].includes(value.setback)) error("scelta fuori fascia non ammessa.");
  if (typeof value.withHeatPump !== "string" || !["continuo", "come-oggi"].includes(value.withHeatPump)) error("scelta con la pompa di calore non ammessa.");
  const bands = value.bands;
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > 2) error("indica una o due fasce.");
  else {
    const valid = bands.every((b: unknown) => object(b) && typeof b.start === "number" && typeof b.end === "number" && Number.isInteger(b.start) && Number.isInteger(b.end) && b.start >= 0 && b.end <= 24 && b.start < b.end);
    if (!valid) error("le fasce richiedono ore intere da 0 a 24 e inizio prima della fine.");
    else {
      const sorted = (bands as { start: number; end: number }[]).slice().sort((a, b) => a.start - b.start);
      if (sorted.some((b, i) => i > 0 && b.start < sorted[i - 1].end)) error("le fasce non possono sovrapporsi.");
    }
  }
  for (const [key, label, min, max] of [["setbackTemp", "Temperatura ridotta", 5, setpoint], ["maxPowerKw", "Potenza verso la casa", 2, 100]] as const) {
    const v = value[key];
    if (!object(v) || typeof v.value !== "number" || !Number.isFinite(v.value) || typeof v.status !== "string" || !["documentato", "misurato", "ipotizzato", "sconosciuto"].includes(v.status)) { error(`${label}: attesi valore numerico finito e stato del dato.`); continue; }
    if (v.value < min || v.value > max) error(`${label}: valore fuori intervallo ${it(min)}–${it(max)}.`);
    if ((v.source !== undefined && typeof v.source !== "string") || (v.date !== undefined && typeof v.date !== "string") || (v.confirmed !== undefined && typeof v.confirmed !== "boolean")) error(`${label}: provenienza, data o conferma non valide.`);
  }
  return errors;
}

/** Anche una scelta spenta deve avere una forma valida: i file importati non sono fidati. */
export function cookingSwitchErrors(value: unknown): string[] {
  if (value === undefined) return [];
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!object(value)) return ["cooking (piano a induzione): atteso un oggetto."];
  const errors: string[] = [];
  if (typeof value.enabled !== "boolean") errors.push("cooking.enabled: deve essere booleano.");
  for (const [key, min, max] of [["gasHobEfficiency", .2, 1], ["inductionEfficiency", .2, 1], ["hobCost", 0, 20000], ["meterClosureCost", 0, 20000]] as const) {
    const v = value[key], path = `cooking.${key}`;
    if (!object(v) || typeof v.value !== "number" || !Number.isFinite(v.value) || typeof v.status !== "string" || !["documentato", "misurato", "ipotizzato", "sconosciuto"].includes(v.status)) {
      errors.push(`${path}: attesi valore numerico finito e stato del dato.`);
      continue;
    }
    if (v.value < min || v.value > max) errors.push(`${path}: valore fuori intervallo ${it(min)}–${it(max)}.`);
    if ((v.source !== undefined && typeof v.source !== "string") || (v.date !== undefined && typeof v.date !== "string") || (v.confirmed !== undefined && typeof v.confirmed !== "boolean")) errors.push(`${path}: provenienza, data o conferma non valide.`);
  }
  return errors;
}

export const ENUMS = {
  mode: ["rapida", "documentata"],
  geometryMode: ["forma", "aree"],
  windowMode: ["frazione", "aree"],
  shape: ["quadrata", "rettangolare", "L", "ferroCavallo"],
  upper: ["riscaldato", "sottotetto", "coperturaInclinata", "coperturaPiana"],
  lower: ["riscaldato", "nonRiscaldato", "terreno", "esterno"],
  sides: ["isolato", "unLato", "dueLati"],
  sideAdjacency: ["riscaldato", "nonRiscaldato", "nonNoto"],
  unheatedMode: ["fattoreB", "locale"],
  thermalBridgeMode: ["deltaU", "lineari"],
  wallInsulation: ["esterno", "interno", "intercapedine"],
  thermalFrame: ["telaio", "muratura"],
  infiltrationMode: ["costante", "tenuta"],
  efficiencyBasis: ["PCS", "PCI"],
  profile: ["diurno", "serale", "distribuito"],
  profileMode: ["sintetico", "stagionale"],
  plane: ["E20", "E35", "S20", "S35", "O20", "O35"],
  costStatus: ["incluso", "escluso", "sconosciuto"],
  hpModel: ["parametrico", "catalogo"],
  emitters: ["radiatori", "ventilconvettori", "radiante", "nonNoto"],
  coolingToday: ["nessuno", "split"],
  goal: ["auto", "completo", "fv", "batteria", "pdc", "serramenti", "tariffa"],
  consumptionFrom: ["inverter", "bolletta", "contatore"],
  sizing: ["preventivo", "indicativa"],
  energyClass: [...ENERGY_CLASSES, "nonSo"],
  dhwType: ["pdc", "elettrico", "solare"],
  dhwBackup: ["elettrico", "gas"],
  dhwAir: ["esterno", "locale"],
  costMode: ["stima", "preventivo"],
} as const;

/** Valori enumerati del progetto con il loro elenco ammesso (per l'import di dati non fidati). */
export function enumChecks(p: ProjectInput): [string, unknown, readonly string[]][] {
  const b = p.building;
  return [
    ["mode", p.mode, ENUMS.mode],
    ["building.geometryMode", b.geometryMode, ENUMS.geometryMode],
    ["building.windowMode", b.windowMode, ENUMS.windowMode],
    ["building.shape", b.shape, ENUMS.shape],
    ["building.upper", b.upper, ENUMS.upper],
    ["building.lower", b.lower, ENUMS.lower],
    ["building.sides", b.sides, ENUMS.sides],
    ["building.sideAdjacency", b.sideAdjacency, ENUMS.sideAdjacency],
    ["building.thermalBridges.mode", b.thermalBridges.mode, ENUMS.thermalBridgeMode],
    ["building.thermalBridges.wallInsulation", b.thermalBridges.wallInsulation, ENUMS.wallInsulation],
    ["building.thermalBridges.frame", b.thermalBridges.frame, ENUMS.thermalFrame],
    ["building.infiltration.mode", b.infiltration.mode, ENUMS.infiltrationMode],
    ...(["unheatedUpper", "unheatedLower", "unheatedSide"] as const).map((k) => [`building.${k}.mode`, b[k].mode, ENUMS.unheatedMode] as [string, unknown, readonly string[]]),
    ["system.efficiencyBasis", p.system.efficiencyBasis, ENUMS.efficiencyBasis],
    ["consumption.profile", p.consumption.profile, ENUMS.profile],
    ...(p.consumption.profileMode === undefined ? [] : [["consumption.profileMode", p.consumption.profileMode, ENUMS.profileMode] as [string, unknown, readonly string[]]]),
    ["pv.plane", p.pv.plane, ENUMS.plane],
    ["heatPump.model", p.heatPump.model, ENUMS.hpModel],
    ["system.emitters", p.system.emitters, ENUMS.emitters],
    ["cooling.today", p.cooling.today, ENUMS.coolingToday],
    ["goal", p.goal, ENUMS.goal],
    ["existingPv.plane", p.existingPv.plane, ENUMS.plane],
    ["existingPv.consumptionFrom", p.existingPv.consumptionFrom, ENUMS.consumptionFrom],
    ["pv.sizing", p.pv.sizing, ENUMS.sizing],
    ["economics.homeValue.energyClass", p.economics.homeValue.energyClass, ENUMS.energyClass],
    ["dhw.newType", p.dhw.newType, ENUMS.dhwType],
    ["dhw.solarPlane", p.dhw.solarPlane, ENUMS.plane],
    ["dhw.solarBackup", p.dhw.solarBackup, ENUMS.dhwBackup],
    ["dhw.airSource", p.dhw.airSource, ENUMS.dhwAir],
    ["ev.pvPlan", p.ev.pvPlan, ["esistente", "nuovo", "nessuno"]],
    ["ev.charger", p.ev.charger, ["presa", "wallbox"]],
    ["ev.strategy", p.ev.strategy, ["arrivo", "notte", "sole"]],
    ["ev.costMode", p.ev.costMode, ENUMS.costMode],
    ...p.ev.cost.items.map((it, i): [string, unknown, readonly string[]] => [`ev.cost.items[${i}].status`, it.status, ENUMS.costStatus]),
    ["dhw.costMode", p.dhw.costMode, ENUMS.costMode],
    ...p.dhw.cost.items.map((it, i): [string, unknown, readonly string[]] => [`dhw.cost.items[${i}].status`, it.status, ENUMS.costStatus]),
    ...INSULATION_KINDS.flatMap((kind): [string, unknown, readonly string[]][] => [
      [`envelope.${kind}.method`, p.envelope[kind].method, ["spessore", "uFinale"]],
      [`envelope.${kind}.bridges`, p.envelope[kind].bridges, ["comeOggi", "valore"]],
      [`envelope.${kind}.costMode`, p.envelope[kind].costMode, ["stima", "preventivo"]],
      ...p.envelope[kind].cost.items.map((it, i): [string, unknown, readonly string[]] => [`envelope.${kind}.cost.items[${i}].status`, it.status, ENUMS.costStatus]),
    ]),
    ...[p.windows.cost, p.heatPump.cost, p.pv.cost, p.battery.cost].flatMap((c, k) =>
      c.items.map((it, i) => [`costi[${k}].items[${i}].status`, it.status, ENUMS.costStatus] as [string, unknown, readonly string[]]),
    ),
    ...(["windows", "heatPump", "pv", "battery"] as const).flatMap((k) =>
      p[k].otherQuotes.flatMap((q, j) => q.cost.items.map((it, i) => [`${k}.otherQuotes[${j}].cost.items[${i}].status`, it.status, ENUMS.costStatus] as [string, unknown, readonly string[]])),
    ),
    ...p.heatPump.otherQuotes.map((q, j) => [`heatPump.otherQuotes[${j}].model`, q.model, ENUMS.hpModel] as [string, unknown, readonly string[]]),
  ];
}

export type Section = "Località" | "Edificio" | "Servizio" | "Impianto" | "Acqua calda" | "Auto elettrica" | "Consumi" | "Tariffe" | "Serramenti" | "Isolamento" | "Pompa di calore" | "Fotovoltaico" | "Economia";

/**
 * «dato»: per il confronto documentato serve un valore documentato o misurato.
 * «tecnico»: ammessa anche una stima tecnica motivata e confermata esplicitamente.
 */
type Criticality = "dato" | "tecnico" | undefined;

export interface RangeRule {
  path: string;
  label: string;
  get: (p: ProjectInput) => Q;
  min: number;
  max: number;
  critical: Criticality;
  applies: (p: ProjectInput) => boolean;
  section: Section;
}

const always = () => true;
const R = (
  section: Section,
  path: string,
  label: string,
  get: (p: ProjectInput) => Q,
  min: number,
  max: number,
  critical?: Criticality,
  applies: (p: ProjectInput) => boolean = always,
): RangeRule => ({ section, path, label, get, min, max, critical, applies });

const aree = (p: ProjectInput) => p.building.geometryMode === "aree";
/** La batteria entra nei conti: scelta con il FV nuovo, sempre con il FV esistente. */
export const batteryUsed = (p: ProjectInput) => p.battery.enabled || p.existingPv.present;
const fmtSize = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
const hasIncluded = (c: ProjectInput["pv"]["cost"]) => c.items.some((it) => it.status === "incluso" && it.amount.value > 0);

/**
 * Preventivo da riverificare: la taglia è cambiata dopo averlo compilato. Gli importi dell'utente non si toccano mai:
 * si avvisa vicino al costo e nei risultati.
 */
export function quoteSizeNotes(p: ProjectInput): string[] {
  if (p.pv.sizing === "indicativa") return [];
  const out: string[] = [];
  const pv = p.pv.cost;
  if (!p.existingPv.present && pv.forSize > 0 && hasIncluded(pv) && Math.abs(pv.forSize - p.pv.kWp.value) > 1e-9)
    out.push(`Il preventivo del FV è per ${fmtSize(pv.forSize)} kWp ma la potenza ora è ${fmtSize(p.pv.kWp.value)} kWp: prezzo e sostituzioni vanno riverificati.`);
  const b = p.battery.cost;
  if (batteryUsed(p) && b.forSize > 0 && hasIncluded(b) && Math.abs(b.forSize - p.battery.capacityKwh.value) > 1e-9)
    out.push(`Il preventivo della batteria è per ${fmtSize(b.forSize)} kWh ma la capacità ora è ${fmtSize(p.battery.capacityKwh.value)} kWh: prezzo e sostituzioni vanno riverificati.`);
  return out;
}

const indicativeRoof = (p: ProjectInput) => p.pv.sizing === "indicativa" && !p.existingPv.present;
const indicativeBattery = (p: ProjectInput) => p.pv.sizing === "indicativa" && batteryUsed(p);
const fromBill = (p: ProjectInput) => p.existingPv.present && p.existingPv.consumptionFrom === "bolletta";
const fromMeterCurve = (p: ProjectInput) => p.existingPv.present && p.existingPv.consumptionFrom === "contatore";
const finestreAree = (p: ProjectInput) => p.building.windowMode === "aree";
const raffresca = (p: ProjectInput) => p.cooling.today === "split";
const ORS = ["N", "E", "S", "O"] as const;
const newDhw = (p: ProjectInput) => p.dhw.replace;
const newDhwHp = (p: ProjectInput) => p.dhw.replace && p.dhw.newType === "pdc";
const newDhwSolar = (p: ProjectInput) => p.dhw.replace && p.dhw.newType === "solare";
const peopleDhw = (p: ProjectInput) => todayBoiler(p) || (p.dhw.replace && !p.system.acsOnGas);

const insulationRules: RangeRule[] = INSULATION_KINDS.flatMap((kind) => ([
    ["thicknessCm", "spessore dell'isolante", 0, 40, (p: ProjectInput) => p.envelope[kind].method === "spessore"],
    ["lambda", "conduttività dell'isolante (λ)", .015, .2, (p: ProjectInput) => p.envelope[kind].method === "spessore"],
    ["uFinal", "U dopo il lavoro", .05, 3, (p: ProjectInput) => p.envelope[kind].method === "uFinale"],
    ["sharePct", "parte della superficie isolata", 0, 100, always],
    ["bridgeDeltaU", "ΔU dei ponti termici dopo il lavoro", 0, .3, (p: ProjectInput) => p.envelope[kind].bridges === "valore"],
    ["pricePerM2", "prezzo per m²", 0, 1000, (p: ProjectInput) => p.envelope[kind].costMode === "stima"],
  ] as const).map(([field, label, min, max, applies]) => R("Isolamento", `envelope.${kind}.${field}`, `${kind === "walls" ? "Cappotto" : kind === "roof" ? "Isolamento del tetto o del sottotetto" : "Isolamento del solaio"}: ${label}`, (p) => p.envelope[kind][field], min, max, field === "thicknessCm" || field === "lambda" || field === "uFinal" ? "dato" : undefined, (p) => p.envelope[kind].enabled && insulationApplies(p, kind) && applies(p))));

const tariffActive = (p: ProjectInput): boolean => {
  const tariff = p.tariffCompare;
  if (!tariff) return false;
  const prices = [
    tariff.oneriKwh,
    tariff.monoraria.prezzo, tariff.monoraria.fissa,
    tariff.bioraria.f1, tariff.bioraria.f23, tariff.bioraria.fissa,
    tariff.indicizzata.punF1, tariff.indicizzata.punF2, tariff.indicizzata.punF3,
    tariff.indicizzata.spread, tariff.indicizzata.fissa,
  ];
  return p.goal === "tariffa" || prices.some((price) => price.status !== "sconosciuto");
};

const tariffRules: RangeRule[] = [
  R("Tariffe", "tariffCompare.oneriKwh", "Oneri di rete e imposte per kWh", (p) => p.tariffCompare!.oneriKwh, 0, 0.5, "dato", tariffActive),
  R("Tariffe", "tariffCompare.monoraria.prezzo", "Prezzo monorario", (p) => p.tariffCompare!.monoraria.prezzo, 0, 1, "dato", tariffActive),
  R("Tariffe", "tariffCompare.monoraria.fissa", "Quota fissa monoraria", (p) => p.tariffCompare!.monoraria.fissa, 0, 500, undefined, tariffActive),
  R("Tariffe", "tariffCompare.bioraria.f1", "Prezzo biorario F1", (p) => p.tariffCompare!.bioraria.f1, 0, 1, "dato", tariffActive),
  R("Tariffe", "tariffCompare.bioraria.f23", "Prezzo biorario F2 e F3", (p) => p.tariffCompare!.bioraria.f23, 0, 1, "dato", tariffActive),
  R("Tariffe", "tariffCompare.bioraria.fissa", "Quota fissa bioraria", (p) => p.tariffCompare!.bioraria.fissa, 0, 500, undefined, tariffActive),
  R("Tariffe", "tariffCompare.indicizzata.punF1", "PUN F1", (p) => p.tariffCompare!.indicizzata.punF1, 0, 1, "dato", tariffActive),
  R("Tariffe", "tariffCompare.indicizzata.punF2", "PUN F2", (p) => p.tariffCompare!.indicizzata.punF2, 0, 1, "dato", tariffActive),
  R("Tariffe", "tariffCompare.indicizzata.punF3", "PUN F3", (p) => p.tariffCompare!.indicizzata.punF3, 0, 1, "dato", tariffActive),
  R("Tariffe", "tariffCompare.indicizzata.spread", "Spread indicizzato", (p) => p.tariffCompare!.indicizzata.spread, -0.05, 0.2, "dato", tariffActive),
  R("Tariffe", "tariffCompare.indicizzata.fissa", "Quota fissa indicizzata", (p) => p.tariffCompare!.indicizzata.fissa, 0, 500, undefined, tariffActive),
];

export const RULES: RangeRule[] = [
  R("Edificio", "building.floorArea", "Superficie utile riscaldata", (p) => p.building.floorArea, 20, 1000, "dato"),
  R("Edificio", "building.floors", "Numero di piani", (p) => p.building.floors, 1, 4),
  R("Edificio", "building.netStoreyHeight", "Altezza netta", (p) => p.building.netStoreyHeight, 2.2, 4.5, "dato"),
  R("Edificio", "building.slabThickness", "Spessore solaio", (p) => p.building.slabThickness, 0, 0.8, undefined, (p) => p.building.geometryMode === "forma"),
  ...ORS.map((o) => R("Edificio", `building.wallArea.${o}`, `Parete esterna netta ${o}`, (p) => p.building.wallArea[o], 0, 2000, "dato", aree)),
  R("Edificio", "building.upperArea", "Area confine superiore", (p) => p.building.upperArea, 0, 2000, "dato", (p) => aree(p) && p.building.upper !== "riscaldato"),
  R("Edificio", "building.lowerArea", "Area confine inferiore", (p) => p.building.lowerArea, 0, 2000, "dato", (p) => aree(p) && p.building.lower !== "riscaldato"),
  R("Edificio", "building.exposedPerimeter", "Perimetro esposto del pavimento", (p) => p.building.exposedPerimeter, 0, 2000, "dato", (p) => p.building.lower === "terreno"),
  R("Edificio", "building.adjacentWallArea", "Area pareti confinanti", (p) => p.building.adjacentWallArea, 0, 2000, "dato", (p) => aree(p) && p.building.sides !== "isolato"),
  ...ORS.map((o) => R("Edificio", `building.windowArea.${o}`, `Finestre ${o}`, (p) => p.building.windowArea[o], 0, 500, "dato", finestreAree)),
  R("Edificio", "building.windowFraction", "Rapporto finestrato", (p) => p.building.windowFraction, 0.03, 0.4, undefined, (p) => !finestreAree(p)),
  R("Edificio", "building.uWall", "U pareti", (p) => p.building.uWall, 0.1, 3.5, "dato"),
  R("Edificio", "building.uUpper", "U confine superiore", (p) => p.building.uUpper, 0.1, 4, "dato", (p) => p.building.upper !== "riscaldato"),
  R("Edificio", "building.uLower", "U confine inferiore", (p) => p.building.uLower, 0.1, 4, "dato", (p) => p.building.lower !== "riscaldato"),
  R("Edificio", "building.uWindow", "Uw serramenti attuali", (p) => p.building.uWindow, 0.5, 6.5, "dato"),
  R("Edificio", "building.gWindow", "g vetro attuale", (p) => p.building.gWindow, 0.1, 0.9),
  R("Edificio", "building.frameFraction", "Frazione telaio", (p) => p.building.frameFraction, 0.05, 0.5),
  R("Edificio", "building.thermalBridgeDeltaU", "Maggiorazione ponti termici ΔU", (p) => p.building.thermalBridgeDeltaU, 0, 0.3, "tecnico", (p) => p.building.thermalBridges.mode === "deltaU"),
  R("Edificio", "building.bUpperUnheated", "Fattore b sottotetto", (p) => p.building.bUpperUnheated, 0, 1, "tecnico", (p) => p.building.upper === "sottotetto"),
  R("Edificio", "building.bLowerUnheated", "Fattore b locale inferiore", (p) => p.building.bLowerUnheated, 0, 1, "tecnico", (p) => p.building.lower === "nonRiscaldato"),
  R("Edificio", "building.bSideUnheated", "Fattore b adiacenze laterali", (p) => p.building.bSideUnheated, 0, 1, "tecnico", (p) => p.building.sides !== "isolato" && p.building.sideAdjacency !== "riscaldato"),
  ...(["unheatedUpper", "unheatedLower", "unheatedSide"] as const).flatMap((k) => [
    R("Edificio", `building.${k}.areaOut`, "Superficie del locale verso l'esterno", (p) => p.building[k].areaOut, 0.01, 10000, "dato", (p) => p.building[k].mode === "locale" && (k === "unheatedUpper" ? p.building.upper === "sottotetto" : k === "unheatedLower" ? p.building.lower === "nonRiscaldato" : p.building.sides !== "isolato" && p.building.sideAdjacency !== "riscaldato")),
    R("Edificio", `building.${k}.uOut`, "U media del locale verso l'esterno", (p) => p.building[k].uOut, 0.01, 10, "dato", (p) => p.building[k].mode === "locale" && (k === "unheatedUpper" ? p.building.upper === "sottotetto" : k === "unheatedLower" ? p.building.lower === "nonRiscaldato" : p.building.sides !== "isolato" && p.building.sideAdjacency !== "riscaldato")),
    R("Edificio", `building.${k}.volume`, "Volume del locale non riscaldato", (p) => p.building[k].volume, 0.01, 100000, "dato", (p) => p.building[k].mode === "locale" && (k === "unheatedUpper" ? p.building.upper === "sottotetto" : k === "unheatedLower" ? p.building.lower === "nonRiscaldato" : p.building.sides !== "isolato" && p.building.sideAdjacency !== "riscaldato")),
    R("Edificio", `building.${k}.airChange`, "Ricambi del locale non riscaldato", (p) => p.building[k].airChange, 0.01, 20, "dato", (p) => p.building[k].mode === "locale" && (k === "unheatedUpper" ? p.building.upper === "sottotetto" : k === "unheatedLower" ? p.building.lower === "nonRiscaldato" : p.building.sides !== "isolato" && p.building.sideAdjacency !== "riscaldato")),
  ]),
  R("Edificio", "building.groundFactor", "Correzione al calcolo del terreno", (p) => p.building.groundFactor, 0.5, 1.5, undefined, (p) => p.building.lower === "terreno"),
  R("Edificio", "building.airChange", "Ricambi d'aria", (p) => p.building.airChange, 0.05, 3, "tecnico"),
  R("Edificio", "building.infiltration.n50", "Tenuta all'aria n50", (p) => p.building.infiltration.n50, 0.3, 30, undefined, (p) => p.building.infiltration.mode === "tenuta"),
  R("Edificio", "building.infiltration.minAirChange", "Ricambio minimo per l'aria pulita", (p) => p.building.infiltration.minAirChange, 0, 3, "tecnico", (p) => p.building.infiltration.mode === "tenuta"),
  R("Edificio", "building.heatCapacityPerArea", "Capacità termica per m²", (p) => p.building.heatCapacityPerArea, 50, 400, "tecnico"),
  R("Edificio", "building.shadingFactor", "Fattore di ombreggiamento", (p) => p.building.shadingFactor, 0.2, 1),
  R("Edificio", "building.solarAbsorptance", "Assorbimento del sole di pareti e tetto", (p) => p.building.solarAbsorptance, 0.2, 0.95),
  R("Edificio", "building.atticRoofShare", "Quota del tetto nelle dispersioni del sottotetto", (p) => p.building.atticRoofShare, 0, 1, "tecnico", (p) => p.building.upper === "sottotetto"),
  R("Servizio", "service.setpoint", "Setpoint", (p) => p.service.setpoint, 16, 24, "dato"),
  // Il valore di riserva serve ai metadati dei moduli; senza schedule queste regole non si applicano.
  R("Servizio", "service.schedule.setbackTemp", "Temperatura ridotta", (p) => p.service.schedule?.setbackTemp ?? p.service.setpoint, 5, 24, undefined, (p) => p.service.schedule?.mode === "fasce" && p.service.schedule.setback === "ridotta"),
  R("Servizio", "service.schedule.maxPowerKw", "Potenza della caldaia verso la casa", (p) => p.service.schedule?.maxPowerKw ?? p.service.setpoint, 2, 100, undefined, (p) => p.service.schedule?.mode === "fasce"),
  R("Servizio", "service.internalGains", "Apporti interni", (p) => p.service.internalGains, 0, 10),
  R("Servizio", "cooling.setpoint", "Temperatura estiva in casa", (p) => p.cooling.setpoint, 22, 30, undefined, raffresca),
  R("Servizio", "cooling.maxDelta", "Differenza massima con l'esterno", (p) => p.cooling.maxDelta, 8, 12, undefined, raffresca),
  R("Servizio", "cooling.summerShading", "Schermature estive", (p) => p.cooling.summerShading, 0.1, 1, undefined, raffresca),
  R("Servizio", "cooling.latentFactor", "Fattore per l'umidità (latente)", (p) => p.cooling.latentFactor, 1, 1.5, undefined, raffresca),
  R("Servizio", "cooling.splitEer35", "EER degli split a 35 °C", (p) => p.cooling.splitEer35, 2, 6, "dato", raffresca),
  R("Servizio", "cooling.splitCapacity", "Potenza degli split", (p) => p.cooling.splitCapacity, 0.5, 30, undefined, raffresca),
  R("Impianto", "system.boilerEfficiency", "Rendimento stagionale caldaia", (p) => p.system.boilerEfficiency, 0.5, 1.1, "dato"),
  R("Impianto", "system.gasPcs", "PCS gas", (p) => p.system.gasPcs, 9, 12),
  R("Impianto", "system.gasPci", "PCI gas", (p) => p.system.gasPci, 8, 11),
  R("Impianto", "system.designFlowTemp", "Mandata di progetto", (p) => p.system.designFlowTemp, 30, 85, "dato"),
  R("Impianto", "system.designOutdoorTemp", "T esterna di progetto", (p) => p.system.designOutdoorTemp, -20, 15),
  R("Impianto", "system.acsGasSmc", "Gas ACS", (p) => p.system.acsGasSmc, 0, 1500, undefined, (p) => p.system.acsOnGas),
  R("Impianto", "system.cookingGasSmc", "Gas cucina", (p) => p.system.cookingGasSmc, 0, 500, undefined, (p) => p.system.cookingOnGas),
  R("Consumi", "consumption.electricityKwh", "Elettricità annua", (p) => p.consumption.electricityKwh, 300, 20000, "dato", (p) => !fromBill(p) && !fromMeterCurve(p)),
  R("Consumi", "existingPv.kWp", "Potenza del FV esistente", (p) => p.existingPv.kWp, 0.5, 20, undefined, (p) => p.existingPv.present),
  R("Consumi", "existingPv.lossPct", "Ombre e perdite del FV esistente", (p) => p.existingPv.lossPct, 0, 40, undefined, (p) => p.existingPv.present),
  R("Consumi", "existingPv.gridImportKwh", "Prelievi annui in bolletta", (p) => p.existingPv.gridImportKwh, 100, 20000, "dato", fromBill),
  R("Consumi", "consumption.gasSmcObserved", "Gas osservato", (p) => p.consumption.gasSmcObserved, 0, 20000),

  ...tariffRules,
  R("Tariffe", "tariffs.gasPrice", "Prezzo gas", (p) => p.tariffs.gasPrice, 0.2, 5, "dato"),
  R("Tariffe", "tariffs.gasFixed", "Quota fissa gas", (p) => p.tariffs.gasFixed, 0, 1000),
  R("Tariffe", "tariffs.elecPrice", "Prezzo elettricità", (p) => p.tariffs.elecPrice, 0.05, 1, "dato"),
  R("Tariffe", "tariffs.elecFixed", "Quota fissa elettricità", (p) => p.tariffs.elecFixed, 0, 1000),
  R("Tariffe", "tariffs.powerCostPerKw", "Quota potenza", (p) => p.tariffs.powerCostPerKw, 0, 200),
  R("Tariffe", "tariffs.contractPower", "Potenza contrattuale attuale", (p) => p.tariffs.contractPower, 1.5, 30),
  R("Tariffe", "tariffs.exportPrice", "Prezzo di cessione", (p) => p.tariffs.exportPrice, 0, 0.5),
  R("Serramenti", "windows.uWindow", "Uw nuovi serramenti", (p) => p.windows.uWindow, 0.5, 3, "dato", (p) => p.envelope.windows),
  R("Serramenti", "windows.gWindow", "g nuovo vetro", (p) => p.windows.gWindow, 0.1, 0.9, undefined, (p) => p.envelope.windows),
  R("Serramenti", "windows.frameFraction", "Frazione telaio nuova", (p) => p.windows.frameFraction, 0.05, 0.5, undefined, (p) => p.envelope.windows),
  R("Serramenti", "windows.airChange", "Ricambi d'aria dopo", (p) => p.windows.airChange, 0.05, 3, "tecnico", (p) => p.envelope.windows),
  R("Serramenti", "windows.n50After", "Tenuta all'aria dopo i serramenti", (p) => p.windows.n50After, 0.3, 30, undefined, (p) => p.envelope.windows && p.building.infiltration.mode === "tenuta"),
  R("Serramenti", "windows.maintenanceDelta", "Variazione manutenzione serramenti", (p) => p.windows.maintenanceDelta, -2000, 2000, undefined, (p) => p.envelope.windows),
  ...insulationRules,
  R("Acqua calda", "dhw.todayTankLitres", "Serbatoio del boiler di oggi", (p) => p.dhw.todayTankLitres, 10, 500, undefined, todayBoiler),
  R("Acqua calda", "dhw.todayPowerKw", "Potenza del boiler di oggi", (p) => p.dhw.todayPowerKw, .5, 6, undefined, todayBoiler),
  R("Acqua calda", "dhw.todayStandbyW", "Perdita del boiler di oggi", (p) => p.dhw.todayStandbyW, 0, 300, undefined, todayBoiler),
  R("Acqua calda", "dhw.people", "Persone in casa", (p) => p.dhw.people, 1, 12, undefined, peopleDhw),
  R("Acqua calda", "dhw.litresPerPerson", "Litri al giorno a persona", (p) => p.dhw.litresPerPerson, 10, 150, undefined, peopleDhw),
  R("Acqua calda", "dhw.gasDhwEfficiency", "Rendimento della caldaia per l'acqua calda", (p) => p.dhw.gasDhwEfficiency, .4, 1, undefined, (p) => newDhw(p) && p.system.acsOnGas),
  R("Acqua calda", "dhw.tankLitres", "Serbatoio nuovo", (p) => p.dhw.tankLitres, 30, 500, undefined, newDhw),
  R("Acqua calda", "dhw.hpThermalKw", "Potenza termica dello scaldacqua", (p) => p.dhw.hpThermalKw, .3, 5, undefined, newDhwHp),
  R("Acqua calda", "dhw.backupKw", "Resistenza elettrica", (p) => p.dhw.backupKw, 0, 6, undefined, newDhw),
  R("Acqua calda", "dhw.solarAreaM2", "Superficie dei pannelli", (p) => p.dhw.solarAreaM2, .5, 30, undefined, newDhwSolar),
  R("Acqua calda", "dhw.solarEta0", "Rendimento ottico η0", (p) => p.dhw.solarEta0, .3, .9, undefined, newDhwSolar),
  R("Acqua calda", "dhw.solarA1", "Coefficiente a1", (p) => p.dhw.solarA1, 0, 10, undefined, newDhwSolar),
  R("Acqua calda", "dhw.solarA2", "Coefficiente a2", (p) => p.dhw.solarA2, 0, .1, undefined, newDhwSolar),
  R("Acqua calda", "dhw.solarLoopLossPct", "Perdite del circuito solare", (p) => p.dhw.solarLoopLossPct, 0, 50, undefined, newDhwSolar),
  R("Acqua calda", "dhw.solarPumpW", "Pompa del circuito solare", (p) => p.dhw.solarPumpW, 0, 200, undefined, newDhwSolar),
  R("Acqua calda", "dhw.copRated", "COP della scheda (EN 16147)", (p) => p.dhw.copRated, 1.5, 6, undefined, newDhwHp),
  R("Acqua calda", "dhw.copRatedAirC", "Aria della prova", (p) => p.dhw.copRatedAirC, -10, 25, undefined, newDhwHp),
  R("Acqua calda", "dhw.roomTemp", "Temperatura del locale", (p) => p.dhw.roomTemp, 0, 30, undefined, (p) => newDhw(p) || todayBoiler(p)),
  R("Acqua calda", "dhw.standbyW", "Perdita del serbatoio", (p) => p.dhw.standbyW, 0, 300, undefined, newDhw),
  R("Acqua calda", "dhw.minAirC", "Aria minima per la PDC dello scaldacqua", (p) => p.dhw.minAirC, -25, 10, undefined, newDhwHp),
  R("Acqua calda", "dhw.price", "Prezzo dello scaldacqua (stima)", (p) => p.dhw.price, 0, 20000, undefined, (p) => newDhw(p) && p.dhw.costMode === "stima"),
  R("Acqua calda", "dhw.maintenanceDelta", "Manutenzione dello scaldacqua", (p) => p.dhw.maintenanceDelta, -500, 500, undefined, newDhw),
  R("Pompa di calore", "heatPump.nominalCapacity", "Potenza nominale A7/W35", (p) => p.heatPump.nominalCapacity, 2, 40),
  R("Pompa di calore", "heatPump.carnotEfficiency", "Rendimento rispetto a Carnot", (p) => p.heatPump.carnotEfficiency, 0.25, 0.65),
  R("Pompa di calore", "heatPump.copFactor", "Fattore di variazione del COP", (p) => p.heatPump.copFactor, 0.5, 1.5),
  R("Pompa di calore", "heatPump.eerFactor", "Fattore di variazione dell'EER", (p) => p.heatPump.eerFactor, 0.5, 1.5),
  R("Pompa di calore", "heatPump.eer35", "EER della PDC a 35 °C", (p) => p.heatPump.eer35, 2, 6, undefined, (p) => p.heatPump.model === "parametrico"),
  R("Pompa di calore", "heatPump.capacitySlope", "Variazione potenza per K", (p) => p.heatPump.capacitySlope, 0, 0.06),
  R("Pompa di calore", "heatPump.defrostFactor", "Fattore sbrinamento", (p) => p.heatPump.defrostFactor, 0.6, 1),
  R("Pompa di calore", "heatPump.minOutdoorTemp", "T esterna minima di funzionamento", (p) => p.heatPump.minOutdoorTemp, -30, 0),
  R("Pompa di calore", "heatPump.maxFlowTemp", "Mandata massima", (p) => p.heatPump.maxFlowTemp, 35, 75),
  R("Pompa di calore", "heatPump.newContractPower", "Potenza contrattuale con PDC", (p) => p.heatPump.newContractPower, 1.5, 30),
  R("Pompa di calore", "heatPump.maintenanceDelta", "Variazione manutenzione PDC", (p) => p.heatPump.maintenanceDelta, -2000, 2000),
  R("Pompa di calore", "heatPump.boilerReplacementCost", "Costo caldaia sostitutiva", (p) => p.heatPump.boilerReplacementCost, 0, 50000, undefined, (p) => p.heatPump.boilerEndOfLife),
  R("Pompa di calore", "heatPump.replacementBoilerEfficiency", "Rendimento caldaia nuova", (p) => p.heatPump.replacementBoilerEfficiency, 0.5, 1.1, undefined, (p) => p.heatPump.boilerEndOfLife),
  R("Pompa di calore", "heatPump.minModulation", "Modulazione minima PDC", (p) => p.heatPump.minModulation, 0, 1),
  R("Pompa di calore", "heatPump.cyclingCd", "Coefficiente di degrado per cicli", (p) => p.heatPump.cyclingCd, 0.5, 1),
  R("Pompa di calore", "heatPump.pTO_W", "Potenza PDC termostato spento", (p) => p.heatPump.pTO_W, 0, 500),
  R("Pompa di calore", "heatPump.pOFF_W", "Potenza PDC spenta", (p) => p.heatPump.pOFF_W, 0, 500),
  R("Pompa di calore", "heatPump.pCK_W", "Potenza riscaldatore carter PDC", (p) => p.heatPump.pCK_W, 0, 500),
  R("Pompa di calore", "heatPump.extraPump_W", "Pompa primaria aggiuntiva PDC", (p) => p.heatPump.extraPump_W, 0, 1000),
  R("Fotovoltaico", "pv.kWp", "Potenza FV", (p) => p.pv.kWp, 0.5, 20),
  R("Fotovoltaico", "pv.lossPct", "Ombre e perdite FV", (p) => p.pv.lossPct, 0, 40),
  R("Fotovoltaico", "pv.degradationPct", "Degrado FV", (p) => p.pv.degradationPct, 0, 2),
  R("Fotovoltaico", "pv.maintenanceDelta", "Manutenzione FV", (p) => p.pv.maintenanceDelta, 0, 2000),
  R("Fotovoltaico", "pv.roofArea", "Tetto utilizzabile", (p) => p.pv.roofArea, 1, 2000, undefined, indicativeRoof),
  R("Fotovoltaico", "pv.areaPerKwp", "Superficie per kWp", (p) => p.pv.areaPerKwp, 3, 12, undefined, indicativeRoof),
  R("Fotovoltaico", "pv.pricePerKwp", "Prezzo tipico del FV (stima)", (p) => p.pv.pricePerKwp, 300, 6000, undefined, indicativeRoof),
  R("Fotovoltaico", "battery.pricePerKwh", "Batteria, parte per kWh (stima)", (p) => p.battery.pricePerKwh, 100, 4000, undefined, indicativeBattery),
  R("Fotovoltaico", "battery.fixedCost", "Batteria, parte fissa con FV nuovo (stima)", (p) => p.battery.fixedCost, 0, 20000, undefined, (p) => indicativeBattery(p) && !p.existingPv.present),
  R("Fotovoltaico", "battery.retrofitFixedCost", "Batteria, parte fissa su FV esistente (stima)", (p) => p.battery.retrofitFixedCost, 0, 20000, undefined, (p) => indicativeBattery(p) && p.existingPv.present),
  R("Fotovoltaico", "battery.replacementPerKwh", "Sostituzione batteria, per kWh (stima)", (p) => p.battery.replacementPerKwh, 0, 4000, undefined, indicativeBattery),
  R("Fotovoltaico", "battery.replacementFixed", "Sostituzione batteria, parte fissa (stima)", (p) => p.battery.replacementFixed, 0, 10000, undefined, indicativeBattery),
  R("Fotovoltaico", "battery.warrantyYears", "Garanzia della batteria", (p) => p.battery.warrantyYears, 0, 30, undefined, batteryUsed),
  R("Fotovoltaico", "battery.capacityKwh", "Capacità utile della batteria", (p) => p.battery.capacityKwh, 0, 50, undefined, (p) => batteryUsed(p) && p.pv.sizing !== "indicativa"),
  R("Fotovoltaico", "battery.powerKw", "Potenza della batteria", (p) => p.battery.powerKw, 0.3, 30, undefined, batteryUsed),
  R("Fotovoltaico", "battery.roundTripPct", "Rendimento di andata e ritorno", (p) => p.battery.roundTripPct, 50, 100, undefined, batteryUsed),
  R("Fotovoltaico", "battery.reservePct", "Riserva minima della batteria", (p) => p.battery.reservePct, 0, 50, undefined, batteryUsed),
  R("Fotovoltaico", "battery.fadePctPerYear", "Calo della capacità", (p) => p.battery.fadePctPerYear, 0, 10, undefined, batteryUsed),
  R("Fotovoltaico", "battery.lifeYears", "Vita operativa della batteria (scenario)", (p) => p.battery.lifeYears, 3, 30, undefined, batteryUsed),
  R("Fotovoltaico", "battery.lifeCycles", "Vita della batteria in cicli", (p) => p.battery.lifeCycles, 500, 20000, undefined, batteryUsed),
  R("Fotovoltaico", "battery.maintenanceDelta", "Manutenzione batteria", (p) => p.battery.maintenanceDelta, 0, 2000, undefined, batteryUsed),
  R("Economia", "economics.horizonYears", "Orizzonte", (p) => p.economics.horizonYears, 5, 30),
  R("Economia", "economics.realDiscountRate", "Tasso reale", (p) => p.economics.realDiscountRate, 0, 0.1),
  R("Economia", "economics.incentive.windowsPct", "Serramenti: quota della spesa", (p) => p.economics.incentive.windowsPct, 0, 100, undefined, (p) => p.economics.incentive.enabled),
  R("Economia", "economics.incentive.heatPumpPct", "PDC: quota della spesa", (p) => p.economics.incentive.heatPumpPct, 0, 100, undefined, (p) => p.economics.incentive.enabled),
  R("Economia", "economics.incentive.pvPct", "FV: quota della spesa", (p) => p.economics.incentive.pvPct, 0, 100, undefined, (p) => p.economics.incentive.enabled),
  R("Economia", "economics.incentive.batteryPct", "Batteria: quota della spesa", (p) => p.economics.incentive.batteryPct, 0, 100, undefined, (p) => p.economics.incentive.enabled && batteryUsed(p)),
  R("Economia", "economics.incentive.years", "Rate annue uguali", (p) => p.economics.incentive.years, 1, 30, undefined, (p) => p.economics.incentive.enabled),
  ...EV_FIELDS.map(([key, label, , min, max]) => R("Auto elettrica", `ev.${key}`, label, (p) => p.ev[key], min, max, undefined, (p) => p.ev.enabled && (key !== "price" || p.ev.costMode === "stima"))),
  R("Economia", "economics.homeValue.marketValue", "Valore di mercato della casa", (p) => p.economics.homeValue.marketValue, 0, 10_000_000, undefined, (p) => p.economics.homeValue.enabled),
  ...([
    ["gasHobEfficiency", "Rendimento del piano a gas", .2, 1],
    ["inductionEfficiency", "Rendimento del piano a induzione", .2, 1],
    ["hobCost", "Piano a induzione e posa", 0, 20000],
    ["meterClosureCost", "Chiusura del contatore del gas", 0, 20000],
  ] as const).map(([key, label, min, max]) => R("Pompa di calore", `cooking.${key}`, label, (p) => p.cooking![key], min, max, undefined, (p) => !!p.cooking?.enabled && p.system.cookingOnGas && (key !== "meterClosureCost" || (p.heatPump.included && (!p.system.acsOnGas || (p.dhw.replace && !(p.dhw.newType === "solare" && p.dhw.solarBackup === "gas"))))))),
].map((r) => r.section === "Pompa di calore" && !r.path.startsWith("cooking.") ? { ...r, applies: (p: ProjectInput) => p.heatPump.included && r.applies(p) } : r);

export interface Issue {
  section: Section;
  severity: "errore" | "esplorativo" | "nota";
  message: string;
}

const okStatus = (s: DataStatus) => s === "documentato" || s === "misurato";
const it = (v: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 }).format(v);
/** Controllo minimo di tracciabilità: non verifica l'autenticità del documento indicato. */
export const usefulSource = (q: Q) => !!q.source?.trim() && !/^(preset\s*:|esempio)|provvisori[oa]|da (verificare|sostituire|rilevare)/i.test(q.source.trim());

/**
 * Campi non usati dalle scelte correnti con un valore fuori intervallo. Non entrano nei calcoli:
 * si conservano all'esportazione e all'importazione con un avviso, e tornano errori se il campo si riattiva.
 */
export function inactiveOutOfRange(p: ProjectInput): RangeRule[] {
  return RULES.filter((r) => {
    if (r.applies(p) || (r.path.startsWith("cooking.") && !p.cooking)) return false;
    const q = r.get(p);
    if (q.value === 0 && /^(building\.unheated(Upper|Lower|Side)\.(areaOut|uOut|volume|airChange)|building\.infiltration\.n50|windows\.n50After)$/.test(r.path)) return false;
    const v = q.value;
    return v < r.min || v > r.max;
  });
}

export function inactiveOutOfRangeWarning(p: ProjectInput): string | null {
  const rules = inactiveOutOfRange(p);
  if (!rules.length) return null;
  const list = rules.map((r) => `${r.label} ${it(r.get(p).value)} (ammesso ${it(r.min)}–${it(r.max)})`).join("; ");
  return `Valori fuori intervallo in campi non usati dalle scelte correnti, conservati senza entrare nei calcoli: ${list}. Se riattivi il campo, correggilo.`;
}

export function checkProject(p: ProjectInput): Issue[] {
  const issues: Issue[] = [];
  for (const message of cookingSwitchErrors(p.cooking)) issues.push({ section: "Pompa di calore", severity: "errore", message });
  if (issues.length) return issues;
  const profileMode = p.consumption.profileMode;
  if (profileMode !== undefined && profileMode !== "sintetico" && profileMode !== "stagionale")
    issues.push({ section: "Consumi", severity: "errore", message: "consumption.profileMode: andamento nell'anno non ammesso." });
  if (profileMode === "stagionale" && !usesMeasuredCurve(p) && !profileArea(p.location.sigla))
    issues.push({ section: "Consumi", severity: "nota", message: "Profilo medio ARERA: provincia non riconosciuta, si usa la media del Nord." });
  if (p.plan) {
    const errors: string[] = [];
    for (const [k,q,max] of [["budgetNow",p.plan.budgetNow,1e6],["budgetPerYear",p.plan.budgetPerYear,2e5]] as const) if (!Number.isFinite(q.value)||q.value<0||q.value>max) errors.push(`${k}: importo fuori intervallo.`);
    for (const [k,q] of [["boilerYear",p.plan.boilerYear],["carYear",p.plan.carYear]] as const) if (!Number.isInteger(q.value)||q.value<0||q.value>5) errors.push(`${k}: indicare un anno intero da 0 a 5.`);
    for (const k of ["W","H","P"] as const) { const y=p.plan.custom[k]; if(y!==null&&(!Number.isInteger(y)||y<0||y>5)) errors.push(`custom.${k}: indicare un anno intero da 0 a 5 oppure mai.`); }
    for (const message of errors) issues.push({section:"Economia",severity:"errore",message});
  }
  const provenance = (v: Q, label: string, section: Section) => {
    if (okStatus(v.status) && !usefulSource(v))
      issues.push({ section, severity: "esplorativo", message: `${label}: stato ${v.status} senza provenienza utile (fonte vuota, preset, esempio o testo provvisorio).` });
  };
  for (const r of RULES) {
    if (!r.applies(p)) continue;
    const v = r.get(p);
    if (!v || typeof v.value !== "number" || !Number.isFinite(v.value)) {
      issues.push({ section: r.section, severity: "errore", message: `${r.label}: valore mancante o non numerico.` });
      continue;
    }
    // Zero è il segnaposto dei campi locali non inseriti; non è un valore fisico.
    const unknownLocalePlaceholder = v.status === "sconosciuto" && v.value === 0 && /^(building\.unheated(Upper|Lower|Side)\.(areaOut|uOut|volume|airChange)|building\.infiltration\.n50|windows\.n50After)$/.test(r.path);
    if (!unknownLocalePlaceholder && (v.value < r.min || v.value > r.max))
      issues.push({ section: r.section, severity: "errore", message: `${r.label}: ${it(v.value)} fuori dall'intervallo ammesso ${it(r.min)}–${it(r.max)}.` });
    provenance(v, r.label, r.section);
    if (!r.critical || okStatus(v.status)) continue;
    if (v.status === "sconosciuto")
      issues.push({ section: r.section, severity: "esplorativo", message: `${r.label}: «non so», il valore usato è solo un'ipotesi.` });
    else if (r.critical === "dato")
      issues.push({ section: r.section, severity: "esplorativo", message: `${r.label}: ipotizzato, serve un dato documentato o misurato.` });
    else if (!usefulSource(v) || v.confirmed !== true)
      issues.push({ section: r.section, severity: "esplorativo", message: `${r.label}: serve una stima tecnica motivata e confermata esplicitamente (un preset non basta).` });
  }
  if (p.ev.enabled) {
    for (const key of ["daysPerWeek", "departHour", "returnHour"] as const)
      if (!Number.isInteger(p.ev[key].value)) issues.push({ section: "Auto elettrica", severity: "errore", message: `${EV_FIELDS.find((f) => f[0] === key)![1]}: serve un numero intero.` });
    if (p.ev.returnHour.value <= p.ev.departHour.value) issues.push({ section: "Auto elettrica", severity: "errore", message: "L'ora di rientro deve essere dopo quella di partenza, nello stesso giorno." });
    if (p.ev.minDepartPct.value > p.ev.targetPct.value) issues.push({ section: "Auto elettrica", severity: "errore", message: "La carica minima alla partenza non può superare la carica massima impostata." });
    for (const [key, label] of EV_FIELDS) if (p.ev[key].status === "sconosciuto") issues.push({ section: "Auto elettrica", severity: "esplorativo", message: `${label}: «non so», il valore usato è solo un'ipotesi.` });
  }
  const b = p.building;
  if (b.infiltration.mode === "tenuta") {
    if (b.infiltration.n50.status === "sconosciuto") issues.push({ section: "Edificio", severity: "esplorativo", message: "Tenuta all'aria n50 non inserita: si usa il ricambio costante." });
    if (!Number.isInteger(b.infiltration.shelterClass) || b.infiltration.shelterClass < 1 || b.infiltration.shelterClass > 5) issues.push({ section: "Edificio", severity: "errore", message: "La classe di riparo dal vento deve essere un intero da 1 a 5." });
  }
  if (b.thermalBridges.mode === "lineari") for (const [id,j] of Object.entries(b.thermalBridges.junctions)) {
    for (const [field,value,min,max,unit] of [["ψ",j.psi.value,-.5,1.5,"W/mK"],["L",j.length.value,0,10000,"m"]] as const)
      if (!Number.isFinite(value) || (j[field === "ψ" ? "psi" : "length"].status !== "sconosciuto" && (value < min || value > max))) issues.push({section:"Edificio",severity:"errore",message:`Ponte ${id}, ${field}: valore fuori dall'intervallo ${min}–${max} ${unit}.`});
  }
  for (const kind of INSULATION_KINDS) {
    const m = p.envelope[kind], name = insulationName(p, kind).long;
    if (!m.enabled) continue;
    if (!insulationApplies(p, kind)) {
      issues.push({ section: "Isolamento", severity: "nota", message: `${name}: non applicabile con questo confine della casa, non entra nei conti.` });
      continue;
    }
    const now = insulationCurrentU(p, kind), after = insulatedU(now, m);
    if (after >= now) issues.push({ section: "Isolamento", severity: "esplorativo", message: `${name}: U dopo il lavoro ${it(after)} W/m²K non migliore di quella attuale (${it(now)}).` });
    const type = insulationPriceType(p, kind), prices = INSULATION_PRICE_SCENARIOS[type];
    const readable = { pareti: "le pareti", copertura: "una copertura", sottotetto: "un sottotetto", solaio: "un solaio" }[type];
    if (m.costMode === "stima" && (m.pricePerM2.value < prices.basso || m.pricePerM2.value > prices.alto))
      issues.push({ section: "Isolamento", severity: "esplorativo", message: `${name}: ${it(m.pricePerM2.value)} €/m² fuori dagli scenari dichiarati per ${readable} (${prices.basso}–${prices.alto} €/m²): controlla il prezzo.` });
  }
  if (p.mode === "rapida") issues.push({ section: "Edificio", severity: "esplorativo", message: "Modalità rapida: valori preimpostati dichiarati, risultati indicativi." });
  if (b.geometryMode === "forma") issues.push({ section: "Edificio", severity: "esplorativo", message: "Aree ricavate dalla forma in pianta, non da rilievo." });
  if (b.windowMode === "frazione") issues.push({ section: "Edificio", severity: "esplorativo", message: "Finestre da rapporto sulla superficie, non per orientamento." });
  if (b.sides !== "isolato" && b.sideAdjacency === "nonNoto")
    issues.push({ section: "Edificio", severity: "esplorativo", message: "Adiacenza laterale non nota." });
  if (!Number.isInteger(b.floors.value)) issues.push({ section: "Edificio", severity: "errore", message: "Il numero di piani deve essere intero." });
  const g = computeGeometry(b);
  const unheatedChecks = [
    ...(b.upper === "sottotetto" ? [{ label: "Sottotetto", data: b.unheatedUpper, Hiu: (b.uUpper.value + (b.thermalBridges.mode === "lineari" ? 0 : b.thermalBridgeDeltaU.value)) * g.upperArea, b: b.bUpperUnheated.value }] : []),
    ...(b.lower === "nonRiscaldato" ? [{ label: "Locale inferiore", data: b.unheatedLower, Hiu: (b.uLower.value + (b.thermalBridges.mode === "lineari" ? 0 : b.thermalBridgeDeltaU.value)) * g.lowerArea, b: b.bLowerUnheated.value }] : []),
    ...(b.sides !== "isolato" && b.sideAdjacency !== "riscaldato" ? [{ label: "Adiacenze laterali", data: b.unheatedSide, Hiu: (b.uWall.value + (b.thermalBridges.mode === "lineari" ? 0 : b.thermalBridgeDeltaU.value)) * g.adjacentWall, b: b.bSideUnheated.value }] : []),
  ];
  for (const x of unheatedChecks) {
    const hue = unheatedHue(x.data, x.Hiu, x.b).hue;
    const beq = hue / (x.Hiu + hue);
    if (beq < 0.1 || beq > 0.98) issues.push({ section: "Edificio", severity: "nota", message: `${x.label}: fattore b risultante ${it(beq)} fuori dall'intervallo usuale 0,1–0,98.` });
  }
  for (const message of g.errors) issues.push({ section: "Edificio", severity: "errore", message });
  const winTotal = ORIENTATIONS.reduce((s, o) => s + g.windows[o], 0);
  if (winTotal <= 0) issues.push({ section: "Edificio", severity: "esplorativo", message: "Area finestrata totale nulla: verificare tutte le finestre dell'abitazione." });
  if (b.geometryMode === "aree") {
    const wallGross = ORIENTATIONS.reduce((s, o) => s + g.externalWall[o], winTotal + g.adjacentWall);
    const minWall = 2 * Math.sqrt(Math.PI * g.footprint) * Math.round(b.floors.value) * b.netStoreyHeight.value;
    // Soglie larghe di plausibilità del progetto, non una verifica normativa della geometria.
    if (wallGross < 0.5 * minWall || wallGross > 4 * minWall)
      issues.push({ section: "Edificio", severity: "esplorativo", message: "Involucro verticale incoerente con superficie e volume: verificare aree nette, finestre e confini." });
    for (const [label, area, boundary] of [["superiore", g.upperArea, b.upper], ["inferiore", g.lowerArea, b.lower]] as const)
      if (boundary !== "riscaldato" && (area < 0.5 * g.footprint || area > 2 * g.footprint))
        issues.push({ section: "Edificio", severity: "esplorativo", message: `Area del confine ${label} incoerente con l'impronta riscaldata: verificare il rilievo.` });
  }
  if (b.lower === "terreno") {
    if (b.exposedPerimeter.status === "sconosciuto")
      issues.push({ section: "Edificio", severity: "esplorativo", message: "Perimetro esposto del terreno non rilevato: si usa un'ipotesi geometrica dichiarata, verificata in sensibilità." });
    else if (!(b.exposedPerimeter.value > 0))
      issues.push({ section: "Edificio", severity: "errore", message: "Il perimetro esposto del terreno deve essere positivo." });
  }
  const s = p.service;
  for (const [label, d] of [
    ["Inizio stagione", s.seasonStart],
    ["Fine stagione", s.seasonEnd],
  ] as const)
    if (!d || !isValidDate(d.month, d.day)) issues.push({ section: "Servizio", severity: "errore", message: `${label}: data non valida.` });
  const c = p.cooling;
  const coolDates = [c.seasonStart, c.seasonEnd].every((d) => d && isValidDate(d.month, d.day));
  if (!coolDates) issues.push({ section: "Servizio", severity: "errore", message: "Periodo di raffrescamento: data non valida." });
  // solo per chi raffresca: altrimenti il fabbisogno estivo è informativo e salta i giorni di riscaldamento
  else if (c.today === "split" && [s.seasonStart, s.seasonEnd].every((d) => d && isValidDate(d.month, d.day))) {
    const overlap = Array.from({ length: 365 }, (_, d) => d).filter((d) => inDayPeriod(d, s.seasonStart, s.seasonEnd) && inDayPeriod(d, c.seasonStart, c.seasonEnd));
    if (overlap.length)
      issues.push({ section: "Servizio", severity: "errore", message: `Periodo di raffrescamento sovrapposto alla stagione di riscaldamento per ${overlap.length} giorni: correggi le date.` });
  }
  if (p.system.designOutdoorTemp.value > s.setpoint.value - 5)
    issues.push({ section: "Impianto", severity: "errore", message: "La temperatura esterna di progetto deve essere almeno 5 K sotto il setpoint." });
  for (const message of heatingScheduleErrors(s.schedule, s.setpoint.value)) issues.push({ section: "Servizio", severity: "errore", message });
  if (!s.continuousService && s.schedule?.mode !== "fasce")
    issues.push({ section: "Servizio", severity: "esplorativo", message: "Riscaldamento a orari o spento per lunghi periodi: il calcolo resta continuo finché nel passo Impianto non scegli «A fasce orarie»." });
  if (s.multiZoneOrPartial)
    issues.push({ section: "Servizio", severity: "esplorativo", message: "Zone a temperature diverse o casa scaldata in parte: Casa non sa ancora calcolare questo caso, risultati indicativi." });
  if (p.system.designFlowTemp.status === "sconosciuto")
    issues.push({ section: "Impianto", severity: "esplorativo", message: "Mandata sconosciuta: la parola «radiatori» non determina la mandata; PDC solo come scenario condizionato." });
  if (!p.tariffs.date) issues.push({ section: "Tariffe", severity: "esplorativo", message: "Prezzi senza data: non sono «attuali»." });

  const sys = p.system;
  if (sys.efficiencyBasis === "PCS" && sys.boilerEfficiency.value > 0.98)
    issues.push({ section: "Impianto", severity: "errore", message: "Rendimento oltre 0,98 su base PCS: non plausibile (controlla la base PCS/PCI)." });
  if (p.heatPump.included && p.heatPump.boilerEndOfLife && sys.efficiencyBasis === "PCS" && p.heatPump.replacementBoilerEfficiency.value > 0.98)
    issues.push({ section: "Pompa di calore", severity: "errore", message: "Rendimento della caldaia nuova oltre 0,98 su base PCS: non plausibile." });
  if (sys.acsOnGas && sys.acsGasSmc.status === "sconosciuto")
    issues.push({ section: "Impianto", severity: "esplorativo", message: "Gas per ACS «non so»: l'economia resta incompleta." });
  if (sys.cookingOnGas && sys.cookingGasSmc.status === "sconosciuto")
    issues.push({ section: "Impianto", severity: "esplorativo", message: "Gas per cucina «non so»: l'economia resta incompleta." });

  if (!Number.isInteger(p.ev.years.value) || p.ev.years.value < 1 || p.ev.years.value > 25) issues.push({ section: "Auto elettrica", severity: "errore", message: "Gli anni di possesso dell'auto devono essere un intero fra 1 e 25." });
  for (const [name, q, max] of [["Prezzo dell'elettrica", p.ev.evPrice, 200000], ["Incentivo dell'elettrica", p.ev.evIncentive, 50000], ["Manutenzione elettrica", p.ev.evMaintenance, 5000], ["Bollo elettrica", p.ev.evTax, 3000], ["Rivendita elettrica", p.ev.evResale, 200000], ["Prezzo auto a combustione", p.ev.icePrice, 200000], ["Manutenzione auto a combustione", p.ev.iceMaintenance, 5000], ["Bollo auto a combustione", p.ev.iceTax, 3000], ["Rivendita auto a combustione", p.ev.iceResale, 200000]] as const) if (q.value < 0 || q.value > max) issues.push({ section: "Auto elettrica", severity: "errore", message: `${name}: importo fuori intervallo 0\u2013${max} \u20ac.` });
  const horizon = p.economics.horizonYears.value;
  if (!Number.isInteger(horizon)) issues.push({ section: "Economia", severity: "errore", message: "L'orizzonte deve essere un numero intero di anni." });
  if (p.economics.incentive.enabled && !Number.isInteger(p.economics.incentive.years.value))
    issues.push({ section: "Economia", severity: "errore", message: "Le rate dell'incentivo devono essere un numero intero di anni." });
  for (const message of measuredCurveErrors(p.consumption.measuredCurve)) issues.push({ section: "Consumi", severity: "errore", message });
  if (p.existingPv.present && p.consumption.measuredCurve && !fromMeterCurve(p))
    issues.push({ section: "Consumi", severity: "nota", message: "Con il FV esistente il contatore misura solo i prelievi: la curva caricata non è la forma dei consumi e non si usa. Vale il profilo scelto." });
  if (indicativeRoof(p) && maxKwpForRoof(p) < KWP_MIN)
    issues.push({ section: "Fotovoltaico", severity: "errore", message: `Il tetto indicato non basta per ${KWP_MIN} kWp: servono almeno ${p.pv.areaPerKwp.value * KWP_MIN} m².` });
  if (p.pv.sizing === "indicativa")
    issues.push({ section: "Fotovoltaico", severity: "esplorativo", message: "Taglia indicativa con costi stimati da ipotesi dichiarate: è una stima, non un preventivo, e non sostituisce sopralluogo e preventivo." });
  for (const message of quoteSizeNotes(p)) issues.push({ section: "Fotovoltaico", severity: "esplorativo", message });
  if (p.existingPv.present)
    issues.push({ section: "Consumi", severity: "esplorativo", message: "FV esistente: la forma oraria dei consumi è un profilo sintetico e pesa molto sul valore della batteria; guarda l'intervallo sui tre profili." });
  if (p.heatPump.included && horizon > 15 && p.heatPump.replacements.length === 0)
    issues.push({ section: "Economia", severity: "nota", message: "Orizzonte oltre 15 anni senza sostituzioni della PDC né valore residuo: verifica la vita utile dei componenti." });

  const blocks: [Section, string, ProjectInput["windows"]["cost"]][] = [
    ...(p.envelope.windows ? [["Serramenti", "serramenti", p.windows.cost] as [Section, string, ProjectInput["windows"]["cost"]]] : []),
    ...activeInsulation(p).filter((kind) => p.envelope[kind].costMode === "preventivo").map((kind): [Section, string, ProjectInput["windows"]["cost"]] => ["Isolamento", insulationName(p, kind).long, p.envelope[kind].cost]),
    ...(p.heatPump.included ? [["Pompa di calore", "PDC", p.heatPump.cost] as [Section, string, ProjectInput["windows"]["cost"]]] : []),
    ...(p.ev.enabled && p.ev.costMode === "preventivo" ? [["Auto elettrica", "ricarica auto", p.ev.cost] as [Section, string, ProjectInput["windows"]["cost"]]] : []),
    ...(p.dhw.replace && p.dhw.costMode === "preventivo" ? [["Acqua calda", "scaldacqua", p.dhw.cost] as [Section, string, ProjectInput["windows"]["cost"]]] : []),
    ["Fotovoltaico", "FV", p.pv.cost],
    ...(batteryUsed(p) ? [["Fotovoltaico", "batteria", p.battery.cost] as [Section, string, ProjectInput["windows"]["cost"]]] : []),
  ];
  for (const [section, name, block] of blocks) {
    for (const item of block.items) {
      if (item.status === "incluso") provenance(item.amount, `Costo ${name}, «${item.label}»`, section);
      if (!Number.isFinite(item.amount.value) || item.amount.value < 0 || item.amount.value > 1e6)
        issues.push({ section, severity: "errore", message: `Costo ${name}, «${item.label}»: importo fuori intervallo 0–1.000.000 €.` });
    }
    const hypothetical = block.items.some((x) => x.status === "incluso" && !okStatus(x.amount.status));
    if (hypothetical) issues.push({ section, severity: "esplorativo", message: `Costi ${name} ipotetici, non da preventivo documentato.` });
    if (!block.quoteDate) issues.push({ section, severity: "nota", message: `Costi ${name}: data del preventivo non indicata.` });
  }
  for (const [section, list] of [
    ...(p.heatPump.included ? [["Pompa di calore", p.heatPump.replacements]] : []),
    ["Fotovoltaico", p.pv.replacements],
    ...(batteryUsed(p) ? [["Fotovoltaico", p.battery.replacements]] : []),
  ] as [Section, ProjectInput["pv"]["replacements"]][]) {
    for (const r of list) {
      provenance(r.amount, `Sostituzione «${r.label}»`, section);
      if (!Number.isInteger(r.year) || r.year < 1 || r.year > horizon)
        issues.push({ section, severity: "errore", message: `Sostituzione «${r.label}»: l'anno ${r.year} deve essere un intero fra 1 e l'orizzonte.` });
      if (!(r.amount.value >= 0 && r.amount.value <= 1e6)) issues.push({ section, severity: "errore", message: `Sostituzione «${r.label}»: importo fuori intervallo.` });
    }
  }
  if (p.heatPump.included) {
    if (p.heatPump.model === "parametrico")
      issues.push({
        section: "Pompa di calore",
        severity: "esplorativo",
        message: "PDC con modello parametrico: i pacchetti con PDC restano indicativi finché non si sceglie una macchina documentata.",
      });
    else if (!findCatalogHp(p.heatPump.catalogId))
      issues.push({ section: "Pompa di calore", severity: "errore", message: "Macchina del catalogo non trovata." });
    else if (!hasFitDomain(findCatalogHp(p.heatPump.catalogId)!))
      issues.push({ section: "Pompa di calore", severity: "esplorativo", message: "Catalogo PDC senza il campo dei punti di prova del fit: il limite provvisorio −7…12 °C (aria del fit saturata a 12 °C oltre tale temperatura) e 25…55 °C di mandata non dimostra l'assenza di estrapolazioni. Capacità disponibile non validata; confronto indicativo fino alla verifica dei punti di origine." });
    else issues.push({ section: "Pompa di calore", severity: "esplorativo", message: "Catalogo PDC: punti di prova e campi di validità dei fit COP/P_el conservati. Le ore estrapolate e l'energia termica associata sono dichiarate per pacchetto; la capacità modificata dal progetto resta non validata. Un certificato della macchina non valida questa estensione né il consumo annuo." });
  }
  if (p.dhw.replace && p.dhw.costMode === "stima") {
    const prices = DHW_PRICE_SCENARIOS[p.dhw.newType];
    if (p.dhw.price.value < prices.basso || p.dhw.price.value > prices.alto)
      issues.push({ section: "Acqua calda", severity: "esplorativo", message: `Scaldacqua: ${it(p.dhw.price.value)} € fuori dagli scenari dichiarati per ${({ pdc: "uno scaldacqua a pompa di calore", elettrico: "un boiler elettrico", solare: "un impianto solare termico" } as const)[p.dhw.newType]} (${prices.basso}–${prices.alto} €): controlla il prezzo.` });
  }
  issues.push({ section: "Edificio", severity: "nota", message: "Dati documentati significa tracciabilità degli input: i test verificano proprietà del modello, non l'accuratezza sull'edificio reale, ancora non validata." });
  if (p.consumption.observedStart && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.consumption.observedStart))
    issues.push({ section: "Consumi", severity: "errore", message: "Il primo mese fatturato deve essere nel formato mese/anno." });
  for (const y of p.consumption.gasOtherYears) if (y.start && !/^\d{4}-(0[1-9]|1[0-2])$/.test(y.start)) issues.push({ section: "Consumi", severity: "errore", message: "Il primo mese fatturato deve essere nel formato mese/anno." });
  if (p.consumption.gasSmcObserved.value > 0 && !p.consumption.observedPeriod && !p.consumption.observedStart)
    issues.push({ section: "Consumi", severity: "nota", message: "Periodo della bolletta non indicato." });
  return issues;
}

export function isDocumented(issues: Issue[]): boolean {
  return !issues.some((i) => i.severity !== "nota");
}
