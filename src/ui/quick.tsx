import { OPAQUE_U_PCT, type ProjectInput } from "../engine";
import { SelectField } from "./fields";
import type { FormProps } from "./forms";
import { journey, setChoice } from "./journey";
import { applyEnvelope, applyGlass, applyShade, SHADE } from "./scelte-rapide";

export function GuidedChoice<T extends string>({ p, up, path, label, value, options, set }: Pick<FormProps, "p" | "up"> & { path: string; label: string; value: T; options: { value: T; label: string }[]; set: (d: ProjectInput, v: T) => void }) {
  const choice = journey(p)?.choices[path];
  return <SelectField label={label} value={choice === "nonso" ? "nonso" : value} options={[...options, { value: "nonso", label: "Non lo so, usa un'ipotesi dichiarata" }]} onChange={(v) => up((d) => { setChoice(d, path, v); if (v !== "nonso") set(d, v as T); })} hint={choice === "nonso" || !choice ? `Ipotesi iniziale da verificare: ${options.find((o) => o.value === value)?.label}. Schema semplificato, non rilievo.` : "Scelta dichiarata; non documenta automaticamente i parametri tecnici."} />;
}


const EMITTER_OPTIONS: { value: ProjectInput["system"]["emitters"]; label: string }[] = [
  { value: "radiatori", label: "Radiatori" },
  { value: "ventilconvettori", label: "Ventilconvettori" },
  { value: "radiante", label: "Pavimento o soffitto radiante" },
  { value: "nonNoto", label: "Non lo so" },
];

/** Rapida: raffrescamento di oggi, terminali e schermature estive, con «non so». */
export function QuickSystemSummer({ p, up }: Pick<FormProps, "p" | "up">) {
  const choices = journey(p)?.choices ?? {};
  // la scelta della Rapida distingue solo «no» da «non so»: il dato vero è cooling.today, che la Documentata può cambiare
  const cools = p.cooling.today === "split" ? "split" : choices.cooling === "nonso" ? "nonso" : "no";
  const shade = (choices.summerShade ?? "nonso") as keyof typeof SHADE;
  return <div className="grid">
    <SelectField label="D'estate raffreschi la casa?" value={cools} options={[{ value: "no", label: "No" }, { value: "split", label: "Sì, con condizionatori (split)" }, { value: "nonso", label: "Non lo so" }]}
      onChange={(v) => up((d) => { setChoice(d, "cooling", v); d.cooling.today = v === "split" ? "split" : "nessuno"; })}
      hint={cools === "nonso" ? "Raffrescamento non indicato: i conti estivi non sono inclusi." : cools === "split" ? "Consumi e spese estive entrano in tutti i pacchetti; EER e potenza sono in «Vedi le ipotesi tecniche»." : "Il fabbisogno estivo si mostra come informazione, fuori dai conti."} />
    <SelectField label="Che terminali ha l'impianto?" value={p.system.emitters} options={EMITTER_OPTIONS} onChange={(v) => up((d) => void (d.system.emitters = v))}
      hint="La pompa di calore può raffrescare solo con ventilconvettori o pannelli radianti; con i radiatori restano gli split." />
    <SelectField label="Hai tende o persiane esterne che usi d'estate?" value={shade} options={[{ value: "si", label: "Sì" }, { value: "no", label: "No" }, { value: "nonso", label: "Non lo so, usa un'ipotesi dichiarata" }]}
      onChange={(v) => up((d) => { setChoice(d, "summerShade", v); applyShade(d, v); })} />
  </div>;
}

export function QuickEnvelope({ p, up }: Pick<FormProps, "p" | "up">) {
  const choices = journey(p)?.choices ?? {};
  const insulation = choices.insulation ?? "nonso";
  const epoch = choices.epoch ?? "nonso";
  const envelope = applyEnvelope;
  return <div className="section"><h3>Cosa conosci della casa?</h3><div className="grid">
    <SelectField label="Epoca di costruzione indicativa" value={epoch} options={[{ value: "prima1990", label: "Prima del 1990" }, { value: "recente", label: "Dal 1990 in poi" }, { value: "nonso", label: "Non lo so, usa un'ipotesi dichiarata" }]} onChange={(v) => up((d) => { setChoice(d, "epoch", v); envelope(d, v, insulation); })} />
    <SelectField label="Sai se sono stati isolati muri, tetto o pavimento?" value={insulation} options={[{ value: "si", label: "Sì, considero uno scenario con isolamento" }, { value: "no", label: "Non risultano lavori di isolamento" }, { value: "nonso", label: "Non lo so, usa un'ipotesi dichiarata" }]} onChange={(v) => up((d) => { setChoice(d, "insulation", v); envelope(d, epoch, v); })} hint="Uno scenario medio applicato alle tre superfici. Per lavori su una sola parte modifica le ipotesi tecniche. I dati già documentati restano." />
    <SelectField label="Che vetri riconosci?" value={choices.glass ?? "nonso"} options={[{ value: "singolo", label: "Un solo vetro" }, { value: "doppio", label: "Due vetri separati (vetrocamera)" }, { value: "recente", label: "Serramenti recenti con vetro isolante" }, { value: "nonso", label: "Non lo so, usa un'ipotesi dichiarata" }]} onChange={(v) => up((d) => { setChoice(d, "glass", v); applyGlass(d, v); })} />
  </div><p className="small muted">Le scelte producono stime visibili in «Vedi le ipotesi tecniche». La stessa epoca può avere pareti molto diverse: controlla le alternative U ±{OPAQUE_U_PCT} nella sensibilità. «Non lo so» mantiene un'ipotesi, senza trasformarla in un dato certo.</p></div>;
}
