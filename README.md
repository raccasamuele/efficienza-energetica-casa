# Casa — simulatore di interventi energetici per la casa

**Casa** confronta, sulla stessa casa e nello stesso anno climatico tipico calcolato ora per ora, la situazione di
oggi con gli interventi possibili. Risponde a domande concrete, in italiano:

- Mi conviene il fotovoltaico, con o senza batteria? Ho già il fotovoltaico: mi conviene la batteria?
- Mi conviene la pompa di calore, per il riscaldamento o l'acqua calda?
- Mi conviene cambiare i serramenti o isolare la casa?
- Mi conviene l'auto elettrica, con o senza pannelli? Quale tariffa della luce mi conviene?
- Voglio il quadro completo.

- **Provalo:** <https://casa.raccasamuele.it>. Si usa nel browser, senza account: i dati della casa restano nel
  browser e il calcolo si fa sul dispositivo.
- **Come funziona** (metodo, formule, fonti, confronti con EnergyPlus): <https://raccasamuele.it/metodo/casa>.

È una **preanalisi a scopo di confronto**: non è un APE, una classe energetica, una perizia, un dimensionamento né
un risparmio garantito. I limiti sono [più sotto](#limiti).

## Che cosa c'è in questo repository

| Cartella | Contenuto |
|---|---|
| `src/engine/` | Il motore di calcolo in TypeScript (motore 0.18.0), senza dipendenze dall'interfaccia |
| `src/ui/` | L'interfaccia del sito, in React |
| `mcp/` | Il server MCP locale per gli agenti AI |
| `scripts/` | Preparazione offline dei dati (Python con pvlib) e controlli |
| `data/`, `public/data/` | Fonti con data e hash, dati derivati e pacchetti del clima |
| `tests/` | Prove del motore, dei dati e dell'interfaccia (Vitest) |
| `validazione/` | Confronto con EnergyPlus |
| `docs/` | Documenti tecnici: [guida per gli agenti AI](docs/ecosistema/GUIDA-MCP.md), [validazione con EnergyPlus](docs/validazione/), [ipotesi incerte](docs/IPOTESI-INCERTE.md), [confronto con la teoria](docs/confronto-teoria.md), [test di sicurezza](docs/sicurezza/TEST-2026-11-23.md) |

## Provarlo in locale

Serve Node.js 22.13 o successivo (la lettura delle bollette PDF lo richiede); è provato con Node 24.

```bash
npm ci
npm run dev -- --port 5180
```

Apri l'indirizzo mostrato (http://127.0.0.1:5180). Nessun account, backend o API durante il calcolo. Aprire `index.html` con `file://` non funziona, perché il pacchetto clima viene caricato via HTTP dal server locale.

Altri comandi:

```bash
npm test            # motore, dati e pipeline offline (il test delle pipeline usa il Python di .venv; senza .venv si salta)
npx vitest run --exclude tests/audit-b-pipelines.test.ts   # gli stessi test, senza Python
npm run typecheck   # controllo dei tipi
npm run build       # build statica in dist/
npx vite-node scripts/print-example.ts   # risultati del caso d'esempio in console
```

## Strumenti per agenti AI

Casa ha un server [MCP](https://modelcontextprotocol.io) locale: un agente AI (Claude Code, Claude Desktop o un altro
agente compatibile con MCP) usa lo stesso motore del sito su un progetto salvato dal sito («Salva il progetto»).
Può controllarlo e valutarlo, provare varianti, fare la sensibilità e il piano nel tempo, confrontare i preventivi,
creare un progetto nuovo con domande una alla volta e scrivere il profilo per la comunità energetica.

**Chiunque può usarlo**, sul proprio computer: si costruisce da questo repository.

```bash
npm ci
npm run build:mcp    # crea dist-mcp/casa-mcp.mjs, con il motore dentro
```

Installazione per Claude Code e Claude Desktop, uso, avvertenze e che cosa esce dal computer:
[`docs/ecosistema/GUIDA-MCP.md`](docs/ecosistema/GUIDA-MCP.md). Il server gira sul computer, legge i dati del clima
dal disco, non scrive file e non usa internet; le risposte arrivano comunque al servizio dell'agente, e la guida dice
quali dati restano fuori.

## Come si usa

All'ingresso scegli **Rapida** (caratteristiche osservabili della casa, bollette e ipotesi dichiarate) o **Documentata** (rilievi, schede e preventivi con fonte), poi **Inizia con la tua casa** o **Esplora un esempio**. L'esempio non viene salvato automaticamente prima della scelta. I valori ereditati restano riconoscibili nel riepilogo delle ipotesi; cambiare modalità conserva i dati senza documentarli automaticamente.

1. **Località e dominio** — conferma la località e verifica che il caso rientri nel dominio (riscaldamento continuo, una zona).
2. **Edificio** — modalità *Rapida* (forma in pianta, rapporto finestrato, preset dichiarati) oppure *Documentata* (aree nette e fonte di ogni dato). Ogni valore ha uno stato: documentato, misurato, ipotizzato o «non so».
3. **Servizio e impianto** — temperatura in casa, stagione, tipo di caldaia, acqua calda e cucina; d'estate se raffreschi (split), terminali dell'impianto e schermature. In Rapida rendimenti, mandata e separazione dei consumi sono sotto **Vedi le ipotesi tecniche**; in Documentata sono esposti con fonte e stato.
4. **Consumi e tariffe** — bolletta del gas (solo per il confronto diagnostico), elettricità degli altri usi, prezzi con data e provenienza.
5. **Interventi e preventivi** — parametri dei tre interventi e voci di costo (inclusa / non necessaria / sconosciuta), distinti dall'origine dell'importo. In Documentata inserisci fonte e data e usa **Ho trascritto questi importi dal preventivo** per confermare le voci incluse. Una voce sconosciuta rende l'economia incompleta: niente VAN né rientro.
   Nel blocco impianto puoi scegliere anche il piano a induzione se oggi cucini a gas. Indica i costi del piano, delle pentole e della posa e della chiusura del contatore: quest'ultima entra nei conti, insieme alla rimozione della quota fissa, solo quando non resta nessun uso del gas. La cottura segue la forma oraria degli altri usi elettrici. Piano e chiusura del contatore sono esclusi dalla spesa incentivata. Scelta assente o spenta: risultati invariati.
6. **Risultati** — tabella degli 8 pacchetti, alternative non dominate, spesa annua per voce, flusso di cassa cumulato, registro dei servizi e contabilità per pacchetto.
7. **Sensibilità** — variazioni singole delle ipotesi, intervalli di risparmio e VAN, «differenza non risolta», stabilità della graduatoria.
8. **Report** — versione stampabile (o PDF dal browser) con versioni, clima, input con stato e fonte, ipotesi e limiti.

Il pulsante **Salva il progetto** salva un file JSON con versione del motore e hash del clima; **Importa una casa** (in «Le mie case») lo ricarica, controllandolo come dato non fidato. La bozza nel browser è solo una comodità, non un backup.

Un numero vuoto o non leggibile resta in digitazione: correggilo o ripristina esplicitamente l'ultimo valore usato prima di cambiare passo o esportare. I valori fuori intervallo hanno un errore associato al campo. Le priorità nel riepilogo portano al dato da completare: sono motivate da prezzi, fattibilità e preventivi, non da un'influenza calcolata dal motore. Tutti gli input sono compilabili dalla UI; il catalogo PDC mantiene comunque il confronto esplorativo perché la capacità modificata non è validata (limite dichiarato).

## Cosa c'è nel motore (`src/engine/`)

| Modulo | Contenuto |
|---|---|
| `thermal.ts` | Rete oraria 5R1C a due nodi (UNI EN ISO 13790, appendice C); il passo 1R1C resta come funzione; transitorio di inizio stagione separato; fasce orarie facoltative con potenza limitata (0.16.0) |
| `geometry.ts` | Aree da forma in pianta (quadrata, rettangolare 2:1, L, ferro di cavallo) o da rilievo |
| `heatpump.ts` | PDC **parametrica esplorativa**: Carnot ridotto, curva climatica di mandata, potenza vs T esterna, sbrinamento; niente estrapolazione né backup implicito |
| `electric.ts` | Profili sintetici o, a scelta, medi ARERA 2025 con stagioni e tipo di giorno; stesso totale annuo, bilancio orario FV (autoconsumo, prelievo, cessione) |
| `scenarios.ts` | 8 pacchetti ricalcolati sullo stesso edificio, registro dei servizi, contabilità per voce |
| `economics.ts` | Completezza dei costi, flusso di cassa reale, VAN, rientro semplice e attualizzato |
| `sensitivity.ts` | Varianti singole applicate a tutti i pacchetti |
| `quality.ts` | Intervalli fisici, campi critici, stato «esplorazione» vs «documentato» |
| `project.ts` | Export/import con controllo di schema, tipi e numeri finiti |
| `cooling.ts` | Raffrescamento: EER orario degli split, consumo con potenza limitata (usato anche dalla PDC reversibile in `heatpump.ts`) |
| `curva.ts` | Curve orarie nel formato `curva-consumi` v1 del simulatore CER, usate nel profilo energetico che si scarica da «Le mie case» («scarica il profilo di questa casa») |

Il pacchetto clima `public/data/packages/<codice ISTAT>.json` viene prodotto offline:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install pvlib==0.11.1 pandas==2.2.3 numpy==2.1.3
.venv/Scripts/python -m pip install pypdf==5.1.0 pyshp==2.3.1 pyproj==3.7.0
node scripts/data/fetch_audit_sources.mjs                  # fonti ISTAT 2026, hplib versionato e report Keymark
.venv/Scripts/python scripts/data/build_comuni.py          # anagrafe comuni (ISTAT + DPR 412)
.venv/Scripts/python scripts/climate/fetch_capoluoghi.py   # coordinate OSM + 109 TMY PVGIS
.venv/Scripts/python scripts/climate/build_package.py      # pacchetti compatti + indice
.venv/Scripts/python scripts/data/build_hp_catalog.py      # catalogo PDC (hplib / HP Keymark)
.venv/Scripts/python scripts/data/build_profili_elettrici.py # profili ARERA 2025; richiede lo ZIP regionale locale, non incluso
npx vite-node scripts/check-packages.ts                    # validazione dei 109 pacchetti
```

L'archivio storico TMY, query e hash in `data/raw/` è in sola lettura. La cache viene riusata soltanto se richiesta completa (coordinate, API, finestra, database, formato, orizzonte), sidecar, hash e risposta concordano. Nuove acquisizioni e `fetch_capoluoghi.py --refresh` si conservano in `data/sources/climate/<chiave>/<acquisizione>/`, senza sovrascrivere le precedenti. Il builder rifiuta una cache che non corrisponde alle coordinate richieste. Fonti versionate e relativi hash sono nei manifest `data/sources/istat-source.json` e `data/sources/keymark/*-source.json`.

## Limiti

- **Dominio:** casa indipendente, monozona, riscaldamento autonomo a gas. Anagrafe ISTAT al **21/02/2026: 7.894
  comuni**, centroidi derivati dai confini 2025, aggregati per le fusioni 2026; clima orario scelto fra 109 TMY
  PVGIS, con ID storici conservati. Non ogni nuovo capoluogo ha un pacchetto dedicato. Dati DPR discordanti o
  approssimati restano esplorativi e mostrano donatore, riga e stato della verifica.
- Il clima è quello del capoluogo scelto, non del comune esatto (avviso oltre 40 km, 250 m o zona diversa); la temperatura di progetto è stimata dal TMY; apporti interni costanti; d'estate solo calore sensibile (umidità e raffrescamento notturno non modellati).
- PDC: sei varianti esatte del CSV hplib, con certificato e punti conservati, oppure il modello parametrico esplorativo; nessun dimensionamento. Il COP usa 8 punti, il fit P_el solo 4: l'app conta ore ed energia termica estrapolate oltre l'inviluppo comune, mantenendo i blocchi prudenziali sotto −7 °C e oltre 55 °C di mandata (aria del fit saturata a 12 °C nelle ore miti). Il MAPE non misura l'errore della capacità modificata dal progetto, che resta non validata. Due report Keymark non acquisibili (HTTP 500): limite esplicito per VERSI e ADAPT; nessuna revisione o edizione di norma inventata (vedi `NOTICE.md`).
- Le trasmittanze preimpostate sono valori tipici TABULA per epoca, non misure della casa; altri preset (ombre, spifferi, rendimenti) restano provvisori.
- Il confronto con EnergyPlus (livello B della validazione) esiste: risultati in [RISULTATI-B.md](docs/validazione/RISULTATI-B.md) e analisi in [ANALISI-B.md](docs/validazione/ANALISI-B.md), con esiti e limiti. Mancano ancora i confronti con case reali (livello E): i numeri non hanno un'accuratezza dimostrata su case reali.
- I prezzi d'esempio non sono prezzi attuali.
- Con la curva del contatore e gli split, il consumo estivo dei condizionatori è già nella curva e il modello lo aggiunge di nuovo: i consumi elettrici risultano più alti. Il sito lo avverte; la correzione è da fare.
- `npm audit` segnala avvisi solo negli strumenti di sviluppo (Vite 5, Vitest 2, CLI `cf`), non nelle dipendenze del sito e del server MCP (controllo del 23/11/2026, [test di sicurezza](docs/sicurezza/TEST-2026-11-23.md)). Gli aggiornamenti cambiano versione principale e sono da fare.

## Sicurezza

Un problema di sicurezza si segnala in privato, non con una issue pubblica: scrivi a **sicurezza@raccasamuele.it** o
usa le segnalazioni private di GitHub. Come e che cosa, in [`SECURITY.md`](SECURITY.md).

## Licenza e dati di terzi

- **Il codice di Casa è distribuito con licenza [MIT](LICENSE)**, © 2026 Samuele Racca.
- **I dati e il software di terzi tengono le loro licenze**, elencate in [`NOTICE.md`](NOTICE.md). Le principali:
  dati climatici PVGIS (© Unione Europea, JRC; riuso con riconoscimento della fonte), ISTAT (CC BY 4.0),
  OpenStreetMap (ODbL 1.0), hplib (codice MIT, database CSV CC BY 4.0), profili elettrici medi ARERA in
  `src/engine/data/profili-arera.json` (CC BY-SA 4.0, attribuzione ARERA).
- Se riusi i dati, conserva le attribuzioni indicate in `NOTICE.md`; la licenza MIT non si estende a quei dati.

## Pubblicazione

Casa è online su <https://casa.raccasamuele.it>, nella famiglia «Energia in chiaro» del portale raccasamuele.it, accanto
al simulatore della comunità energetica. È un Worker di Cloudflare, `casa-sito`, con i file di `dist/` come static
assets; si pubblica con la CLI `cf` (non Wrangler) dalla cartella `pubblica/`, che ha le sue dipendenze:

```bash
npm run build
cd pubblica && npm ci && npx cf deploy --dry-run   # prova, senza mandare nulla
npx cf deploy
```

**Automatica da GitHub.** A ogni push su `main` il workflow `.github/workflows/pubblica.yml` fa typecheck, test (esclusi
quelli delle pipeline dei dati, che chiedono il Python di `.venv`) e build, poi pubblica. Servono in GitHub, *Settings →
Secrets and variables → Actions*, il segreto `CLOUDFLARE_API_TOKEN` e la variabile `CLOUDFLARE_ACCOUNT_ID`. Senza il
token la pubblicazione si salta, con un avviso. Il calcolo resta nel browser: il sito serve solo pagina e pacchetti clima.
