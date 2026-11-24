import type { ClimatePackage } from "../engine/climate";
import type { CalculationRequest, EngineInputs, EngineKind, EngineRequest, EngineResponse, EngineResults, SensitivityProgress } from "../engine/worker-protocol";

export interface EngineWorker {
  postMessage(message: EngineRequest): void;
  onmessage: ((event: MessageEvent<EngineResponse>) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
  terminate?(): void;
}
interface RequestOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SensitivityProgress) => void;
}
interface Pending {
  request: CalculationRequest;
  resolve: (value: EngineResults[EngineKind]) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  onProgress?: RequestOptions["onProgress"];
}
const abortError = () => new DOMException("Calcolo annullato.", "AbortError");
export const isEngineAbort = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";

export function createEngineClient(factory: () => EngineWorker | null = () => typeof Worker === "undefined" ? null : new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" })) {
  let sequence = 0;
  let worker: EngineWorker | null = null;
  let fallback = false;
  let runtime: Promise<ReturnType<typeof import("../engine/worker-runtime").createEngineRuntime>> | null = null;
  const climates = new Map<string, ClimatePackage>();
  const pending = new Map<number, Pending>();

  function receive(response: EngineResponse) {
    const item = pending.get(response.id);
    if (!item) return;
    if (response.type === "progress") { item.onProgress?.(response.progress); return; }
    if (response.type === "result" && response.kind !== item.request.type) return;
    pending.delete(response.id);
    item.cleanup();
    if (response.type === "error") item.reject(new Error(response.message));
    else item.resolve(response.result);
  }
  function detach() {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate?.();
    worker = null;
  }
  function fail(error: Error) {
    detach();
    for (const item of pending.values()) { item.cleanup(); item.reject(error); }
    pending.clear();
  }
  function ensureWorker() {
    if (worker || fallback) return;
    try { worker = factory(); } catch { worker = null; }
    if (!worker) { fallback = true; return; }
    const active = worker;
    worker.onmessage = (event) => { if (worker === active) receive(event.data); };
    worker.onerror = (event) => {
      if (worker !== active) return;
      event.preventDefault?.();
      fail(new Error(event.message || "Errore nel worker di calcolo."));
    };
    for (const climate of climates.values()) worker.postMessage({ id: ++sequence, type: "climate", climate });
  }
  function dispatch(request: CalculationRequest) {
    try {
      ensureWorker();
      if (worker) worker.postMessage(request);
      else setTimeout(() => {
        if (!pending.has(request.id)) return;
        runtime ??= import("../engine/worker-runtime").then((m) => {
          const run = m.createEngineRuntime();
          for (const climate of climates.values()) run({ id: ++sequence, type: "climate", climate }, receive);
          return run;
        });
        void runtime.then((run) => { if (pending.has(request.id)) run(request, receive); }).catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
      }, 0);
    } catch (error: unknown) { fail(error instanceof Error ? error : new Error(String(error))); }
  }
  function cancel(id: number) {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    item.cleanup();
    item.reject(abortError());
    if (item.request.type === "sensitivity" && worker) {
      // Un worker occupato non può leggere un messaggio di annullamento.
      detach();
      // Le altre richieste restano valide: si rimandano insieme ai climi.
      for (const other of pending.values()) dispatch(other.request);
    }
  }
  return {
    climate(climate: ClimatePackage) {
      const id = climate.manifest.climateId;
      if (climates.has(id)) return;
      climates.set(id, climate);
      try {
        worker?.postMessage({ id: ++sequence, type: "climate", climate });
        if (runtime) void runtime.then((run) => run({ id: ++sequence, type: "climate", climate }, receive));
      } catch (error: unknown) { fail(error instanceof Error ? error : new Error(String(error))); }
    },
    request<K extends EngineKind>(type: K, input: EngineInputs[K], options: RequestOptions = {}): Promise<EngineResults[K]> {
      for (const [id, item] of pending) if (item.request.type === type) cancel(id);
      if (options.signal?.aborted) return Promise.reject(abortError());
      try { ensureWorker(); } catch (error: unknown) {
        const failure = error instanceof Error ? error : new Error(String(error));
        fail(failure);
        return Promise.reject(failure);
      }
      const id = ++sequence;
      // Il discriminante e il relativo input sono legati dal parametro K.
      const request = { id, type, input: structuredClone(input) } as CalculationRequest;
      return new Promise<EngineResults[K]>((resolve, reject) => {
        const abort = () => cancel(id);
        pending.set(id, { request, resolve: (value) => resolve(value as EngineResults[K]), reject, onProgress: options.onProgress, cleanup: () => options.signal?.removeEventListener("abort", abort) });
        options.signal?.addEventListener("abort", abort, { once: true });
        dispatch(request);
      });
    },
    dispose() {
      fail(abortError());
      runtime = null;
    },
  };
}
