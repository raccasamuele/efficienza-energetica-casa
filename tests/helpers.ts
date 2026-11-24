import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HOURS, unpackClimate, type ClimatePackage } from "../src/engine/climate";
import { exampleProject } from "../src/engine/example";
import type { ProjectInput } from "../src/engine/types";

export function loadPackage(id: string): ClimatePackage {
  const p = resolve(__dirname, `../public/data/packages/${id}.json`);
  return unpackClimate(JSON.parse(readFileSync(p, "utf-8"))) as ClimatePackage;
}

/** Pacchetto del capoluogo di Milano (codice ISTAT 015146). */
export function loadMilano(): ClimatePackage {
  return loadPackage("015146");
}

/** Pacchetto con dati correnti ma senza la correzione termica 0.15.0, per fixture storiche successive al 0.13.0. */
export function loadClimateUncorrected(id: string): ClimatePackage {
  const p = resolve(__dirname, `../public/data/packages/${id}.json`);
  return unpackClimate(JSON.parse(readFileSync(p, "utf-8")), { temperatureCorrection: false }) as ClimatePackage;
}

/** Pacchetto storico senza IAM angolare, per le fixture dei motori precedenti al 0.13.0. */
export function loadMilanoLegacy(): ClimatePackage {
  const climate = unpackClimate(JSON.parse(readFileSync(resolve(__dirname, "../public/data/packages/015146.json"), "utf-8")), { temperatureCorrection: false }) as ClimatePackage;
  const { facadeGlazing: _facadeGlazing, ...series } = climate.series;
  return { ...climate, series };
}

export function readPublicJson(rel: string): unknown {
  return JSON.parse(readFileSync(resolve(__dirname, `../public/data/${rel}`), "utf-8"));
}

/**
 * Casa d'esempio che raffresca con split e ha ventilconvettori: base dei test estivi. La PDC è parametrica
 * (reversibile): la macchina di catalogo dell'esempio non ha dati di raffrescamento.
 */
export function coolingProject(): ProjectInput {
  const p = exampleProject();
  p.cooling.today = "split";
  p.system.emitters = "ventilconvettori";
  p.heatPump.model = "parametrico";
  return p;
}

/** Clima sintetico costante, utile per casi con soluzione nota. */
export function constantClimate(tAir: number, facade = 0, pv = 0): ClimatePackage {
  const s = (v: number) => new Array<number>(HOURS).fill(v);
  return {
    manifest: { schemaVersion: 1, climateId: "test", name: "test", latitude: 45, longitude: 9, elevation_m: 100 } as ClimatePackage["manifest"],
    series: {
      tAir: s(tAir),
      wind: s(1),
      ghi: s(0),
      facade: { N: s(facade), E: s(facade), S: s(facade), O: s(facade) },
      pvAc: { E20: s(pv), E35: s(pv), S20: s(pv), S35: s(pv), O20: s(pv), O35: s(pv) },
    },
  };
}

/**
 * Regime della rete 5R1C (UNI EN ISO 13790, appendice C) risolto a mano: temperatura operante fissata, potenza
 * all'aria incognita. Controlla la soluzione della rete (Crank-Nicolson e forme riscritte del motore) con una
 * risoluzione diretta del sistema lineare. Ripartizione degli apporti e Htr,em sono copiati dalla norma come nel
 * motore: un errore di trascrizione di quei coefficienti non si vedrebbe qui (revisione Codex, 8/11/2026).
 */
export function steady5R1C(x: { Hve: number; Bve: number; Hw: number; Bw: number; Hop: number; Bop: number }, Am: number, Af: number, phiInt: number, phiSol: number, tOp: number) {
  const Atot = 4.5 * Af, Htris = 3.45 * Atot, Hms = 9.1 * Am;
  const Hem = 1 / (1 / x.Hop - 1 / Hms);
  const tSup = x.Bve / x.Hve, tW = x.Bw / x.Hw, tOpE = x.Bop / x.Hop;
  const rest = 0.5 * phiInt + phiSol;
  const phiIa = 0.5 * phiInt, phiM = (Am / Atot) * rest, phiSt = (1 - Am / Atot - x.Hw / (9.1 * Atot)) * rest;
  // incognite: θair, θs, θm, Φ
  const A = [
    [-(Htris + x.Hve), Htris, 0, 1, -(x.Hve * tSup + phiIa)],
    [Htris, -(Htris + Hms + x.Hw), Hms, 0, -(x.Hw * tW + phiSt)],
    [0, Hms, -(Hms + Hem), 0, -(Hem * tOpE + phiM)],
    [0.5, 0.5, 0, 0, tOp],
  ];
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < 4; r++) if (r !== i) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < 5; c++) A[r][c] -= f * A[i][c];
    }
  }
  const v = A.map((row, i) => row[4] / row[i]);
  return { thetaAir: v[0], thetaS: v[1], thetaM: v[2], phi: v[3], Hem };
}
