/** Illustrazioni clay generate per il progetto, WebP trasparenti 48/96 px. */
export type IconName = "auto" | "casa" | "localita" | "calore" | "bolletta" | "interventi" | "risultati" | "sensibilita" | "report" | "rapida" | "verifica" | "clima" | "geometria" | "confini" | "serramenti" | "temperatura" | "acqua" | "fresco" | "costi" | "solare" | "pdc" | "pareti" | "nome" | "crescita" | "calo" | "batteria" | "fv-batteria" | "domanda" | "quadro" | "fv-esistente" | "comunita";
export function Icon({ name, size = 24, label, className = "" }: { name: IconName; size?: number; label?: string; className?: string }) {
  const source = `${import.meta.env.BASE_URL}icons/${name}`;
  return <img className={`casa-icon ${className}`} src={`${source}.webp`} srcSet={`${source}.webp 1x, ${source}-2x.webp 2x`} width={size} height={size} alt={label ?? ""} aria-hidden={label ? undefined : true} draggable={false} />;
}
