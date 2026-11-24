import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/**
 * Riquadro di approfondimento: chiuso sotto il titolo quando `folded`, altrimenti titolo e contenuto come sempre.
 * Proposta A della tappa E del piano dopo la 8: tariffe e «Dove finisce la spesa?» chiusi fuori dalla loro domanda.
 */
export function Foldable({ folded, title, children }: { folded: boolean; title: string; children: ReactNode }) {
  if (!folded) return <><h3>{title}</h3>{children}</>;
  return (
    <details className="fold fold-block">
      <summary><h3>{title}</h3></summary>
      {children}
    </details>
  );
}

/**
 * Gruppo del passo Interventi (proposta D della tappa E del piano dopo la 8). Aperto come sempre, oppure, quando
 * `folded`, un riquadro chiuso con il titolo e una riga che dice che cosa c'è dentro. Si apre da solo quando nel
 * gruppo c'è un errore e non si richiude da solo quando l'errore sparisce: chi sta scrivendo non perde il campo.
 */
export function Group({ folded, icon, title, status, alert, children }: { folded: boolean; icon: IconName; title: string; status?: string; alert: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(alert);
  useEffect(() => { if (alert) setOpen(true); }, [alert]);
  const head = <h3><span className="section-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>{title}</h3>;
  if (!folded) return <div className="section">{head}{children}</div>;
  return (
    <details className="section fold-block group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><span className="group-head">{head}{status && <span className="small muted group-status">{status}</span>}</span></summary>
      {children}
    </details>
  );
}
