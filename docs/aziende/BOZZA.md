# Piattaforma per aziende e capannoni — bozza

Stato: **bozza su carta, niente codice.** Linee approvate da Samuele il 7/11/2026 (proposte A1-A8).
Visione di lungo periodo: una nota di visione non inclusa nel repository (profilo «Azienda multisito», §11 «Funzioni per aziende», fasi 0-4). Questa bozza non la ripete: sceglie un primo pezzo piccolo.

Nel piano medio termine di Casa le «Piccole attività» (7D) sono fuori dal medio termine: si parte solo con richieste concrete (vedi §9).

## 1. A chi si rivolge

- Capannoni artigiani e piccole imprese con **un solo sito**.
- Superficie fra 500 e 5.000 m².
- Allacciati in bassa o media tensione, fino a circa 200 kW di potenza.
- Chi usa il sito: il titolare, il responsabile tecnico, o il tecnico esterno che lo segue.
- **Dopo**: aziende con più sedi (KPI di portafoglio, MACC), come nella nota di visione.

## 2. Le domande della prima versione

Prima la parte elettrica, perché il dato c'è già (curva del contatore) e il modello di Casa si riusa in gran parte.

| # | Domanda | Cosa serve di nuovo rispetto a Casa |
|---|---|---|
| 1 | «Quanto fotovoltaico mi conviene sul tetto?» | autoconsumo sui turni di lavoro (giorni feriali, chiusure, ferie di agosto); tetti grandi e piani; prezzi per kWp di impianti grandi; regole di connessione oltre 20 kW |
| 2 | «Pago troppo di potenza e di tariffa?» | fasce F1-F3, quota potenza, energia reattiva (penali), confronto delle strutture di prezzo per BT e MT |
| 3 | «Conviene passare ai LED?» | inventario semplice delle lampade (numero, potenza, ore); risparmio e costo |
| 4 | «Entro in una comunità energetica?» | profilo dell'azienda per il simulatore CER (formato del profilo da estendere ai 15 minuti, vedi §5) |

**Seconda fase**: riscaldamento del capannone (aerotermi a gas, pompa di calore, pannelli radianti, destratificatori).
Serve un modello termico nuovo: volumi alti, stratificazione dell'aria, portoni aperti, ricambi grandi. Il modello della casa non basta.

**Dopo ancora**: aria compressa, motori e inverter, recupero di calore dai processi. Molto legati al tipo di attività: solo se arriva un caso concreto.

## 3. Dati in ingresso

- **Dato principale**: curva quartoraria del contatore della luce di 12 mesi (prelievi e, se c'è il FV, immissioni). Le aziende di solito la hanno dal distributore o dal venditore.
- Bollette della luce: fasce F1-F3, potenza impegnata e prelevata, energia reattiva, oneri.
- Bollette del gas (per la seconda fase).
- Dati del sito: comune, tetto (m², orientamento, tipo di copertura), orari e turni, giorni di chiusura.
- Preventivi, come in Casa (fino a tre per intervento).

Formati da provare con file veri anonimi, come per Casa: le curve dei distributori e dei venditori non hanno tutte lo stesso formato.

## 4. Cosa esce

- Per ogni domanda: risparmio annuo, costo, VAN e tempo di ritorno, con un intervallo (sensibilità), come in Casa.
- Un report stampabile per il titolare o per la banca.
- Indicatori semplici: kWh per m², kWh per addetto, quota di energia nelle ore di lavoro.
- **Non** è una diagnosi energetica di legge (D.Lgs. 102/2014) né un progetto: deve dirlo come Casa.

## 5. Cosa si riusa da Casa

| Modulo di Casa | Uso |
|---|---|
| `climate.ts`, `location.ts`, pacchetti clima | stessi comuni e stesso anno tipico |
| `electric.ts` (produzione FV e profili della luce) | produzione uguale, da controllare per impianti grandi e falde multiple; profili sintetici delle case da sostituire con i turni |
| `battery.ts` | uguale, con taglie più grandi |
| `economics.ts`, `sensitivity.ts`, `preventivi.ts` | uguali |
| `misure.ts` | lettura delle curve del contatore (oggi ridotte a una forma media); per le aziende serve tenere la curva intera a 15 minuti |
| `tariffe.ts` | base per le fasce; da allargare a quota potenza e reattiva |
| `profilo.ts`, `curva.ts` | profilo e curva per la CER; serve una versione a 15 minuti o con più giorni tipo |

**Nuovo**: profilo dei turni, tariffe BT/MT complete, inventario LED, poi il modello termico del capannone.

Il passo orario di Casa è un limite già scritto (`IPOTESI-INCERTE.md`, «Passo orario»). Per le aziende il quarto d'ora conta di più (potenza, picchi): il motore aziende dovrebbe lavorare a 15 minuti fin dall'inizio.

## 6. Dove sta il codice: due strade

Si decide all'inizio della prima tappa.

| | A. Repository e sito a parte | B. Un solo repository condiviso |
|---|---|---|
| Come | nuovo repository (per esempio `aziende`), sito `aziende.raccasamuele.it`; i moduli di Casa copiati con la versione | pacchetti comuni (clima, FV, economia, tariffe) usati da Casa, CER e aziende, come la «Fase 0» della nota di visione |
| Pro | parte subito; Casa non si tocca | una sola correzione vale per tutti |
| Contro | correzioni da riportare a mano in due posti | prima bisogna spostare il codice di Casa e della CER senza cambiare i numeri (lavoro lungo, con i test golden) |
| Quando | se si vuole provare in fretta con un caso vero | se le aziende diventano un prodotto stabile |

Proposta di Claude: **A** per il primo prototipo, con una regola: i moduli copiati restano identici a quelli di Casa (stesso test). Si passa a **B** solo quando le copie cominciano a divergere.

## 7. Dati e privacy

- Prima versione: tutto nel browser, come Casa. Nessun account, nessun server di calcolo.
- File di progetto da scaricare e reimportare.
- I dati di un'azienda sono più sensibili (consumi = attività): nessun invio a servizi esterni senza consenso esplicito.
- **Dopo**: account e condivisione con il tecnico, come la «Fase 3» della nota di visione (backend opzionale su Cloudflare).

## 8. Gratis o a pagamento

Non si decide ora. La domanda è già aperta nella nota di visione non inclusa nel repository («Domande aperte»).
Opzioni da valutare:
- tutto gratuito, come Casa e la CER;
- gratuito nel browser, a pagamento le funzioni con server (account, condivisione, più siti);
- gratuito per le aziende, a pagamento per i tecnici che lo usano con molti clienti.

Prima di decidere: almeno un'azienda vera che lo usa (vedi §9).

## 9. Prima di scrivere codice

1. **Un caso concreto**: un'azienda o una persona interessata, con la curva quartoraria e le bollette di un anno. *Da completare da Samuele.* Senza un caso, il prototipo si costruisce su dati inventati e rischia di rispondere a domande che nessuno fa.
2. **Due o tre colloqui brevi** (titolare, tecnico, installatore FV per aziende): quali domande fanno davvero, quali dati hanno, cosa usano oggi.
3. **Prova degli strumenti esistenti** sullo stesso caso (come la «Fase 0» del piano di Casa): dove si fermano.
4. **Specifica della prima tappa** (solo la domanda 1 del §2, fotovoltaico sui turni), con le soglie di prova, prima del codice.

## 10. Rischi

- **Dominio molto vario**: un panificio e un'officina meccanica hanno consumi diversissimi. Rimedio: solo la parte elettrica e i turni all'inizio, niente processi.
- **Regole diverse dalle case**: connessione degli impianti grandi, accise, incentivi per le imprese (Transizione 5.0 e successivi), CER per le imprese. Da verificare con fonti aggiornate in ogni tappa.
- **Tempo**: Casa ha ancora la validazione e le tappe 7B e 7C. Le aziende non devono fermare la validazione.
- **Responsabilità**: un'azienda può decidere investimenti grandi su questi numeri. Servono avvisi chiari e, per un uso commerciale, la lettura di un esperto (come per Casa).
