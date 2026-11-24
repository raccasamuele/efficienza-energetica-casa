// Voci dell'inventario da controllare: scadono (ultimo_controllo + frequenza_mesi) prima della
// routine successiva, cioè entro frequenza_routine_mesi da oggi.
// node aggiornamento/scadute.mjs [--tutte] [--oggi AAAA-MM-GG]
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const at = args.indexOf("--oggi");
const today = at >= 0 ? new Date(`${args[at + 1]}T00:00:00Z`) : new Date();
const all = args.includes("--tutte");
const inv = JSON.parse(await readFile(new URL("./fonti.json", import.meta.url), "utf8"));

const monthsLater = (date, m) => {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d;
};
const dueDate = (entry) => monthsLater(new Date(`${entry.ultimo_controllo}T00:00:00Z`), entry.frequenza_mesi);
const nextRun = monthsLater(today, inv.frequenza_routine_mesi);

const rows = inv.fonti
  .map((f) => ({ id: f.id, ultimo_controllo: f.ultimo_controllo, scade: dueDate(f).toISOString().slice(0, 10), automatico: f.automatico, da_controllare: dueDate(f) < nextRun }))
  .filter((r) => all || r.da_controllare);
console.log(JSON.stringify({ progetto: inv.progetto, oggi: today.toISOString().slice(0, 10), prossimo_controllo: nextRun.toISOString().slice(0, 10), voci: rows }, null, 2));
