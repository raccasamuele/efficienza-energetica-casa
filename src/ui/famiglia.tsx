// La barra comune di «Energia in chiaro»: la stessa, con le stesse classi, in Casa (src/ui/famiglia.tsx di quel progetto)
// e qui. Porta al portale e all'altro simulatore della famiglia; il sito aperto è segnato con aria-current.

export type SitoFamiglia = "casa" | "cer";

const SITI: { id: SitoFamiglia; nome: string; indirizzo: string }[] = [
  { id: "casa", nome: "Casa", indirizzo: "https://casa.raccasamuele.it/" },
  { id: "cer", nome: "Comunità energetica", indirizzo: "https://cer.raccasamuele.it/" },
];

export const PORTALE_FAMIGLIA = "https://raccasamuele.it/#energia-in-chiaro";

export function BarraFamiglia({ corrente }: { corrente: SitoFamiglia }) {
  return (
    <nav className="famiglia-barra no-print" aria-label="Energia in chiaro">
      <a className="famiglia-nome" href={PORTALE_FAMIGLIA}>Energia in chiaro</a>
      <ul>
        {SITI.map((s) => (
          <li key={s.id}>
            <a href={s.indirizzo} aria-current={s.id === corrente ? "page" : undefined}>{s.nome}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
