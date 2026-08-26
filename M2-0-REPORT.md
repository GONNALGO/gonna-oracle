# M2-0 — SPIKE: determinismo cross-engine (replay headless dell'engine)

**VERDETTO: SÌ — il replay cross-engine è fattibile bit-exact.** Stessa seed + stesso input log → simHash (ogni 60 frame) e score **identici** tra Node headless e Chromium reale, su 4 stage × (run onesta 3600f + deep god-run 10800f), anche tra **V8 diversi** (11.3 vs 14.1).
Condizione: il replay deve pinnare la lunghezza dell'intro (START non è nella bitmask GIL v1 — trovato e dimostrato) e lo stageIdx va preso dalla card (non è nell'header GIL).
Nessuna modifica ai file di gameplay: harness 100% additivo in `oracle-server/replay/`.

---

## 1. Cosa è stato provato

| Prova | Setup | Esito |
|---|---|---|
| **A — Node↔Node** | stesso GIL log, due `Game` freschi in Node | 24/24 PASS: hash/score identici; driver raw-mask == `debugSim(tape)`; seed diversa → hash diversi |
| **B — Node↔browser** | stesso fixture in Node (replayGIL) e in Chromium 141 headless (`window.__gonna.debugSim` su build vite preview) | **8/8 PASS — bit-identico**: stage 0/2/4/6, 60 hash + score per run onesta, 180 hash + score per deep god-run (wave 3-4, kos 20-50) |
| **Divergenza intro** | stessa seed+mask, intro saltata vs intro naturale 150f | DIVERGE al frame 60 — dimostra che la finestra di registrazione va pinnata (§4.1) |

Versioni esatte: **Node v20.20.2, V8 11.3.244.8-node.38** vs **Chromium 141.0.7390.37** (Playwright `chromium_headless_shell-1234`, V8 ~14.1). Bundle Node: esbuild 0.27.2 della **stessa sorgente** servita al browser. Il test copre quindi non solo Node↔Chrome ma **V8-version-vs-V8-version**, il rischio reale individuato nel brief.

## 2. Come l'engine dipende dal browser (recon)

`Game.boot(canvas)` (engine.ts:1140) fa tre cose browser-only: `loadFrames()` (fetch + `Image`, mai attese dal sim), `buildArt()` (disegna pixel art su canvas offscreen — solo rendering), `canvas.getContext('2d')`. Il costruttore tocca inoltre: `window.localStorage` (zoom/best — try/catch), `TouchControls` (solo listener su canvas), `wallet.init()` (no-op con storage vuoto), `audio.ensure()` (`AudioContext`), `loadSkinPortraits`/`loadSkinMap` (fire-and-forget), `captureInstallPrompt`, `adoptOracleFromHash`, `bootArenaDeepLink` (legge `window.location`).

**Percorso minimo trovato** (nessuna modifica all'engine): stub globali (`window/document/localStorage/Image/Audio/AudioContext/rAF/fetch`) → bundle esbuild di `engine.ts` per node → `new Game(stubCtx, buildArt(), new Map())` (costruttore TS-`private`, a runtime JS puro) → `debugDescent(stageIdx, seedLabel)` (seed `'PIT-<cid>'` via FNV-1a + mulberry32, rng.ts) → per ogni frame: bitmask → `input.down` livelli + `input.pressed` sul rising edge → `game.step()` → `simHash()` ogni 60 frame. Il sim path (`step → updatePlay → descent/player/enemies/boss`) **non renderizza mai** — `render()` è separato e non viene chiamato.

Nota sul loop reale (Game.tsx:52-63): `STEP=1000/60`, tempo a frame-count (`this.frame++` per step, niente `performance.now`/`Date.now` nel sim) → la riproduzione frame-per-frame è esatta per costruzione.

## 3. Audit float del game loop (classificazione)

Sim-relevant state evolution (player/enemy/boss x,y,hp,state, score, rng stream):
- **int-only / IEEE754-esatto**: `+ - * /` su double, `Math.floor/round/ceil/abs/max/min/sign/trunc`, `Math.imul`, confronti. ECMA-262 li definisce al bit → identici su OGNI engine conforme. Il 99%+ del sim è qui (fisica, hit test, RNG mulberry32 interamente a interi, FNV-1a simHash).
- **float-risky (implementation-approximated) che tocca lo stato sim**: solo DUE call site, entrambi nel drone (enemies.ts):
  - `Math.sin(hoverPhase)` (enemies.ts:429,456) → `z` hover ∈ [19,29];
  - `Math.hypot(dx,dy)` (enemies.ts:534) → velocità del dive del drone.
  `z` gate-a gli hit (`e.z < 36`, engine.ts:2582; margine ≥ 7 sul range hover) e la fine del dive (`z > 0.5`). V8 implementa sin/hypot via fdlibm (algoritmo deterministico, stabile da anni); **conferma empirica: bit-identici tra V8 11.3 e 14.1** nelle deep-run con drone (hash mai diverso in 4×180 campioni).
- **float-risky solo visivo** (non alimenta il sim): `sin/cos` in proj.ts, fx.ts, bosses.ts draw, engine.ts:669 (seal burst), `visualRand()` in fx/audio — stream separato a seed fisso, per costruzione "never feeds back into the sim" (rng.ts:1-6); in Node gli timer audio consumano quantità diverse di quello stream senza alcun effetto sugli hash (verificato).
- **Math.random**: zero nel sim DESCENT (`setSeededSim(true)`; trap QA esistente). FULL RUN campaign usa `mathRng` = Math.random (engine.ts:1710-1715) → **non riproducibile, fuori scope (M2-2)** come da brief.

Classificazione finale DESCENT: **`float-deterministic`** con due call site `implementation-approximated` empiricamente stabili nella famiglia V8 (il server è Node = V8: stessa famiglia del client Chrome per definizione di M2).

## 4. Punti di divergenza trovati (non float — semantica del log)

### 4.1 La finestra di registrazione include l'intro, e START non è nella mask ⚠️ (unico blocco reale)
Il recorder (engine.ts:2184-2190) scatta la mask **ad ogni `step()` da `startArenaRun`**, quindi il log include i frame della title card intro. L'intro dura 150 frame **oppure meno se il giocatore preme START** — e START/PAUSE/MUTE **non sono negli 8 bit** della mask v1. Due run live con input identici ma skip-intro diverso producono log identici ma sim diversi: **il server non può ricostruire la lunghezza dell'intro dal solo log** (dimostrato: `intro-divergence.mjs` — stessa seed, stesse mask, divergenza al frame 60).
**Mitigazioni (scelta per M2-1)**: (a) registrare solo da `scene==='play'` (cambio client additivo: il recorder entra quando il sim entra in play; il server forza lo skip dell'intro come già fa `debugSim`) — raccomandata, 3 righe in engine.ts; (b) portare `introFrames` nell'header v2. Finché non si decide, l'harness riproduce la convenzione `debugSim` (skip forzato).

### 4.2 `stageIdx` non è nell'header GIL v1
L'header ha build/seedLabel/frames ma non il livello. Il server lo possiede già (verdict stage_idx dalla nota on-chain) → il replay lo prende da lì, mai dal client. Documentato nell'API dell'harness (`replayGIL({stageIdx, ...})`).

### 4.3 Log `truncated` (run > 300k frame)
Un log troncato rende lo score finale non verificabile → policy M2: rifiutare per il signing o accettare con cap di score (decisione prodotto, segnalata).

### 4.4 Pinning del codice engine per `build`
Il replay è valido solo contro l'engine della build `__GONNA_VER` del log (SPEC §5). Lo spike bundla dalla sorgente corrente; M2 deve archiviare il bundle replay per ogni VER rilasciata (artefatto di release).

## 5. File prodotti (worktree, branch `m2-replay`)

```
oracle-server/replay/
  stubs.mjs            browser stubs: canvas2d Proxy, Image, Audio(AudioContext), localStorage, rAF, fetch
  replay.mjs           bundle loader + bootGame + replayMasks (driver M2) + replayGIL + masksToTape + makeGIL
  fixtures.mjs         tape/masks/casi condivisi Node<->browser (bit-identici per costruzione)
  provaA-node.mjs      Prova A (24 check)   — node oracle-server/replay/provaA-node.mjs
  provaB-browser.mjs   Prova B (8 check)    — richiede preview :4173 (sotto)
  intro-divergence.mjs evidenza §4.1
M2-0-REPORT.md         questo file
```
Scelta `oracle-server/replay/` (non `scripts/replay/`): il replay verifier è un deliverable del deploy unit server (M2 lo promuoverà a codice di produzione); gli script sono `.mjs` plain-node coerenti col pattern `.tmp-kit` dei sim QA (bundle esbuild generato a runtime in `.tmp-engine-bundle.mjs`, non committato).

## 6. Riproduzione

```bash
git worktree add $HOME/work-m2-replay m2-replay && cd $HOME/work-m2-replay
cp -rL /mnt/agents/output/app/node_modules .            # sandbox: no npm install su FUSE
mkdir -p /tmp/esbin && cp node_modules/@esbuild/linux-x64/bin/esbuild /tmp/esbin/ && chmod +x /tmp/esbin/esbuild
export ESBUILD_BINARY_PATH=/tmp/esbin/esbuild
node oracle-server/replay/provaA-node.mjs               # A: Node<->Node
node node_modules/vite/bin/vite.js build                # serve la build al browser
node node_modules/vite/bin/vite.js preview --port 4173 --strictPort &
node oracle-server/replay/provaB-browser.mjs            # B: Node<->Chromium
node oracle-server/replay/intro-divergence.mjs          # evidenza 4.1
```

## 7. Limiti onesti

- Browser testato: **Chromium 141 headless** (stesso V8 di Chrome desktop; mobile Safari/JSC e Firefox/SpiderMonkey NON testati — irrilevante per il server Node, rilevante solo se un giorno il replay girasse altrove).
- I fixture sono tape sintetici (walk/punch/kick/jump/special); non coprono ogni ramo (es. continue-flow, che in arena è assente: death sigilla). La copertura float (drone sin/hypot) è raggiunta nelle deep god-run (wave 3-4). Raccomandazione M2-1: rigiocare anche log reali registrati dal client v16 (E2E testnet) appena il recorder play-only (§4.1) esiste.
- `debugSim`/god mode sono harness, non il path di produzione: la run reale muore e sigilla; il driver raw NON usa god e riproduce anche la morte frame-esatta (stessa code path, stessa scena).
- La prova A4/B-deep usa god per raggiungere wave alte: legit per il confronto di determinismo (stesso god su entrambi i lati), non è una run "onesta" per il signing.
- La build vite del worktree non include vault-door (irrilevante: il sim è lo stesso codice sorgente).
