import type { ProjectInput } from "../engine";

/**
 * Il calcolo mostrato è dello stesso progetto che si sta guardando? Mentre si modifica un dato restano i risultati di
 * un attimo prima, con «Sto ricalcolando…». Con un'altra domanda o un'altra casa (domanda, modalità, nome, comune o
 * clima diversi) quei numeri non c'entrano: non si mostrano finché non arriva il calcolo nuovo.
 */
export function stessoProgetto(shown: ProjectInput, current: ProjectInput): boolean {
  return shown === current || (
    shown.goal === current.goal &&
    shown.mode === current.mode &&
    shown.name === current.name &&
    shown.climateId === current.climateId &&
    shown.location.code === current.location.code
  );
}
