import { useEffect, useState } from "react";
import type { ClimateIndexEntry, ClimatePackage, Comune, ProjectInput, Section } from "../engine";
import { checkProject } from "../engine";
import { BuildingForm, ConsumptionForm, LocationForm, SystemForm } from "./forms";
import { FormContext } from "./fields";
import { Icon } from "./icons";
import { focusControl } from "./metadata";
import { stessaCasa } from "./casa-dati";

const ERROR = "C'è un numero vuoto o non leggibile in digitazione. Correggilo prima di cambiare passo o esportare: l'ultimo valore accettato non è la tua nuova immissione.";
const GROUPS: { name: string; sections: Section[] }[] = [
  { name: "Località", sections: ["Località"] }, { name: "Edificio", sections: ["Edificio"] },
  { name: "Impianto", sections: ["Servizio", "Impianto"] }, { name: "Consumi e tariffe", sections: ["Consumi", "Tariffe"] },
];

export function SchedaCasa({ value, climate, climateIndex, comuni, comuniError, onSave, onCancel, onMode, onDirty, onClimateId }: { value: ProjectInput; climate: ClimatePackage | null; climateIndex: ClimateIndexEntry[] | null; comuni: Comune[] | null; comuniError: string | null; onSave: (p: ProjectInput) => void; onCancel: () => void; onMode?: (mode: ProjectInput["mode"]) => void; onDirty?: (dirty: boolean) => void; onClimateId?: (id: string) => void }) {
  const [p, setP] = useState(() => structuredClone(value)); const [errors, setErrors] = useState(new Set<string>()); const [guardError, setGuardError] = useState(false); const [nameError, setNameError] = useState(false);
  const issues = checkProject(p); const doc = p.mode === "documentata";
  useEffect(() => { onDirty?.(!stessaCasa(value, p)); }, [p, value, onDirty]);
  useEffect(() => { onClimateId?.(p.climateId); }, [p.climateId, onClimateId]);
  const up = (fn: (d: ProjectInput) => void) => setP(old => { const next = structuredClone(old); fn(next); return next; });
  const draftError = (id: string, invalid: boolean) => setErrors(old => { const next = new Set(old); if (invalid) next.add(id); else next.delete(id); return next; });
  const guard = () => {
    if (!errors.size) { setGuardError(false); return true; }
    setGuardError(true); focusControl([...errors][0]); return false;
  };
  const content = [
    <LocationForm key="loc" p={p} up={up} doc={doc} issues={issues} climate={climate} index={climateIndex} comuni={comuni} comuniError={comuniError} setProject={setP} />,
    <BuildingForm key="ed" p={p} up={up} doc={doc} issues={issues} />,
    <SystemForm key="sys" p={p} up={up} doc={doc} issues={issues} />,
    <ConsumptionForm key="cons" p={p} up={up} doc={doc} issues={issues} soloCasa />,
  ];
  const cancel = () => { if (!stessaCasa(value, p) && !window.confirm("Uscire senza salvare le modifiche alla casa?")) return; onCancel(); };
  const save = () => { if (!p.name.trim()) { setNameError(true); return; } setNameError(false); if (guard()) onSave(p); };
  return <FormContext.Provider value={{ project: p, draftError, guard }}><section className="panel casa-sheet"><p className="small muted">Solo i dati della casa. Valgono per tutte le domande.</p><div className="entry-mode seg" role="group" aria-label="Modalità di inserimento della casa"><button type="button" aria-pressed={p.mode === "rapida"} onClick={() => { up(d => { d.mode = "rapida"; }); onMode?.("rapida"); }}><Icon name="rapida" size={18}/> Rapida</button><button type="button" aria-pressed={p.mode === "documentata"} onClick={() => { up(d => { d.mode = "documentata"; }); onMode?.("documentata"); }}><Icon name="verifica" size={18}/> Documentata</button></div>{GROUPS.map((group, i) => <details key={group.name} open={i === 0}><summary>{group.name}{issues.some(issue => group.sections.includes(issue.section) && issue.severity === "errore") && <span className="dot num bad" role="img" aria-label="errori da correggere" title="errori da correggere"/>}</summary>{content[i]}</details>)}{nameError && <div className="notice bad" role="alert">Scrivi un nome: è nella sezione Località, «Nome del caso».</div>}{guardError && <div className="notice bad" role="alert">{ERROR}</div>}<div className="toolbar"><button type="button" className="btn primary" onClick={save}>Salva</button><button type="button" className="btn" onClick={cancel}>Annulla</button></div></section></FormContext.Provider>;
}
