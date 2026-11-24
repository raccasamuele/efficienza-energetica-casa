import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isClimateId, parseComuni, prepareClimate, type ClimateIndexEntry, type ClimatePackage, type Comune, type DegreeDaysFile } from "../src/engine";

/**
 * Dati pubblici del sito letti dal disco (`public/data` del repository): pacchetti del clima, gradi giorno, comuni.
 * Niente rete: la cartella la indica chi avvia il server.
 */
export function createData(dir: string) {
  const climates = new Map<string, ClimatePackage>();
  let comuni: Comune[] | undefined;
  let degrees: DegreeDaysFile | null | undefined;
  let index: ClimateIndexEntry[] | undefined;
  const readJson = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf-8"));

  return {
    dir,
    /** Anagrafe dei comuni; undefined se il file manca (come nel sito, il progetto si apre con un avviso). */
    comuni(): Comune[] | undefined {
      if (comuni === undefined && existsSync(join(dir, "comuni.json"))) comuni = parseComuni(readJson("comuni.json"));
      return comuni?.length ? comuni : undefined;
    },
    /** Indice dei pacchetti del clima, per scegliere il capoluogo di un comune. */
    index(): ClimateIndexEntry[] | undefined {
      if (index === undefined && existsSync(join(dir, "packages", "index.json"))) {
        const d = readJson(join("packages", "index.json")) as { climates?: ClimateIndexEntry[] };
        index = Array.isArray(d.climates) ? d.climates : [];
      }
      return index?.length ? index : undefined;
    },
    /** Il pacchetto clima del capoluogo, preparato come nel sito. */
    climate(climateId: string): { climate?: ClimatePackage; error?: string } {
      if (!isClimateId(climateId)) return { error: `Clima «${String(climateId).slice(0, 20)}» non valido.` };
      const cached = climates.get(climateId);
      if (cached) return { climate: cached };
      const file = join("packages", `${climateId}.json`);
      if (!existsSync(join(dir, file))) return { error: `Clima ${climateId} non trovato nella cartella dei dati.` }; // senza il percorso: la risposta va al servizio dell'agente
      if (degrees === undefined) degrees = existsSync(join(dir, "gradi-giorno.json")) ? readJson("gradi-giorno.json") as DegreeDaysFile : null;
      const { climate, errors } = prepareClimate(readJson(file), degrees, climateId);
      if (errors.length) return { error: `Pacchetto clima non valido: ${errors.slice(0, 3).join("; ")}` };
      climates.set(climateId, climate);
      return { climate };
    },
  };
}

export type Data = ReturnType<typeof createData>;
