# DOGFOOD MAINNET — report (M-3 essenziale, 2026-08-27)

Primo dogfood on-chain su **mainnet**: app **3686311434**, ASA GONNA
**2582294183**, oracle pubblico Render (network=mainnet), build client
**v4fc0b66e** (v17.0.0) per le carte on-chain + **v9850706e** (v17.0.1,
OpUp-fix) per lo smoke replay. REPLAY_ENFORCE=1, ALLOW_LEGACY_GIL=0,
OpUp donor **3686469118**. Harness: `scripts/m4-mainnet-dogfood.mjs`
(FLOWS filter + resume). Ogni leg verificata via indexer mainnet.

## Esiti per flow

| Flow | cid | Esito | Note |
|------|-----|-------|------|
| S3 micro-duel stage 0.1 GONNA | 0 | PASS | primo replay E2E + primo resolve mainnet |
| S4a duel stage 1 GONNA | 1 | PASS | verdict 200 pre-resolve incluso |
| S4b full-mode 4-seat 0.5 GONNA | 2 | PASS | "3 seat" non esiste: SEATS_SMALL=4 joiner (1/4/8/12) |
| S4c early_close 0 joiner | 3 | PASS | stake+MBR back, fee 1 ALGO→treasury |
| S4d verdict 200/409 | — | PASS | 200 su open full-signed (cid 1), 409 su risolta (cid 0) |
| S4e avversariale | — | PASS | inflated → 400 REPLAY MISMATCH; v1 → 400 LEGACY LOG REFUSED |
| claim_forfeit | — | SKIP | 1h di attesa, già provato su testnet (cid 25, legs 95/5 esatte): stesso bytecode v2.1 pinnato (sha256 1a632904…4a77), nessun valore aggiunto |

## Txid

- **S3 cid 0**: create `PBBDLQJ36I6LBK3LI33AMU6JLQCRVRDRNXUTWGVCOSUAADYIFTPA` · join `TCTUAGPB64ZY…` · submit `6IE3LVKQ5RRP…` · resolve `B4YAXZ5XA7BAZHQJL4NMFMA3ESGMMG4WXBBNTZRP7WWKBRRQPH4Q` — legs: 190.000u→QA2 (95%), 10.000u→treasury (5%), MBR 358.200µA→creator, box chiuse
- **S4a cid 1**: create `ENE4ZSNH7XHNPVV3PQNPFCZHGOONFDRJQG6JHEPC55FA3GEJO7XA` · join `Q6MJ2BOBRLQV…` · submit `7ON7S7ATCGDW…` · resolve `T7BLN4MU7CW2WWVZYUCTNB2XDBP52YFO745DKGHLRDVNCQPSMRQQ` — legs: 1.900.000u→DEPLOYER, 100.000u→treasury, MBR back, box chiuse
- **S4b cid 2**: create `7BUGZA2JYPV6PVBIUQMBWQVGRSCPN2YC45IFWIZ75ECG5FNTOLSQ` · submits QA2 `CQ44A4FL2OSK…` ORACLE `RO33NUX3N6VM…` QA3 `C5Z4JVHR3PL2…` QA4 `QTFRZWP7VH2A…` · resolve `CEHC27X2LAA57X34ZR6N6XLGCLYTQZM5KJAKSVGHB22AMMBGK3CA` — legs: 2.375.000u→QA3 (winner 10050), 125.000u→treasury, MBR back, box chiuse
- **S4c cid 3**: create `BMO2UCCCOTJNUNZ3DHWTJ3NXR5HQBB7JSP653JIEYFPACXIGFFVQ` · early_close `COPTU33LODYHG27OO3YBFT6C54DJPFORIR4DEEWBALGWYQ4JX5OQ` — legs: 100.000u→creator, MBR 358.200µA→creator, fee 1 ALGO→treasury (gruppo), box chiuse
- **OpUp donor 3686469118**: deploy `KDKCFKPCYZ2V3AMWSNRIPIIOX7MSZKUFKM6JULTFT7WPQAGANVEQ` (bytecode 0b8101 approve-all, zero stato — identico al testnet 769688641)
- **Opt-in ASA**: DEPLOYER `JNCLJFTG5FPUX7U3XWIJTONYG5322GEF4RUJY4IFO2K53Y5RY3GQ`

## OpUp (incidente risolto)

La prima create (pre-donor) è stata rifiutata: `dynamic cost budget exceeded,
executing ed25519verify_bare … app=3686311434, pc=1013` — senza donor il
budget singolo (700) non copre la verifica ed25519 (~2700). Gruppo atomico:
nulla scritto. Deploy donor (GO del lead) → sanity via **simulate** (7 tx,
budget pooled OK) → tutte le create successive verdi. Il client zip v17.0.0
(opUp=0) NON va distribuito: v17.0.1 (v9850706e) ha opUpAppId=3686469118.

## Smoke replay (golden rule) — v17.0.1

`SMOKE_NETWORK=mainnet SMOKE_ZIP=gonnafight-arena-mainnet.zip` (VER da
__GONNA_VER = v9850706e): **8/8 PASS** — honest 200 + sig verificata,
inflated → 400 REPLAY MISMATCH, wrong-seed → 400 SEED MISMATCH, CORS
gonna.bond ✓ / evil ✗. Boot log: 6 bundle, store=turso(libsql), legacyGil=off.

## Saldi finali (GONNA / ALGO)

| Wallet | GONNA | ALGO |
|--------|-------|------|
| DEPLOYER | **192.3** (residuo per QA futura) | 4.02 |
| PLAYER_QA2 | 3.59 | 1.47 |
| PLAYER_QA3 | 2.875 | 1.19 |
| PLAYER_QA4 | 0.5 | 1.19 |
| ORACLE | 0.5 | 1.99 |
| TREASURY (Principe) | +0.235 fee totali | +1.0 early-close fee |

Anomalie: nessuna contrattuale. Le uniche re-run sono state per fix dell'
harness (stageMode full, sealedRun fallback, cid-drift su resume) — nessun
doppio invio alla cieca (resume via readPlayers, mai re-join).
