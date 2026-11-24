import { createEngineRuntime } from "./worker-runtime";
import type { EngineRequest, EngineResponse } from "./worker-protocol";

const run = createEngineRuntime();
// Solo le API usate: il progetto compila anche con le librerie DOM della pagina.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage: (message: EngineResponse) => void;
};
scope.onmessage = (event) => run(event.data, (response) => scope.postMessage(response));
