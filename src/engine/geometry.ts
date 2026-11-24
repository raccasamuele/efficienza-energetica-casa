import type { BuildingInput, Orientation, Shape } from "./types";

export const ORIENTATIONS: Orientation[] = ["N", "E", "S", "O"];

/**
 * Perimetro di un'impronta di area A per le forme semplici:
 * quadrata; rettangolare 2:1; L = 3 quadrati di lato s (area 3s², perimetro 8s);
 * ferro di cavallo = 5 quadrati (area 5s², perimetro 12s).
 */
export function footprintPerimeter(shape: Shape, area: number): number {
  switch (shape) {
    case "quadrata":
      return 4 * Math.sqrt(area);
    case "rettangolare":
      return 3 * Math.sqrt(2 * area);
    case "L":
      return 8 * Math.sqrt(area / 3);
    case "ferroCavallo":
      return 12 * Math.sqrt(area / 5);
  }
}

/**
 * Trasmittanza equivalente di un pavimento su terreno, semplificazione stazionaria ispirata a UNI EN ISO 13370:2018.
 * Parte periodica trascurata; applicazione conforme delle appendici D e NA:2025 non verificata.
 * (λ terreno 2,0 W/mK, Rsi 0,17, Rse 0,04 m²K/W, spessore pareti 0,3 m). uFloor è la U del solo pacchetto di pavimento.
 */
export function groundEquivalentU(uFloor: number, area: number, exposedPerimeter: number): number {
  const lambda = 2.0;
  const rsi = 0.17;
  const rse = 0.04;
  const w = 0.3;
  const rf = Math.max(0, 1 / uFloor - rsi - rse);
  const dt = w + lambda * (rsi + rf + rse);
  const B = area / (0.5 * exposedPerimeter);
  return dt < B ? ((2 * lambda) / (Math.PI * B + dt)) * Math.log((Math.PI * B) / dt + 1) : lambda / (0.457 * B + dt);
}

/** Quota di pareti verticali confinante con altre unità. */
export function adjacentWallShare(sides: BuildingInput["sides"]): number {
  return sides === "isolato" ? 0 : sides === "unLato" ? 0.25 : 0.5;
}

export interface Geometry {
  derived: boolean;
  footprint: number;
  perimeter: number;
  grossWall: number;
  volume: number;
  windows: Record<Orientation, number>;
  externalWall: Record<Orientation, number>;
  adjacentWall: number;
  upperArea: number;
  lowerArea: number;
  exposedPerimeter: number; // perimetro del pavimento verso l'esterno (per EN ISO 13370)
  notes: string[];
  errors: string[];
}

export function computeGeometry(b: BuildingInput): Geometry {
  const errors: string[] = [];
  const notes: string[] = [];
  const floorArea = b.floorArea.value;
  const floors = Math.max(1, Math.round(b.floors.value));
  const footprint = floorArea / floors;
  const volume = floorArea * b.netStoreyHeight.value;
  const measuredPerimeter = b.exposedPerimeter.status !== "sconosciuto";
  const exposed = (estimated: number) => {
    if (measuredPerimeter) return b.exposedPerimeter.value;
    if (b.lower === "terreno") notes.push(b.geometryMode === "aree"
      ? "Perimetro esposto non rilevato: ipotesi di quadrato equivalente, ridotto del 25%/50% per una/due adiacenze; in sensibilità geometrica."
      : "Perimetro esposto stimato dalla forma, ridotto del 25%/50% per una/due adiacenze; in sensibilità geometrica.");
    return estimated;
  };
  const zero = { N: 0, E: 0, S: 0, O: 0 };

  const windows: Record<Orientation, number> = { ...zero };
  if (b.windowMode === "frazione") {
    const total = b.windowFraction.value * floorArea;
    for (const o of ORIENTATIONS) windows[o] = total / 4;
    notes.push("Finestre ripartite in parti uguali sui quattro orientamenti (ipotesi della modalità a frazione).");
  } else {
    for (const o of ORIENTATIONS) windows[o] = b.windowArea[o].value;
  }

  if (b.geometryMode === "forma") {
    const perimeter = footprintPerimeter(b.shape, footprint);
    const grossWall = perimeter * floors * (b.netStoreyHeight.value + b.slabThickness.value);
    const adjacentWall = grossWall * adjacentWallShare(b.sides);
    const externalGross = grossWall - adjacentWall;
    const externalWall: Record<Orientation, number> = { ...zero };
    for (const o of ORIENTATIONS) {
      externalWall[o] = externalGross / 4 - windows[o];
      if (externalWall[o] < 0) errors.push(`Finestre ${o} più grandi della parete esterna ricavata dalla forma.`);
    }
    notes.push("Aree stimate da forma, superficie, piani e altezza: stato «ipotizzato» finché non si inseriscono aree nette da rilievo.");
    return {
      derived: true,
      footprint,
      perimeter,
      grossWall,
      volume,
      windows,
      externalWall,
      adjacentWall,
      upperArea: footprint,
      lowerArea: footprint,
      exposedPerimeter: exposed(perimeter * (1 - adjacentWallShare(b.sides))),
      notes,
      errors,
    };
  }

  const externalWall: Record<Orientation, number> = { ...zero };
  for (const o of ORIENTATIONS) externalWall[o] = b.wallArea[o].value;
  notes.push("Aree nette opache inserite: le finestre non vengono sottratte di nuovo.");
  const adjacentWall = b.sides === "isolato" ? 0 : b.adjacentWallArea.value;
  const wallTotal = ORIENTATIONS.reduce((s, o) => s + externalWall[o], 0);
  if (b.sides === "isolato" && wallTotal <= 0) errors.push("Casa isolata senza pareti esterne opache: verificare l'involucro.");
  if (b.sides === "isolato" && b.adjacentWallArea.value > 0) errors.push("Casa isolata con pareti confinanti: confini incoerenti.");
  if (b.sides !== "isolato" && adjacentWall <= 0) errors.push("Area delle pareti confinanti mancante, anche se l'adiacenza è riscaldata.");
  if (b.upper !== "riscaldato" && b.upperArea.value <= 0) errors.push("Area del confine superiore disperdente nulla.");
  if (b.lower !== "riscaldato" && b.lowerArea.value <= 0) errors.push("Area del confine inferiore disperdente nulla.");
  return {
    derived: false,
    footprint,
    perimeter: NaN,
    grossWall: NaN,
    volume,
    windows,
    externalWall,
    adjacentWall,
    upperArea: b.upperArea.value,
    lowerArea: b.lowerArea.value,
    exposedPerimeter: exposed(4 * Math.sqrt(Math.max(0, b.lowerArea.value)) * (1 - adjacentWallShare(b.sides))),
    notes,
    errors,
  };
}
