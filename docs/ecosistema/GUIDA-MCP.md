# Casa negli agenti AI: guida all'installazione

Con questa guida un agente AI (Claude Code, Claude Desktop o un altro agente compatibile con MCP) può usare Casa:
- controlla e valuta un progetto salvato dal sito;
- prova varianti, sensibilità, piano nel tempo e preventivi;
- scrive il profilo per la comunità energetica.

I calcoli sono quelli del sito, con lo stesso motore.

**Chiunque può installarlo**, sul proprio computer: il codice è in questo repository, con licenza MIT. Prima di
installarlo leggi le avvertenze del §6.

## 1. Che cosa serve

- **Node.js 22.13 o più recente.** Provato con Node 24.15.0. Per controllare la versione: `node --version`.
- **Git**, per scaricare il repository. In alternativa, su GitHub, «Code» → «Download ZIP».
- **Circa 300 MB liberi**, fra il repository e le dipendenze.
- Non servono account, chiavi o Python: il server usa solo Node.js.
- **I dati del clima** sono già nel repository, in `public/data` (49 MB): 109 pacchetti del clima, i comuni e i gradi
  giorno. Il server li legge dal disco e non scarica niente da internet.

## 2. Scaricare Casa e costruire il server

La prima volta, in PowerShell (o in un altro terminale), dalla cartella dove vuoi tenere Casa:

```powershell
git clone https://github.com/raccasamuele/efficienza-energetica-casa.git
cd efficienza-energetica-casa
npm ci
npm run build:mcp
```

- `npm ci` installa le dipendenze nelle versioni esatte di `package-lock.json`. Serve solo la prima volta e dopo
  un aggiornamento (§7).
- `npm run build:mcp` crea un solo file, `dist-mcp/casa-mcp.mjs` (circa 520 kB), con il motore dentro. La cartella
  `dist-mcp` non va su git.
- Il percorso completo della cartella del repository è la `<cartella di Casa>` dei paragrafi seguenti. In
  PowerShell, dentro quella cartella, lo dà `(Get-Location).Path`.

## 3. Collegarlo a Claude Code

Questo comando registra il server per tutte le cartelle, non solo per quella del progetto. Funziona da qualsiasi
cartella. Al posto di `<cartella di Casa>` va il percorso completo della cartella del repository (§2):

```powershell
claude mcp add --scope user casa -- node "<cartella di Casa>\dist-mcp\casa-mcp.mjs"
```

Per controllare che sia collegato:

```powershell
claude mcp get casa
```

Deve dire `Status: ✔ Connected`. Dentro una sessione di Claude Code, `/mcp` mostra lo stesso stato.

- Il comando è provato il 20/11/2026 in PowerShell e in Git Bash, con Claude Code 2.1.329 e una configurazione
  separata. Il `--` passa intatto anche in PowerShell.
- **Senza `--scope user`** il server vale solo nella cartella da cui si è dato il comando: da altre cartelle Claude
  Code non lo vede. Una registrazione fatta così si toglie, da quella cartella, con `claude mcp remove casa -s local`.
  Se resta, non dà problemi: punta allo stesso file.

## 4. Collegarlo a Claude Desktop (provato il 23/11/2026)

Si fa **una volta sola**. Dopo, `casa` è collegato in ogni chat nuova, senza ripetere niente.

1. In Claude Desktop: Impostazioni → Sviluppatore → «Modifica configurazione». Claude Desktop crea il file
   `claude_desktop_config.json` nella cartella giusta e lo apre.
   - **Usare il pulsante, non cercare il file a mano.** La versione installata dal Microsoft Store tiene il file in
     `%LOCALAPPDATA%\Claude-Data\<cartella dell'installazione>\`, non in `%APPDATA%\Claude\` come dicono molte
     guide. Nella prova del 23/11/2026 `%APPDATA%\Claude\` non aveva il file, e sembrava che la configurazione non
     ci fosse.
2. Nel file, accanto a quello che c'è già, si aggiunge `mcpServers`. Al posto di `<cartella di Casa>` va il
   percorso completo del repository, con le barre rovesciate raddoppiate:

   ```json
   {
     "mcpServers": {
       "casa": {
         "command": "C:\\Program Files\\nodejs\\node.exe",
         "args": ["<cartella di Casa>\\dist-mcp\\casa-mcp.mjs"]
       }
     }
   }
   ```

   Il percorso completo di `node.exe` evita problemi se Claude Desktop non trova `node`. Lo dà `(Get-Command
   node).Source` in PowerShell.
3. **Chiudere del tutto Claude Desktop:** clic destro sull'icona vicino all'orologio, poi «Esci». Chiudere la finestra
   non basta, perché il server resta quello di prima. Poi riaprirlo.
4. In Impostazioni → Sviluppatore, `casa` deve risultare in esecuzione.

**Dove si vede la scheda**
- Nella **Chat**: con ogni strumento compare la scheda di Casa (§5).
- Nelle sessioni della scheda **Code**: lo stesso server c'è, ma le risposte sono solo testo.
- **Cowork:** non provato.

I log del server sono in `%LOCALAPPDATA%\Claude\Logs\mcp-server-casa.log`. Lì si vede se Claude Desktop l'ha avviato
e se ha letto la scheda (`resources/read`).

Gli altri agenti che avviano server MCP via stdio usano lo stesso comando: `node` più il percorso del file.

## 5. Come usarlo

Si salva il progetto dal sito («Salva il progetto», un file `.json`) e si chiede all'agente indicando il
percorso. Per esempio:

| Si chiede | Strumento |
|---|---|
| «Controlla il progetto in C:\…\casa.json: è completo?» | `controlla_progetto` |
| «Valuta il progetto in C:\…\casa.json con lo strumento casa» | `valuta_progetto` |
| «Creami un progetto per una casa a Torino: voglio sapere se conviene il fotovoltaico» | `crea_progetto` (fa le domande una alla volta e dà il link «Apri in Casa») |
| «E con 6 kWp? E se la luce costasse 0,35 €/kWh?» | `prova_variante` |
| «Quanto è sicura la scelta? Fai la sensibilità» | `sensibilita` (circa 5 secondi, con l'avanzamento) |
| «Come distribuisco gli interventi negli anni?» | `piano_nel_tempo` (solo per la domanda «quadro completo») |
| «Confronta i preventivi del fotovoltaico» | `confronta_preventivi` |
| «Scrivimi il profilo per la comunità energetica» | `scrivi_profilo` |

- **Il percorso è meglio del contenuto.** L'agente può anche incollare il contenuto del file, ma così il file
  intero passa dal servizio dell'agente.
- **Ogni risposta riporta lo stato dei dati, i limiti del modello e l'avvertenza.** Se l'agente li toglie,
  chiedili: sono parte del risultato.
- **Scheda nella chat.** Nella Chat di Claude Desktop e su claude.ai, ogni strumento mostra anche una scheda con i
  numeri principali, lo stato dei dati, i limiti e l'avvertenza. Con `crea_progetto` la scheda ha il pulsante «Apri
  in Casa».
  - Le sessioni della scheda Code mostrano solo il testo, come gli altri agenti. Il testo contiene comunque tutto.
- **Il server non scrive file.** Il profilo e i progetti creati tornano come testo, e li salva l'agente solo se
  glielo si chiede. I progetti creati con `crea_progetto` restano in memoria finché il server è acceso.

## 6. Prima di installarlo: che cosa sapere

Le avvertenze vengono dal test di sicurezza del 23/11/2026 ([`SICUREZZA.md`](../sicurezza/TEST-2026-11-23.md), punto 5).

1. **Che cosa esce dal computer.** Le risposte del server arrivano al servizio dell'agente: il dettaglio è sotto.
   Con `scrivi_profilo` escono anche il comune e i consumi medi della casa.
2. **Il server legge i file `.json` che l'agente gli indica**, fino a 2 MB, ovunque siano sul computer. Dai
   all'agente solo i percorsi dei tuoi progetti di Casa.
   - Con un file che non è un progetto di Casa il server risponde solo con un errore generico, senza il contenuto
     del file.
   - Rifiuta i percorsi di rete e di dispositivo di Windows (`\\server\…`, `//server/…`, `\\?\…`, `\\.\…`) con un
     errore generico: legge solo file sul computer.
   - Il server **non scrive file** e **non usa internet**.
3. **Costruiscilo dal repository ufficiale**, e ricostruiscilo dopo ogni aggiornamento (§7). Un file
   `casa-mcp.mjs` ricevuto da altri può contenere codice diverso.
4. **I risultati sono una preanalisi, non una diagnosi energetica.** Ogni risposta lo ricorda nell'avvertenza.

I testi scritti a mano nel progetto (nome, fornitori, fonti, periodi) non arrivano all'agente. Così un file preparato da
altri non può dare istruzioni all'agente attraverso il server.

Un problema di sicurezza si segnala come dice [`SECURITY.md`](../../SECURITY.md).

**Che cosa esce dal computer, nel dettaglio.** Il server gira sul computer, ma l'agente di solito no: quello che il
server risponde arriva al servizio dell'agente (per Claude, ad Anthropic). Per questo le risposte contengono solo
quello che serve:
- **Non escono:**
  - il nome del progetto, il comune e il codice ISTAT;
  - nomi e fornitori dei preventivi, che diventano «Preventivo 1», «Preventivo 2»…;
  - le voci scritte a mano;
  - POD, email, letture con le date;
  - le serie di 8.760 valori orari.
- **Esce il capoluogo del clima** (per esempio Milano), che serve a capire i numeri.
- **`crea_progetto` riporta le risposte date all'agente.** Il link «Apri in Casa» contiene, dopo il `#`, il codice
  del comune, i consumi, i prezzi e le altre risposte: sono i dati che l'utente ha già scritto nella chat. Chi riceve
  il link li può leggere; il sito non li riceve, perché la parte dopo il `#` non parte dal browser.
- **L'eccezione è `scrivi_profilo`.** Il profilo contiene il comune e i consumi ora per ora di un anno tipico (864
  valori medi), perché è fatto per uscire dal computer ed entrare nel simulatore della comunità energetica. La
  risposta lo dice in chiaro.

## 7. Dopo un aggiornamento di Casa

Il server ha dentro la versione del motore di quando è stato costruito. Per aggiornarlo, dalla cartella di Casa:

```powershell
git pull
npm ci
npm run build:mcp
```

Poi si apre una sessione nuova dell'agente. Per Claude Desktop serve la chiusura completa dall'icona vicino
all'orologio (§4, punto 3). Ogni risposta riporta la versione del motore, da confrontare con quella
del sito («preanalisi energetica · v0.18.1» accanto al nome, e nel report).

## 8. Problemi frequenti

| Che cosa succede | Che cosa fare |
|---|---|
| `claude mcp get casa` dice `Status: ✘ Failed to connect` | Manca `dist-mcp/casa-mcp.mjs`: `npm run build:mcp`. Oppure `node` non si trova: `node --version` deve rispondere. |
| L'agente non vede lo strumento `casa` | È registrato solo per un'altra cartella: registrarlo con `--scope user` (§3). Poi aprire una sessione nuova. |
| «Clima … non trovato nella cartella dei dati» | Il server cerca i dati in `public/data` accanto a `dist-mcp`. Se sono altrove, aggiungere `--dati "<cartella>"` in fondo al comando. |
| «Il progetto di Casa è un file .json.» o «File non trovato.» | Il percorso non è quello di un progetto salvato dal sito. Il limite è 2 MB, come nel sito. |
| «È un profilo energetico, non un progetto di Casa» | Il file è un profilo: si apre nel sito per creare il progetto. |
| In Claude Desktop la scheda di Casa non compare | Usare la Chat, non una sessione Code (§4). Dopo un aggiornamento del server, chiudere del tutto Claude Desktop e riaprirlo. Se Claude risponde a parole senza usare Casa, chiedere «usa lo strumento casa». |
| In Claude Desktop `casa` non c'è | La configurazione è in un altro file: aprirla con Impostazioni → Sviluppatore → «Modifica configurazione» (§4). |
| «Progetto non trovato» | I progetti creati con `crea_progetto` restano solo finché il server è acceso: va ricreato, o salvato prima. |

## 9. Toglierlo

```powershell
claude mcp remove casa -s user
```

In Claude Desktop si toglie il blocco `"casa"` da `mcpServers` (Impostazioni → Sviluppatore → «Modifica
configurazione») e si riavvia l'app.

Il file `dist-mcp/casa-mcp.mjs` si può cancellare: `npm run build:mcp` lo ricrea quando serve.
