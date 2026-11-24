import { describe, expect, it, vi } from "vitest";
import { addQuote, compareQuotes, evaluate, evaluatePaths, exampleProject, pathNpvForVariant, runSensitivity, type Evaluation, type PathsResult } from "../src/engine";
import { confrontaCase } from "../src/ui/case";
import { createEngineClient, type EngineWorker } from "../src/ui/engine-client";
import { createEngineRuntime } from "../src/engine/worker-runtime";
import type { CalculationRequest, EngineRequest, EngineResponse } from "../src/engine/worker-protocol";
import { loadMilano } from "./helpers";

const project = exampleProject();
const input = { project, climateId: project.climateId };

class FakeWorker implements EngineWorker {
  messages: EngineRequest[] = [];
  onmessage: EngineWorker["onmessage"] = null;
  onerror: EngineWorker["onerror"] = null;
  terminate = vi.fn();
  postMessage(message: EngineRequest) { this.messages.push(structuredClone(message)); }
  reply(message: EngineResponse) { this.onmessage?.(new MessageEvent("message", { data: message })); }
  last(): CalculationRequest {
    const request = this.messages.at(-1);
    if (!request || request.type === "climate") throw new Error("Richiesta assente.");
    return request;
  }
}

describe("Cliente del motore", () => {
  it("scarta la risposta vecchia e conclude anche la promessa sostituita", async () => {
    const worker = new FakeWorker(), client = createEngineClient(() => worker);
    const old = client.request("evaluate", input).catch((error: unknown) => error);
    const oldId = worker.last().id;
    const current = client.request("evaluate", input);
    const currentId = worker.last().id;
    expect(currentId).toBeGreaterThan(oldId);
    const result = { ok: false } as Evaluation;
    worker.reply({ id: oldId, type: "result", kind: "evaluate", result });
    const resolved = vi.fn();
    void current.then(resolved);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    worker.reply({ id: currentId, type: "result", kind: "evaluate", result });
    expect(await old).toMatchObject({ name: "AbortError" });
    expect(await current).toEqual(result);
    client.dispose();
  });

  it("annulla senza promesse appese, anche prima dell'invio", async () => {
    const worker = new FakeWorker(), client = createEngineClient(() => worker);
    const controller = new AbortController();
    const result = client.request("evaluate", input, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    const sent = worker.messages.length;
    await expect(client.request("evaluate", input, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.messages).toHaveLength(sent);
    client.dispose();
  });

  it("propaga gli errori restituiti e quelli del worker", async () => {
    const worker = new FakeWorker(), client = createEngineClient(() => worker);
    const result = client.request("evaluate", input);
    worker.reply({ id: worker.last().id, type: "error", message: "Calcolo non riuscito" });
    await expect(result).rejects.toThrow("Calcolo non riuscito");
    const failure = client.request("evaluate", input);
    worker.onerror?.({ message: "Worker interrotto" } as ErrorEvent);
    await expect(failure).rejects.toThrow("Worker interrotto");
    client.dispose();
  });

  it("inoltra l'avanzamento solo alla sensibilità corrente", async () => {
    const worker = new FakeWorker(), client = createEngineClient(() => worker);
    const onProgress = vi.fn(), controller = new AbortController();
    const result = client.request("sensitivity", { ...input, only: null }, { onProgress, signal: controller.signal });
    const id = worker.last().id;
    const progress = { variantId: "gas+", index: 1, total: 12 };
    worker.reply({ id: id - 1, type: "progress", progress });
    expect(onProgress).not.toHaveBeenCalled();
    worker.reply({ id, type: "progress", progress });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(progress);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    client.dispose();
  });

  it("ricrea il worker per fermare la sensibilità, rimanda i climi e le altre richieste", async () => {
    const workers: FakeWorker[] = [];
    const client = createEngineClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
    const climate = loadMilano();
    client.climate(climate); client.climate(structuredClone(climate));
    const controller = new AbortController();
    const sensitivity = client.request("sensitivity", { ...input, only: null }, { signal: controller.signal });
    const comparison = client.request("compareHouses", { houses: { attiva: null, altre: [] }, goal: "completo" });
    const first = workers[0], oldHandler = first.onmessage;
    const comparisonId = first.last().id;
    expect(first.messages.filter((m) => m.type === "climate")).toHaveLength(1);
    controller.abort();
    await expect(sensitivity).rejects.toMatchObject({ name: "AbortError" });
    expect(first.terminate).toHaveBeenCalledOnce();
    const second = workers[1];
    expect(second.messages.filter((m) => m.type === "climate")).toHaveLength(1);
    expect(second.last().id).toBe(comparisonId);
    oldHandler?.(new MessageEvent<EngineResponse>("message", { data: { id: comparisonId, type: "result", kind: "compareHouses", result: [] } }));
    const rows = [{ id: "attiva", nome: "Casa", comune: "Milano", stato: "ok" as const }];
    second.reply({ id: comparisonId, type: "result", kind: "compareHouses", result: rows });
    expect(await comparison).toEqual(rows);
    client.dispose();
  });

  it("la chiusura conclude tutte le richieste pendenti", async () => {
    const client = createEngineClient(() => new FakeWorker());
    const evaluation = client.request("evaluate", input);
    const paths = client.request("paths", input);
    client.dispose();
    await expect(evaluation).rejects.toMatchObject({ name: "AbortError" });
    await expect(paths).rejects.toMatchObject({ name: "AbortError" });
  });

  it("il ripiego rinvia e consente di annullare prima del calcolo", async () => {
    const client = createEngineClient(() => { throw new Error("Worker non disponibile"); });
    const controller = new AbortController();
    const result = client.request("evaluate", input, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    client.dispose();
  });
});

/** Anche Infinity, NaN e undefined passano senza trasformazioni: niente serializzazione JSON. */
function checkPlain(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") {
    if (!["undefined", "string", "number", "boolean"].includes(typeof value) && value !== null) throw new Error(`Dato non semplice: ${typeof value}`);
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Oggetto non semplice.");
  for (const entry of Object.values(value)) checkPlain(entry, visited);
}

// Copia indipendente del calcolo della stabilità che era in App.tsx.
function directPaths(ev: Evaluation, samples: Evaluation[]): PathsResult {
  const result = evaluatePaths(project, loadMilano(), ev);
  const shown = [...result.proposed, ...(result.custom ? [result.custom] : [])];
  const ranges = shown.map((path) => {
    const values = samples.map((v) => pathNpvForVariant(project, v, path));
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: path.npv, max: path.npv };
  });
  shown.forEach((path, i) => {
    const best = samples.filter((v) => {
      const npvs = shown.map((p) => pathNpvForVariant(project, v, p));
      return npvs[i] >= Math.max(...npvs) - 1e-6;
    }).length;
    path.stability = { ...ranges[i], best, total: samples.length, indistinguishable: ranges[i].min <= ranges[0].max && ranges[i].max >= ranges[0].min };
  });
  return result;
}

describe("Risultati identici con Milano e la casa d'esempio", () => {
  it("il ripiego e il protocollo conservano ogni numero e restituiscono solo dati semplici", async () => {
    const climate = loadMilano(), client = createEngineClient();
    expect(typeof Worker).toBe("undefined");
    client.climate(climate);
    const ev = evaluate(project, climate);
    const received = await client.request("evaluate", input);
    expect(received).toEqual(ev);
    const samples: Evaluation[] = [];
    const sensitivity = runSensitivity(project, climate, ev, null, (_id, variant) => samples.push(variant));
    const onProgress = vi.fn();
    const receivedSensitivity = await client.request("sensitivity", { ...input, only: null }, { onProgress });
    expect(receivedSensitivity).toEqual(sensitivity);
    expect(onProgress).toHaveBeenCalledTimes(samples.length);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ index: samples.length, total: samples.length });
    const paths = await client.request("paths", input);
    expect(paths).toEqual(directPaths(ev, samples));
    const { stability: _stability, ...first } = paths.proposed[0];
    expect(first).toEqual(evaluatePaths(project, climate, ev).proposed[0]);

    const quoted = structuredClone(project);
    addQuote(quoted, "windows");
    quoted.windows.otherQuotes[0].uWindow.value *= 0.9;
    const quotes = await client.request("quotes", { project: quoted, climateId: input.climateId, kinds: ["windows"], today: Date.UTC(2026, 10, 17) });
    expect(quotes).toEqual(compareQuotes(quoted, climate, evaluate(quoted, climate), ["windows"], new Date(Date.UTC(2026, 10, 17))));
    const houses = { attiva: project, altre: [] };
    const rows = await client.request("compareHouses", { houses, goal: "completo" });
    expect(rows).toEqual(confrontaCase(houses, "completo", new Map([[input.climateId, climate]])));
    // Un progetto diverso non deve ereditare le varianti dell'ultima sensibilità.
    const other = { ...project, name: "Altra casa" };
    const otherPaths = await client.request("paths", { project: other, climateId: input.climateId });
    expect(otherPaths.proposed.every((p) => p.stability?.total === 0)).toBe(true);
    for (const result of [received, receivedSensitivity, paths, quotes, rows]) {
      checkPlain(result);
      expect(structuredClone(result)).toEqual(result);
    }
    // Il percorso usato da postMessage è lo stesso, con input e output clonati.
    const workerClient = createEngineClient(() => {
      const worker = new FakeWorker(), run = createEngineRuntime();
      worker.postMessage = (request) => run(structuredClone(request), (response) => worker.reply(structuredClone(response)));
      return worker;
    });
    workerClient.climate(climate);
    expect(await workerClient.request("evaluate", input)).toEqual(ev);
    expect(await workerClient.request("sensitivity", { ...input, only: null })).toEqual(sensitivity);
    expect(await workerClient.request("paths", input)).toEqual(paths);
    workerClient.dispose(); client.dispose();
  }, 300_000);
});
