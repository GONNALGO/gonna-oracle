# DOGFOOD WAVE B — AVVERSARIALE vs oracle pubblico (GIL breaker)

**Target:** `https://gonna-arena-oracle-testnet.onrender.com` (testnet, app v2.1 `769907387`, REPLAY_ENFORCE=1, ALLOW_LEGACY_GIL=1)
**Attacker kit:** `/tmp/waveb/` (`gil.mjs` codec+driver, `attack.mjs` batteria, `results.json` raw). Tapes generate sui bundle pinnati `engine-v53365263.mjs` / `engine-v002d77d0.mjs` (read-only dal repo condiviso). Nessuna modifica a `oracle-server/src` né ai bundle. Flow usato: **seat 0 pre-create** (`cid = next_challenge_id` letto on-chain al momento di ogni burst; è scivolato 25→31 durante la sessione per attività Wave A — nessuna collisione).
**Baseline onestà:** log v2 onesto (stage 1, `PIT-<cid>`, 2494 frame, score 3750) → **200 + sigB64** (A0). L'oracle replaya davvero: 2135ms per 2.5k frame.

## VERDETTI IN UNA TABELLA

| # | Attacco | Atteso | Ottenuto | Esito |
|---|---------|--------|----------|-------|
| 1 | Score gonfiato +5000 | 400 REPLAY MISMATCH | 400 `REPLAY MISMATCH` (1380ms) | ✅ |
| 2 | Bitflip RIGHT @frame100 | 400 REPLAY MISMATCH | 400 `REPLAY MISMATCH` (1165ms) | ✅ |
| 3 | v1 legacy (onesto / +99999 / build falsa+499999) | 400 LEGACY LOG REFUSED | **200 / 200 / 200** | 🔴 **SEV-1** |
| 4 | seedLabel PIT-999999 su tape PIT-cid | 400 SEED MISMATCH | 400 `SEED MISMATCH` (425ms) | ✅ |
| 5 | build `vdeadbeef` | 400 BUILD UNKNOWN | 400 `BUILD UNKNOWN TO THE ORACLE` (421ms) | ✅ |
| 6 | build legacy `v002d77d0` | da scoprire | **200 e 200** — bundle ancora pinnato, replay bit-identico | ⚠️ policy |
| 7a | truncated flag bit0=1 | 400 RUN LOG TRUNCATED | 400 `RUN LOG TRUNCATED` (421ms) | ✅ |
| 7b | frames dimezzati (coerente) | REPLAY MISMATCH | 400 `REPLAY MISMATCH` (663ms) | ✅ |
| 7c | bytes tagliati a metà | invalid structure | 400 `input log: invalid structure` (427ms) | ✅ |
| 8 | receipt: register→reuse→fake→consume→reconsume | 200→409→400→200→409 | esattamente 200→409→400→200→409 | ✅ |
| 9 | raffica 40× verdict | 429 dal 21º (brief) | **429 dal 31º**, `Retry-After: 42`, body `rate limited (ip)` | ✅ (limite reale 30/min) |
| 10 | CORS 6 origin | post-fix allow-list | gonna.bond/localhost:8787/127.0.0.1:8787 ✅ ACAO; evil.example/null/localhost:9999 ✅ assente | ✅ |
| 11 | verdict cid 999999999 / cid 0 / cid stringa | 409 / 409 / 400 | 409 `challenge not active…` / 409 / 400 malformed | ✅ |
| 12 | 8× body malformati | 400 puliti | 8/8 → 400 `malformed request body`, zero 500, zero stack | ✅ |
| 13a | run.frames=300001 | run sanity | 400 `run sanity: frames above 300000` (450ms) | ✅ |
| 13b | header GIL frames=300001 | invalid structure | 400 `run sanity: frames above 300000` (rule 4 precede il decode) | ✅ |
| 13c | inputLogB64 ~1.4MB | malformed | 400 `malformed request body` (1649ms, limite 600k char) | ✅ |
| 13d | log valido 299999 frame | rifiuto/200 veloce | **200 (5258ms) ma /v1/health durante il replay: 4252ms** | ⚠️ **SEV-2 (DoS)** |

---

## 🔴 SEV-1 — LEGACY v1 BYPASSA IL REPLAY: firme a punteggio arbitrario su testnet

**Atteso dal brief:** `400 LEGACY LOG REFUSED` (REPLAY_ENFORCE=1 batte ALLOW_LEGACY_GIL).
**Ottenuto:** il contrario. Con `ALLOW_LEGACY_GIL=1` il ramo v1 del pipeline (`verify.ts` §5) **salta interamente** bundle-check, seed-binding chain-derived e replay: `if (log.header.v === 1) { if (!cfg.allowLegacyGil) return bad('LEGACY LOG REFUSED'); }` → prosegue dritto alla firma. Per v1 restano solo: shape, cap punteggio, run sanity (frame 600-300000), coerenza header↔body (self-consistent, non chain-checked), cid-drift.

**Prove (tutte HTTP 200 + sigB64 valida):**
- **A3a** v1 + score onesto 3750 → 200 (422ms) — grandfathering atteso;
- **A3b** v1 + score **gonfiato +99999** → 200 (426ms) — forgery;
- **A3c** v1 + **build `vnonesiste`** + score **499999** (1 sotto il cap stage) → 200 (897ms) — forgery totale.

**Request esatta per riprodurre (A3c, cid=31):**
```
POST /v1/sign-score
{"cid":31,"seat":0,"addr":"5KKX…XW6U","score":499999,"stageMode":"stage","stageIdx":1,
 "build":"vnonesiste",
 "run":{"seedLabel":"PIT-31","frames":2494,"durationSec":44,
        "inputLogB64":"<GIL v1: byte[3]=1, build 'vnonesiste', seedLabel 'PIT-31', 2494 mask bytes>"}}
```
La stessa richiesta con `v=2` verrebbe respinta 3 volte (BUILD UNKNOWN / SEED/REPLAY MISMATCH). Basta flippare `byte[3]=1` perché TUTTE le verifiche M2 spariscano.

**Impatto:** su testnet chiunque può farsi firmare punteggi arbitrari (≤cap) per la prossima card (seat 0) senza giocare nulla. La sig è reale (verificata ed25519 contro oracle pubkey in A0).
**Mitigazione:** `ALLOW_LEGACY_GIL=0` anche su testnet (il grandfathering v1 ha senso solo con REPLAY_ENFORCE=0). Mainnet default è già 0 — **verificare esplicitamente al deploy mainnet**. Fix lato codice (opzionale): nel ramo v1 con allowLegacyGil, applicare comunque il seed-binding `PIT/RUN-<cid>` e il build-check contro i bundle pinnati (costo zero, chiude build falsa + seed falsa anche per v1).

## ⚠️ SEV-2 — DoS da replay: l'event loop si blocca ~4-5s per richiesta

`replayCampaign` è un loop **sincrono in-process**. Un log valido da 299999 frame (zeri) → replay 5258ms su Render; durante il replay `/v1/health` ha risposto in **4252ms** (>2s, missione violata). Con rate limit 30/min/IP, un IP può tenere il loop occupato ~2.5min CPU/min. Il wall-clock guard (30s default) limita il caso peggiore singolo ma non la concorrenza. **Nota:** il run da 299999 frame a maschere zero ha score 0 → è onestamente 200 (un "run" vuota ma valida: atteso, non una vuln di integrità — la vuln è la latenza). **Mitigazione già pianificata:** worker_threads isolation = M3; nel frattempo considerare un cap replay più basso (es. 60000 frame ≈ 16min di gioco) o un rate-limit separato più stretto per body > N KB.

## Item 6 — policy pruning bundle (dato per mainnet)

`engine-v002d77d0.mjs` è **ancora pinnato sull'oracle** e il suo replay è **bit-identico** a v53365263 sulla tape stage-1 (score 3750 = 3750, death frame 1897 = 1897): A6a (log v002d77d0 + score del vecchio engine) → 200; A6b (build v002d77d0 + score del nuovo engine) → 200 perché i due engine producono lo STESSO score. **Conseguenza:** i log v1-era engine restano accettati finché il bundle è pinnato — nessun drift rilevato tra i due build su stage 1. Per mainnet: il pruning dei bundle legacy è una leva di sicurezza (riduce la superficie), ma oggi non c'è drift che lo renda urgente; documentare però che "build vecchia" ≠ "build rifiutata".

## Item 8 — receipt lifecycle (a costo zero, receipt on-chain E2EV161-1-B del sim storico)

`POST /v1/continue/receipt` `{refId:'E2EV161-1-B', addr:PLAYER_B, txid:FO6B7NJJP2…}` → 200; stessa richiesta → **409 `receipt already registered`**; txid inesistente → **400 `continue payment not verified on-chain`**; `sign-score` con `continueRef` onesto → 200 (consume atomico con sig); riuso → **409 `continue receipt already consumed`**. Catena anti-double-spend dei continue: integra. Nessun ALGO speso.

## Item 9 — rate limit

Limite reale: **30 req/min per IP** (default `MAX_SIG_PER_MIN` — il brief diceva 20; da allineare o documentare). Burst 40× `/v1/verdict`: richieste 1-30 → 409 (handler raggiunto), **dal 31º → 429** con header `Retry-After: 42` e body `{"error":"rate limited (ip)"}`. Finestra fissa allineata al minuto. Nessun 500 sotto raffica. Nota: il budget IP è condiviso tra gli agenti dogfood sullo stesso egress — durante la batteria nessun 429 spurio.

## Item 10 — CORS (post-fix, eseguito dopo il redeploy)

| Origin | preflight | ACAO | POST ACAO |
|---|---|---|---|
| https://gonna.bond | 204 | ✅ presente | ✅ |
| http://localhost:8787 | 204 | ✅ | ✅ |
| http://127.0.0.1:8787 | 204 | ✅ | ✅ |
| https://evil.example | 204 | ❌ assente | ❌ |
| `null` | 204 | ❌ | ❌ |
| http://localhost:9999 | 204 | ❌ | ❌ |

Conforme all'atteso post-fix. Per gli origin non in allow-list la risposta arriva ma senza ACAO → il browser la scarta (enforcement corretto lato client; il server non autentica sull'origin, corretto per un'API firmatrice pubblica).

## Item 11 — verdict misuse

- cid `999999999` → 409 `challenge not active (not found or already resolved)`;
- cid `0` (prima card; boxes cancellate → finalized/expired) → stesso 409 (l'oracle non distingue "mai esistita" da "finalizzata" — coerente, stessa superficie);
- cid come stringa → 400 malformed. Nessun leak.

## Item 12 — body malformati

8/8 → **400 `{"error":"malformed request body"}`**: JSON rotto, `{}`, score stringa, cid -3, addr spazzatura, stageMode `turbo`, frames -5, full+stageIdx. Zero 500, zero stack trace, latenze 340-740ms.

## Item 13 — note di ordinamento (per chi legge i reason)

- `run.frames=300001` con log piccolo → `run sanity: frames above 300000` (rule 4 prima del decode);
- header GIL frames=300001 con run.frames coerente → STESSO reason (rule 4 colpisce prima del decode — il cap in decode non viene mai raggiunto da questa via; è difesa in profondità);
- bitmask corto vs header → `input log: invalid structure` (A7c);
- b64 >600k char → `malformed request body` (shape check, 1649ms per 1.4MB — parsing JSON dominante).

## Raccomandazioni ordinate

1. **[SEV-1]** `ALLOW_LEGACY_GIL=0` su testnet ORA; assert deploy-time che mainnet lo abbia 0; opzionalmente seed+build check anche nel ramo legacy.
2. **[SEV-2]** replay in worker_thread (M3) o cap replay 60-100k frame; health check endpoint che non dipenda dal loop principale se possibile.
3. Allineare brief/config rate limit (20 vs 30).
4. Pruning bundle legacy su mainnet come leva di igiene (non urgente: zero drift rilevato).

*Raw results: `/tmp/waveb/results.json` (33 entries) + run log `/tmp/waveb/run1.log`. Script: `/tmp/waveb/attack.mjs`, `/tmp/waveb/gil.mjs`.*
