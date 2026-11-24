import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import arera from "../src/engine/data/profili-arera.json";
import { parseComuni } from "../src/engine/location";
import { readPublicJson } from "./helpers";

const root = resolve(__dirname, "..");
const manifestPath = "data/sources/arera-profili/arera-profili-source.json";
const archivePath = "data/sources/arera-profili/Dati_regione_2025.zip";
const outputPath = "src/engine/data/profili-arera.json";
const scriptPath = "scripts/data/build_profili_elettrici.py";
const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8")) as { sha256: string; bytes: number; url: string; page: string; acquiredAt: string; licence: string; filters: { anno: number; mercato: string; residenza: string; classi: string[] } };

describe("Pipeline offline dei profili ARERA", () => {
  it("conserva provenienza, filtri, licenza e hash dell'archivio acquisito", () => {
    expect(manifest.sha256).toBe("2b7e5b4dc5d61f60ad7a1935c113aafbb26d8a1b5b6a371f73dc084806e1603c");
    expect(arera.sha256).toBe(manifest.sha256);
    expect(arera.url).toBe(manifest.page); expect(arera.acquiredAt).toBe(manifest.acquiredAt);
    expect(arera.year).toBe(2025); expect(manifest.filters).toEqual({ anno: 2025, mercato: "Tutti", residenza: "Residente", classi: ["1.5<potenza_impegnata<=3", "3<potenza_impegnata<=4.5"] });
    expect(arera.licence).toBe("CC BY-SA 4.0"); expect(manifest.licence).toContain(arera.licence);
    expect(manifest.url).toBe("https://www.arera.it/fileadmin/allegati/dati/monitoraggioretail/Dati_regione_2025.zip");
    expect(readFileSync(resolve(root, outputPath)).byteLength).toBeLessThan(40000);
  });

  it("ha due classi e tre aree, ciascuna con 12×3×24 pesi positivi e media 1 entro l'arrotondamento", () => {
    expect(Object.keys(arera.profiles).sort()).toEqual(["fino3", "fino4_5"]);
    for (const power of Object.values(arera.profiles)) {
      expect(Object.keys(power).sort()).toEqual(["centro", "nord", "sud"]);
      for (const table of Object.values(power)) {
        expect(table).toHaveLength(12);
        for (const month of table) { expect(month).toHaveLength(3); for (const day of month) expect(day).toHaveLength(24); }
        const weights = table.flat(2);
        expect(weights.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
        expect(Math.abs(weights.reduce((s, v) => s + v, 0) / weights.length - 1)).toBeLessThan(5e-5);
      }
    }
  });

  it("ogni provincia dell'anagrafe ha un'area, isole comprese", () => {
    const sigle = [...new Set(parseComuni(readPublicJson("comuni.json")).map((c) => c.sigla))].sort();
    expect(Object.keys(arera.areaBySigla).sort()).toEqual(sigle);
    expect(Object.values(arera.areaBySigla).every((a) => ["nord", "centro", "sud"].includes(a))).toBe(true);
    expect(arera.areaBySigla.MI).toBe("nord"); expect(arera.areaBySigla.RM).toBe("centro");
    expect(arera.areaBySigla.BA).toBe("sud"); expect(arera.areaBySigla.PA).toBe("sud"); expect(arera.areaBySigla.CA).toBe("sud");
  });

  it.skipIf(!existsSync(resolve(root, archivePath)))("riproduce il file con Python, senza scrivere sui dati originali", () => {
    const raw = readFileSync(resolve(root, archivePath));
    expect(createHash("sha256").update(raw).digest("hex")).toBe(manifest.sha256);
    expect(raw.byteLength).toBe(manifest.bytes);
    const temp = mkdtempSync(resolve(tmpdir(), "casa-arera-"));
    try {
      for (const path of [scriptPath, manifestPath, archivePath, "public/data/comuni.json"]) {
        const dest = resolve(temp, path); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(resolve(root, path), dest);
      }
      mkdirSync(dirname(resolve(temp, outputPath)), { recursive: true });
      const result = execFileSync(resolve(root, ".venv/Scripts/python.exe"), [resolve(temp, scriptPath)], { cwd: temp, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" }, timeout: 120000 });
      expect(result).toContain("profili-arera.json");
      expect(readFileSync(resolve(temp, outputPath), "utf8")).toBe(readFileSync(resolve(root, outputPath), "utf8"));
      expect(readFileSync(resolve(temp, manifestPath), "utf8")).toBe(readFileSync(resolve(root, manifestPath), "utf8"));
    } finally {
      if (dirname(temp) !== resolve(tmpdir())) throw new Error("Cartella temporanea inattesa.");
      rmSync(temp, { recursive: true, force: true });
    }
  }, 125000);
});
