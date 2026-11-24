import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COOL_DOMAIN, HP_CATALOG, catalogCooling } from "../src/engine";

const reversible = HP_CATALOG.filter((m) => m.eer);
const PYTHON = resolve(__dirname, "../.venv/Scripts/python.exe");

describe("Catalogo PDC — raffrescamento hplib", () => {
  it("due macchine reversibili con parametri EER e P_el di raffrescamento", () => {
    expect(reversible).toHaveLength(2);
    for (const m of reversible) {
      expect(m.eer).toHaveLength(4);
      expect(m.pElC).toHaveLength(4);
      expect(m.pElCRef_W).toBeGreaterThan(0);
      expect(m.eerRef).toBeGreaterThan(1);
      expect(m.mapeCooling!.eer).toBeLessThanOrEqual(15);
      expect(m.mapeCooling!.pEl).toBeLessThanOrEqual(20);
    }
    expect(HP_CATALOG.slice(0, 6).every((m) => !m.eer)).toBe(true);
  });

  it("macchina senza parametri EER: nessuna prestazione estiva", () => {
    expect(catalogCooling(HP_CATALOG[0], 30, 7)).toBeNull();
  });

  it("dominio osservato aria 20–35 °C e mandata 7 o 18 °C", () => {
    const m = reversible[0];
    expect(COOL_DOMAIN).toEqual({ airMin: 20, airMax: 35, flows: [7, 18] });
    expect(catalogCooling(m, 30, 7)!.extrapolated).toBe(false);
    expect(catalogCooling(m, 38, 7)!.extrapolated).toBe(true);
    expect(catalogCooling(m, 30, 12)!.extrapolated).toBe(true);
    expect(catalogCooling(m, 30, 7)!.pThC_W).toBeGreaterThan(0);
  });

  // Il confronto chiede il Python di .venv (come le pipeline audit-b): sul server di pubblicazione non c'è e si salta.
  it.skipIf(!existsSync(PYTHON))("EER e potenza frigorifera uguali a hplib.simulate in modalità 2", () => {
    const grid = reversible.flatMap((m) =>
      [20, 25, 30, 35, 40].flatMap((air) => [7, 18].map((flow) => ({ id: m.id, csvRow: m.csvRow, air, flow, ...catalogCooling(m, air, flow)! }))),
    );
    expect(grid).toHaveLength(20);
    const dir = mkdtempSync(join(tmpdir(), "casa-eer-"));
    const file = join(dir, "griglia.json");
    writeFileSync(file, JSON.stringify(grid));
    const root = resolve(__dirname, "..");
    const out = execFileSync(PYTHON, ["-I", resolve(root, "tests/audit_cooling_hplib.py"), file], {
      cwd: root, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" }, timeout: 60000, stdio: "pipe",
    });
    expect(out).toContain(`OK ${grid.length} punti`);
  }, 65000);
});
