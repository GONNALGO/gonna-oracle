# DOGFOOD WAVE C — BROWSER UI SMOKE (v16.1.1, VER v53365263)

- Zip under test: `/mnt/agents/output/gonnafight-arena-testnet.zip` (v16.1.1, `__GONNA_VER = 'v53365263'`)
- Served: `python3 -m http.server` from `/tmp/wavec-zip` on **http://localhost:8787** (exact CORS origin) and **http://localhost:9999** (degradation test)
- Oracle: `https://gonna-arena-oracle-testnet.onrender.com`
- Runner: Playwright 1.62 headless Chromium (desktop 1280×800 + mobile 390×844 iPhone UA/touch)
- Screenshots: `/tmp/wavec-shots/*.png` (paths listed per item)

## CHECKLIST

| # | Item | Result |
|---|------|--------|
| a | Boot console: zero errors | **PASS (warm boot)** — known by-design exceptions below |
| b | Initial screen renders, no white flash | **PASS** |
| c | Oracle status line = SERVER ORACLE + CORS health from :8787 | **FAIL (initial) → ORACLE FIX → RETEST PASS** |
| d | Arena lobby w/o wallet: board, wizard, pager, VIEW TX | **PASS** |
| e | Mobile 390×844: no overflow, tappable, legible | **PASS** |
| f | Perf: first render, fps, lazy chunks | **PASS (with env caveats)** |
| g | Back/forward landing↔lobby, no broken state / double boot | **PASS** |
| 4 | Port 9999: clean degradation on CORS denial | **PASS** |

---

## (a) Console — zero errors on the steady path

**Warm boot (SW armed): 0 console errors, 0 pageerrors.** Full warm-boot log: 8× warning, all identical and known:

- `The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture` ×8 — standard Chrome autoplay policy; the game resumes audio on first input. **Known, not a defect.**

**Known by-design console noise (documented, not failures):**

1. **1× `404 /assets/index-B0jAAMUg.js` on the FIRST load of a fresh browser profile.** This is THE VAULT DOOR optimistic boot working as designed: the entry is excluded from the zip, `index.html` registers `sw-v53365263.js` in parallel, the entry 404s, the page reloads ONCE and the armed worker mints the entry from `payload-v53365263.dat`. Server log confirms the only 404s ever served are this entry (7 hits across the whole session, all first-paint events). Self-heals every time; the game always booted.
2. **2× transient `404 ()` from external origins** on first arena entry — algonode indexer `box?name=` lookups returning 404 for absent boxes (normal "no box" semantics; cached afterwards, never reappears). Not our server (see http log).
3. **CORS errors on oracle calls BEFORE the fix** (see item c) — resolved by the oracle allow-list redeploy.

## (b) Initial screen

- `01-boot-landing.png`, `13-testnet-title.png` — GONNA FIGHT! pixel wordmark, INSERT COIN, ARENA / CONNECT / FIGHTER / THE PIT buttons, VER badge `V53365263` bottom-right. No rendering artifacts.
- **No white flash**: brightness sampled every 200 ms from `commit` on a fresh profile: `[6, 6, 0, 43, 42, …]` (0=black, 255=white) — black → dark game bg directly.

## (c) Oracle status — FAIL iniziale → FIX → RETEST PASS

- Label (testnet wizard confirm, `15-testnet-confirm-oracle.png`): **`SERVER ORACLE - GONNA-ARENA-ORACLE-TESTNET.ONRENDER.COM`** in FLUO green — correct, fully inside the canvas (edge-to-edge at VW=384, not clipped). NOTE: the label is config-based (static), drawn only in `?arena=testnet` mode; it is NOT a live health ping.
- **INITIAL FAIL (SEV, reported immediately)**: preflight `OPTIONS /v1/verdict` + `/v1/sign-score` with `Origin: http://localhost:8787` returned 204 but **no `Access-Control-Allow-Origin`**; browser fetch → `TypeError: Failed to fetch`. Allow-list contained only `https://gonna.bond`. Proxy artifact excluded (api.github.com `ACAO:*` passes through the same egress intact).
- **FIX (oracle redeploy, allow-list += localhost:8787, 127.0.0.1:8787) — RETEST PASS:**
  - Preflight → `access-control-allow-origin: http://localhost:8787` ✓ (and `http://127.0.0.1:8787` ✓)
  - Real fetch from the page on :8787 → HTTP 400 `{"error":"malformed request body"}` on both `/v1/verdict` and `/v1/sign-score` = CORS layer passes, oracle answers JSON (400 expected for dummy bodies).
  - `http://localhost:9999` remains correctly **denied** (allow-list hygiene).

## (d) Arena lobby without wallet

Mock mode (default on non-gonna.bond hosts) + `?arena=testnet` both exercised:

- **THE PIT board** (`06-thepit-board.png`): LIVE feed ticker, 3 open cards (1B DUEL CLOSING SOON countdown, 2× 100M OPEN TABLE), stake icons, **PAGE 1/2 pager with next arrow**, CREATE CARD / HISTORY / MY LEGACY / BACK.
- **Testnet board** (`14-testnet-pit.png`): TESTNET tag, CONNECT button, honest `NO LIVE CARDS - POST THE FIRST ONE`.
- **CREATE CARD wizard, all 5 steps, no wallet** (`07`–`12`): VISIBILITY → FORMAT → BATTLE → STAKE (10M/100M/1B + custom field) → YOUR FIGHTER (NFT shelf, 3 owned / 2 locked, honest `MOCK SHELF - CONNECT FOR REAL NFTS`) → SIGN IT confirm (summary, `NETWORK FEE: 0.009 ALGO (TESTNET)` in testnet mode, oracle line, PLAY YOUR RUN).
- **Versus screen** (`20-card-versus.png`): 1B DUEL detail, seats, countdown, ACCEPT & STAKE.
- **HISTORY** (`21-history.png`) → **battle card** (`22-histcard.png`): settled duel, pot math, `POT PAID ON-CHAIN`.
- **RUN CARD seal detail** (`25-seal-detail2.png`): **VIEW CARD / VIEW TX / BACK + SHARE ON X / TELEGRAM buttons present**. VIEW TX is a real DOM anchor → `https://allo.info/tx/CW3RQFIP…JDQ` (aria-label "View the seal transaction on allo.info"). Seal v2 block, date, message all render.

## (e) Mobile 390×844

- `26-mobile-title.png` → `27-mobile-title2.png`, `28-mobile-pit.png`, `29-mobile-pit2.png`.
- `document.documentElement.scrollWidth === window.innerWidth (390)` → **no horizontal overflow** (also no vertical page scroll: canvas FIT).
- First mobile boot shows the TRUE FULLSCREEN guide card (by design, v9.2) — one tap GOT IT dismisses.
- Title, THE PIT board, all buttons tappable and legible; a mis-tap on the title even proved **gameplay boots on mobile with touch controls** (`28-mobile-pit.png`, LIZARD LOUNGE stage, HUD + touch pad).

## (f) Performance (headless Chromium, software GL — caveat on fps)

- Warm boot (SW armed): **First Paint 180 ms, First Contentful Paint 392 ms**, DCL 74 ms, load 196 ms.
- Cold boot (fresh profile, SW arm + one vault-door self-heal reload): **3.74 s to first game render**.
- FPS (3 s rAF average): 30.9 (mobile viewport, pit) / 15.6 (desktop, canvas-heavy detail) — **headless SwiftShader-bound, not representative of real GPUs**; no jank observable in screen flow.
- **Lazy loading**: at boot only `index-B0jAAMUg.js` (entry, SW-minted) + `index-DsG97nrb.css` + brand PNGs + fighter frames are fetched. No `App-*.js` / `main-*.js` / `bowser` / `nacl` chunk is ever requested while navigating landing → leaderboard → pit → wizard → history → connect gate (verified by request logging per phase): the whole game incl. arena rides the entry; the extra chunks belong to the bundled hub/wallet app entry and stay cold.

## (g) Navigation back/forward

Cycle: title → THE PIT → CREATE CARD → step → ESC×3 → title → L leaderboard → ESC → title (plus earlier: leaderboard → PLAYER CARD → RUN CARD, pit → versus → history → battle card). `framenavigated` events during the formal cycle: **NONE** (true SPA scene switching, no double boot) and **0 pageerrors**. Final screenshot `34-nav-final.png` = landing intact. Wizard ESC steps back one step at a time correctly.

## Port 9999 — clean degradation (item 4)

- `31-port9999-title.png`, `32-port9999-histcard.png`, `33-port9999-after-probe.png`.
- Boot OK (same by-design entry 404 → self-heal). THE PIT + HISTORY load real **testnet** data (indexer reads have no CORS issue).
- Oracle call from :9999 → `TypeError: Failed to fetch` (CORS denied, as intended for a non-allowlisted host). **UI stays alive**: canvas keeps painting (mean brightness 27 after the failed call), **0 pageerrors, no white screen, no broken state**. Signing actions would surface the honest `OracleError` copy ("THE ORACLE IS UNREACHABLE - CHECK THE LINE AND RETRY") — by design; browsing/history/leaderboards fully usable.

## Known limits (per brief)

- No wallet connect in headless → no real create/join/sign flows from the browser (covered by Wave A).
- FPS numbers are software-GL bound.

## Minor cosmetic nit (NOT a SEV, no action requested)

- On THE PIT board the VER badge (`V53365263`, bottom-right) is drawn partially **under the BACK button / clipped by the mosaic border** (`14-testnet-pit.png` crop). Unreadable but harmless; present on both mock and testnet boards.

## Console log (warm boot, complete)

```
warning  The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page. (×8)
(no errors, no pageerrors)
```

Cold-boot additions (by design, see item a): `error Failed to load resource: 404 /assets/index-B0jAAMUg.js` (once, then self-heal reload); transient external indexer box 404s on first arena entry.

## Screenshot index (/tmp/wavec-shots/)

01 boot landing · 02 arena leaderboard · 03 player card · 04 back-to-title · 05 leaderboard re-entry · 06 THE PIT board (mock) · 07-12 wizard steps 1-5 + confirm · 13 testnet title · 14 testnet pit (+ VER badge nit) · 15 testnet confirm SERVER ORACLE line · 16-17 connect gate (testnet, official Algorand wordmark visible) · 18-19 wizard ESC chain · 20 versus · 21 history · 22 battle card · 23-25 seal detail / RUN CARD with VIEW TX · 26-27 mobile title (+fullscreen guide) · 28 mobile gameplay (touch controls) · 29 mobile pit · 30 cold boot · 31-33 port 9999 (title, history, post-probe alive) · 34 nav-cycle final landing.
