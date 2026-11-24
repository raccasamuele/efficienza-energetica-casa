# Aggiornamento periodico dei dati — istruzioni per l'agente

Queste istruzioni le segue la routine trimestrale (Claude Code nel cloud) e chiunque faccia il controllo a mano. Valgono per questo repository; il simulatore CER ha un file gemello con le sue fonti.

## Regole che non si toccano

- **Mai su `main`, mai pubblicare.** Il push su `main` pubblica il sito. Si lavora su un ramo `aggiornamento-dati-AAAA-MM` e si apre una pull request verso `main`. Niente merge.
- **Nessun valore senza fonte.** Ogni numero cambiato porta fonte, edizione o data e indirizzo nel codice (testo della fonte del `Q`), in `NOTICE.md` e nel rapporto.
- **Nessun prezzo da una sola offerta o da un blog.** Servono fonti pubbliche e datate. Se non ci sono, si lascia il valore e si aggiorna solo la data del controllo.
- **Voci con `"automatico": false`**: non si cambia il codice né i dati. Si scrive solo il rapporto con quello che è cambiato e come rigenerare in locale.
- **Dati con licenza** (campo `licenza`): non si scaricano.
- **Importi degli utenti**: mai toccati (non sono in questo inventario).
- **Lingua**: italiano semplice in rapporto, commit e pull request. Commit senza la riga `Co-Authored-By`.

## Passi

1. **Voci da controllare.** `node aggiornamento/scadute.mjs` elenca le voci da controllare: quelle che scadono (`ultimo_controllo` + `frequenza_mesi`) prima della routine successiva, cioè entro `frequenza_routine_mesi` da oggi. Così una voce che scadrebbe fra un controllo e l'altro si guarda in anticipo, non con tre mesi di ritardo. Con `--tutte` le elenca tutte. Se non ce n'è nessuna, la routine si ferma senza aprire nulla.
2. **Per ogni voce da controllare**, seguendo `come_controllare`:
   - apri la fonte (`url` o ricerca della nuova edizione); leggi il documento originale, non un riassunto;
   - annota: fonte, edizione o data, indirizzo, valore trovato, unità, cosa include ed esclude (IVA, installazione…);
   - confronta con `valori`.
3. **Esito per voce**
   - **Invariato**: aggiorna solo `ultimo_controllo` (data di oggi).
   - **Cambiato, `automatico: true`**: aggiorna il valore nel codice (`dove`), il testo della fonte, `NOTICE.md` e la voce dell'inventario (`valori`, `fonte`, `url`, `ultimo_controllo`). Se la differenza supera `soglia_pct`, segnalala nel rapporto come **«da verificare a mano»**.
   - **Cambiato, `automatico: false`**: lascia codice e dati; aggiorna `ultimo_controllo` e descrivi nel rapporto la novità e i comandi per rigenerare in locale.
   - **Fonte non raggiungibile**: non cambiare il valore; scrivi nel rapporto «fonte non raggiungibile» con la data. Se era già successo al controllo precedente (vedi l'ultimo rapporto in `docs/aggiornamenti/`), segnalalo come **«serve una fonte nuova»**.
4. **Gradi giorno osservati**: eseguire `.venv/Scripts/python scripts/climate/fetch_gradi_giorno.py`; controllare la copertura da gennaio 2015 all'ultimo mese completo, gli hash dei grezzi e la coerenza 2015–2024 rispetto al TMY. La richiesta è una per capoluogo, al massimo una ogni secondo.
5. **Controlli**: `npm ci`, poi `npm test`, `npm run typecheck`, `npm run build`. Se un test fallisce per un valore cambiato (per esempio un test che conosce il prezzo), aggiorna il test solo se il nuovo comportamento è corretto e dillo nel rapporto. Se non sai perché fallisce, non forzare: scrivilo nel rapporto e apri comunque la pull request come bozza.
6. **Rapporto** in `docs/aggiornamenti/AAAA-MM.md` (formato sotto).
7. **Ramo, commit e pull request**: ramo `aggiornamento-dati-AAAA-MM` da `main`; un commit con messaggio «Aggiornamento dati AAAA-MM: …»; pull request verso `main` con titolo «Aggiornamento dati AAAA-MM» e nel testo il riassunto del rapporto (tre righe in cima: quante voci controllate, quante cambiate, quante da verificare a mano). Se nulla è cambiato e nessuna fonte manca, apri lo stesso la pull request con le sole date aggiornate: è la prova che il controllo è stato fatto.

## Formato del rapporto

```markdown
# Aggiornamento dati — AAAA-MM

Controllo del GG/MM/AAAA. Voci controllate: N. Cambiate: N. Da verificare a mano: N. Fonti non raggiungibili: N.

| Voce | Esito | Prima | Dopo | Fonte (edizione, data) |
|---|---|---|---|---|
| fv-prezzo-residenziale | invariato | 1530 €/kWp | — | IEA PVPS NSR Italy 2024, tab. 11 |

## Dettagli
Per ogni voce cambiata o da verificare: cosa dice la fonte, cosa include ed esclude, perché il valore nuovo è confrontabile con il vecchio, effetto sui risultati dell'esempio (VAN del FV, taglia indicativa) prima e dopo.

## Da fare in locale
Voci con `automatico: false` cambiate: comandi per rigenerare (script, Python di .venv) e cosa controllare dopo.

## Controlli
Esito di test, typecheck e build.
```
