import { describe, expect, it } from "vitest";
import { exteriorCoefficients, hourlyU, windowExteriorConvection } from "../src/engine/thermal";

// Motore 0.8.0: convezione esterna dei vetri (CORREZIONE-MOTORE.md §9).
describe("Convezione esterna dei vetri (MoWiTT)", () => {
  const { hre } = exteriorCoefficients(5, 0);

  it("senza vento resta solo la convezione naturale, sotto i 4 W/m²K della UNI EN ISO 6946", () => {
    const h = windowExteriorConvection(5, 0, 2.8, hre);
    expect(h).toBeGreaterThan(0.5);
    expect(h).toBeLessThan(4);
  });

  it("col vento: media di sopravento e sottovento, con la convezione naturale in quadratura", () => {
    const v = 0.5 * 4; // vento locale con 4 m/s a 10 m
    const hf = 0.5 * (3.26 * v ** 0.89 + 3.55 * v ** 0.617);
    const h = windowExteriorConvection(5, 4, 2.8, hre);
    expect(h).toBeGreaterThan(hf);
    expect(h).toBeLessThan(hf + 2);
    expect(h).toBeLessThan(4 + 4 * v); // più bassa della formula 4 + 4v
  });

  it("cresce col vento e la U dell'ora dei vetri resta sotto quella dichiarata", () => {
    let prev = 0;
    for (const w of [0, 1, 2, 4, 8, 15]) {
      const h = windowExteriorConvection(0, w, 2.8, hre);
      expect(h).toBeGreaterThan(prev);
      prev = h;
      expect(hourlyU(2.8, h + hre)).toBeLessThan(2.8);
    }
  });
});
