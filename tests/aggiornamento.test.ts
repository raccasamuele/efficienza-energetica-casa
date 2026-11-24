// Inventario dei dati da tenere aggiornati (aggiornamento/fonti.json): coerente con il codice e non in ritardo.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INCENTIVE_PRESETS, exampleProject } from "../src/engine";
import arera from "../src/engine/data/profili-arera.json";

const root = resolve(__dirname, "..");
interface Entry {
  id: string;
  descrizione: string;
  dove: string[];
  valori: { percorso: string; valore: number; unita: string }[];
  fonte: string;
  url: string;
  ultimo_controllo: string;
  frequenza_mesi: number;
  come_controllare: string;
  se_cambia: string;
  soglia_pct?: number;
  automatico: boolean;
  licenza?: string;
}
const inv = JSON.parse(readFileSync(resolve(root, "aggiornamento/fonti.json"), "utf8")) as { versione: number; frequenza_routine_mesi: number; fonti: Entry[] };

const get = (o: unknown, path: string) => path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)?.[k], o);
const monthsLater = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d;
};

describe("Inventario delle fonti da aggiornare", () => {
  it("i profili ARERA hanno controllo annuale manuale e provenienza coerente con i dati", () => {
    const entry = inv.fonti.find((f) => f.id === "arera-profili-elettrici")!;
    expect(entry).toBeDefined();
    expect(entry.frequenza_mesi).toBe(12); expect(entry.automatico).toBe(false);
    expect(entry.ultimo_controllo).toBe(arera.acquiredAt); expect(entry.url).toBe(arera.url);
    expect(entry.licenza).toBe(arera.licence); expect(entry.fonte).toBe(arera.source);
    expect(entry.dove).toContain("src/engine/data/profili-arera.json");
    expect(entry.dove).toContain("scripts/data/build_profili_elettrici.py");
    expect(entry.dove).toContain("data/sources/arera-profili/arera-profili-source.json");
  });
  it("è ben formato: id unici, date valide, frequenze positive, istruzioni presenti", () => {
    expect(inv.versione).toBe(1);
    expect(new Set(inv.fonti.map((f) => f.id)).size).toBe(inv.fonti.length);
    for (const f of inv.fonti) {
      expect(f.id).toMatch(/^[a-z0-9-]+$/);
      expect(f.ultimo_controllo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(f.ultimo_controllo).getTime())).toBe(false);
      expect(new Date(`${f.ultimo_controllo}T00:00:00Z`).getTime()).toBeLessThanOrEqual(Date.now());
      expect(f.frequenza_mesi).toBeGreaterThan(0);
      expect(f.fonte.length).toBeGreaterThan(10);
      expect(f.come_controllare.length).toBeGreaterThan(20);
      expect(f.se_cambia.length).toBeGreaterThan(10);
      expect(typeof f.automatico).toBe("boolean");
    }
  });

  it("i file indicati esistono", () => {
    for (const f of inv.fonti) for (const p of f.dove) expect(existsSync(resolve(root, p)), `${f.id}: ${p}`).toBe(true);
  });

  it("i valori dell'inventario sono quelli del codice", () => {
    const p = exampleProject();
    for (const f of inv.fonti) for (const v of f.valori) expect(v.percorso.startsWith("incentivi.") ? get({ incentivi: Object.fromEntries(INCENTIVE_PRESETS.map((r) => [r.id, r])) }, v.percorso) : get(p, v.percorso), `${f.id}: ${v.percorso}`).toBe(v.valore);
  });

  it("nessuna voce è in ritardo di oltre tre mesi rispetto alla sua frequenza", () => {
    // se fallisce, la routine trimestrale non è passata o la pull request non è stata accolta: vedi aggiornamento/ISTRUZIONI.md
    const late = inv.fonti.filter((f) => monthsLater(f.ultimo_controllo, f.frequenza_mesi + 3).getTime() < Date.now()).map((f) => f.id);
    expect(late).toEqual([]);
  });

  it("lo script segna da controllare le voci che scadono prima della routine successiva", () => {
    const out = JSON.parse(execFileSync(process.execPath, ["aggiornamento/scadute.mjs", "--tutte", "--oggi", "2027-01-05"], { cwd: root, encoding: "utf8" }));
    expect(out.prossimo_controllo).toBe("2027-04-05");
    expect(out.voci).toHaveLength(inv.fonti.length);
    for (const v of out.voci) expect(v.da_controllare, v.id).toBe(v.scade < "2027-04-05");
  });
});
