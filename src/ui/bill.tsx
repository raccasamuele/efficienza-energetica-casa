import { useState } from "react";
import { applyBillUpdates, billUpdates, readBill, type BillReading, type ProjectInput } from "../engine";
import { Check } from "./fields";
import { fmt, fmtUpTo } from "./format";
import { InfoTip } from "./info-tip";

const MAX_BYTES = 15_000_000;
const itDay = (iso: string) => iso.split("-").reverse().join("/");
const show = (v: number | string, unit: string) => (typeof v === "number" ? `${v < 100 ? fmtUpTo(v, 3) : fmt(v)}${unit ? ` ${unit}` : ""}` : v || "vuoto");

/** Il percorso della sola luce non usa il gas: una bolletta del gas lì non propone nulla. */
const electricOnly = (p: ProjectInput) => p.goal === "fv" || p.goal === "batteria" || p.goal === "auto";

/** Che cosa la bolletta dice e che cosa propone: ogni valore si conferma a parte, il resto si mostra soltanto. */
export function BillResult({ p, reading: r, chosen, onToggle, onApply, onClose }: {
  p: ProjectInput;
  reading: BillReading;
  chosen: string[];
  onToggle: (path: string, on: boolean) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const gasIgnored = electricOnly(p) && r.servizio === "gas";
  const updates = gasIgnored ? [] : billUpdates(p, r);
  const unit = r.servizio === "gas" ? "Smc" : "kWh";
  const info: [string, string][] = [];
  if (r.consumoPeriodo !== null) info.push(["Consumo del periodo", `${fmt(r.consumoPeriodo)} ${unit}`]);
  if (r.letture) info.push(["Letture", r.letture]);
  if (r.offerta) info.push(["Offerta", r.offerta === "altra" ? "altra tipologia" : `a ${r.offerta}`]);
  if (r.fasce) info.push([`Consumi per fascia (${r.fasce.di === "annuo" ? "anno" : "periodo"})`, `F1 ${fmt(r.fasce.f1)} · F2 ${fmt(r.fasce.f2)} · F3 ${fmt(r.fasce.f3)} kWh`]);
  if (r.potenzaDisponibile !== null) info.push(["Potenza disponibile", `${fmtUpTo(r.potenzaDisponibile, 2)} kW`]);
  if (r.prezzoMedioConsumi !== null) info.push(["Prezzo medio della quota per consumi", `${fmt(r.prezzoMedioConsumi, 4)} €/${unit}, senza imposte: non è il prezzo variabile del progetto, che le comprende`]);
  if (r.quotaFissaMese !== null) info.push(["Quota fissa", `${fmt(r.quotaFissaMese, 2)} €/mese, senza imposte`]);
  if (r.spesaAnnua) info.push(["Spesa annua", `${fmt(r.spesaAnnua.valore, 2)} €${r.spesaAnnua.dal ? ` dal ${itDay(r.spesaAnnua.dal)} al ${itDay(r.spesaAnnua.al)}` : ""}, imposte comprese`]);
  const title = [`Bolletta ${r.servizio === "gas" ? "del gas" : r.servizio === "luce" ? "della luce" : "di tipo non riconosciuto"}`, r.fornitore ?? "fornitore non riconosciuto", r.periodo ? `dal ${itDay(r.periodo.dal)} al ${itDay(r.periodo.al)}` : "periodo non trovato"].join(" · ");
  const count = updates.filter((u) => chosen.includes(u.path)).length;
  return (
    <div className="bill-result">
      <p><strong>{title}</strong></p>
      {gasIgnored && <p className="small">In questo percorso il gas non cambia il risultato: dalla bolletta del gas non si usa nulla.</p>}
      {updates.length > 0 && (
        <>
          <h5>Da confermare, uno per uno</h5>
          {updates.map((u) => (
            <div key={u.path}>
              <Check checked={chosen.includes(u.path)} onChange={(on) => onToggle(u.path, on)}
                label={<>{u.label}: {show(u.proposed, u.unit)} <span className="muted">(ora {show(u.current, u.unit)})</span></>} />
              {u.note && <p className="small muted">{u.note}</p>}
            </div>
          ))}
          <p className="small muted">Fonte: «{updates[0].source}», stato documentato. Nulla cambia finché non lo confermi.</p>
          <div className="row">
            <button type="button" className="btn" disabled={!count} onClick={onApply}>Usa i valori confermati ({count})</button>
            <button type="button" className="btn small" onClick={onClose}>Chiudi</button>
          </div>
        </>
      )}
      {updates.length === 0 && !gasIgnored && <p className="small">Nessun valore da proporre per questo progetto.</p>}
      {info.length > 0 && (
        <>
          <h5>Letti, non usati nel calcolo</h5>
          <ul className="small">{info.map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
        </>
      )}
      {r.avvisi.length > 0 && <ul className="small issues">{r.avvisi.map((a) => <li key={a}>{a}</li>)}</ul>}
      {updates.length === 0 && <button type="button" className="btn small" onClick={onClose}>Chiudi</button>}
    </div>
  );
}

/**
 * La bolletta in PDF letta nel browser: il file non esce dal dispositivo, il testo non si conserva, nel progetto
 * vanno solo i valori confermati.
 */
export function BillReader({ p, up }: { p: ProjectInput; up: (fn: (d: ProjectInput) => void) => void }) {
  const [reading, setReading] = useState<BillReading | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    setReading(null);
    setChosen([]);
    if (file.size > MAX_BYTES) return setMessage("Il file supera 15 MB: non sembra una bolletta.");
    setBusy(true);
    try {
      const { pdfText } = await import("./pdf-text");
      setReading(readBill(await pdfText(await file.arrayBuffer())));
    } catch (e) {
      const m = (e as Error).message ?? "";
      setMessage(/password/i.test(m) ? "Il PDF è protetto da password: scaricalo di nuovo senza protezione." : /Invalid PDF|PDF header/i.test(m) ? "Il file non è un PDF valido." : m || "Il PDF non si legge.");
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    if (!reading) return;
    const ups = billUpdates(p, reading);
    const n = ups.filter((u) => chosen.includes(u.path)).length;
    up((d) => {
      const next = applyBillUpdates(d, ups, chosen);
      d.consumption = next.consumption;
      d.tariffs = next.tariffs;
      d.system = next.system;
      d.existingPv = next.existingPv;
    });
    setMessage(`${n === 1 ? "Inserito un valore" : `Inseriti ${n} valori`} con fonte «${ups[0].source}».`);
    setReading(null);
    setChosen([]);
  };
  return (
    <div className="section">
      <h4>Leggi una bolletta (PDF)</h4>
      <p className="small">
        <InfoTip text="Il PDF si legge solo qui, nel browser: niente foto o scansioni." label="Lettura della bolletta">Il PDF resta sul tuo dispositivo: si legge qui, nel browser. Non leggiamo e non salviamo nome, indirizzo, POD, PDR e codice cliente; nel progetto vanno solo i numeri che confermi. Serve il PDF scaricato dall'area clienti: foto e scansioni non si leggono.</InfoTip>
      </p>
      <input type="file" accept="application/pdf,.pdf" aria-label="Bolletta in PDF" disabled={busy} onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
      {busy && <p className="small" role="status">Leggo la bolletta…</p>}
      {message && <p className="small" role="status">{message}</p>}
      {reading && (
        <BillResult p={p} reading={reading} chosen={chosen}
          onToggle={(path, on) => setChosen((c) => (on ? [...c.filter((x) => x !== path), path] : c.filter((x) => x !== path)))}
          onApply={apply} onClose={() => setReading(null)} />
      )}
    </div>
  );
}
