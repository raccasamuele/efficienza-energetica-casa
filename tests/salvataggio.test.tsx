import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OPAQUE_U_VARIATION,
  checkProject,
  defaultVariants,
  exampleProject,
  inactiveOutOfRange,
  parseProjectFile,
  toProjectFile,
  type ProjectInput,
} from "../src/engine";
import { QuickEnvelope } from "../src/ui/quick";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const text = (p: ProjectInput) => JSON.stringify(toProjectFile(p, milano));

/** Rilievo ad aree appena iniziato: solo la parete nord compilata. */
function partialSurvey(walls: Partial<Record<"N" | "E" | "S" | "O", number>> = {}): ProjectInput {
  const p = exampleProject();
  p.mode = "documentata";
  p.building.geometryMode = "aree";
  for (const o of ["N", "E", "S", "O"] as const) p.building.wallArea[o].value = walls[o] ?? 0;
  return p;
}

describe("R1 — la bozza di un rilievo incompleto si riapre", () => {
  it("l'importazione rigorosa rifiuta il rilievo incompleto, la bozza lo riapre con tutti i dati", () => {
    const p = partialSurvey();
    p.building.upperArea.value = 61.5;
    expect(checkProject(p).some((i) => i.severity === "errore")).toBe(true);
    expect(parseProjectFile(text(p), null).file).toBeUndefined();
    const r = parseProjectFile(text(p), null, undefined, { draft: true });
    expect(r.errors).toEqual([]);
    expect(r.file?.input.building.geometryMode).toBe("aree");
    expect(r.file?.input.building.upperArea.value).toBe(61.5);
    expect(r.incomplete.length).toBeGreaterThan(0);
  });

  it("un valore fuori intervallo appena digitato resta nella bozza ed è segnalato", () => {
    const p = partialSurvey({ N: 40 });
    p.building.uWall.value = 9;
    const r = parseProjectFile(text(p), null, undefined, { draft: true });
    expect(r.file?.input.building.uWall.value).toBe(9);
    expect(r.incomplete.join(" ")).toContain("U pareti");
  });

  it("la bozza resta protetta da struttura, tipi, valori ammessi e numeri non finiti", () => {
    const p = partialSurvey();
    const bad = [
      text(p).replace('"geometryMode":"aree"', '"geometryMode":"cerchio"'),
      text(p).replace(/"floorArea":\{"value":120/, '"floorArea":{"value":"120"'),
      text(p).replace(/"floorArea":\{"value":120/, '"floorArea":{"value":1e400'),
      "{non json",
    ];
    for (const t of bad) {
      const r = parseProjectFile(t, null, undefined, { draft: true });
      expect(r.file, t.slice(0, 40)).toBeUndefined();
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("R2 — ciò che si esporta si reimporta", () => {
  it("U inferiore fuori intervallo resa inattiva dal confine riscaldato: conservata con avviso", () => {
    const p = exampleProject();
    p.building.uLower.value = 0.05;
    p.building.lower = "riscaldato";
    expect(checkProject(p).filter((i) => i.severity === "errore")).toEqual([]);
    expect(inactiveOutOfRange(p).map((x) => x.path)).toEqual(["building.uLower"]);
    const r = parseProjectFile(text(p), milano);
    expect(r.errors).toEqual([]);
    expect(r.file?.input.building.uLower.value).toBe(0.05);
    expect(r.warnings.join(" ")).toContain("U confine inferiore");
  });

  it("lo stesso valore in un campo attivo resta un errore all'importazione", () => {
    const p = exampleProject();
    p.building.uLower.value = 0.05;
    p.building.lower = "nonRiscaldato";
    expect(parseProjectFile(text(p), milano).file).toBeUndefined();
  });

  it("andata e ritorno dopo cambi di geometria, confini e modello PDC con dati inattivi fuori intervallo", () => {
    const steps: ((p: ProjectInput) => void)[] = [
      (p) => { p.building.geometryMode = "aree"; p.building.slabThickness.value = 5; p.building.wallArea.N.value = 50; p.building.wallArea.S.value = 50; p.building.wallArea.E.value = 30; p.building.wallArea.O.value = 30; },
      // tornando alla forma lo spessore del solaio si riattiva: va corretto, mentre le aree restano inattive
      (p) => { p.building.geometryMode = "forma"; expect(checkProject(p).some((i) => i.message.startsWith("Spessore solaio"))).toBe(true); p.building.slabThickness.value = 0.3; p.building.wallArea.N.value = 9999; },
      (p) => { p.building.lower = "riscaldato"; p.building.uLower.value = 99; p.building.lowerArea.value = -3; },
      (p) => { p.building.upper = "riscaldato"; p.building.upperArea.value = 5000; },
      (p) => { p.heatPump.model = p.heatPump.model === "catalogo" ? "parametrico" : "catalogo"; },
    ];
    const p = exampleProject();
    let checked = 0;
    let withInactive = 0;
    for (const step of steps) {
      step(p);
      if (checkProject(p).some((i) => i.severity === "errore")) continue; // l'esportazione sarebbe sospesa
      checked++;
      if (inactiveOutOfRange(p).length) withInactive++;
      const r = parseProjectFile(text(p), milano);
      expect(r.errors, JSON.stringify(inactiveOutOfRange(p))).toEqual([]);
      expect(r.file?.input).toEqual(p);
      for (const x of inactiveOutOfRange(p)) expect(r.warnings.join(" ")).toContain(x.label);
    }
    expect(checked).toBe(steps.length);
    expect(withInactive).toBeGreaterThanOrEqual(3);
  });
});

describe("R3 — la guida della Rapida descrive la sensibilità eseguita", () => {
  it("la percentuale delle U opache è la stessa nelle varianti e nel testo", () => {
    const pct = `${Math.round(OPAQUE_U_VARIATION * 100)}%`;
    const labels = defaultVariants(exampleProject()).map((v) => v.label);
    expect(labels).toContain(`U opache +${pct}`);
    expect(labels).toContain(`U opache −${pct}`);
    const html = renderToStaticMarkup(<QuickEnvelope p={exampleProject()} up={() => {}} />);
    expect(html).toContain(`U ±${pct}`);
    expect(html).not.toContain("±25%");
  });
});
