import type { ClimatePackage } from "./climate";
import { evaluate, type Evaluation } from "./scenarios";
import { runSensitivity } from "./sensitivity";
import { pathsWithStability } from "./percorsi";
import { compareQuotes } from "./preventivi";
import { resultDetails } from "./dettagli";
import { confrontaCase } from "../ui/case";
import type { CalculationRequest, EngineRequest, EngineResponse } from "./worker-protocol";

/** Stesso esecutore nel worker e nel ripiego. Le serie delle varianti non escono da qui. */
export function createEngineRuntime() {
  const climates = new Map<string, ClimatePackage>();
  let nominal: { key: string; value: Evaluation } | null = null;
  let samples: { key: string; values: Evaluation[] } | null = null;

  function calculate(request: CalculationRequest, send: (response: EngineResponse) => void): EngineResponse {
    const { id, type, input } = request;
    if (type === "compareHouses") return { id, type: "result", kind: type, result: confrontaCase(request.input.houses, request.input.goal, climates) };
    // Il confronto delle case non richiede un progetto singolo.
    if (!("project" in input)) throw new Error("Richiesta di calcolo non valida.");
    const climate = climates.get(input.climateId);
    if (!climate) throw new Error(`Clima non disponibile: ${input.climateId}`);
    const key = JSON.stringify([input.climateId, input.project]);
    if (type === "evaluate" || nominal?.key !== key) nominal = { key, value: evaluate(input.project, climate) };
    const ev = nominal.value;
    switch (request.type) {
      case "evaluate": return { id, type: "result", kind: "evaluate", result: ev };
      case "details": return { id, type: "result", kind: "details", result: resultDetails(input.project, climate, ev) };
      case "sensitivity": {
        samples = null;
        const values: Evaluation[] = [];
        const result = runSensitivity(input.project, climate, ev, request.input.only, (variantId, variant, index, total) => {
          values.push(variant);
          send({ id, type: "progress", progress: { variantId, index, total } });
        });
        samples = { key, values };
        return { id, type: "result", kind: "sensitivity", result };
      }
      case "paths": return { id, type: "result", kind: "paths", result: pathsWithStability(input.project, climate, ev, samples?.key === key ? samples.values : []) };
      case "quotes": return { id, type: "result", kind: "quotes", result: compareQuotes(input.project, climate, ev, request.input.kinds, new Date(request.input.today)) };
    }
  }

  return (request: EngineRequest, send: (response: EngineResponse) => void): void => {
    try {
      if (request.type === "climate") {
        climates.set(request.climate.manifest.climateId, request.climate);
        // Un clima di un'altra casa non invalida la sensibilità appena completata.
      } else send(calculate(request, send));
    } catch (error: unknown) {
      send({ id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };
}
