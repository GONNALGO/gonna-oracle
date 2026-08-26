# DOGFOOD WAVE A — report (2026-08-26)

Happy-path dogfood contro l'oracle pubblico
`https://gonna-arena-oracle-testnet.onrender.com`, app v2.1 testnet
**769907387**, ASA GONNA **769688287**, build client **v53365263**,
REPLAY_ENFORCE=1, run GIL v2 oneste. Harness in `scripts/wave-a-*.mjs`.
Ogni inner leg verificata via indexer (testnet-idx.algonode.cloud).

## Flow

| # | Flow | cid | Esito | Txids chiave |
|---|------|-----|-------|--------------|
| a | DUEL stage-mode (1 GONNA, 2 seat) | 26 | PASS | create `NAXLQRZZVM2DBA3OZYOLKKEASNUF3WNJ2UKCYF2GJLUHLJFXJTKQ` · join `RMNINJQHNN3OOBGSRLYWKAMKAXEPNNBIORRH7ZRNUABMKKQYIXJA` · resolve `ZLL7SFQ2B77C56T6Q4T3PGM6ZZGYKWGIOZ5YILS6G4SSREYD6XMQ` |
|   | (bonus duel da rerun filtro) | 29 | PASS | resolve `JRCDJMC6LORZV3XHZ4B7AVYD5RURUVYEVGYKWNCZ4YCXQW45PTGA` |
| b | 5-seat full-mode (0.5 GONNA ×5) | 30 | PASS | create `IAHFELKOXTGKXBAB7ATVLMA7ME2WKNFDFW4HTMQOWBWWOKGOG3WQ` · join XJTKHKHIGYQJREYOD4BTFTDDONMPSHPMELCRQOAAUH2VVFY46TUA (+3) · resolve `M7AKOTS6EFJV4LJCPLBX76TOBJ4VJJUAESH6RTI3D6BSA24RU4TA` |
| c | CONTINUE receipt | 31 | PASS | continue pay 5 ALGO `6GUQD4T77NZ2JVKKPOV5LWQ4IANQ3KCJNVYG4DE7R2AOOCN6CWDQ` (refId `WAVE-C-31-mtadomg5`) · submit run2 `VOVCMV42RNQPD6QYLYI7XWX6FGB2RCOSWEYVZ2URR4KLF2642GJQ` · resolve `RVS47GDHDQGEWCPVLYCGNKXD4JJG35RHT5Z2CYN5UFWATFR37ELA` |
| d | EARLY_CLOSE (0 joiners, pre-deadline) | 24 | PASS | `5JIUCQ5BNRW6CTQC3LXLOKU7CUNAFBCHYHETF2GYJQPUQ5ENDMOA` |
| e | CLAIM_FORFEIT (joiner silenzioso > 1h) | 25 | PASS | create `VH6AN3WYXJDB5HSUPHBQJK2RBJJUJJNGWOBSBYCBPE6ZIKP76MRA` · join `JSL653QXL7KTVBQKGAMLPZTBIFC4KMMNEX24FYHAFQQE7N2VRCAQ` · claim `ONDIVEANN64OOSIJUVJZDYEC4Q5XLXWLTWIGGKUULMNNTOX6H3BA` |
| f | VERDICT endpoint | — | PASS | 200 su card aperta full-signed (cid 26 pre-resolve); 409 "challenge not active" su risolta (26) e early-closed (24); 409 "not resolvable yet" su 25 pre-claim |
| g | VIEW TX indexer | — | PASS | inner legs recuperate e coerenti per 24/25/26/29/30/31 |

## Inner legs (somme esatte verificate)

- **(a/b) resolve**: payout 95% pot al winner (1.900.000 u su pot 2.000.000; 4.750.000 su 5.000.000), fee 5% al treasury (100.000 / 250.000), MBR 358.200 microA restituito al creator, box chiuse.
- **(c) continue**: run1 mai sottomessa → pay 5 ALGO a treasury (nota `QA-CONTINUE|refId|addr`) → `POST /v1/continue/receipt` 200 → sign-score con `continueRef` 200 (receipt **consumato**) → submit accettato on-chain. Dup verificati: re-register → **409 "receipt already registered"**; riuso ref consumato su card attiva con run onesta → **409 "continue receipt already consumed"**.
- **(d) early_close**: stake 1.000.000 u → creator, MBR 358.200 microA → creator, fee 1 ALGO → treasury (payment di gruppo), box chiuse.
- **(e) claim_forfeit**: caller (creator firmato) riceve stake proprio + **95%** dello stake del silent (totale +1.950.000 u), treasury **5%** (+50.000 u), MBR al creator. La realtà contrattuale è 95% caller / 5% treasury.

## Anomalie / note ops

- Nessuna anomalia contrattuale.
- Il creator è già SIGNED al `create_challenge` (score sigillato): un secondo submit è rifiutato — by design, non tentarlo nei flow.
- Broadcast policy rispettata: short-poll + mai doppio invio alla cieca; le uniche re-run (filtro SIM_ONLY, fix param kit) hanno creato card extra regolarmente concluse.
- ALGO testnet è il collo di bottiglia ops: il dispenser pubblico richiede ora JWT (algokit login); i 5 ALGO del continue sono arrivati dal Principe su PLAYER_B.
- Funding wallet QA documentato in `scripts/wave-a-fund.mjs` (top-up da TREASURY/DEPLOYER con min-balance checks).
- Airdrop dogfood: 10.000 GONNA DEPLOYER → Principe, txid `Y5LXXI5WDZBDHUVCT4H3OXHQKX5JXNVTL3LFAGLNCZDSJ5CDZCUA` (`scripts/airdrop-principe.mjs`).
