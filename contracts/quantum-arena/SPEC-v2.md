# QuantumArena — SPEC v2 (delta su v1, fonte di verità per l'implementazione)

v1 = contracts/quantum_arena/contract.py (735 righe). TUTTO ciò che non è elencato qui resta
identico a v1. Invarianti v1 da preservare INTATTE: binding firma oracle (app+cid+seat+addr+score),
tie → rimborso pieno zero fee, assert_no_rekey ovunque, checks-effects-interactions,
seats ∈ {1,4,8,12}, MAX_PLAYERS=13, JOIN_CUTOFF, CATASTROPHE_WINDOW, resolve permissionless.

## V2-A — SEAT CLOCK (solo duelli, seats_total == 1)

- Nuovo stato per seat: `seated_at: UInt64` (timestamp). Creator: alla create. Joiner: al join.
- Costante `SEAT_TTL = 3600` (1 ora).
- Nuovo metodo `claim_forfeit(cid: UInt64, seat: UInt64)`:
  - Solo duelli (assert seats_total == 1).
  - Il seat target è occupato e NON ha score firmato.
  - assert now > seated_at[seat] + SEAT_TTL (strict >).
  - Il chiamante deve essere l'avversario (l'altro seat) E avere uno score firmato sulla challenge.
    (Se nessuno dei due ha firmato, valgono i path esistenti: earlyClose / catastrophe.)
  - Effetto: stake del giocatore in forfeit → 95% all'avversario, 5% al treasury
    (arrotondamento: fee = stake * 5 / 100, resto all'avversario — stessa convenzione di resolve).
  - Stake del chiamante (firmato) gli torna intero.
  - Challenge chiusa (nuovo status STATUS_FORFEIT = 4), box cancellato, MBR al payer (creator).
  - Un solo claim possibile (status gate). Nessun rekey. CEI: aggiorna stato PRIMA dei pay.
- Caso simmetrico: il forfeit può colpire sia il creator (clock dalla create) sia il joiner (clock dal join).

## V2-B — MBR refund su early close (fix MBR bloccato)

- `early_close` ora CANCELLA il box della challenge e restituisce il MBR (0.35 ALGO o il valore
  esatto registrato alla create) al payer del box (creator).
- Resto invariato: stake rimborsato, 1 ALGO fee anti-spam al treasury, solo se nessun joiner
  ha firmato / regole v1 esistenti.
- Stessa cancellazione box + rimborso MBR applicata a TUTTI i path di chiusura (resolve,
  claim_forfeit, refund/catastrophe) — principio: "no fondi bloccati", MBR sempre restituito.
- Se il MBR esatto non è tracciato in v1, salvarlo nel box alla create (`mbr_paid: UInt64`).

## V2-C — RUMBLE SELF-SPAWN (permissionless, zero operatore)

- Nuovo metodo `spawn_rumble(seats_total, stake_amount, ...)`:
  - Permissionless: CHIUNQUE può chiamarlo (nessun gate oracle/deployer).
  - seats_total ∈ {4, 8, 12} (mai 1 — i duelli restano su create_challenge).
  - Il chiamante diventa il creator (seat 0) e paga: stake in $GONNA + MBR box + 1 ALGO fee
    anti-spam al treasury (stessa convenzione anti-spam di early_close).
  - Deadline automatica: prossimo 21:00 UTC; se mancano meno di 4h al prossimo 21:00 UTC,
    deadline = 21:00 UTC del giorno successivo (partecipazione minima garantita).
  - Da lì in poi valgono TUTTE le regole v1 dei rumble: join con stake, JOIN_CUTOFF,
    resolve permissionless a deadline+1 signed, forfeit-in-pot dei non firmanti,
    tie → rimborso, winner-takes-all −5%.
  - Anti-grief: la fee anti-spam + stake rendono lo spam costoso; nessun limite al numero
    di rumble (il costo è il freno). Nessuna lista allowlist.

## V2-D — Stato & compatibilità

- Il box cresce: aggiungere `seated_at` per player e `mbr_paid`. Ricalcolare la size del box
  e documentarla. Versione contratto: bump chiaro (es. global `VERSION = 2`).
- Deploy = NUOVA app (mai upgrade in-place della 769688298).
- Status enum: STATUS_OPEN=0, STATUS_RESOLVED=1, STATUS_REFUNDED=3 restano; aggiungere STATUS_FORFEIT=4.

## Test obbligatori (pytest, suite esistente estesa)

1. Forfeit joiner: joiner seduto, non firma, t+3601 → creator (firmato) claima: 95/5, stake
   creator restituito, box cancellato, MBR tornato, status=4.
2. Forfeit creator: creator non firma entro 1h dalla create, joiner firmato claima. Idem.
3. Boundary: t = seated_at+3600 esatto → claim DEVE fallire; t+3601 → ok.
4. Doppio claim → fallisce. Claim da non-avversario → fallisce. Claim senza score firmato → fallisce.
5. Forfeit su rumble (seats>1) → claim_forfeit DEVE fallire (rumbles restano deadline-based).
6. Early close: box cancellato, MBR restituito, 1 ALGO al treasury, stake rimborsato.
7. Resolve normale: box cancellato + MBR restituito (nuovo) oltre a payout 5%.
8. Spawn rumble: chiunque crea, deadline = 21:00 UTC corretta nei due casi (>=4h / <4h),
   fee 1 ALGO al treasury, creator seduto con stake.
9. Regression: TUTTA la suite v1 deve passare invariata (tie, oracle binding, cutoff, catastrophe…).
10. Adversarial: rekey attempts, inner-tx confusion, fee arrotondamenti (stake=1 micro), claim
    durante JOIN_CUTOFF, race forfeit-vs-submit nello stesso blocco logico.

## Self-audit obbligatorio (deliverable scritto)
Flussi fondi per ogni metodo nuovo/modificato: chi paga, chi riceve, quando, cosa può fallire,
nessun path che lascia ALGO o ASA bloccati nel contratto oltre i fondi attivi delle challenge aperte.
