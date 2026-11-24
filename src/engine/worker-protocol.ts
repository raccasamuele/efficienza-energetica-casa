import type { ClimatePackage } from "./climate";
import type { Evaluation } from "./scenarios";
import type { SensitivityResult } from "./sensitivity";
import type { ResultDetails } from "./dettagli";
import type { PathsResult } from "./percorsi";
import type { QuoteComparison, QuoteKind } from "./preventivi";
import type { Goal, PackageId, ProjectInput } from "./types";
import type { Case, RigaConfronto } from "../ui/case";

type ProjectRequest = { project: ProjectInput; climateId: string };
export interface EngineInputs {
  evaluate: ProjectRequest;
  details: ProjectRequest;
  sensitivity: ProjectRequest & { only: PackageId[] | null };
  paths: ProjectRequest;
  quotes: ProjectRequest & { kinds: QuoteKind[]; today: number };
  compareHouses: { houses: Case; goal: Goal };
}
export interface EngineResults {
  evaluate: Evaluation;
  details: ResultDetails;
  sensitivity: SensitivityResult;
  paths: PathsResult;
  quotes: QuoteComparison[];
  compareHouses: RigaConfronto[];
}
export type EngineKind = keyof EngineInputs;
export type CalculationRequest = {
  [K in EngineKind]: { id: number; type: K; input: EngineInputs[K] }
}[EngineKind];
export type EngineRequest = CalculationRequest | { id: number; type: "climate"; climate: ClimatePackage };
export interface SensitivityProgress { variantId: string; index: number; total: number }
export type EngineResponse =
  | { [K in EngineKind]: { id: number; type: "result"; kind: K; result: EngineResults[K] } }[EngineKind]
  | { id: number; type: "progress"; progress: SensitivityProgress }
  | { id: number; type: "error"; message: string };
