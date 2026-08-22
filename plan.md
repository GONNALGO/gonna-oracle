# PLAN — v9.4.0 "THE MINTING" + v9.5.0 "THRONE ROOM"

Design: /mnt/agents/output/GDD-THE-MINTING-THRONE-ROOM.md (approvato 6/6, 2026-08-10)

## Stage 0 — Scoping (ora)
- Mappare il sistema scene/stage dell'engine: come vengono definiti stage, nemici, transizioni, punteggio, sprite/background loading
- Identificare i punti di integrazione del bonus stage post-Stage 3

## Stage 1 — v9.4.0 THE MINTING (skill: vibecoding-general-swarm) ✅ CONSEGNATA
<!-- live: commit be9f26c, version 2527e48, zip gonnafight-v940.zip, gauntlet OK -->
1. Bonus-scene engine: oggetto statico HP, timer 40s, 4 stati di danno, reveal statua (flip)
2. Chart-pump wall procedurale (candela cresce col danno, rossa se idle 2s, GOD CANDLE finale)
3. Forgia: parallasse + crew dal roster sprite esistente + folla degen + ticker + gatto
4. Punteggio → run score; costante MINT_BONUS_CAP (TBD Silvio, default competitivo)
5. Hook nel flusso post-Stage 3 → Stage 4
6. Version bump (screens.ts + vault-door.mjs v940), build, gauntlet QA, zip, commit, build_version

## Stage 2 — v9.5.0 THRONE ROOM (dopo v9.4.0 live)
1. Stage 7: navata + Corridoio dei Morti + Guardia d'Oro (elite tinta oro) + 3 ondate
2. Cattedrale candele, fregio blocco reale, tempesta glitch
3. Boss GONNA 404 (skin rainbow reale): entrance statua, 3 fasi, teleport NOT FOUND, RAGE
4. Finale BYZANTINE CLEAR + podio
5. Release dance (v950)

## Note
- GONNA = lucertola umanoide SENZA CODA (mai "gecko")
- Nessun lampo bianco mai
- $GONNA/$ALGO/ALGORAND eroi; BTC/ETH/SOL inferiori (ticker + Corridoio dei Morti)
- Statua del bonus = statua del boss (continuity bomb)

## Stage 2 — v9.5.0 THRONE ROOM ✅ RILASCIATO
- Commit: 09cb971 | Version: f15c0d0 | Zip: gonnafight-v950.zip
- Stage 7 THE THRONE ROOM (idx 6): cattedrale Algorand, vetrate (triangolo ALGO / testa GONNA dorata / candela verde), Corridor of the Dead (ETH GAS $48, SOL OFFLINE, BTC ~10 MIN), arazzo COMPETITION 01 con 218540, folla degen con cartelli
- Boss finale GONNA 404: hp 420, skin rainbow REALE, intro dalla statua d'oro mintata nel bonus (continuity), 3 fasi, teleport NOT FOUND, combo da 10 con popup 218,540, RAINBOW RAGE, morte a dissolvenza rainbow SENZA lampo bianco
- Frieze live: BLOCK <numero> dal mainnet Algorand (indexer /health, cache 30s, stima +1/2.9s)
- FUD non più finale: stageClear → Stage 7; vittoria finale solo con gonna404 ("404: FOUND." / "THE THRONE IS YOURS." / BYZANTINE CLEAR se 0 continue)
- QA: spawn boss ✓ intro statua ✓ teleport NOT FOUND ✓ fasi ✓ morte→vittoria ✓ transizione FUD→Stage7 ✓ gauntlet armor ✓ fix collisioni HUD (frieze BLOCK spostato, BYZ line, cast line)

## Hotfix — v9.5.1 SAFARI GUARD ✅ (commit 7c503ea, version 4bcdb2c)
- Probe HEAD del chunk entry nel bootstrap + reload singolo auto-guaritore (Safari non fa controllerchange)

## Hotfix — v9.5.2 ZOMBIE KILLER ✅ (commit 79174e3, version c67b46b)
- Diagnosi: Chrome dell'utente ha giocato la v9.4.0 ZOMBIE (index.html vecchio in HTTP cache + SW v940 + payload-v940.dat ancora sul server) → game over al lvl 6 con FUD finale
- sw.js: 404 per tutti gli 11 entry chunk storici (STALE_ENTRIES), navigazioni sempre no-store (index.html mai più dalla cache)
- Fix contatori: save record "/ 6" → "/ 7", openSave clamp 6→7, seal note clamp 6→7, board parser uint max 6→7 (i record stage-7 venivano SCARTATI dalla leaderboard!)
- Deploy instructions: cancellare vecchi payload-v9*.dat dal server + hard refresh una volta

## Hotfix — v9.5.3 SW CACHE TRAP ✅ (commit 6ac5c11, version 113af43)
- Diagnosi: LiteSpeed serve sw.js con max-age=691200; regola 24h dei browser → Chrome riusava sw.js v950 dalla cache, SW v952 mai installato → chunk nuovo 404 → pagina nera
- Fix: register('./sw.js?v953', { updateViaCache: 'none' }) — URL versionato buca la cache HTTP, updateViaCache:none per sempre
- STALE_ENTRIES += index-DDi_h0ej.js (v952)
- Gauntlet PASS: boot + mint + zombie 404 + legit 200
- Self-heal: index.html ha max-age=0 → bootstrap v953 → nuovo URL SW → installazione forzata → il player si sblocca con UN reload normale

## Hotfix — v9.5.4 OPTIMISTIC BOOT ✅ (commit 2ea429e, version f093a8a)
- Riscrittura bootstrap: modulo iniettato SUBITO (zero attese), worker armato in parallelo con FILENAME versionato dist/sw-v954.js (immune a cache browser + edge LiteSpeed), rescue reload singolo solo su onerror reale
- QA: prima visita 944ms (1 auto-reload invisibile), visita di ritorno 634ms 1 load istantaneo, zombie 404 OK


---

# PROJECT QUANTUM FIGHT — THE ARENA (approvato dal Prince 2026-08-22, decisioni Silvio definitive)

## Contesto
- Algorand v5.0.0 attiva native Falcon-1024 PQ accounts su mainnet ~22-23 ago 2026 (90% threshold 15 ago + cooldown 208k round)
- Falcon-1024: indirizzo 58 char da SHA512_256(domain||scheme||salt||pk); mnemonic 25 parole; Pera/AlgoKit/SDK support; fee resource-based (firma ~1280B, pk ~1793B → fee > 0.001 ALGO base)
- AVM v12+: opcode falcon_verify (contratti verificano firme Falcon on-chain); AVM v13: contratti 16KB, box cross-app, SHA-512, Poseidon2
- Consenso NON ancora PQ (2027) → marketing dice "quantum-secure accounts", mai "chain quantum-proof"

## DECISIONI SILVIO (definitive)
1. TESORO = account Falcon-1024 PURO (99% riceve: 5% vincite + 1 ALGO early-close; uscite rare e manuali)
2. ESCROW = smart contract senza chiavi (program-controlled; nemmeno noi possiamo toccare i fondi)
3. VERDETTI oracle firmati Falcon-1024, verificati on-chain con falcon_verify → "quantum referee"
4. Fee engine: UI mostra network fee corretta per tipo account (Ed25519 vs Falcon) prima di firmare
5. QUANTUM SEAL: badge ⚛️ sulle card create da account Falcon
6. Testnet obbligatoria → mainnet solo dopo test personale del Prince

## REGOLE DI GIOCO (blocco 1: CARD + BACHECA)
- CREATE CARD: visibility PUBLIC(board)/PRIVATE(link-only) × formato DUEL(1 seat, primo arrivato)/OPEN TABLE(4/8/12 seats) × stage pick/random(shuffle animation)/FULL RUN × stake 10M/100M/1B/custom × NFT fighter se posseduto
- Durata: 24h duello; tavolo 4h/12/24h. Scaduta senza partecipanti → claim creatore (keeper spazza dopo 7gg, permissionless)
- Early-close (solo se 0 partecipanti): 1 ALGO al tesoro
- Join atomico: doppio tentativo sullo stesso seat → tx2 fallisce senza muovere fondi (+tap "open identical")
- PAY = PLAY: chi paga e non firma score entro chiusura → posta nel piatto
- Join cutoff: ultimi 10 min prima di chiusura vietati
- 2+ firme → vincitore tra firmatari (piatto − 5% tesoro; forfeit inclusi); pareggio perfetto → rimborsi zero fee
- CATASTROPHE RULE: scadenza + 7gg senza verdetto → rimborso totale a tutti, zero fee, permissionless
- Quit live: 45s rejoin window; quit-rate pubblico
- Bacheca = UNA piazza sola: countdown Rumble in cima (dopo), card vive con seats/timer live, badge FILLING FAST/CLOSING SOON, feed live
- Private card NON cliccabile in bacheca; feed annuncia solo "A PRIVATE DUEL HAS BEEN SEALED"
- Copy inglese degen; mai lampi bianchi; mobile-first; sprite/stile esistenti

## ROADMAP
- BLOCCO 1 (ora): contratto escrow Puya + test (testnet) — poi UI CREATE CARD/BOARD/CARD DETAIL + wallet connect + fee engine
- BLOCCO 2 (dopo): keeper autoclaim, oracle Falcon signer, seal on-chain
- BLOCCO 3: chat Sovereign (gate ≥2B $GONNA o ≥1 NFT), Royal Rumble 21:00 auto, staking $GONNA + revenue share (DOPO parere legale)
- BLOCCO 4: marketing QUANTUM FIGHT — "the first quantum-secure fight club on Algorand"

## Note legali
- Skill-based (stesso seed per tutti) ≠ gambling; prima del mainnet: parere avvocato gaming + T&C 18+ + geo/KYC sopra soglie
- Staking/revenue share = possibile security → solo dopo parere legale

## LOG QUANTUM FIGHT
- 2026-08-22 — BLOCCO 1 contratto ✅: /contracts/quantum-arena/ (Puya, AVM v11, extra_program_pages=1), 33/33 test verdi (verificati di persona), artifact TEAL+ARC56. falcon_verify NON in puyapy 5.10 → oracle v1 ed25519verify_bare con swap point `_verify_oracle_sig` + ORACLE_SIG_SCHEME; v2 = redeploy immutabile con chiave Falcon 1793B. Box MBR 0.35 ALGO/challenge. Treasury deve fare opt-in $GONNA; bootstrap ≥0.2 ALGO post-deploy.

- 2026-08-22 — ARENA UI v4 ✅ (preview 2f96314): SHARE sheet 5 tasti, share card 1200×630, deep-link ?duel=, 404 lore, @GONNALGO, SHOW CARD overlay, paginazione, HISTORY, MY LEGACY. Commit 798c9ce.
- 2026-08-22 — VAI del Prince → FASE TESTNET: (1) chiavi deployer/treasury/oracle + dispenser funding; (2) $GONNA testnet ASA; (3) deploy QuantumArena da artifact ARC-56 (extra pages=1) + bootstrap; (4) wiring TestnetAdapter (APP ID reale, box read, oracle signer TESTNET-ONLY, Pera connect); (5) QA E2E su testnet reale. Oracle v1 = ed25519 (falcon_verify v2 al redeploy). Niente chiavi mainnet mai in repo; mnemonic testnet in file gitignored.
