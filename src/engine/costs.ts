import type { ProjectInput } from "./types";

/**
 * Costi stimati di FV e batteria, IVA compresa, quando non c'è un preventivo. Un solo modello per dimensionamento,
 * risultati, sensibilità e report. Con il preventivo valgono gli importi dell'utente, mai modificati in automatico.
 *
 * - FV nuovo: prezzo per kWp chiavi in mano (inverter compreso).
 * - Batteria installata insieme a un FV nuovo: parte fissa (installazione, collegamento, gestione) più parte per kWh;
 *   l'inverter è già quello ibrido del FV, quindi non si conta due volte.
 * - Batteria aggiunta a un FV esistente: stessa parte per kWh, parte fissa più alta (di solito serve un inverter o un
 *   convertitore in più).
 * - Sostituzione futura: solo i moduli e la manodopera, con importi propri, non l'intera installazione iniziale.
 */
export function pvEstimate(p: ProjectInput, kWp: number): number {
  return kWp > 0 ? p.pv.pricePerKwp.value * kWp : 0;
}

export function batteryFixedCost(p: ProjectInput): number {
  return p.existingPv.present ? p.battery.retrofitFixedCost.value : p.battery.fixedCost.value;
}

export function batteryEstimate(p: ProjectInput, capacity: number): number {
  return capacity > 0 ? p.battery.pricePerKwh.value * capacity + batteryFixedCost(p) : 0;
}

export function batteryReplacementEstimate(p: ProjectInput, capacity: number): number {
  return capacity > 0 ? p.battery.replacementPerKwh.value * capacity + p.battery.replacementFixed.value : 0;
}
