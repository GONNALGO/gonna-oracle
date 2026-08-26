# DEPLOY-RENDER — l'oracle GONNA ARENA su Render (testnet, app 769907387)

Guida per il Principe. L'oracle è il server che firma punteggi e verdetti
dopo averli riverificati. Metterlo su Render lo rende pubblico: il gioco
smette di dipendere dal `localhost:8787`.

## ⚡ STATO LIVE (26 agosto 2025 — v16.1.1)

**L'oracle pubblico è ATTIVO**: <https://gonna-arena-oracle-testnet.onrender.com>

- Servizio Render: `gonna-arena-oracle-testnet` (id `srv-da7auj8u01pc738qmkkg`),
  region **Frankfurt**, health check su `/v1/health`.
- Repo pubblico di deploy: <https://github.com/GONNALGO/gonna-oracle>
  (snapshot standalone di questa cartella, con il fix del lockfile).
- **Piano FREE** (scelta del Principe). Due avvertenze da conoscere:
  1. **Spin-down dopo 15 min** di inattività → la prima richiesta dopo la
     nanna impiega ~30-60 s (cold start). Le successive sono normali.
  2. **Database effimero** (niente disco sul free) → a ogni redeploy/restart
     la finestra anti-riuso delle ricevute di continue riparte da zero.
     **Accettato SOLO per testnet.** Per mainnet: upgrade a **Starter +
     disco da 1 GB su `/data`** — si fa con UN click dal dashboard
     (Upgrade plan + Add Disk), nessun redeploy, nessuna modifica al codice.
- **Runtime native node 22**, NON Docker: deviazione documentata. Il
  `Dockerfile` resta valido e testato, ma la build Docker su Render falliva
  per colpa del lockfile (vedi sotto) e la via native è stata la più rapida
  a convergere. Build command: `npm ci --no-audit --no-fund && npm run build
  && npm prune --omit=dev`; start: `node dist/index.js`; `DB_PATH=oracle.db`
  (effimero, vedi avvertenza 2).
- **Fix del lockfile** (root cause dei primi 4 deploy falliti): il
  `package-lock.json` era stato generato nella sandbox di sviluppo con URL
  tarball di un registry privato (`npm.mirrors.msh.team`), irrisolvibile da
  fuori — ogni `npm ci` moriva dopo ~70 s di timeout DNS. Tutti i 145 URL
  riscritti a `registry.npmjs.org` (gli hash di integrità sono sul contenuto,
  invariati). Se rigeneri il lockfile nella sandbox, ripeti la riscrittura.
- Smoke live superato: firma onesta 200 + verifica locale della firma,
  punteggio gonfiato → 400 REPLAY MISMATCH, CORS gonna.bond sì /
  evil.example no, e una card duel completa creata→join→resolve con sole
  firme dell'oracle pubblico (txid nel report di missione).

## (a) Cosa serve

1. Un **account Render** (render.com) — email e password bastano.
2. Il **codice su GitHub** in un repo che Render può leggere (pubblico, o
   privato con l'integrazione GitHub collegata). Serve solo la cartella
   `oracle-server/`: il blueprint `render.yaml` la usa come radice della build.
   *Alternativa senza GitHub*: immagine Docker pubblica (vedi "Manuale" sotto).
3. La **chiave API di Render** (Account Settings → API Keys) SOLO se vuoi
   automatizzare via script. Per la via manuale non serve.
4. Il **mnemonic dell'oracle** (25 parole). Non va MAI nel repo, MAI in chat,
   MAI in screenshot. Si inserisce solo come segreto Render (punto f).

## (b) Via automatica (blueprint) e via manuale

### Blueprint (consigliata)

Il file `oracle-server/render.yaml` descrive tutto il servizio. Da Render:
**New → Blueprint** → colleghi il repo → Render legge `render.yaml` e crea:
servizio web Docker in **Frankfurt**, piano **Starter**, disco da 1 GB su
`/data`, health check su `/v1/health`, tutte le variabili d'ambiente già
impostate. `autoDeploy` è **spento**: i deploy si lanciano a mano dal
pulsante "Deploy latest commit" (l'oracle è un servizio delicato, niente
deploy automatici a ogni push).

### Manuale (se il blueprint non piace)

1. **New → Web Service** → repo GitHub.
2. Root Directory: `oracle-server` · Runtime: **Docker** (usa il `Dockerfile`
   della cartella, niente da configurare) · Region: **Frankfurt**.
3. Piano: **Starter** (vedi punto c — NON free).
4. **Disks → Add Disk**: nome `oracle-data`, mount `/data`, 1 GB.
5. Health Check Path: `/v1/health`.
6. Variabili d'ambiente: copia quelle di `render.yaml` (sezione `envVars`).
   `PORT` **non** si tocca: la inietta Render da solo (il server la legge;
   in locale resta 8787).
7. Crea il servizio. Al primo boot controlla i log: deve apparire
   `[oracle] ready addr=COI33V32… keysrc=…`.

## (c) Piano: free ora (testnet), Starter per mainnet

Il servizio LIVE oggi è **free** (scelta del Principe, vedi STATO LIVE).
Il disco persistente esiste **solo nei piani a pagamento** (Starter, ~7 $/mese).
Sul piano **free** il filesystem è effimero: a ogni restart/redeploy il
database SQLite sparisce. Quel database contiene le **ricevute dei continue**
già viste: perderlo riapre una **finestra di riuso delle ricevute** — un
giocatore potrebbe ri-presentare la stessa ricevuta di continue dopo un
restart e il server la accetterebbe di nuovo. Rischio concreto di doppi
continue pagati una volta sola. **Su testnet è accettato; su mainnet NO.**

**Upgrade path (mainnet, un click)**: dashboard Render → il servizio →
*Upgrade* a Starter → *Disks → Add Disk* (nome `oracle-data`, mount `/data`,
1 GB) → togli `DB_PATH=oracle.db` dalle env (torna il default
`/data/oracle.db`). Nessun redeploy manuale, nessuna modifica al codice:
Render riavvia il servizio con disco montato e la finestra anti-riuso
diventa persistente.

Nota free-tier secondaria: i servizi free si addormentano dopo 15 minuti e il
primo risveglio impiega ~30-60 s — pessima esperienza in gioco.

## (d) Dopo il deploy

1. **Health check**: apri `https://<servizio>.onrender.com/v1/health` —
   deve rispondere `{"ok":true,"network":"testnet","appId":769907387,…}` e
   l'indirizzo oracle deve essere `COI33V32…KNFA`.
2. **Dogfood immediato** (zero rebuild): apri il gioco con
   `?oracle=https://<servizio>.onrender.com` — la scelta si salva in
   localStorage. La riga di stato nel wizard deve dire
   `SERVER ORACLE - <servizio>.onrender.com`.
3. **Quando è stabile**: flip di `ORACLE_BASE_URL_TESTNET` in
   `src/game/arena/oracleClient.ts` da `http://localhost:8787` al nuovo URL,
   rebuild del client (pipeline vault-door), e SOLO ALLORA si valuta il flip
   del live `/arena-testnet/` da v15.3.2. Fino a quel momento il live non si
   tocca.

## (e) Monitoraggio

I verdetti firmati si controllano come sempre: vedi **RUNBOOK.md** (sezione
verdict/receipt, comandi indexer + script di recon). Aggiungi ai segnalibri:
`https://<servizio>.onrender.com/v1/health`. I log si leggono dalla
dashboard Render (Events/Logs): cerca `verdict issued`, `REPLAY MISMATCH`,
`REPLAY TIMEOUT`. Ogni restart compare come evento — se vedi restart
frequenti, investiga prima di dare l'URL ai giocatori.

## (f) Il mnemonic: come inserirlo SENZA esporlo

Due strade, **mai entrambe** (se c'è il FILE vince sempre quello):

1. **Secret File da dashboard** (preferita): service → Settings →
   *Secret Files* → Add Secret File, filename `/etc/secrets/oracle_mnemonic`,
   contenuto le 25 parole su una riga. `render.yaml` punta già lì
   (`ORACLE_MNEMONIC_FILE`). Il file si crea SOLO da dashboard — per questo
   esiste la strada 2.
2. **Env var via API** (automazione): `ORACLE_MNEMONIC` è dichiarata
   `sync: false` nel blueprint = write-only, non rileggibile. Si imposta con
   una chiamata API (o dashboard → Environment, incolla e salva: Render non
   la mostra più). Se usi questa strada, **togli** `ORACLE_MNEMONIC_FILE`
   dalle env, altrimenti il boot fallisce cercando un file che non esiste.

Regole d'oro: il mnemonic non si committa (è nel `.gitignore` come pattern),
non si scrive in ticket/chat/email, non si mette negli screenshot della
dashboard. Il server non lo logga mai (nei log vedi solo `keysrc=file` o
`keysrc=env` e l'indirizzo pubblico).

## Note tecniche (per chi curiosi)

- **Perché docker + rootDir oracle-server**: l'immagine si porta dentro i
  replay-bundle del motore (12 MB) senza i quali `REPLAY_ENFORCE=1` rifiuta
  il boot; il resto del monorepo non serve.
- **Perché 1 sola istanza**: SQLite è single-writer e il rate-limiter vive in
  memoria di processo; più repliche romperebbero entrambe le garanzie.
- **Fallback chiave**: `config.ts` accetta `ORACLE_MNEMONIC` solo se
  `ORACLE_MNEMONIC_FILE` manca; con entrambe vince il file; con nessuna il
  boot esce con errore (exit 1) come sempre.
