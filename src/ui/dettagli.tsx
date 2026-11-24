import { createContext, useContext, useMemo, type DependencyList } from "react";
import type { ResultDetails } from "../engine";

/**
 * Dettagli dei Risultati calcolati nel worker (tariffe, lavori sull'involucro, beneficio dei pannelli con l'auto).
 * `null` come valore del contesto: nessun fornitore, i componenti calcolano da sé come prima (test, disegni a sé).
 * `{ details: null }`: il worker li sta calcolando.
 */
export const DetailsContext = createContext<{ details: ResultDetails | null } | null>(null);

/** Valore dal worker se la pagina lo fornisce, altrimenti calcolato qui; `undefined` finché il worker non risponde. */
export function useResultDetail<T>(pick: (details: ResultDetails) => T, local: () => T, deps: DependencyList): T | undefined {
  const context = useContext(DetailsContext);
  const provided = context !== null;
  const computed = useMemo(() => provided ? undefined : local(), [provided, ...deps]);
  if (!provided) return computed;
  return context.details ? pick(context.details) : undefined;
}
