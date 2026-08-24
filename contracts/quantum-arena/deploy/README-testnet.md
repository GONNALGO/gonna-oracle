# QUANTUM ARENA — Testnet deploy & smoke test

Riproduzione end-to-end su **Algorand TESTNET** (niente mainnet).
Tutti gli script vivono in `deploy/` e sono idempotenti: lo stato
(`deploy/testnet.json`) permette di rieseguirli senza duplicare risorse.

## Prerequisiti

```bash
pip install py-algorand-sdk pynacl
```

Node usato: `https://testnet-api.algonode.cloud` (algod v2, token vuoto).

## 1. Chiavi

```bash
python3 deploy/gen_accounts.py
```

Genera DEPLOYER, TREASURY, ORACLE e scrive `deploy/testnet.secrets.json`
(address + mnemonic, permessi 0600). Il file è **gitignored**
(verificare con `git check-ignore contracts/quantum-arena/deploy/testnet.secrets.json`).

## 2. Fondi testnet

> ⚠️ Il vecchio dispenser anonimo (`dispenser.testnet.aws.algodev.network`,
> `bank.testnet.algorand.network`) è stato dismesso a febbraio 2026: ora
> redirige a Lora, login-gated. Il funding usa la **AlgoKit TestNet Dispenser
> API** con device flow OAuth (lo stesso di `algokit dispenser login --ci`).

```bash
python3 deploy/fund.py --start-device-flow   # stampa URL + codice
# un umano apre l'URL, inserisce il codice e fa login (GitHub/Google)
python3 deploy/fund.py --poll                # attende e salva il token
python3 deploy/fund.py <ADDRESS> 10000000    # 10 ALGO
```

In alternativa: `export ALGOKIT_DISPENSER_ACCESS_TOKEN=<jwt>` e chiamare
direttamente `fund.py <ADDRESS>`. Il token è salvato in
`deploy/.dispenser_token.json` (gitignored). Nota: il dispenser impone un
limite giornaliero per identità (~5 ALGO): basta per l'intero deploy,
perché DEPLOYER redistribuisce on-chain a TREASURY e ai player.

## 3. ASA $GONNA TESTNET

```bash
python3 deploy/create_asa.py
```

Crea l'ASA (name `GONNA TESTNET`, unit `GONNA`, decimals 6,
total 100_000_000_000 × 10^6 base unit, manager/reserve/freeze/clawback
vuoti ⇒ immutabile) e fa l'opt-in di TREASURY. Scrive `gonna_asa_id` in
`deploy/testnet.json`.

## 4. Deploy contratto + bootstrap

```bash
python3 deploy/deploy_contract.py
```

- Compila i TEAL artifact via algod (`/v2/teal/compile`).
- `ApplicationCreateTxn`: NoOp, global schema (3 int, 2 byte), local (0,0),
  `extra_pages=1`, app args ABI di `create(byte[],byte[],uint64)`:
  treasury = pk 32-byte di TREASURY, oracle_pub_key = pk ed25519 di ORACLE,
  gonna = asset id.
- `bootstrap(pay)`: gruppo `[pay 1 ALGO → app, app call]`; l'app fa opt-in
  a $GONNA via inner axfer (fee pooling, inner fee=0).
- Stampa e salva `app_id` + `app_address` (escrow) e lo stato globale
  on-chain a verifica.

## 5. Budget opcode (go-algorand v5) — opup helper

Testnet gira go-algorand **v5.0.0**: il budget opcode pooled è
`700 × n_app_call` nel gruppo; le fee in surplus **non** comprano più
budget (error: `dynamic cost budget exceeded`). `ed25519verify_bare`
costa 1900 ⇒ serve un helper:

```bash
python3 deploy/opup.py   # deploy app "budget donor" (approva ogni NoOp)
```

Lo smoke test aggiunge 4 NoOp call all'opup app nei gruppi con verifica
oracle (CREATE / SUBMIT / RESOLVE). Ogni call deve avere una `note`
univoca (txid altrimenti duplicati nel gruppo).

## 6. Smoke test on-chain reale

```bash
python3 deploy/smoke_testnet.py
```

Crea PLAYER_A/PLAYER_B (salvati nei secrets), li finanzia da DEPLOYER,
opt-in ASA e distribuisce 100 GONNA a testa. Poi:

1. **Duello**: A crea challenge cid=N (stake 1 GONNA, score 1000 firmato
   oracle), B joina e submette score 2000 firmato oracle. `resolve`
   (permissionless, chiamato da DEPLOYER) con verdict oracle:
   B riceve `pot − 5%` = 1_900_000 µGONNA, TREASURY riceve 100_000 µGONNA.
2. **Early close**: A crea cid=N+1, nessun join, `early_close` con 1 ALGO
   al treasury; stake rimborsato ad A.

Lo script stampa tutti i tx id e fa assert sui saldi finali
al microGONNA. Esce con codice ≠ 0 se qualcosa non quadra.

## Formato dei messaggi oracle (v1, ed25519)

- Score: `QA-SCORE|` ‖ app_id(8 BE) ‖ challenge_id(8) ‖ seat(1) ‖ player(32) ‖ score(8)
- Verdict: `QA-VERDICT|` ‖ app_id(8) ‖ challenge_id(8) ‖ mode(1) ‖ extra(32) ‖ sha256(concat[seat(1)‖addr(32)‖score(8)] sui firmatari in ordine di seat)(32)

Firma: ed25519 bare (PyNaCl `SigningKey(seed)` dove seed = primi 32 byte
della chiave privata algosdk di ORACLE).

## Risultati del run v2 del 2026-08-24 (NUOVA app — v1 mantenuta come legacy)

| Voce | Valore |
|---|---|
| App ID **v2** | **769767443** |
| App escrow v2 | `GISV2JNJTT7XCOQFN7BBLKPT3HQKXAUSFKCODTYQ7U7B2XJ2BIMAQIBNM4` |
| Deploy tx v2 | `U4ZT77JXKHJRJQGJLVGN4WXKLD4UVKPTB6GQXNY5ZAWK4B6C4VWQ` |
| Bootstrap tx v2 | `IWIUGC7T6BWRCSJYLH2Y3JDG3FWUR2ZFAPMJ4ZDATQOMWDH7YCRQ` |
| Smoke v2: create duello cid 2 (A firmato) | `Y7HLVCAIM6RZHE2P6N5ASZUSTYNLKZPW6AKO5PKUSL2IV5OQ2NIQ` |
| Smoke v2: join cid 2 (B NON firmato) | `NMZFZJEDZHJJFUIVWPWHRMCTEZIBJPBIGX2AL3F3W6M6UGUV5GYA` |
| Smoke v2: spawn_rumble cid 3 | `LODM54LS5OSZDNRLU7B2LRMS4B4JSGZBGKM4CSM56PLEUKMW4EJQ` |

Note v2:
- Schema globale 4 int / 2 byte (+ `version` = 2), `extra_pages=2`
  (approval 4473B > 4096).
- Bootstrap esige il TREASURY opt-in $GONNA on-chain: passare TREASURY in
  `accounts` (liveness gate). Verificato: treasury già opted-in dal run v1.
- Box layout v2: meta 148B (+`mbr_paid`), entry `(byte[],uint64,bool,uint64)`
  con `seated_at`; `CHALLENGE_MBR = 358_200` µALGO.
- `deploy/smoke_v2_testnet.py`: duello cid 2 lasciato APERTO con B unsigned
  (claim_forfeit(cid 2, seat 1) si sblocca a `seated_at + 3600`), rumble
  cid 3 self-spawnato (deadline = prossimo 21:00 UTC, fee 1 ALGO al treasury)
  lasciato APERTO per QA.
- La v1 (app 769688298) resta risolvibile on-chain; in `testnet.json` le sue
  chiavi sono `legacy_*`. Il frontend punta alla v2.
- Explorer: `https://lora.algokit.io/testnet/application/769767443`

## Risultati del run del 2026-08-23 (v1, LEGACY)

| Voce | Valore |
|---|---|
| App ID | **769688298** |
| App escrow | `LJFWMZQKDYEAXUCHCNCXJ4I634GHA7KQHT7L5ZATPLNVT4VPL6M4WLFEIQ` |
| $GONNA TESTNET ASA | **769688287** |
| OpUp budget app | 769688641 |
| Deploy tx | `TXJCCOZVQ3BIJYHKPFN6TQ6EN3AN3FNA5DI7Q3E2PNOJ6IBJBNHA` |
| Bootstrap tx | `HV4T36UY5CYCOS6HBN5IQLFJDU33RRPBICE22NPS3UZX4PE4KWQA` |
| Smoke: resolve duello cid 0 | `LRHAI56ZU6Y2B6J56WGT6CP7TYHT3Z2ARSJOG27TYOY3CIT654DQ` |
| Smoke: early_close cid 1 | `POUUHI36Q2ZKXKYFPFP6HTAKRLZKIQ5Z6TSVI7ZEL2YDAT66RSCQ` |

Esiti verificati on-chain (assert nel codice): B ha ricevuto
1_900_000 µGONNA (pot 2 GONNA − 5%), TREASURY 100_000 µGONNA di fee;
nell'early close A ha riavuto lo stake intero e TREASURY +1 ALGO.
Tutti gli indirizzi e i tx id sono in `deploy/testnet.json`
(solo dati pubblici; i mnemonic restano in `testnet.secrets.json`,
gitignored).

Explorer: `https://lora.algokit.io/testnet/application/769688298`
