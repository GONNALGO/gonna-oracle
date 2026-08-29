# E2E MAINNET OPEN TABLE — v17.0.4 (VERDE)

Data: 2026-08-28. Build sotto test: **VER vd99cf399** (bundle engine-vd99cf399.mjs, zip md5 d3279c8d795f23058e97075495566c6c). Oracle: Render live con bundle vd99cf399 (smoke 8/8 preliminare dell'altro agente). Rete: Algorand **mainnet**, app 3686311434, ASA GONNA 2582294183.

## Esito: E2E MULTIPLAYER v17.0.4 VERDE

Flusso completo eseguito da `scripts/e2e-mainnet-open-table.mjs`
(`E2E_BUILD=vd99cf399 E2E_SEATS=1`, stake 2 GONNA/seat, 2 seat:
creator DEPLOYER + joiner PLAYER_QA2). **La carta è nata, è stata giocata,
firmata, verificata e risolta on-chain — zero carte sporche in piazza.**

### Leg per leg (cid 7)

| Step | Esito | txid / prova |
|---|---|---|
| Sign creator (pre-create, seat 0) | oracle **200** con build vd99cf399 — la stessa chiamata che al Principe dava REPLAY MISMATCH | sig ed25519 su `cid=7, seat=0, score=3000` |
| CREATE | confermata | `FXEWM3XVM25IZNOTCO4PJ7TSLY2KKYEOR65V3Y6UZX7PJXUTOSMA` |
| JOIN QA2 (seat 1, stake 2 GONNA) | confermata | gruppo `7YBIXCMWYUPH…` (stake leg), app call `VO6V6GA7IIHMKV6DPKX5OXIDFRXXFZC55IYMVATQOFK7Q6GY2KKQ` (round 64533724) |
| Sign joiner (post-join, seat 1) | oracle **200** (ordine corretto: join PRIMA del sign) | sig su `cid=7, seat=1, score=2400` |
| SUBMIT QA2 | confermata | `4FAF3VWK3NBTFCNPKYWUSSZECCQ73VV67JEWLVG55F6LHGZYJBCA` (round 64533728) |
| VERDICT | oracle **200** (carta piena e firmata) | verdictSigB64 ed25519 |
| RESOLVE (winner = DEPLOYER, 3000 > 2400) | confermata | `US2XPOZY3VRL6M7KHQ3KXENHC4URGCCPOLIGN5MZV6E4VOAAM7SQ` (round 64533732) |

### Legs del resolve (indexer mainnet)

- `3.8 GONNA -> XEXW2KKA…` (DEPLOYER, winner 95% del pot da 4 GONNA)
- `0.2 GONNA -> GONHNV3X…` (treasury, 5%)
- `0.3582 ALGO -> XEXW2KKA…` (MBR box restituito)

### Stato finale on-chain (verificato via kit + indexer)

- `readMeta(7)` → **null** (box meta cancellato)
- `readPlayers(7)` → **vuoto** (box players cancellato)
- `/v1/verdict` su cid 7 → `challenge not active (not found or already resolved)` — coerente
- **Nessun EARLY_CLOSE necessario**: il resolve ha già chiuso la carta
  (box cancellati, stake distribuiti, MBR recuperato). L'early_close era
  previsto solo se il flusso si fosse fermato a metà.

### Note di processo

- Un bug cosmetico nello script (`legsOf` usava `kit.NET.appId` — NET non è
  re-exportato) ha fatto crashare la stampa finale DOPO che il resolve era
  già confermato on-chain; fixato (`kit.ARENA_APP_ID`) in questo commit.
- Il sign del creator pre-create con la build vd99cf399 è il sentiero
  esatto del SEV-1 del Principe: ora 200 al primo colpo, con telemetria
  oracle (`sign-score-reject` strutturata) pronta a loggare qualsiasi
  reject futuro con replayedScore.
- Fondi usati: DEPLOYER 2 GONNA stake (rientrati col win) + fee/MBR
  (~0.37 ALGO, MBR recuperato); QA2 2 GONNA stake (perse a favore del pot)
  + fee. Nessun mnemonic è mai stato stampato o commitato.
