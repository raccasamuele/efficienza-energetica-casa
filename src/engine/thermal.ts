import { HOURS, inDayPeriod, localDay, localHour, mean, type ClimatePackage, type ClimateZone } from "./climate";
import { ORIENTATIONS, computeGeometry, groundEquivalentU, type Geometry } from "./geometry";
import { q, type BuildingInput, type CoolingInput, type HeatingSchedule, type ServiceInput } from "./types";
import type { EnvelopeUpgrade, SurfaceUpgrade } from "./involucro";
import { bridgeTable } from "./thermalBridges";
import { hourlyAirChange, infiltrationModel, type InfiltrationModel } from "./infiltration";

export const DT = 3600; // s
const RHO_C_AIR = 1200; // J/(m³K), capacità termica volumica dell'aria
const F_W = 0.9; // fattore g per incidenza non normale (ipotesi dichiarata)

// Scambio con l'esterno ora per ora (motore 0.6.0, docs/validazione/CORREZIONE-MOTORE.md)
const RSE_STD = 0.04; // m²K/W, resistenza esterna già contenuta nelle U (UNI EN ISO 6946)
const WIND_LOCAL = 0.5; // vento vicino alla parete / vento a 10 m: terreno suburbano, 2-6 m (ASHRAE Fundamentals)
const EPS_EXT = 0.9; // emissività delle superfici esterne
const SIGMA = 5.67e-8;
const DT_SKY = 11; // K, differenza media fra aria e cielo (UNI EN ISO 52016-1, UNI EN ISO 13790)
const T_IN_REF = 20; // °C, interno di riferimento per stimare il salto fra vetro e aria esterna (motore 0.8.0)

// Rete 5R1C della UNI EN ISO 13790:2008, appendice C (motore 0.7.0, docs/validazione/CORREZIONE-MOTORE.md §7)
const H_IS = 3.45; // W/m²K, fra aria e superfici
const LAMBDA_AT = 4.5; // superficie interna totale / superficie utile
const H_MS = 9.1; // W/m²K, fra superfici e massa
const PHI_10 = 10; // W/m², potenza di prova del metodo C.4
const SKY_ATTIC = 0.93; // cielo visto dalle falde del sottotetto (30°)

/** Superficie verso l'esterno: U del dato (con Rse 0,04), area, sole e cielo. */
export interface Outdoor {
  surface: "N" | "E" | "S" | "O" | "tetto";
  area: number;
  uRef: number;
  alpha: number; // assorbimento del sole; 0 per le finestre (il sole entra con g)
  sky: number; // fattore di vista del cielo
}

/** Sottotetto: quota delle dispersioni che passa dal tetto, scaldato dal sole e raffreddato dal cielo. */
export interface Attic {
  share: number;
  alpha: number;
  sky: number;
}
export interface UnheatedExchange { id: "upper" | "lower" | "side"; Hiu: number; Hue: number; bToday: number }
export interface UnheatedHue { hue: number; modeUsed: "fattoreB" | "locale"; fallback: boolean }

/** H_ue equivalente: unico calcolo condiviso da involucro e controlli di qualità. */
export function unheatedHue(space: BuildingInput["unheatedUpper"], HiuToday: number, b: number): UnheatedHue {
  const bHue = b >= 1 ? Number.MAX_VALUE : HiuToday * b / (1 - b);
  if (space.mode !== "locale") return { hue: bHue, modeUsed: "fattoreB", fallback: false };
  const fields = [space.areaOut, space.uOut, space.volume, space.airChange];
  const hue = space.uOut.value * space.areaOut.value + RHO_C_AIR * space.airChange.value * space.volume.value / 3600;
  if (fields.every((field) => field.status !== "sconosciuto") && hue > 0 && Number.isFinite(hue))
    return { hue, modeUsed: "locale", fallback: false };
  return { hue: bHue, modeUsed: "fattoreB", fallback: true };
}

/** Termine di scambio: H in W/K verso una temperatura (serie oraria o costante). */
export interface Exchange {
  label: string;
  H: number; // con il coefficiente esterno della norma; quello dell'ora per le superfici esterne
  temp: "aria" | "terreno";
  kind: "opaco" | "finestra" | "ventilazione"; // nodo della rete 5R1C: massa, superfici, aria
  outdoor?: Outdoor;
  attic?: Attic;
  unheated?: UnheatedExchange;
}

/** Coefficiente esterno dell'ora: convezione con il vento locale e irraggiamento (UNI EN ISO 6946, appendice C). */
export function exteriorCoefficients(tAir: number, wind10: number): { he: number; hre: number } {
  const hce = 4 + 4 * WIND_LOCAL * Math.max(0, wind10);
  const hre = EPS_EXT * 4 * SIGMA * (tAir + 273.15) ** 3;
  return { he: hce + hre, hre };
}

/**
 * Convezione esterna dei vetri (motore 0.8.0, CORREZIONE-MOTORE.md §9): correlazione MoWiTT misurata su finestre
 * (Yazdanian e Klems 1994), come il modello DOE-2 per il vetro. Senza direzione del vento: media fra sopravento e sottovento.
 * Convezione naturale 1,31·|ΔT|^(1/3), con ΔT fra vetro e aria stimato in regime stazionario con 20 °C dentro.
 */
export function windowExteriorConvection(tAir: number, wind10: number, uRef: number, hre: number): number {
  const v = WIND_LOCAL * Math.max(0, wind10);
  const hf = 0.5 * (3.26 * v ** 0.89 + 3.55 * v ** 0.617);
  let hn = 0;
  for (let i = 0; i < 2; i++) {
    const hc = Math.sqrt(hn * hn + hf * hf);
    const he = hc + hre;
    const dT = (hourlyU(uRef, he) * Math.abs(T_IN_REF - tAir)) / he;
    hn = 1.31 * Math.cbrt(dT);
  }
  return Math.sqrt(hn * hn + hf * hf);
}

/** U dell'ora: la resistenza esterna della norma sostituita da quella dell'ora. */
export function hourlyU(uRef: number, he: number): number {
  return 1 / (1 / uRef - RSE_STD + 1 / he);
}

/** Temperatura esterna equivalente (sole-aria) di una superficie. */
export function solAirTemp(tAir: number, irradiance: number, o: Pick<Outdoor, "alpha" | "sky">, he: number, hre: number): number {
  return tAir + (o.alpha * irradiance - o.sky * hre * DT_SKY) / he;
}

export interface EnvelopeModel {
  geometry: Geometry;
  exchanges: Exchange[];
  H: number;
  C: number;
  Af: number; // m², superficie utile della rete 5R1C
  Am: number; // m², superficie efficace della massa
  unheatedSpaces: UnheatedResult[];
  tGround: number;
  solarArea: Record<"N" | "E" | "S" | "O", number>; // m² equivalenti, con Fw solo per pacchetti senza serie angolare
  internalGainW: number;
  H_tb: number;
  H_tbToday: number;
  H_tbAfter: number;
  infiltration: InfiltrationModel | null; // modo «tenuta» (motore 0.12.0): ricambio orario
  tRef: number; // °C, setpoint: ΔT del tiraggio fuori dalla simulazione
  errors: string[];
  notes: string[];
}
export interface UnheatedResult { id: "upper" | "lower" | "side"; bToday: number; bAfter: number; meanHeatingTemperature: number }

/** Apporto dei vetri nell'ora: la serie pesata angolarmente sostituisce facade quando presente. */
export function solarGainAtHour(env: Pick<EnvelopeModel, "solarArea">, climate: ClimatePackage, hour: number, shade = 1): number {
  const irradiance = climate.series.facadeGlazing ?? climate.series.facade;
  return shade * (env.solarArea.N * irradiance.N[hour] + env.solarArea.E * irradiance.E[hour] + env.solarArea.S * irradiance.S[hour] + env.solarArea.O * irradiance.O[hour]);
}

export function buildEnvelope(b: BuildingInput, s: ServiceInput, climate: ClimatePackage, upgrade?: EnvelopeUpgrade): EnvelopeModel {
  const g = computeGeometry(b);
  const errors = [...g.errors];
  const notes = [...g.notes];
  if (!climate.series.facadeGlazing) notes.push("Pacchetto clima senza dati angolari: Fw 0,9.");
  if (b.thermalBridges?.mode === "lineari" && upgrade?.ignoredBridgeDeltaU) notes.push("ΔU dei ponti dichiarato nell’intervento ignorato: è attiva la modalità ψ·L.");
  const ex: Exchange[] = [];
  const linear = b.thermalBridges?.mode === "lineari";
  const dU = linear ? 0 : b.thermalBridgeDeltaU.value;
  // I casi senza effetto mantengono esattamente l'espressione originale.
  const effectiveU = (u: number, x?: SurfaceUpgrade) => !x || x.share === 0 || (x.uAfter === u && x.bridgeAfter === dU)
    ? u + dU : x.share * (x.uAfter + x.bridgeAfter) + (1 - x.share) * (u + dU);
  const addUnheated = (id: UnheatedExchange["id"], label: string, Hiu: number, q: BuildingInput["unheatedUpper"], bValue: number, attic?: Attic) => {
    const HiuToday = id === "upper" ? (b.uUpper.value + dU) * g.upperArea : id === "lower" ? (b.uLower.value + dU) * g.lowerArea : (b.uWall.value + dU) * g.adjacentWall;
    const { hue: Hue, modeUsed, fallback } = unheatedHue(q, HiuToday, bValue);
    if (fallback) notes.push(`${label}: dati del locale incompleti, usato il fattore b.`);
    // Con Hiu invariata, conserva anche la valutazione numerica storica U·A·b del 0.9.0.
    const H = modeUsed === "fattoreB" && Hiu === HiuToday ? Hiu * bValue : bValue >= 1 && modeUsed === "fattoreB" ? Hiu : Hiu * Hue / (Hiu + Hue);
    ex.push({ label, H, temp: "aria", kind: "opaco", attic, unheated: { id, Hiu, Hue, bToday: modeUsed === "fattoreB" ? bValue : Hue / (HiuToday + Hue) } });
  };

  const alpha = b.solarAbsorptance.value;
  const climateZone = climate.manifest.zone;
  const bridgeZone: ClimateZone = climateZone ?? "E";
  if (linear && !climateZone) notes.push("Zona climatica del pacchetto assente: ponti lineari stimati con la colonna E.");
  const bridgeRows = linear ? bridgeTable(b, { zone: bridgeZone }, upgrade?.bridgeShare ?? 0) : [];
  const rawBridgeH = bridgeRows.reduce((sum, row) => sum + row.h, 0);
  const rawBridgeHAfter = bridgeRows.reduce((sum, row) => sum + row.after, 0);
  const H_tbToday = Math.max(0, rawBridgeH);
  const H_tbAfter = Math.max(0, rawBridgeHAfter);
  const H_tb = H_tbAfter;
  if (linear && rawBridgeH < 0) notes.push("La somma ψ·L dei ponti è negativa: contributo limitato a zero.");
  if (linear && (b.thermalBridges.junctions.balcone.length.status === "sconosciuto")) notes.push("Balconi non inseriti: lunghezza assunta pari a zero (risultato indicativo).");
  if (linear && H_tb > 0) ex.push({ label: "Ponti termici", H: H_tb, temp: "aria", kind: "opaco" });
  const uWallEff = effectiveU(b.uWall.value, upgrade?.walls);
  for (const o of ORIENTATIONS)
    if (g.externalWall[o] > 0) ex.push({ label: `Pareti esterne ${o}`, H: uWallEff * g.externalWall[o], temp: "aria", kind: "opaco", outdoor: { surface: o, area: g.externalWall[o], uRef: uWallEff, alpha, sky: 0.5 } });
  for (const o of ORIENTATIONS)
    if (g.windows[o] > 0) ex.push({ label: `Serramenti ${o}`, H: b.uWindow.value * g.windows[o], temp: "aria", kind: "finestra", outdoor: { surface: o, area: g.windows[o], uRef: b.uWindow.value, alpha: 0, sky: 0.5 } });

  switch (b.upper) {
    case "riscaldato":
      notes.push("Confine superiore con unità riscaldata allo stesso setpoint: scambio nullo.");
      break;
    case "sottotetto":
      // il sottotetto scambia verso una temperatura scaldata dal sole sul tetto (CORREZIONE-MOTORE.md §7.1)
      addUnheated("upper", "Soffitto verso sottotetto", effectiveU(b.uUpper.value, upgrade?.upper) * g.upperArea, b.unheatedUpper, b.bUpperUnheated.value, { share: b.atticRoofShare.value, alpha, sky: SKY_ATTIC });
      break;
    default: {
      const uRoof = effectiveU(b.uUpper.value, upgrade?.upper);
      // copertura inclinata: irraggiamento orizzontale (approssimazione dichiarata), cielo per 30° di falda
      ex.push({ label: "Copertura", H: uRoof * g.upperArea, temp: "aria", kind: "opaco", outdoor: { surface: "tetto", area: g.upperArea, uRef: uRoof, alpha, sky: b.upper === "coperturaPiana" ? 1 : 0.93 } });
    }
  }

  switch (b.lower) {
    case "riscaldato":
      notes.push("Confine inferiore con unità riscaldata allo stesso setpoint: scambio nullo.");
      break;
    case "nonRiscaldato":
      addUnheated("lower", "Pavimento verso locale non riscaldato", effectiveU(b.uLower.value, upgrade?.lower) * g.lowerArea, b.unheatedLower, b.bLowerUnheated.value);
      break;
    case "terreno":
      {
        // EN ISO 13370, parte stazionaria: U equivalente dal pacchetto (U + ΔU), dall'area e dal perimetro esposto,
        // verso la media annua dell'aria; groundFactor è solo una correzione dichiarata (1 = calcolo standard)
        const uEq = groundEquivalentU(b.uLower.value + dU, g.lowerArea, Math.max(1e-6, g.exposedPerimeter));
        ex.push({ label: "Pavimento su terreno", H: uEq * g.lowerArea * b.groundFactor.value, temp: "terreno", kind: "opaco" });
        notes.push(
      `Terreno: U equivalente semplificata (UNI EN ISO 13370:2018, parte stazionaria) ${uEq.toFixed(2)} W/m²K (perimetro esposto ${g.exposedPerimeter.toFixed(1)} m) verso la media annua dell'aria dell'anno climatico tipico; parte periodica trascurata, conformità alle appendici D e NA:2025 non verificata.`,
        );
      }
      break;
    case "esterno":
      ex.push({ label: "Pavimento verso esterno", H: effectiveU(b.uLower.value, upgrade?.lower) * g.lowerArea, temp: "aria", kind: "opaco" });
  }

  if (b.sides !== "isolato" && g.adjacentWall > 0) {
    if (b.sideAdjacency === "riscaldato") {
      notes.push("Pareti laterali confinanti con unità riscaldate allo stesso setpoint: scambio nullo.");
    } else {
      addUnheated("side", "Pareti verso adiacenze non riscaldate", (b.uWall.value + dU) * g.adjacentWall, b.unheatedSide, b.bSideUnheated.value);
      if (b.sideAdjacency === "nonNoto") notes.push("Adiacenza laterale non nota: trattata come non riscaldata, il risultato resta indicativo.");
    }
  }

  if (b.upper === "sottotetto" || b.lower === "nonRiscaldato" || (b.sides !== "isolato" && b.sideAdjacency !== "riscaldato"))
    notes.push("Locali non riscaldati: bilancio stazionario fra casa e dispersioni del locale (UNI EN ISO 13789, Guida F.15).");
  for (const e of ex) if (e.unheated) {
    const beq = e.unheated.Hue / (e.unheated.Hiu + e.unheated.Hue);
    if (beq < 0.1 || beq > 0.98) notes.push(`${e.label}: fattore b risultante ${beq.toFixed(3)}, fuori dall'intervallo usuale 0,1–0,98.`);
  }

  // modo «tenuta» (CORREZIONE-MOTORE.md §13): H della ventilazione orario; qui il minimo, l'ora si calcola in exchangeSplit e simulateThermal
  const infiltration = b.infiltration?.mode === "tenuta" ? infiltrationModel(b, g.volume) : null;
  if (b.infiltration?.mode === "tenuta" && !infiltration) notes.push("Tenuta all'aria non inserita: usato il ricambio costante.");
  if (infiltration) notes.push(`Infiltrazioni dalla tenuta all'aria: n50 ${infiltration.n50.toFixed(1)} 1/h, area di perdita ${infiltration.leakageArea_cm2.toFixed(0)} cm², con vento e tiraggio ora per ora (modello ASHRAE di Sherman e Grimsrud).`);
  ex.push({ label: "Ventilazione e infiltrazioni", H: (RHO_C_AIR * (infiltration ? infiltration.minAirChange : b.airChange.value) * g.volume) / 3600, temp: "aria", kind: "ventilazione" });

  const H = ex.reduce((acc, e) => acc + e.H, 0);
  const C = b.heatCapacityPerArea.value * 1000 * b.floorArea.value;
  if (!(C > 0)) errors.push("Capacità termica non positiva.");
  const Af = b.floorArea.value;
  const Am = massAreaRatio(b.heatCapacityPerArea.value) * Af;
  for (const e of ex) if (!Number.isFinite(e.H) || e.H < 0) errors.push(`Coefficiente non valido: ${e.label}.`);

  const k = b.gWindow.value * (1 - b.frameFraction.value) * b.shadingFactor.value * (climate.series.facadeGlazing ? 1 : F_W);
  const solarArea = { N: g.windows.N * k, E: g.windows.E * k, S: g.windows.S * k, O: g.windows.O * k };
  return {
    geometry: g,
    exchanges: ex,
    H,
    C,
    Af,
    Am,
    unheatedSpaces: [],
    tGround: mean(climate.series.tAir),
    solarArea,
    internalGainW: s.internalGains.value * b.floorArea.value,
    H_tb, H_tbToday, H_tbAfter,
    infiltration,
    tRef: s.setpoint.value,
    errors,
    notes,
  };
}

/** Scambi dell'ora per nodo della rete: H in W/K e B = Σ H·T in W. */
export interface SplitSeries {
  ve: { H: number[]; B: number[] }; // ventilazione, all'aria
  w: { H: number[]; B: number[] }; // finestre, alle superfici
  op: { H: number[]; B: number[] }; // opachi, terreno e locali non riscaldati, alla massa
}

/**
 * Scambio dell'ora con l'esterno, il terreno e i locali non riscaldati, diviso per nodo della rete 5R1C. Superfici
 * esterne al coefficiente esterno dell'ora e alla temperatura sole-aria (motore 0.6.0); sottotetto verso
 * θe + f·(θsa − θe) (motore 0.7.0).
 */
export function exchangeSplit(env: EnvelopeModel, climate: ClimatePackage): SplitSeries {
  const { tAir, wind, ghi, facade } = climate.series;
  const mk = () => ({ H: new Array<number>(HOURS).fill(0), B: new Array<number>(HOURS).fill(0) });
  const out: SplitSeries = { ve: mk(), w: mk(), op: mk() };
  const node = (e: Exchange) => (e.kind === "ventilazione" ? out.ve : e.kind === "finestra" ? out.w : out.op);
  for (let h = 0; h < HOURS; h++) {
    const { he, hre } = exteriorCoefficients(tAir[h], wind[h]);
    for (const e of env.exchanges) {
      const n = node(e);
      let H = e.H;
      let T: number;
      if (e.kind === "ventilazione" && env.infiltration) H = ventilationH(env.infiltration, env.tRef - tAir[h], wind[h]);
      if (e.outdoor) {
        const o = e.outdoor;
        const heS = e.kind === "finestra" ? windowExteriorConvection(tAir[h], wind[h], o.uRef, hre) + hre : he;
        H = hourlyU(o.uRef, heS) * o.area;
        T = solAirTemp(tAir[h], o.surface === "tetto" ? ghi[h] : facade[o.surface][h], o, heS, hre);
      } else if (e.attic) {
        T = tAir[h] + e.attic.share * (solAirTemp(tAir[h], ghi[h], e.attic, he, hre) - tAir[h]);
      } else T = e.temp === "terreno" ? env.tGround : tAir[h];
      n.H[h] += H;
      n.B[h] += H * T;
    }
  }
  return out;
}

/** H della ventilazione (W/K) per un ricambio orario dalla tenuta all'aria. */
export function ventilationH(m: InfiltrationModel, dT: number, wind: number): number {
  return (RHO_C_AIR * hourlyAirChange(m, dT, wind) * m.volume) / 3600;
}

/** Somma degli scambi dell'ora su tutti i nodi: H(h) in W/K e B(h) = Σ H·T in W. */
export function exchangeSeries(env: EnvelopeModel, climate: ClimatePackage): { H: number[]; B: number[] } {
  const x = exchangeSplit(env, climate);
  return {
    H: x.ve.H.map((v, h) => v + x.w.H[h] + x.op.H[h]),
    B: x.ve.B.map((v, h) => v + x.w.B[h] + x.op.B[h]),
  };
}

/** Am/Af dalla capacità areica (kJ/m²K), interpolando il prospetto 12 della UNI EN ISO 13790. */
export function massAreaRatio(kappa: number): number {
  if (kappa <= 165) return 2.5;
  if (kappa <= 260) return 2.5 + (0.5 * (kappa - 165)) / 95;
  if (kappa <= 370) return 3.0 + (0.5 * (kappa - 260)) / 110;
  return 3.5;
}

/** Scambi di un'ora per la rete 5R1C. */
export interface HourExchange {
  Hve: number;
  Bve: number;
  Hw: number;
  Bw: number;
  Hop: number;
  Bop: number;
}

export interface Nodes5R1C {
  thetaM: number; // media dell'ora
  thetaMEnd: number; // fine dell'ora (stato)
  thetaS: number;
  thetaAir: number;
  thetaOp: number;
}

/**
 * Un passo orario della rete 5R1C (UNI EN ISO 13790:2008, C.3, Crank-Nicolson) con potenza phiHC all'aria.
 * Apporti: metà degli interni all'aria, il resto e il sole ripartiti fra superfici e massa.
 */
export function step5R1C(thetaMPrev: number, x: HourExchange, Cm: number, Am: number, Af: number, phiInt: number, phiSol: number, phiHC: number): Nodes5R1C {
  const Atot = LAMBDA_AT * Af;
  const Htris = H_IS * Atot;
  const Hms = H_MS * Am;
  if (!(x.Hop < Hms)) throw new Error("Dispersioni degli opachi oltre il collegamento con la massa: rete 5R1C non applicabile");
  const phiIa = 0.5 * phiInt;
  const rest = 0.5 * phiInt + phiSol;
  const phiM = (Am / Atot) * rest;
  const fSt = surfaceShare(Am, Af, x.Hw);
  if (fSt < 0) throw new Error("Finestre troppo grandi per la ripartizione degli apporti: rete 5R1C non applicabile");
  const phiSt = fSt * rest;
  // forme senza divisioni per Hve: H1·(θsup + Φ/Hve) = (Htris·Bve + Htris·Φ) / (Hve + Htris)
  const k = Htris / (x.Hve + Htris);
  const H1 = x.Hve * k;
  const A1 = k * (x.Bve + phiIa + phiHC);
  const H2 = H1 + x.Hw;
  const H3 = H2 > 0 ? (H2 * Hms) / (H2 + Hms) : 0;
  const Hem = x.Hop > 0 ? (x.Hop * Hms) / (Hms - x.Hop) : 0;
  const BemT = x.Hop > 0 ? (x.Bop * Hms) / (Hms - x.Hop) : 0;
  const phiMtot = phiM + BemT + (H2 > 0 ? (H3 * (phiSt + x.Bw + A1)) / H2 : 0);
  const c = Cm / DT;
  const thetaMEnd = (thetaMPrev * (c - 0.5 * (H3 + Hem)) + phiMtot) / (c + 0.5 * (H3 + Hem));
  const thetaM = 0.5 * (thetaMEnd + thetaMPrev);
  const thetaS = (Hms * thetaM + phiSt + x.Bw + A1) / (Hms + x.Hw + H1);
  const thetaAir = (Htris * thetaS + x.Bve + phiIa + phiHC) / (Htris + x.Hve);
  if (!Number.isFinite(thetaMEnd) || !Number.isFinite(thetaS) || !Number.isFinite(thetaAir)) throw new Error("Rete 5R1C: temperatura non finita");
  return { thetaM, thetaMEnd, thetaS, thetaAir, thetaOp: 0.5 * (thetaAir + thetaS) };
}

/** Quota degli apporti alle superfici (UNI EN ISO 13790, C.3): 1 − Am/Atot − Htr,w/(9,1·Atot). */
export function surfaceShare(Am: number, Af: number, Hw: number): number {
  const Atot = LAMBDA_AT * Af;
  return 1 - Am / Atot - Hw / (H_MS * Atot);
}

export interface ControlResult {
  nodes: Nodes5R1C;
  qHeat: number;
  qCool: number; // W sottratti, ≥ 0
}

/**
 * Potenza dell'ora con il metodo della UNI EN ISO 13790, C.4: due calcoli a potenza 0 e 10 W/m², poi la potenza
 * che porta la temperatura operante al setpoint (o al limite estivo). Illimitata se pMax è assente;
 * con pMax il passo 4 di C.4.2 ricalcola i nodi alla potenza disponibile.
 */
export function control5R1C(thetaMPrev: number, x: HourExchange, Cm: number, Am: number, Af: number, phiInt: number, phiSol: number, tSet: number | null, tMax: number | null, pMax?: number): ControlResult {
  const n0 = step5R1C(thetaMPrev, x, Cm, Am, Af, phiInt, phiSol, 0);
  const heat = tSet !== null && n0.thetaOp < tSet;
  const cool = !heat && tMax !== null && n0.thetaOp > tMax;
  if (!heat && !cool) return { nodes: n0, qHeat: 0, qCool: 0 };
  const p10 = PHI_10 * Af;
  const n10 = step5R1C(thetaMPrev, x, Cm, Am, Af, phiInt, phiSol, p10);
  const target = heat ? tSet! : tMax!;
  const phi = (p10 * (target - n0.thetaOp)) / (n10.thetaOp - n0.thetaOp);
  if (heat && pMax !== undefined && phi > pMax)
    return { nodes: step5R1C(thetaMPrev, x, Cm, Am, Af, phiInt, phiSol, pMax), qHeat: pMax, qCool: 0 };
  const f = phi / p10;
  const mix = (a: number, b: number) => a + f * (b - a);
  const nodes: Nodes5R1C = {
    thetaM: mix(n0.thetaM, n10.thetaM),
    thetaMEnd: mix(n0.thetaMEnd, n10.thetaMEnd),
    thetaS: mix(n0.thetaS, n10.thetaS),
    thetaAir: mix(n0.thetaAir, n10.thetaAir),
    thetaOp: target,
  };
  return heat ? { nodes, qHeat: phi, qCool: 0 } : { nodes, qHeat: 0, qCool: -phi };
}

/** Maschera della stagione di riscaldamento sulle 8760 ore, per giorno locale Europe/Rome (con ora legale). */
export function seasonMask(s: ServiceInput): boolean[] {
  return dayMask(s.seasonStart, s.seasonEnd);
}

/** Maschera oraria di un periodo di date, per giorno locale Europe/Rome. */
export function dayMask(start: { month: number; day: number }, end: { month: number; day: number }): boolean[] {
  const mask = new Array<boolean>(HOURS);
  for (let h = 0; h < HOURS; h++) mask[h] = inDayPeriod(localDay(h), start, end);
  return mask;
}

export const DEFAULT_HEATING_SEASON = dayMask({ month: 10, day: 15 }, { month: 4, day: 15 });

export const RECOVERY_HOURS = 72;

/** Ore di recupero a inizio stagione: dopo il periodo libero il carico ideale ha un transitorio non fisico. */
export function recoveryMask(mask: boolean[]): boolean[] {
  const out = new Array<boolean>(HOURS).fill(false);
  for (let h = 0; h < HOURS; h++) {
    const prev = mask[(h - 1 + HOURS) % HOURS];
    if (mask[h] && !prev) for (let k = 0; k < RECOVERY_HOURS && h + k < HOURS && mask[h + k]; k++) out[h + k] = true;
  }
  return out;
}

export interface StepResult {
  tNext: number;
  qHeat: number;
  qCool: number; // W sottratti, ≥ 0
}

/**
 * Un passo del modello 1R1C con condizioni costanti nel passo (soluzione esatta).
 * C dT/dt = H (Teq - T) + Q, con Teq = (B+G)/H. Riscalda sotto tSet, raffresca sopra tMax.
 */
export function rcStep(tPrev: number, H: number, B: number, G: number, C: number, dt: number, tSet: number | null, tMax: number | null = null): StepResult {
  if (!(C > 0) || !Number.isFinite(C)) throw new Error("C deve essere positivo e finito");
  if (H < 0 || !Number.isFinite(H)) throw new Error("H deve essere non negativo e finito");
  if (H * dt < 1e-9 * C) {
    // limite H → 0: T_free = T_prev + G dt / C
    const tFree = tPrev + (G * dt) / C;
    if (tSet !== null && tFree < tSet) return { tNext: tSet, qHeat: ((tSet - tFree) * C) / dt, qCool: 0 };
    if (tMax !== null && tFree > tMax) return { tNext: tMax, qHeat: 0, qCool: ((tFree - tMax) * C) / dt };
    return { tNext: tFree, qHeat: 0, qCool: 0 };
  }
  const x = (-H * dt) / C;
  const oneMinusA = -Math.expm1(x); // 1 - exp(-H dt / C)
  const a = 1 - oneMinusA;
  const tEq = (B + G) / H;
  const tFree = a * tPrev + oneMinusA * tEq;
  if (tSet !== null && tFree < tSet) {
    const q = (H * (tSet - tFree)) / oneMinusA;
    return { tNext: tFree + (oneMinusA * q) / H, qHeat: q, qCool: 0 };
  }
  if (tMax !== null && tFree > tMax) {
    const q = (H * (tFree - tMax)) / oneMinusA;
    return { tNext: tFree - (oneMinusA * q) / H, qHeat: 0, qCool: q };
  }
  return { tNext: tFree, qHeat: 0, qCool: 0 };
}

/** Periodo di raffrescamento sulle 8760 ore, per giorno locale. */
export function coolingMask(c: CoolingInput): boolean[] {
  return dayMask(c.seasonStart, c.seasonEnd);
}

/** Temperatura obiettivo estiva: setpoint, ma mai più di maxDelta sotto l'aria esterna. */
export function coolingLimit(tAir: number, c: CoolingInput): number {
  return Math.max(c.setpoint.value, tAir - c.maxDelta.value);
}

export interface ThermalResult {
  schedule?: ScheduleResult;
  ok: boolean;
  errors: string[];
  notes: string[];
  envelope: EnvelopeModel;
  qHeat: number[]; // W, ora per ora
  tIndoor: number[]; // temperatura operante
  tMass: number[]; // temperatura della massa a fine ora (stato della rete 5R1C)
  airChange: number[]; // vol/h, ora per ora (costante salvo il modo «tenuta»)
  unheatedSpaces: UnheatedResult[];
  heatNeed_kWh: number;
  peak_W: number; // picco di regime, escluse le ore di recupero
  recoveryPeak_W: number; // picco del transitorio a inizio stagione
  recovery: boolean[];
  recoveryBudget_Wh: number[]; // all'ora di inizio di ogni finestra: C·(Tset − T) da recuperare
  qCool: number[]; // W frigoriferi, ora per ora, già moltiplicati per il fattore latente
  tMax: number[]; // temperatura obiettivo estiva, NaN fuori dal periodo
  coolNeed_kWh: number;
  coolPeak_W: number;
  coolHours: number;
  cycles: number;
  converged: boolean;
}

/** Ricambio d'aria medio nell'anno e nella stagione di riscaldamento, e quota delle ore di riscaldamento in cui
 * prevale il minimo garantito da chi abita (modo «tenuta», motore 0.12.0). */
export function airChangeSummary(t: ThermalResult, s: ServiceInput): { meanYear: number; meanHeating: number; minShareHeating: number } | null {
  const m = t.envelope.infiltration;
  if (!m || t.airChange.length !== HOURS) return null;
  const mask = seasonMask(s);
  let sum = 0, sumH = 0, nH = 0, atMin = 0;
  for (let h = 0; h < HOURS; h++) {
    sum += t.airChange[h];
    if (!mask[h]) continue;
    sumH += t.airChange[h];
    nH++;
    if (t.airChange[h] <= m.minAirChange + 1e-12) atMin++;
  }
  return { meanYear: sum / HOURS, meanHeating: nH ? sumH / nH : NaN, minShareHeating: nH ? atMin / nH : NaN };
}

/** Senza CoolingInput nessun limite estivo: il riscaldamento resta quello del motore 0.1.x. */
export function simulateThermal(b: BuildingInput, s: ServiceInput, climate: ClimatePackage, cooling?: CoolingInput, upgrade?: EnvelopeUpgrade, heating?: HeatingControl): ThermalResult {
  const env = buildEnvelope(b, s, climate, upgrade);
  const errors = [...env.errors];
  const empty = {
    ok: false,
    errors,
    notes: env.notes,
    envelope: env,
    qHeat: [],
    tIndoor: [],
    tMass: [] as number[],
    airChange: [] as number[],
    unheatedSpaces: [],
    heatNeed_kWh: NaN,
    peak_W: NaN,
    recoveryPeak_W: NaN,
    recovery: [] as boolean[],
    recoveryBudget_Wh: [] as number[],
    qCool: [] as number[],
    tMax: [] as number[],
    coolNeed_kWh: NaN,
    coolPeak_W: NaN,
    coolHours: 0,
    cycles: 0,
    converged: false,
  };
  if (errors.length) return empty;

  const tAir = climate.series.tAir;
  const mask = seasonMask(s);
  const tSet = s.setpoint.value;
  const split = exchangeSplit(env, climate);
  const Hms = H_MS * env.Am;
  // condizioni di applicabilità della rete (CORREZIONE-MOTORE.md §7.2): errore esplicito invece di un'eccezione nel passo
  for (let h = 0; h < HOURS; h++) {
    if (!(split.op.H[h] < Hms)) {
      errors.push("Dispersioni degli opachi troppo alte rispetto alla massa della casa: il modello a due nodi non si applica.");
      return { ...empty, errors };
    }
    if (surfaceShare(env.Am, env.Af, split.w.H[h]) < 0) {
      errors.push("Finestre troppo grandi rispetto alla casa per il modello a due nodi.");
      return { ...empty, errors };
    }
  }
  const xh = (h: number): HourExchange => ({ Hve: split.ve.H[h], Bve: split.ve.B[h], Hw: split.w.H[h], Bw: split.w.B[h], Hop: split.op.H[h], Bop: split.op.B[h] });
  const hours = Array.from({ length: HOURS }, (_, h) => xh(h));
  const thetaMass = new Array<number>(HOURS).fill(0);
  const qHeat = new Array<number>(HOURS).fill(0);
  const qCoolSensible = new Array<number>(HOURS).fill(0);
  const tIndoor = new Array<number>(HOURS).fill(0);
  const tAirIndoor = new Array<number>(HOURS).fill(0);
  // modo «tenuta»: ventilazione dell'ora dal ΔT con l'aria interna dell'ora precedente (CORREZIONE-MOTORE.md §13.2.2)
  const inf = env.infiltration;
  const wind = climate.series.wind;
  const airChange = new Array<number>(HOURS).fill(inf ? 0 : b.airChange.value);
  let tAirPrev = tSet;
  // i giorni di riscaldamento restano tali anche se il periodo estivo li tocca (possibile solo per chi non raffresca)
  const coolMask = cooling ? coolingMask(cooling).map((v, h) => v && !mask[h]) : null;
  const tMax = new Array<number>(HOURS).fill(NaN);
  if (cooling) for (let h = 0; h < HOURS; h++) if (coolMask![h]) tMax[h] = coolingLimit(tAir[h], cooling);
  const summerShade = cooling ? cooling.summerShading.value : 1;

  const converges = (e: number, prev: number) => {
    const dE = Number.isFinite(prev) ? Math.abs(e - prev) : Infinity;
    return e < 1 ? dE < 0.01 : dE / e < 0.005;
  };
  let t0 = tSet;
  let prevEnergy = NaN;
  let prevCool = NaN;
  let converged = false;
  let cycles = 0;
  let energy = 0;
  let cool = 0;
  for (cycles = 1; cycles <= 10; cycles++) {
    let t = t0;
    energy = 0;
    cool = 0;
    for (let h = 0; h < HOURS; h++) {
      const summer = coolMask !== null && coolMask[h];
      const solar = solarGainAtHour(env, climate, h, summer ? summerShade : 1);
      let x = hours[h];
      if (inf) {
        const n = hourlyAirChange(inf, tAirPrev - tAir[h], wind[h]);
        const Hve = (RHO_C_AIR * n * inf.volume) / 3600;
        x = { ...x, Hve, Bve: Hve * tAir[h] };
        airChange[h] = n;
      }
      const r = heating
        ? control5R1C(t, x, env.C, env.Am, env.Af, env.internalGainW, solar, heating.tSetHour[h], summer ? tMax[h] : null, typeof heating.pMax_W === "number" ? heating.pMax_W : heating.pMax_W[h])
        : control5R1C(t, x, env.C, env.Am, env.Af, env.internalGainW, solar, mask[h] ? tSet : null, summer ? tMax[h] : null);
      qHeat[h] = r.qHeat;
      qCoolSensible[h] = r.qCool;
      tIndoor[h] = r.nodes.thetaOp;
      tAirIndoor[h] = r.nodes.thetaAir;
      thetaMass[h] = r.nodes.thetaMEnd;
      tAirPrev = r.nodes.thetaAir;
      energy += (r.qHeat * DT) / 3.6e6;
      cool += (r.qCool * DT) / 3.6e6;
      t = r.nodes.thetaMEnd;
    }
    const dT = Math.abs(t - t0);
    t0 = t;
    if (dT < 0.01 && converges(energy, prevEnergy) && converges(cool, prevCool)) {
      converged = true;
      break;
    }
    prevEnergy = energy;
    prevCool = cool;
  }
  if (!converged) {
    errors.push("Warm-up non convergente in 10 cicli: nessun risultato quantitativo.");
    return { ...empty, errors, cycles: 10 };
  }
  for (const v of qHeat) if (!Number.isFinite(v)) return { ...empty, errors: ["Risultato termico non finito."] };
  const recovery = recoveryMask(mask);
  if (heating) recovery.fill(false);
  const recoveryBudget = new Array<number>(HOURS).fill(0);
  for (let h = 0; h < HOURS; h++) {
    const prev = (h - 1 + HOURS) % HOURS;
    if (recovery[h] && !recovery[prev]) recoveryBudget[h] = (Math.max(0, env.C * (tSet - thetaMass[prev])) / 3600) * 1.0001;
  }
  let peak = 0;
  let recoveryPeak = 0;
  for (let h = 0; h < HOURS; h++) {
    if (recovery[h]) recoveryPeak = Math.max(recoveryPeak, qHeat[h]);
    else peak = Math.max(peak, qHeat[h]);
  }
  const latent = cooling ? cooling.latentFactor.value : 1;
  const qCool = qCoolSensible.map((q) => q * latent);
  let coolPeak = 0;
  for (const q of qCool) if (q > coolPeak) coolPeak = q;
  for (const v of qCool) if (!Number.isFinite(v)) return { ...empty, errors: ["Risultato termico estivo non finito."] };
  const unheatedSpaces = env.exchanges.filter((e) => e.unheated).map((e) => {
    const u = e.unheated!;
    const heatingTemperatures = mask.map((active, h) => {
      if (!active) return NaN;
      let teq = tAir[h];
      if (e.attic) {
        const { he, hre } = exteriorCoefficients(tAir[h], climate.series.wind[h]);
        teq += e.attic.share * (solAirTemp(tAir[h], climate.series.ghi[h], e.attic, he, hre) - tAir[h]);
      }
      return (u.Hiu * tAirIndoor[h] + u.Hue * teq) / (u.Hiu + u.Hue);
    }).filter(Number.isFinite);
    return { id: u.id, bToday: u.bToday, bAfter: u.Hue / (u.Hiu + u.Hue), meanHeatingTemperature: heatingTemperatures.reduce((a, v) => a + v, 0) / Math.max(1, heatingTemperatures.length) };
  });
  return {
    ok: true,
    errors,
    notes: env.notes,
    envelope: env,
    qHeat,
    tIndoor,
    tMass: thetaMass,
    airChange,
    unheatedSpaces,
    heatNeed_kWh: energy,
    peak_W: peak,
    recoveryPeak_W: recoveryPeak,
    recovery,
    recoveryBudget_Wh: recoveryBudget,
    qCool,
    tMax,
    coolNeed_kWh: cool * latent,
    coolPeak_W: coolPeak,
    coolHours: coolMask ? coolMask.filter(Boolean).length : 0,
    cycles,
    converged,
    ...(heating ? { schedule: scheduleSummary(s, mask, tIndoor, qHeat, heating) } : {}),
  };
}

// Ipotesi dichiarata (§17.2.3): margine della caldaia sul picco continuo della casa attuale, prima della taratura.
export const ESTIMATED_HEATING_POWER_FACTOR = 1.5;

export function defaultHeatingSchedule(): HeatingSchedule {
  const source = "Ipotesi dichiarata: docs/validazione/CORREZIONE-MOTORE.md §17 (12/11/2026)";
  return { mode: "fasce", bands: [{ start: 6, end: 9 }, { start: 17, end: 23 }], setback: "spento",
    setbackTemp: q(16, "ipotizzato", source, "2026-11-12"), maxPowerKw: q(10, "sconosciuto", source, "2026-11-12"), withHeatPump: "continuo" };
}

export interface HeatingControl { tSetHour: (number | null)[]; pMax_W: number | number[] }
export interface ScheduleResult {
  hoursPerDay: number;
  bandHours: number;
  meanBandTemp: number;
  meanOutsideTemp: number | null; // null se la fascia copre tutte le 24 ore
  coldHours: number;
  pMax_W: number | null; // null se nelle ore con fabbisogno non c'è una potenza finita
  estimated: boolean;
}

/** Le fasce si leggono nell'ora civile, con l'ora legale, e solo nella stagione dichiarata. */
export function scheduledHeating(s: ServiceInput, pMax_W: number | number[]): HeatingControl {
  const schedule = s.schedule!;
  return { pMax_W, tSetHour: seasonMask(s).map((active, h) => !active ? null
    : schedule.bands.some((b) => localHour(h) >= b.start && localHour(h) < b.end) ? s.setpoint.value
    : schedule.setback === "ridotta" ? schedule.setbackTemp.value : null) };
}

function scheduleSummary(s: ServiceInput, mask: boolean[], temps: number[], heat: number[], heating: HeatingControl): ScheduleResult {
  const schedule = s.schedule;
  const power = heating.pMax_W;
  const bandAt = (h: number) => schedule ? schedule.bands.some((b) => localHour(h) >= b.start && localHour(h) < b.end) : heating.tSetHour[h] === s.setpoint.value;
  let bandHours = 0, outsideHours = 0, bandTemp = 0, outsideTemp = 0, coldHours = 0;
  let minPower = Infinity;
  for (let h = 0; h < HOURS; h++) {
    if (heat[h] > 0) minPower = Math.min(minPower, typeof power === "number" ? power : power[h]);
    if (!mask[h]) continue;
    if (bandAt(h)) {
      bandHours++; bandTemp += temps[h];
      if (temps[h] < s.setpoint.value - 0.5) coldHours++;
    } else { outsideHours++; outsideTemp += temps[h]; }
  }
  return { hoursPerDay: schedule ? schedule.bands.reduce((sum, b) => sum + b.end - b.start, 0) : new Set(mask.flatMap((active, h) => active && bandAt(h) ? [localHour(h)] : [])).size, bandHours,
    meanBandTemp: bandHours ? bandTemp / bandHours : 0, meanOutsideTemp: outsideHours ? outsideTemp / outsideHours : null,
    coldHours, pMax_W: typeof power === "number" ? power : Number.isFinite(minPower) ? minPower : null, estimated: typeof power === "number" && schedule?.maxPowerKw.status === "sconosciuto" };
}

/** Il picco a potenza limitata non dimensiona l'impianto: si conserva quello della stessa casa in continuo. */
export function withContinuousPeaks(t: ThermalResult, continuous: ThermalResult): ThermalResult {
  return { ...t, peak_W: continuous.peak_W, recoveryPeak_W: continuous.recoveryPeak_W };
}
