import { ENGINE_VERSION, evaluate, parseProjectFile, type ClimatePackage, type Goal, type PackageId, type ProjectInput, compareTariffs } from "../engine";
import { goalChange, switchGoal } from "./casa";
import { goalPackages } from "./goals";

export const MAX_CASE = 10;
const DRAFT_KEY = "confronto-interventi:bozza:v1";
const CASES_KEY = "confronto-interventi:altre-case:v1";
const REJECTED_KEY = "confronto-interventi:altre-case-rifiutate";
export interface AltraCasa { id: string; savedAt: string; input: ProjectInput }
export interface Case { attiva: ProjectInput | null; altre: AltraCasa[] }
export interface RigaConfronto {
  id: string | "attiva"; nome: string; comune: string; stato: "ok" | "non adatta" | "da completare";
  motivo?: string; spesaOggi?: number;
  migliore?: { id: PackageId; label: string; investimento: number; spesa: number; van: number | null; rientro: number | null };
}
const projectFile = (input: ProjectInput) => ({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input });
const randomId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const error = (errore: string) => ({ errore });
const tooMany = "Hai già 10 case: eliminane una prima.";
const count = (c: Case) => Number(!!c.attiva) + c.altre.length;
const copy = <T,>(value: T): T => structuredClone(value);

export function leggiCase(storage: Pick<Storage, "getItem" | "setItem">): Case & { note: string[] } {
  const notes: string[] = [];
  let attiva: ProjectInput | null = null;
  const draft = storage.getItem(DRAFT_KEY);
  if (draft) {
    const parsed = parseProjectFile(draft, null, undefined, { draft: true });
    if (parsed.file) attiva = parsed.file.input;
  }
  const raw = storage.getItem(CASES_KEY);
  let altre: AltraCasa[] = [];
  if (raw) {
    try {
      const decoded = JSON.parse(raw);
      if (decoded?.version !== 1 || !Array.isArray(decoded.case)) throw new Error("formato non valido");
      const rejected: unknown[] = [];
      let malformed = false, overflow = false;
      for (const item of decoded.case) {
        if (!item?.file || typeof item.file !== "object") { rejected.push(item); malformed = true; continue; }
        const parsed = parseProjectFile(JSON.stringify(item.file), null, undefined, { draft: true });
        if (typeof item?.id !== "string" || typeof item?.savedAt !== "string" || !parsed.file) { rejected.push(item); malformed = true; }
        else if (altre.length < 9) altre.push({ id: item.id, savedAt: item.savedAt, input: parsed.file.input });
        else { rejected.push(item); overflow = true; }
      }
      if (rejected.length) {
        storage.setItem(REJECTED_KEY, raw);
        if (malformed) notes.push("Una o più case non sono leggibili e sono state copiate tra i dati rifiutati.");
        if (overflow) notes.push("Hai più di 9 case: le case eccedenti sono state copiate tra i dati rifiutati.");
      }
    } catch {
      storage.setItem(REJECTED_KEY, raw);
      notes.push("L'elenco delle altre case non è leggibile ed è stato copiato tra i dati rifiutati.");
    }
  }
  return { attiva, altre, note: notes };
}

export function scriviCase(storage: Pick<Storage, "setItem" | "removeItem">, c: Case): void {
  const oldList = (storage as Storage).getItem?.(CASES_KEY) ?? null;
  const oldDraft = (storage as Storage).getItem?.(DRAFT_KEY) ?? null;
  try {
    storage.setItem(CASES_KEY, JSON.stringify({ version: 1, case: c.altre.map((x) => ({ id: x.id, savedAt: x.savedAt, file: projectFile(x.input) })) }));
    if (c.attiva) storage.setItem(DRAFT_KEY, JSON.stringify(projectFile(c.attiva)));
    else storage.removeItem(DRAFT_KEY);
  } catch (e) {
    try {
      if (oldList === null) storage.removeItem(CASES_KEY); else storage.setItem(CASES_KEY, oldList);
      if (oldDraft === null) storage.removeItem(DRAFT_KEY); else storage.setItem(DRAFT_KEY, oldDraft);
    } catch { /* restore best effort after a storage quota failure */ }
    throw e;
  }
}

export function usaCasa(c: Case, id: string, now: string): Case {
  const next = copy(c), index = next.altre.findIndex((x) => x.id === id);
  if (index < 0) return next;
  const selected = next.altre.splice(index, 1)[0]!;
  if (next.attiva) next.altre.push({ id: randomId(), savedAt: now, input: next.attiva });
  next.attiva = selected.input;
  return next;
}
export function duplicaCasa(c: Case, id: string | "attiva", now: string, newId: string): Case | { errore: string } {
  if (count(c) >= MAX_CASE) return error(tooMany);
  const original = id === "attiva" ? c.attiva : c.altre.find((x) => x.id === id)?.input;
  if (!original) return copy(c);
  const name = `Copia di ${original.name}`.slice(0, 60);
  const input = copy(original); input.name = name;
  return { ...copy(c), altre: [...copy(c.altre), { id: newId, savedAt: now, input }] };
}
export function rinominaCasa(c: Case, id: string | "attiva", nome: string): Case | { errore: string } {
  const name = nome.trim(); if (!name) return error("Scrivi un nome.");
  const next = copy(c), target = id === "attiva" ? next.attiva : next.altre.find((x) => x.id === id)?.input;
  if (target) target.name = name.slice(0, 60);
  return next;
}
export function eliminaCasa(c: Case, id: string | "attiva"): Case {
  const next = copy(c);
  if (id === "attiva") next.attiva = null;
  else next.altre = next.altre.filter((x) => x.id !== id);
  return next;
}
export function aggiungiCasa(c: Case, now: string, newId: string): Case | { errore: string } {
  if (!c.attiva) return copy(c);
  if (count(c) >= MAX_CASE) return error(tooMany);
  return { attiva: null, altre: [...copy(c.altre), { id: newId, savedAt: now, input: copy(c.attiva) }] };
}
export function importaCasa(c: Case, input: ProjectInput, now: string, newId: string): Case | { errore: string } {
  if (count(c) >= MAX_CASE) return error(tooMany);
  return { attiva: copy(input), altre: [...copy(c.altre), ...(c.attiva ? [{ id: newId, savedAt: now, input: copy(c.attiva) }] : [])] };
}

export function confrontaCase(c: Case, g: Goal, climi: ReadonlyMap<string, ClimatePackage>): RigaConfronto[] {
  const houses: { id: string | "attiva"; input: ProjectInput }[] = [];
  if (c.attiva) houses.push({ id: "attiva", input: c.attiva });
  houses.push(...c.altre.map((x) => ({ id: x.id, input: x.input })));
  return houses.map(({ id, input }) => {
    const row: RigaConfronto = { id, nome: input.name, comune: input.location.name ? `${input.location.name}${input.location.sigla ? ` (${input.location.sigla})` : ""}` : "da scegliere", stato: "da completare" };
    const change = goalChange(input, g);
    if (change.kind === "blocked" || change.kind === "confirm") {
      row.stato = "non adatta";
      row.motivo = g === "fv" ? "ha già il fotovoltaico" : g === "batteria" ? "non ha il fotovoltaico" : "non ha l'auto elettrica";
      return row;
    }
    if (!input.location.code) { row.motivo = "dati da completare nei passi"; return row; }
    const p = switchGoal(input, g, input.mode), climate = climi.get(p.climateId);
    if (!climate) { row.motivo = "clima non disponibile"; return row; }
    try {
      const evaluation = evaluate(p, climate);
      if (!evaluation.ok) { row.motivo = "dati da completare nei passi"; return row; }
      const base = evaluation.packages.find((x) => x.id === "base");
      if (!base) { row.motivo = "dati da completare nei passi"; return row; }
      row.stato = "ok"; row.spesaOggi = base.costs.total;
      if (g === "tariffa") {
        const tariff = compareTariffs(p, climi.get(p.climateId)!, base);
        const winner = tariff.righe.find((item) => item.id === tariff.menoCara);
        if (winner?.totale !== undefined) {
          row.migliore = { id: "base", label: winner.label, investimento: 0, spesa: winner.totale, van: null, rientro: null };
        }
        return row;
      }
      const allowed = goalPackages(p) ?? evaluation.packages.map((x) => x.id);
      const candidates = evaluation.packages.filter((x) => x.id !== "base" && allowed.includes(x.id));
      const best = candidates.filter((x) => x.cash?.npv != null).sort((a, b) => b.cash!.npv! - a.cash!.npv!)[0] ?? candidates[0];
      if (best) {
        const horizon = p.economics.horizonYears.value;
        const payback = best.cash?.simpleFlows ? best.cash.simplePayback : best.cash?.discountedPayback ?? null;
        row.migliore = { id: best.id, label: best.label, investimento: best.investment, spesa: best.costs.total, van: best.cash?.npv ?? null, rientro: payback !== null && payback > horizon ? null : payback };
      }
      return row;
    } catch {
      row.stato = "da completare"; row.motivo = "dati da completare nei passi"; return row;
    }
  });
}
