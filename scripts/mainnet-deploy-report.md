# M-2 — MAINNET DEPLOY REPORT (2026-08-26)

Cerimonia deploy QuantumArena v2.1 su Algorand **mainnet**, eseguita a gate
con verifica indipendente a ogni passo. Nessun segreto in questo file.

## Esiti gate

| Gate | Esito | Evidenza |
|------|-------|----------|
| 1 funding | PASS | DEPLOYER 10.0 ALGO, ORACLE 2.0 ALGO (indexer mainnet) |
| 2 deploy | PASS | appId **3686311434**, post-checks on-chain OK |
| 3 Turso smoke | PASS | receipt persiste tra processi distinti; DB pulito a fine smoke |
| 4 Render flip | PASS | 15 env var, deploy manuale, health mainnet |
| 5 post-flip | PASS | health/CORS/boot-log/v2 200/v1 400 (dettagli sotto) |
| 6 commit | PASS | questo file + M-1 code sync |

## On-chain (mainnet)

- **APP ID: 3686311434** (QuantumArena v2.1, bytecode pinnato
  approval sha256 `1a632904825f2df0cdb773217a324c0f90d0f6908a7d18685868042ad3eb4a77`
  — identico al testnet dogfooded)
- escrow app: `3XEQEDORZHIRY5HQAUYZOTAIZBNQFY63DOXHATJE2GACPUGVYVK7QH47UM`
- create txid: `ZRVYSAZHJH6V6IYVPJJWZNEMXY6QXFY7ZCIWTARTIIBOWWZVJ2OA`
- bootstrap txid (= opt-in app all'ASA GONNA): `KIY65PTZWTAP7E2NIDHHY5PHNQLSAO6RYHE5FDBAFV2X32STNEXQ`
- global state verificato via indexer indipendente: version=2,
  gonna_asset_id=2582294183, treasury=Principe, oracle_pub_key=ORACLE mainnet,
  bootstrapped=1; escrow: 1.0 ALGO + opted-in ASA 2582294183

## Attori (solo address)

- DEPLOYER mainnet: `XEXW2KKACC4I4KZE4RTRTVHHC2Y377F63VVBNP4OVCTIARPDYQJZNHHVDE` (10 → ~8.9 ALGO dopo deploy+bootstrap)
- ORACLE mainnet (signer): `3UVNPC3IOM42HZS5HZJPVH6LBBJOJFF2WHQ4K5SDYJKKWFAJ36SKXILG4Y` (2 ALGO)
- TREASURY (wallet Principe): `GONHNV3XMSPTGZITI4PXUZGCMIELXHVADCJQPZKVCTXDNJZVIYDIEGKPHU`
- ASA GONNA mainnet: `2582294183` (freeze/clawback sigillati zero-address)

## Oracle pubblico (Render srv-da7auj8u01pc738qmkkg)

Env (15 var, PUT atomico): NETWORK/ARENA_NETWORK=mainnet, ARENA_APP_ID=3686311434,
GONNA_ASA_ID=2582294183, TREASURY_ADDR=Principe, ALGOD/INDEXER mainnet algonode,
ALLOWED_ORIGINS=https://gonna.bond,https://www.gonna.bond, REPLAY_ENFORCE=1,
ALLOW_LEGACY_GIL=0, REPLAY_TIMEOUT_MS=30000, DB_PATH=/data/oracle.db,
TURSO_URL/TURSO_AUTH_TOKEN (SEV-2b), ORACLE_MNEMONIC (mai loggato).

Boot log post-flip (codice M-1, commit pubblico `3572d2a`):
`network=mainnet appId=3686311434 keysrc=env cors=[https://gonna.bond https://www.gonna.bond] store=turso(libsql) replay=enforce(legacyGil=off) — continue reconciliation ok: on-chain=0 db=0`

Verifiche:
- `/v1/health` → mainnet, appId 3686311434, latenza 846ms
- CORS: gonna.bond ✓ ACAO · www.gonna.bond ✓ ACAO · localhost:8787 ✗ · evil.example ✗
- verify v2 onesta (replay reale v53365263, pre-create cid 0) → **200 sig**
- verify v1 (byte3=1) → **400 LEGACY LOG REFUSED**

## Incidenti durante la cerimonia

1. Il primo deploy M-1 buildava il codice pre-M-1 (repo pubblico non syncato):
   CORS senza www, niente Turso. Syncato `src/ test/ package*` monorepo→pubblico
   (`a1f074b`).
2. Build fallita "npm Exit handler never called" — root cause nota: 25 URL del
   lockfile @libsql puntavano al mirror privato di sviluppo. Fix URL →
   registry.npmjs.org (`3572d2a`), build verde. Regola: rigenerare il lock solo
   con registry pubblico prima di pushare.

## Note per M-3 (dogfood mainnet)

- DEPLOYER mainnet non detiene GONNA: gli stake del dogfood richiedono GONNA
  mainnet (richiedere al Principe, come fatto per gli ALGO).
- Il forfeit/continue/early-close seguono gli script `wave-a-*.mjs` con
  ORACLE_URL default già pubblico; serve una variante mainnet del kit
  (testnetKit → mainnet params: appId/ASA/url).
- next_challenge_id mainnet = 0 al deploy.

## M-4 — bundle v4fc0b66e live + smoke (2026-08-26)

- Bundle `engine-v4fc0b66e.mjs` syncato su gonna-oracle (`scripts/sync-oracle-repo.mjs`,
  secret scan pulito) + deploy manuale Render `dep-da7m2pbbc2fs738q1fk0` → live.
- Boot log: 5 bundle (v002d77d0, **v4fc0b66e**, v53365263, v9fe01156, vb1d23c1a),
  store=turso(libsql), legacyGil=off, reconciliation ok.
- Smoke pubblico vs zip mainnet (`SMOKE_NETWORK=mainnet SMOKE_ZIP=…mainnet.zip`,
  VER derivato da `__GONNA_VER` = v4fc0b66e): **8/8 PASS** — honest 200 + sig
  verificata su pubkey oracle, inflated → 400 REPLAY MISMATCH, wrong-seed → 400
  SEED MISMATCH, CORS gonna.bond ✓ / evil ✗.
- Smoke script ora parametrizzato (`SMOKE_NETWORK=mainnet` → appId 3686311434 +
  nodi mainnet; default testnet invariato).
- On-chain micro-duel smoke: **in attesa dei ~100 GONNA dal Principe**.
  DEPLOYER mainnet opted-in ASA 2582294183 (txid
  `JNCLJFTG5FPUX7U3XWIJTONYG5322GEF4RUJY4IFO2K53Y5RY3GQ`, round 64450714,
  balance 0) — il send del Principe ora non fallirà per missing opt-in.
