import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PRESET_VERSION, type DataStatus, type Q } from "../engine";
import type { ProjectInput } from "../engine";
import { fieldError, fieldId, isInherited, ruleFor } from "./metadata";
import { editValue } from "./journey";
import { InfoTip, methodForPath, type MetodoId } from "./info-tip";

export const FormContext = createContext<{ project?: ProjectInput; draftError?: (id: string, invalid: boolean) => void; guard?: () => boolean }>({});

export const STATUS_LABEL: Record<DataStatus, string> = {
  documentato: "documentato",
  misurato: "misurato",
  ipotizzato: "ipotizzato",
  sconosciuto: "non so",
};

const display = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4, useGrouping: false });
export const showNumber = (v: number) => (Number.isFinite(v) ? display.format(v) : "");

/**
 * Interpreta un numero scritto all'italiana: la virgola è il decimale, il punto seguito da gruppi
 * di tre cifre è il separatore delle migliaia ("12.000" → 12000, "1.234,56" → 1234,56).
 * Un punto non seguito da gruppi di tre cifre, o dopo uno zero iniziale, è un decimale ("1.5", "0.125").
 */
export function parseItalianNumber(raw: string): number | null {
  let t = raw.trim().replace(/\s/g, "").replace(/−/g, "-");
  if (!t) return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Input numerico che tollera stati intermedi di digitazione e segnala i valori non leggibili. */
export function NumberInput(props: { id?: string; value: number; onChange: (v: number) => void; disabled?: boolean; ariaLabel?: string; describedBy?: string; invalid?: boolean; min?: number; max?: number; integer?: boolean }) {
  const context = useContext(FormContext);
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const [text, setText] = useState(showNumber(props.value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const lastValue = useRef(props.value);
  const errId = useId();
  const rangeId = `${errId}-range`;
  const rangeError = props.min !== undefined && props.max !== undefined ? fieldError({ value: props.value, status: "ipotizzato" }, { path: "", min: props.min, max: props.max }) ?? (props.integer && !Number.isInteger(props.value) ? "Inserisci un numero intero." : undefined) : undefined;
  useEffect(() => {
    if (!focused.current) {
      setText(showNumber(props.value));
      if (lastValue.current !== props.value) { setInvalid(false); context.draftError?.(id, false); }
    }
    lastValue.current = props.value;
  }, [props.value]);
  return (
    <span className="num-input">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={props.ariaLabel}
        aria-invalid={invalid || !!rangeError || props.invalid || undefined}
        aria-describedby={[props.describedBy, invalid ? errId : undefined, rangeError ? rangeId : undefined].filter(Boolean).join(" ") || undefined}
        value={text}
        disabled={props.disabled}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          if (!invalid) setText(showNumber(props.value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseItalianNumber(e.target.value);
          setInvalid(v === null);
          context.draftError?.(id, v === null);
          if (v !== null) props.onChange(v);
        }}
      />
      {invalid && (
        <span className="field-error" role="alert" id={errId}>
          Numero non valido: il valore usato resta {showNumber(props.value)}
          <button type="button" className="btn small" onClick={() => { setText(showNumber(props.value)); setInvalid(false); context.draftError?.(id, false); }}>Ripristina il valore usato</button>
        </span>
      )}
      {rangeError && <span id={rangeId} className="field-error">{rangeError}</span>}
    </span>
  );
}

export interface Preset {
  label: string;
  value: number;
  source: string;
}

export function QField(props: {
  label: string;
  unit?: string;
  q: Q;
  onChange: (q: Q) => void;
  hint?: ReactNode;
  presets?: Preset[];
  showSource: boolean;
  allowUnknown?: boolean;
  path?: string;
  min?: number;
  max?: number;
  ownLabel?: boolean; // usa l'etichetta del modulo anche se il catalogo dei campi ne ha una
}) {
  const generatedId = useId();
  const context = useContext(FormContext);
  const { q } = props;
  const rule = ruleFor(context.project, q);
  const path = props.path ?? rule?.path;
  const id = path ? fieldId(path) : generatedId;
  const unit = rule?.unit ?? props.unit;
  const error = fieldError(q, rule ?? (props.min !== undefined && props.max !== undefined ? { path: path ?? "", min: props.min, max: props.max } : undefined));
  const describedBy = [unit && `${id}-unit`, `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  const label = props.ownLabel ? props.label : context.project?.mode === "rapida" ? rule?.quickLabel ?? rule?.label ?? props.label : rule?.label ?? props.label;
  return (
    <div className={`field st-${q.status}`}>
      <div className="field-label"><label htmlFor={id}>{label}</label><InfoTip label={label} id={`${id}-hint`} method={methodForPath(path)}>{props.hint} {q.status === "sconosciuto" && `Non lo so: nel calcolo si usa l'ipotesi ${showNumber(q.value)} ${unit ?? ""}.`} {isInherited(q) && "Valore ereditato dall'esempio, da verificare per la tua casa."} {!props.hint && q.status !== "sconosciuto" && !isInherited(q) && "Indica il valore e lo stato del dato; aggiungi la provenienza in Documentata."} {!props.showSource && q.source && <> Fonte: {q.source}</>}</InfoTip></div>
      <div className="row">
        <NumberInput id={id} value={q.value} describedBy={describedBy} invalid={!!error} onChange={(v) => {
          const edited = editValue(q, v);
          if (!props.showSource && (q.status === "documentato" || q.status === "misurato")) edited.status = q.status;
          props.onChange(edited);
        }} />
        {unit && <span id={`${id}-unit`} className="unit">{unit}</span>}
        {props.showSource ? <select
          className="status"
          aria-label={`Stato del dato: ${props.label}`}
          value={q.status}
          onChange={(e) => props.onChange({ ...q, status: e.target.value as DataStatus, confirmed: false })}
        >
          {(Object.keys(STATUS_LABEL) as DataStatus[])
            .filter((s) => props.allowUnknown !== false || s !== "sconosciuto")
            .map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
        </select> : props.allowUnknown !== false && <Check label="Non lo so" checked={q.status === "sconosciuto"} onChange={(unknown) => props.onChange({ ...q, status: unknown ? "sconosciuto" : "ipotizzato", confirmed: false })} />}
      </div>
      {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
      {props.presets && (
        <div className="presets" role="group" aria-label={`Preset per ${props.label}`}>
          {props.presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn small"
              aria-pressed={Math.abs(q.value - p.value) < 1e-9}
              onClick={() => props.onChange({ value: p.value, status: "ipotizzato", source: `Preset: ${p.label} (${PRESET_VERSION}) · ${p.source}`, confirmed: false })}
            >
              {p.label} · {showNumber(Number(p.value.toFixed(3)))}
            </button>
          ))}
        </div>
      )}
      {props.showSource ? (
        <input
          type="text"
          className="src"
          placeholder="Fonte, documento o motivazione"
          aria-label={`Fonte: ${props.label}`}
          value={q.source ?? ""}
          onChange={(e) => props.onChange({ ...q, source: e.target.value, confirmed: false })}
        />
      ) : (
        null
      )}
      {props.showSource && <TextField label={`Data del dato: ${props.label}`} value={q.date ?? ""} placeholder="es. 2026-10-28" onChange={(date) => props.onChange({ ...q, date })} />}
      {props.showSource && rule?.critical === "tecnico" && q.status === "ipotizzato" && <Check label={`Confermo la stima tecnica motivata: ${rule.label}`} checked={q.confirmed === true} onChange={(confirmed) => props.onChange({ ...q, confirmed })} />}
    </div>
  );
}

export function SelectField<T extends string>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: ReactNode; method?: MetodoId }) {
  const id = useId();
  const context = useContext(FormContext);
  return (
    <div className="field">
      <div className="field-label"><label htmlFor={id}>{props.label}</label>{props.hint && <InfoTip label={props.label} id={`${id}-hint`} method={props.method}>{props.hint}</InfoTip>}</div>
      <select id={id} aria-describedby={props.hint ? `${id}-hint` : undefined} value={props.value} onChange={(e) => { if (context.guard?.() !== false) props.onChange(e.target.value as T); }}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Check(props: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const context = useContext(FormContext);
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} onChange={(e) => { if (context.guard?.() !== false) props.onChange(e.target.checked); }} />
      <span>{props.label}</span>
    </label>
  );
}

export function TextField(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input id={id} type="text" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}

/** Parametri avanzati: aperti in modalità documentata, richiusi (ma visibili su richiesta) in modalità rapida. */
export function Advanced({ doc, children, summary = "Vedi le ipotesi tecniche" }: { doc: boolean; children: ReactNode; summary?: string }) {
  if (doc) return <>{children}</>;
  return (
    <details className="advanced">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
