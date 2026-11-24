import type { ClimatePackage } from "./climate";
import { batteryUsed, RULES } from "./quality";
import { usesMeasuredCurve } from "./curva";
import { computeGeometry } from "./geometry";
import { simulateThermal, unheatedHue } from "./thermal";
import { evaluateModel, type Evaluation } from "./scenarios";
import { sizesOf } from "./sizing";
import type { ElectricProfile, PackageId, ProjectInput, Q } from "./types";
import { activeInsulation, envelopeUpgrade, INSULATION_KINDS, INSULATION_PRICE_SCENARIOS, insulationPriceType } from "./involucro";
import { dhwNeedFromGas, DHW_PRICE_SCENARIOS, todayBoiler } from "./acqua";
import { bridgePsi } from "./thermalBridges";
import { knownN50 } from "./infiltration";

export interface Variant {
  id: string;
  label: string;
  apply: (p: ProjectInput) => ProjectInput;
}

const scale = (x: Q, f: number): Q => ({ ...x, value: x.value * f });
const add = (x: Q, d: number): Q => ({ ...x, value: x.value + d });
const clone = (p: ProjectInput): ProjectInput => structuredClone(p);

/** Riporta ogni grandezza della variante dentro il suo intervallo fisico ammesso. */
function clampToRules(p: ProjectInput): ProjectInput {
  for (const r of RULES) {
    if (!r.applies(p)) continue;
    const q = r.get(p);
    if (q.value < r.min) q.value = r.min;
    if (q.value > r.max) q.value = r.max;
  }
  if (p.service.schedule?.mode === "fasce") p.service.schedule.setbackTemp.value = Math.min(p.service.schedule.setbackTemp.value, p.service.setpoint.value);
  return p;
}

function edit(f: (p: ProjectInput) => void): (p: ProjectInput) => ProjectInput {
  return (p) => {
    const c = clone(p);
    f(c);
    return clampToRules(c);
  };
}

function scaleCosts(p: ProjectInput, k: number) {
  if (p.cooking?.enabled && p.system.cookingOnGas) {
    p.cooking.hobCost = scale(p.cooking.hobCost, k);
    p.cooking.meterClosureCost = scale(p.cooking.meterClosureCost, k);
  }
  p.dhw.price = scale(p.dhw.price, k);
  for (const it of p.dhw.cost.items) it.amount = scale(it.amount, k);
  for (const kind of INSULATION_KINDS) {
    const m = p.envelope[kind];
    m.pricePerM2 = scale(m.pricePerM2, k);
    for (const it of m.cost.items) it.amount = scale(it.amount, k);
  }
  for (const block of [p.windows.cost, p.heatPump.cost, p.pv.cost, p.battery.cost]) for (const it of block.items) it.amount = scale(it.amount, k);
  for (const r of [...p.heatPump.replacements, ...p.pv.replacements, ...p.battery.replacements]) r.amount = scale(r.amount, k);
  p.pv.pricePerKwp = scale(p.pv.pricePerKwp, k);
  p.battery.pricePerKwh = scale(p.battery.pricePerKwh, k);
  p.battery.fixedCost = scale(p.battery.fixedCost, k);
  p.battery.retrofitFixedCost = scale(p.battery.retrofitFixedCost, k);
  p.battery.replacementPerKwh = scale(p.battery.replacementPerKwh, k);
  p.battery.replacementFixed = scale(p.battery.replacementFixed, k);
  p.heatPump.boilerReplacementCost = scale(p.heatPump.boilerReplacementCost, k);
}

/** Variazione relativa delle U opache nella sensibilità; la guida della Rapida cita la stessa percentuale. */
export const OPAQUE_U_VARIATION = 0.2;
export const OPAQUE_U_PCT = `${Math.round(OPAQUE_U_VARIATION * 100)}%`;

/** Variazioni singole, fisicamente plausibili, applicate allo stesso modo a tutti i pacchetti. */
export function defaultVariants(p: ProjectInput, climate?: ClimatePackage): Variant[] {
  const otherProfiles = (["diurno", "serale", "distribuito"] as ElectricProfile[]).filter((x) => x !== p.consumption.profile);
  const b = p.building;
  const tight = b.infiltration.mode === "tenuta" && knownN50(b);
  const scaleAir = (c: ProjectInput, f: number) => {
    c.building.airChange = scale(c.building.airChange, f);
    c.windows.airChange = scale(c.windows.airChange, f);
    if (tight) {
      c.building.infiltration.n50 = scale(c.building.infiltration.n50, f);
      c.windows.n50After = scale(c.windows.n50After, f);
    }
  };
  const v: Variant[] = [
    ...(p.cooking?.enabled && p.system.cookingOnGas ? [-.1, .1].map((delta): Variant => ({
      id: delta < 0 ? "cooking-" : "cooking+",
      label: `Rendimento del piano a gas ${delta < 0 ? "−" : "+"}10 punti`,
      apply: edit((c) => { c.cooking!.gasHobEfficiency.value = Math.max(.2, Math.min(1, c.cooking!.gasHobEfficiency.value + delta)); }),
    })) : []),
    { id: "uw+", label: "Uw nuovi serramenti +30% (posa peggiore)", apply: edit((c) => (c.windows.uWindow = scale(c.windows.uWindow, 1.3))) },
    // nel modo «tenuta» (motore 0.12.0) le stesse varianti scalano anche n50 prima e dopo; il minimo resta
    { id: "inf-", label: tight ? "Infiltrazioni −30% (n50 prima e dopo)" : "Ricambi d'aria −30% (prima e dopo)", apply: edit((c) => scaleAir(c, 0.7)) },
    { id: "inf+", label: tight ? "Infiltrazioni +30% (n50 prima e dopo)" : "Ricambi d'aria +30% (prima e dopo)", apply: edit((c) => scaleAir(c, 1.3)) },
    { id: "infW", label: "Nessuna riduzione delle infiltrazioni con i nuovi serramenti", apply: edit((c) => ((c.windows.airChange = { ...c.windows.airChange, value: c.building.airChange.value }), tight && (c.windows.n50After = { value: c.building.infiltration.n50.value, status: "ipotizzato", source: "Variante di sensibilità: tenuta invariata" }))) },
    ...(tight ? [{ id: "infMin", label: "Ricambio minimo 0,5 vol/h", apply: edit((c) => (c.building.infiltration.minAirChange = { ...c.building.infiltration.minAirChange, value: 0.5 })) }] : []),
    { id: "uopaco+", label: `U opache +${OPAQUE_U_PCT}`, apply: edit((c) => ((c.building.uWall = scale(c.building.uWall, 1 + OPAQUE_U_VARIATION)), (c.building.uUpper = scale(c.building.uUpper, 1 + OPAQUE_U_VARIATION)), (c.building.uLower = scale(c.building.uLower, 1 + OPAQUE_U_VARIATION)))) },
    { id: "uopaco-", label: `U opache −${OPAQUE_U_PCT}`, apply: edit((c) => ((c.building.uWall = scale(c.building.uWall, 1 - OPAQUE_U_VARIATION)), (c.building.uUpper = scale(c.building.uUpper, 1 - OPAQUE_U_VARIATION)), (c.building.uLower = scale(c.building.uLower, 1 - OPAQUE_U_VARIATION)))) },
    ...(b.thermalBridges.mode === "lineari" ? [
      { id: "ponti-", label: "Ponti termici ψ ×0,5", apply: edit((c) => { for (const [id,j] of Object.entries(c.building.thermalBridges.junctions) as [keyof typeof c.building.thermalBridges.junctions, (typeof c.building.thermalBridges.junctions)[keyof typeof c.building.thermalBridges.junctions]][]) j.psi = { ...j.psi, value: bridgePsi(c.building,c.location,id)*.5, status:"ipotizzato", source:"Variante di sensibilità: ψ ×0,5" }; }) },
      { id: "ponti+", label: "Ponti termici ψ ×1,5", apply: edit((c) => { for (const [id,j] of Object.entries(c.building.thermalBridges.junctions) as [keyof typeof c.building.thermalBridges.junctions, (typeof c.building.thermalBridges.junctions)[keyof typeof c.building.thermalBridges.junctions]][]) j.psi = { ...j.psi, value: bridgePsi(c.building,c.location,id)*1.5, status:"ipotizzato", source:"Variante di sensibilità: ψ ×1,5" }; }) },
    ] : [{ id: "ponti+", label: "Ponti termici ΔU +0,05", apply: edit((c) => (c.building.thermalBridgeDeltaU = add(c.building.thermalBridgeDeltaU, 0.05))) }]),
    { id: "set-", label: "Setpoint −1 K", apply: edit((c) => (c.service.setpoint = add(c.service.setpoint, -1))) },
    { id: "set+", label: "Setpoint +1 K", apply: edit((c) => (c.service.setpoint = add(c.service.setpoint, 1))) },
    { id: "cap-", label: "Massa termica −33%", apply: edit((c) => (c.building.heatCapacityPerArea = scale(c.building.heatCapacityPerArea, 0.67))) },
    { id: "ombre", label: "Ombreggiamento più forte (fattore −0,2)", apply: edit((c) => (c.building.shadingFactor = add(c.building.shadingFactor, -0.2))) },
    { id: "rend-", label: `Rendimento ${p.heatPump.included && p.heatPump.boilerEndOfLife ? "caldaia nuova di riferimento" : "caldaia attuale"} −0,05`, apply: edit((c) => {
      if (c.heatPump.included && c.heatPump.boilerEndOfLife) c.heatPump.replacementBoilerEfficiency = add(c.heatPump.replacementBoilerEfficiency, -0.05);
      else c.system.boilerEfficiency = add(c.system.boilerEfficiency, -0.05);
    }) },
    { id: "pdc-", label: "COP PDC −15% (potenza invariata)", apply: edit((c) => (c.heatPump.copFactor = scale(c.heatPump.copFactor, 0.85))) },
    { id: "pdc+", label: "COP PDC +10% (potenza invariata)", apply: edit((c) => (c.heatPump.copFactor = scale(c.heatPump.copFactor, 1.1))) },
    { id: "cd-", label: "Degrado cicli Cd = 0,8", apply: edit((c) => (c.heatPump.cyclingCd = { ...c.heatPump.cyclingCd, value: 0.8 })) },
    { id: "mod-", label: "Modulazione minima −50%", apply: edit((c) => (c.heatPump.minModulation = scale(c.heatPump.minModulation, 0.5))) },
    { id: "mod+", label: "Modulazione minima +50%", apply: edit((c) => (c.heatPump.minModulation = scale(c.heatPump.minModulation, 1.5))) },
    ...([ ["pTO_W", "termostato spento"], ["pOFF_W", "spenta"], ["pCK_W", "carter"] ] as const).flatMap(([key, label]) => p.heatPump[key].value > 0 ? [0.5, 2].map((factor) => ({ id: `${key}-${factor}`, label: `Ausiliari ${label} ×${String(factor).replace(".", ",")}`, apply: edit((c) => (c.heatPump[key] = scale(c.heatPump[key], factor))) })) : []),
    { id: "flow+", label: "Mandata di progetto +5 K", apply: edit((c) => (c.system.designFlowTemp = add(c.system.designFlowTemp, 5))) },
    { id: "tdes-", label: "T esterna di progetto −4 K (curva della mandata)", apply: edit((c) => (c.system.designOutdoorTemp = add(c.system.designOutdoorTemp, -4))) },
    { id: "tdes+", label: "T esterna di progetto +4 K (curva della mandata)", apply: edit((c) => (c.system.designOutdoorTemp = add(c.system.designOutdoorTemp, 4))) },
    { id: "pvprod-", label: "Produzione FV −15% (ombre o resa peggiore)", apply: edit((c) => (c.pv.lossPct = { ...c.pv.lossPct, value: Math.min(40, 100 - (100 - c.pv.lossPct.value) * 0.85) })) },
    ...otherProfiles.map((pr) => ({ id: `prof-${pr}`, label: `${PROFILE_VARIANT_PREFIX}${pr}`, apply: edit((c) => (c.consumption.profile = pr)) })),
    { id: "gas+", label: "Prezzo gas +20%", apply: edit((c) => (c.tariffs.gasPrice = scale(c.tariffs.gasPrice, 1.2))) },
    { id: "gas-", label: "Prezzo gas −20%", apply: edit((c) => (c.tariffs.gasPrice = scale(c.tariffs.gasPrice, 0.8))) },
    { id: "el+", label: "Prezzo elettricità +20%", apply: edit((c) => (c.tariffs.elecPrice = scale(c.tariffs.elecPrice, 1.2))) },
    { id: "el-", label: "Prezzo elettricità −20%", apply: edit((c) => (c.tariffs.elecPrice = scale(c.tariffs.elecPrice, 0.8))) },
    { id: "inv+", label: "Investimenti, sostituzioni e caldaia di confronto +20%", apply: edit((c) => scaleCosts(c, 1.2)) },
    { id: "rate+", label: "Tasso reale +2 punti", apply: edit((c) => (c.economics.realDiscountRate = add(c.economics.realDiscountRate, 0.02))) },
  ];
  if (b.windowMode === "frazione") {
    v.push({ id: "fin+", label: "Rapporto finestrato +25%", apply: edit((c) => (c.building.windowFraction = scale(c.building.windowFraction, 1.25))) });
    v.push({ id: "fin-", label: "Rapporto finestrato −25%", apply: edit((c) => (c.building.windowFraction = scale(c.building.windowFraction, 0.75))) });
  }
  const unheatedVariants = (id: "upper" | "lower" | "side", title: string, active: boolean) => {
    if (!active) return;
    const spaceKey = id === "upper" ? "unheatedUpper" : id === "lower" ? "unheatedLower" : "unheatedSide";
    const bKey = id === "upper" ? "bUpperUnheated" : id === "lower" ? "bLowerUnheated" : "bSideUnheated";
    const q = b[spaceKey];
    // dati del locale incompleti: il motore usa il fattore b, quindi anche le varianti (unheatedHue)
    if (unheatedHue(q, 1, 0.5).modeUsed === "fattoreB") {
      const variantId = id === "upper" ? "bUp" : id === "lower" ? "bLow" : "bSide";
      v.push(id === "lower"
        ? { id: variantId, label: `${title}: fattore b +0,3`, apply: edit((c) => (c.building[bKey] = add(c.building[bKey], 0.3))) }
        : { id: variantId, label: `${title} come esterno (b = 1)`, apply: edit((c) => (c.building[bKey] = { ...c.building[bKey], value: 1 })) });
    } else for (const factor of [0.5, 2] as const) v.push({ id: `hue${id}${factor}`, label: `${title}: dispersioni del locale ×${String(factor).replace(".", ",")}`, apply: edit((c) => {
      const space = c.building[spaceKey];
      space.uOut = scale(space.uOut, factor);
      space.airChange = scale(space.airChange, factor);
    }) });
  };
  unheatedVariants("upper", "Sottotetto", b.upper === "sottotetto");
  unheatedVariants("lower", "Locale inferiore", b.lower === "nonRiscaldato");
  if (b.lower === "terreno") {
    v.push({ id: "gnd", label: "Fattore terreno +50%", apply: edit((c) => (c.building.groundFactor = scale(c.building.groundFactor, 1.5))) });
    for (const [id, factor] of [["perim-", 0.8], ["perim+", 1.2]] as const)
      v.push({ id, label: `Perimetro esposto terreno ${factor < 1 ? "−20%" : "+20%"}`, apply: edit((c) => {
        c.building.exposedPerimeter = { ...c.building.exposedPerimeter, value: computeGeometry(c.building).exposedPerimeter * factor, status: "ipotizzato", source: "Variante geometrica del perimetro esposto" };
      }) });
  }
  unheatedVariants("side", "Adiacenze laterali", b.sides !== "isolato" && b.sideAdjacency !== "riscaldato");
  // varianti estive: solo se il raffrescamento entra nei conti
  if (p.cooling.today === "split")
    v.push(
      { id: "cset-", label: "Temperatura estiva −1 K", apply: edit((c) => (c.cooling.setpoint = add(c.cooling.setpoint, -1))) },
      { id: "cset+", label: "Temperatura estiva +1 K", apply: edit((c) => (c.cooling.setpoint = add(c.cooling.setpoint, 1))) },
      { id: "eer-", label: "EER split e PDC −15%", apply: edit((c) => ((c.cooling.splitEer35 = scale(c.cooling.splitEer35, 0.85)), (c.heatPump.eerFactor = scale(c.heatPump.eerFactor, 0.85)))) },
      { id: "clat+", label: "Carico estivo +20% (umidità non modellata)", apply: edit((c) => (c.cooling.latentFactor = scale(c.cooling.latentFactor, 1.2))) },
      { id: "cshade", label: "Schermature estive più deboli (+0,2)", apply: edit((c) => (c.cooling.summerShading = { ...c.cooling.summerShading, value: Math.min(1, c.cooling.summerShading.value + 0.2) })) },
    );
  // varianti della batteria: solo se la batteria entra nei conti, così senza batteria la sensibilità resta quella di prima
  if (batteryUsed(p))
    v.push(
      { id: "bcap-", label: "Capacità della batteria −30%", apply: edit((c) => (c.battery.capacityKwh = scale(c.battery.capacityKwh, 0.7))) },
      { id: "bcap+", label: "Capacità della batteria +30%", apply: edit((c) => (c.battery.capacityKwh = scale(c.battery.capacityKwh, 1.3))) },
      { id: "beta-", label: "Rendimento della batteria −5 punti", apply: edit((c) => (c.battery.roundTripPct = add(c.battery.roundTripPct, -5))) },
      { id: "bfade1", label: "Degrado della batteria 1% all'anno (scenario)", apply: edit((c) => (c.battery.fadePctPerYear = { ...c.battery.fadePctPerYear, value: 1 })) },
      { id: "bfade3", label: "Degrado della batteria 3% all'anno (scenario)", apply: edit((c) => (c.battery.fadePctPerYear = { ...c.battery.fadePctPerYear, value: 3 })) },
      { id: "blife10", label: "Vita operativa della batteria 10 anni (scenario)", apply: edit((c) => (c.battery.lifeYears = { ...c.battery.lifeYears, value: 10 })) },
      { id: "blife20", label: "Vita operativa della batteria 20 anni (scenario)", apply: edit((c) => (c.battery.lifeYears = { ...c.battery.lifeYears, value: 20 })) },
      ...(p.pv.sizing === "indicativa"
        ? [
            { id: "bprice400", label: "Batteria a 400 €/kWh (scenario basso)", apply: edit((c) => (c.battery.pricePerKwh = { ...c.battery.pricePerKwh, value: 400 })) },
            { id: "bprice900", label: "Batteria a 900 €/kWh (scenario alto)", apply: edit((c) => (c.battery.pricePerKwh = { ...c.battery.pricePerKwh, value: 900 })) },
          ]
        : []),
      { id: "exp-", label: "Prezzo dell'energia ritirata −30%", apply: edit((c) => (c.tariffs.exportPrice = scale(c.tariffs.exportPrice, 0.7))) },
      { id: "exp+", label: "Prezzo dell'energia ritirata +30%", apply: edit((c) => (c.tariffs.exportPrice = scale(c.tariffs.exportPrice, 1.3))) },
    );
  if (activeInsulation(p).length) v.push({ id: "iso-", label: "Isolamento meno efficace (λ e U finale +20%)", apply: edit((c) => {
    for (const kind of activeInsulation(c)) {
      c.envelope[kind].lambda = scale(c.envelope[kind].lambda, 1.2);
      c.envelope[kind].uFinal = scale(c.envelope[kind].uFinal, 1.2);
    }
  }) });
  if (activeInsulation(p).some((kind) => p.envelope[kind].costMode === "stima"))
    for (const scenario of ["basso", "alto"] as const) v.push({ id: `isoprezzo-${scenario}`, label: `Isolamento ai prezzi dello scenario ${scenario}`, apply: edit((c) => {
      for (const kind of activeInsulation(c)) if (c.envelope[kind].costMode === "stima")
        c.envelope[kind].pricePerM2 = { ...c.envelope[kind].pricePerM2, value: INSULATION_PRICE_SCENARIOS[insulationPriceType(c, kind)][scenario] };
    }) });
  if (p.dhw.replace && p.dhw.newType === "pdc") v.push({ id: "acs-cop", label: "Scaldacqua: COP −15%", apply: edit((c) => (c.dhw.copRated = scale(c.dhw.copRated, .85))) });
  if (p.dhw.replace && p.dhw.newType === "solare") v.push({ id: "acs-sole", label: "Solare termico: resa del pannello −15%", apply: edit((c) => (c.dhw.solarEta0 = scale(c.dhw.solarEta0, .85))) });
  if ((todayBoiler(p) || p.dhw.replace) && dhwNeedFromGas(p) === null) v.push({ id: "acs-litri", label: "Acqua calda: litri a persona +30%", apply: edit((c) => (c.dhw.litresPerPerson = scale(c.dhw.litresPerPerson, 1.3))) });
  if (p.dhw.replace && p.dhw.costMode === "stima") for (const scenario of ["basso", "alto"] as const)
    v.push({ id: `acsprezzo-${scenario}`, label: `Scaldacqua ai prezzi dello scenario ${scenario}`, apply: edit((c) => (c.dhw.price = { ...c.dhw.price, value: DHW_PRICE_SCENARIOS[c.dhw.newType][scenario] })) });
  if (p.service.schedule?.mode === "fasce") {
    for (const delta of [-1, 1]) v.push({ id: `fasce${delta > 0 ? "+" : "-"}`, label: `Un'ora in ${delta > 0 ? "più" : "meno"} per fascia`, apply: edit((c) => {
      const bands = c.service.schedule!.bands;
      const sorted = bands.slice().sort((a, b) => a.start - b.start);
      for (let i = 0; i < sorted.length; i++) sorted[i].end = Math.max(sorted[i].start + 1, Math.min(sorted[i].end + delta, sorted[i + 1]?.start ?? 24));
    }) });
    if (p.service.schedule.maxPowerKw.status === "sconosciuto") {
      for (const factor of [1.2, 2]) v.push({ id: `potenza-${factor}`, label: `Potenza stimata: ${String(factor).replace(".", ",")} volte il picco continuo`, apply: (input) => {
        // Il clima arriva dal calcolo di sensibilità; una variante non può ricavare il picco dai soli input.
        if (!climate) throw new Error("Clima necessario per variare la potenza stimata del riscaldamento.");
        const peak = simulateThermal(input.building, input.service, climate, input.cooling.today === "split" ? input.cooling : undefined, envelopeUpgrade(input, [])).peak_W;
        const c = clone(input);
        c.service.schedule!.maxPowerKw = { value: factor * peak / 1000, status: "ipotizzato", source: "Variante della potenza stimata: docs/validazione/CORREZIONE-MOTORE.md §17 (12/11/2026)", date: "2026-11-12" };
        return c;
      } });
    }
  }
  return v;
}

export interface PackageSensitivity {
  id: PackageId;
  benefitMin: number;
  benefitMax: number;
  npvMin: number | null;
  npvMax: number | null;
  unresolved: boolean;
  invalidIn: string[];
  rows: { variant: string; benefit: number | null; npv: number | null; batteryNpv: number | null; valid: boolean }[];
  batteryNpvMin: number | null; // VAN della sola batteria fra le varianti, se il pacchetto ha la batteria
  batteryNpvMax: number | null;
}

export interface SensitivityResult {
  variants: { id: string; label: string; applicable: boolean; ok: boolean; best: PackageId | null }[];
  failedVariants: string[];
  packages: PackageSensitivity[];
  nominalBest: PackageId | null;
  bestStableShare: number | null;
  /** Taglia indicativa fra i tre profili orari (solo senza preventivo e senza curva del contatore). */
  sizeRange?: { id: PackageId; kWpMin: number; kWpMax: number; capacityMin: number; capacityMax: number }[];
}

/** Pacchetto con VAN più alto, solo se il VAN è ≥ 0: altrimenti nessuno conviene rispetto a non fare nulla. */
export function bestByNpv(ev: Evaluation, only: PackageId[] | null = null): PackageId | null {
  let best: PackageId | null = null;
  let v = 0;
  for (const r of ev.packages) if (r.cash && r.cash.npv >= v && (!only || only.includes(r.id))) ((v = r.cash.npv), (best = r.id));
  return best;
}

export const PROFILE_VARIANT_PREFIX = "Profilo elettrico ";

/** Il VAN dei pacchetti con FV sui tre profili sintetici; vuoto con una curva misurata, che non ha varianti di profilo. */
export function profileRange(ev: Evaluation, sens: SensitivityResult): { id: PackageId; label: string; npvMin: number; npvMax: number }[] {
  const out: { id: PackageId; label: string; npvMin: number; npvMax: number }[] = [];
  for (const r of ev.packages) {
    if (!r.has.P || !r.cash) continue;
    const npvs = (sens.packages.find((x) => x.id === r.id)?.rows ?? []).filter((x) => x.variant.startsWith(PROFILE_VARIANT_PREFIX) && x.npv !== null).map((x) => x.npv as number);
    if (npvs.length) out.push({ id: r.id, label: r.label, npvMin: Math.min(r.cash.npv, ...npvs), npvMax: Math.max(r.cash.npv, ...npvs) });
  }
  return out;
}

/** Il VAN della sola batteria sui tre profili sintetici; vuoto con una curva misurata. */
export function batteryProfileRange(ev: Evaluation, sens: SensitivityResult): { id: PackageId; label: string; npvMin: number; npvMax: number }[] {
  const out: { id: PackageId; label: string; npvMin: number; npvMax: number }[] = [];
  for (const r of ev.packages) {
    const nominal = r.battery?.npvBattery;
    if (nominal === null || nominal === undefined) continue;
    const npvs = (sens.packages.find((x) => x.id === r.id)?.rows ?? []).filter((x) => x.variant.startsWith(PROFILE_VARIANT_PREFIX) && x.batteryNpv !== null).map((x) => x.batteryNpv as number);
    if (npvs.length) out.push({ id: r.id, label: r.label, npvMin: Math.min(nominal, ...npvs), npvMax: Math.max(nominal, ...npvs) });
  }
  return out;
}

/** `only`: i pacchetti della domanda scelta; il migliore e la sua stabilità si cercano solo fra questi. */
export function runSensitivity(p: ProjectInput, climate: ClimatePackage, nominal: Evaluation, only: PackageId[] | null = null, onVariant?: (variantId: string, ev: Evaluation, index: number, total: number) => void): SensitivityResult {
  const variants = defaultVariants(p, climate);
  const attempted = variants.map((v) => ({ v, input: v.apply(p) }));
  const original = JSON.stringify(p);
  const inactive = attempted.filter((x) => JSON.stringify(x.input) === original);
  // le taglie indicative restano quelle nominali: le varianti misurano le ipotesi, non un cambio di taglia
  const sizes = sizesOf(nominal);
  const active = attempted.filter((x) => !inactive.includes(x));
  const calculated = active.map(({ v, input }, index) => { const ev = evaluateModel(input, climate, 1, sizes); onVariant?.(v.id, ev, index + 1, active.length); return { v, ev }; });
  const signature = (ev: Evaluation) => JSON.stringify(ev.packages.map((r) => [
    r.valid, r.heatNeed_kWh, r.peak_kW, r.recoveryPeak_kW, r.gasSmc,
    r.elec.demand_kWh, r.elec.import_kWh, r.elec.export_kWh, r.elec.importPeak_W,
    r.costs, r.investment, r.annualBenefit, r.economicsComplete, r.cash,
  ]));
  const nominalSignature = signature(nominal);
  // Una modifica a un campo non usato nel caso non è una prova di robustezza.
  const evals = calculated.filter((x) => !x.ev.ok || signature(x.ev) !== nominalSignature);
  const okEvals = evals.filter((x) => x.ev.ok);
  const nominalBest = bestByNpv(nominal, only);
  const pk: PackageSensitivity[] = nominal.packages
    .filter((r) => r.id !== "base")
    .map((r) => {
      const rows = okEvals.map(({ v, ev }) => {
        const x = ev.packages.find((y) => y.id === r.id);
        return { variant: v.label, benefit: x && x.valid ? x.annualBenefit : null, npv: x?.cash ? x.cash.npv : null, batteryNpv: x?.battery?.npvBattery ?? null, valid: !!x && x.valid };
      });
      const benefits = [r.valid ? r.annualBenefit : null, ...rows.map((x) => x.benefit)].filter((x): x is number => x !== null);
      const npvs = [r.cash ? r.cash.npv : null, ...rows.map((x) => x.npv)].filter((x): x is number => x !== null);
      const benefitMin = benefits.length ? Math.min(...benefits) : NaN;
      const benefitMax = benefits.length ? Math.max(...benefits) : NaN;
      const npvMin = npvs.length ? Math.min(...npvs) : null;
      const npvMax = npvs.length ? Math.max(...npvs) : null;
      const bnpvs = [r.battery?.npvBattery ?? null, ...rows.map((x) => x.batteryNpv)].filter((x): x is number => x !== null);
      const spans = (lo: number | null, hi: number | null) => lo !== null && hi !== null && lo < 0 && hi > 0;
      return {
        id: r.id,
        benefitMin,
        benefitMax,
        npvMin,
        npvMax,
        batteryNpvMin: bnpvs.length ? Math.min(...bnpvs) : null,
        batteryNpvMax: bnpvs.length ? Math.max(...bnpvs) : null,
        unresolved: spans(benefits.length ? benefitMin : null, benefits.length ? benefitMax : null) || spans(npvMin, npvMax),
        invalidIn: rows.filter((x) => !x.valid).map((x) => x.variant),
        rows,
      };
    });
  const vs = variants.map((v) => {
    const ev = evals.find((x) => x.v === v)?.ev;
    return { id: v.id, label: v.label, applicable: !!ev, ok: !!ev?.ok, best: ev?.ok ? bestByNpv(ev, only) : null };
  });
  const comparable = vs.filter((x) => x.applicable && x.ok);
  let sizeRange: SensitivityResult["sizeRange"];
  if (nominal.sizing && !usesMeasuredCurve(p)) {
    const all = [nominal, ...(["diurno", "serale", "distribuito"] as ElectricProfile[]).filter((x) => x !== p.consumption.profile).map((profile) => evaluateModel({ ...p, consumption: { ...p.consumption, profile } }, climate))];
    sizeRange = nominal.sizing.map((s) => {
      const chosen = all.map((ev) => ev.sizing?.find((x) => x.id === s.id)?.chosen).filter((x): x is { kWp: number; capacity: number } => !!x);
      return { id: s.id, kWpMin: Math.min(...chosen.map((x) => x.kWp)), kWpMax: Math.max(...chosen.map((x) => x.kWp)), capacityMin: Math.min(...chosen.map((x) => x.capacity)), capacityMax: Math.max(...chosen.map((x) => x.capacity)) };
    });
  }
  return {
    sizeRange,
    variants: vs,
    failedVariants: vs.filter((x) => x.applicable && !x.ok).map((x) => x.label),
    packages: pk,
    nominalBest,
    bestStableShare: comparable.length ? comparable.filter((x) => x.best === nominalBest).length / comparable.length : null,
  };
}
