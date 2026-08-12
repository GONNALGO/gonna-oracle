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
