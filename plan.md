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
