# PLAN — v9.4.0 "THE MINTING" + v9.5.0 "THRONE ROOM"

Design: /mnt/agents/output/GDD-THE-MINTING-THRONE-ROOM.md (approvato 6/6, 2026-08-10)

## Stage 0 — Scoping (ora)
- Mappare il sistema scene/stage dell'engine: come vengono definiti stage, nemici, transizioni, punteggio, sprite/background loading
- Identificare i punti di integrazione del bonus stage post-Stage 3

## Stage 1 — v9.4.0 THE MINTING (skill: vibecoding-general-swarm)
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
