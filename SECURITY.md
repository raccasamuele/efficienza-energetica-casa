# Sicurezza

*English: to report a security issue, email **sicurezza@raccasamuele.it** or use GitHub's private vulnerability
reporting (Security tab → "Report a vulnerability"). Please do not open a public issue. I aim to reply within 7 days;
English is fine.*

Se trovi un problema di sicurezza in Casa, scrivimelo in privato. **Non aprire una issue pubblica**: finché il
problema non è corretto, potrebbe usarlo qualcun altro.

## Come segnalare

- **Email:** **sicurezza@raccasamuele.it**.
- **GitHub:** nella scheda *Security* di questo repository, «Report a vulnerability». La segnalazione resta privata
  fra te e me.

## Che cosa scrivere

- che cosa succede, e che cosa ti aspettavi;
- i passi per rifarlo: la pagina o lo strumento, il file usato, il browser o l'agente AI;
- la versione del motore, che il sito mostra accanto al nome («preanalisi energetica · v…») e il server MCP
  riporta in ogni risposta;
- che cosa può fare chi sfrutta il problema.

Non mandare dati personali veri: bollette, codici POD o PDR, indirizzi. Se serve un file d'esempio, togli o inventa
nomi e numeri.

## Che cosa succede dopo

- **Cerco di risponderti entro 7 giorni**, anche solo per dire che ho ricevuto la segnalazione.
- Ti scrivo se è un problema vero e quando conto di correggerlo.
- La correzione si pubblica sul sito e nel repository. Se vuoi, nelle note della correzione ti ringrazio per nome.
- Ti chiedo di aspettare la correzione prima di parlarne in pubblico.

Casa è un progetto personale, senza ricompense per le segnalazioni.

## Che cosa riguarda

**Sì:**
- il sito <https://casa.raccasamuele.it> e il suo codice in questo repository (`src/`, `public/`, `index.html`), compresi
  i file che il sito legge (progetti salvati, profili, file del contatore, bollette in PDF, link «Apri in Casa»);
- il server MCP per gli agenti AI (`mcp/`): per esempio un file che gli fa leggere o rivelare dati che non dovrebbe;
- la pubblicazione: il Worker `casa-sito` (`pubblica/`) e il workflow di GitHub Actions.

**No:**
- gli altri siti di raccasamuele.it (il portale e il simulatore della comunità energetica): non sono in questo
  repository;
- i servizi di Cloudflare e di GitHub in sé;
- attacchi che puntano solo a sovraccaricare il sito con molte richieste, o che chiedono di ingannare una persona;
- gli avvisi già noti di `npm audit` negli strumenti di sviluppo (test, server di sviluppo, CLI di pubblicazione):
  non arrivano al sito né al server MCP. Se ne trovi uno che ci arriva, è nel perimetro;
- numeri che sembrano sbagliati: non sono un problema di sicurezza, ma una issue normale è benvenuta.

Si corregge solo la versione più recente: quella pubblicata sul sito e il ramo `main`.
