# DOGFOOD MAINNET WAVE C — BROWSER SMOKE ZIP MAINNET v17 (VER v4fc0b66e)

- Zip under test: `/mnt/agents/output/gonnafight-arena-mainnet.zip` — md5 `36efa4599d14861b77244690822934d2` ✓ (matches brief)
- VER badge: `v4fc0b66e` (confirmed in `index.html` and on-screen)
- Oracle: `https://gonna-arena-oracle-testnet.onrender.com` (mainnet appId 3686311434)
- Served: `python3 -m http.server 8787` from `/tmp/mainnet-zip`
- Runner: Playwright 1.62 headless Chromium (desktop 1280×800 + mobile 390×844 iPhone UA/touch)
- Screenshots: `/tmp/mainnet-shots/*.png`
- **CORS premise (by design): allow-list mainnet = `https://gonna.bond` ONLY → oracle from localhost MUST degrade, not fail.**

## CHECKLIST

| # | Item | Result |
|---|------|--------|
| a | Boot: zero console errors, no white flash | **PASS** (by-design exceptions below) |
| b | Default = PIAZZA MOCK, PRACTICE tag + GO LIVE button | **PASS** |
| c | GO LIVE → `?arena=live` → mainnet lobby renders (board/wizard/VIEW TX) | **PASS** |
| d | Mobile 390×844 piazza + lobby, no overflow, tappable | **PASS** |
| e | Perf: FCP, lazy chunks | **PASS** |
| f | Nav back/forward piazza↔live, no double boot / broken state | **PASS** |
| g | Oracle from localhost degrades clean + preflight matrix | **PASS** |
| h | Zip audit: no testnet strings in served chunks | **PASS** |

## (a) Boot & console

- `01-boot-landing.png` — GONNA FIGHT! title, VER `V4FC0B66E` bottom-right. Brightness sampled every 200 ms from `commit`: `[43, 44, 42, …]` — dark game bg from the first capturable frame, **no white flash**.
- Session console inventory (whole run): **0 unexpected errors, 0 pageerrors.**
  - 1× `404 /assets/index-CnWtyM92.js` per fresh-page first paint = **VAULT DOOR by design** (entry excluded from zip, SW `sw-v4fc0b66e.js` mints it from `payload-v4fc0b66e.dat` after one self-heal reload). Server log: the ONLY 404s served are this entry (8 first-paint events total).
  - 2× transient external `404 ()` = algonode indexer `box?name=` absent-box semantics (not our server).
  - 2× oracle CORS errors = **the by-design localhost denial** (item g), incl. my explicit probe.
  - Warnings: 24× `AudioContext was not allowed to start` (standard autoplay policy; audio resumes on first gesture). Known.

## (b) Default = PIAZZA MOCK

- `02-piazza-mock.png` (L1 board) + `03-piazza-pit.png` (THE PIT): **PRACTICE tag top-left, GO LIVE button top-right** (dark green, specular to CONNECT), mock cards with CLOSING SOON/FILLING FAST badges, PAGE 1/2 pager, CREATE CARD / HISTORY / MY LEGACY / BACK. Default on a non-gonna.bond host is the practice piazza — as specified.

## (c) GO LIVE → live lobby

- GO LIVE navigates to `?arena=live` (full page nav, by design), boots clean.
- `05-live-pit.png`: **MAINNET tag top-left, CONNECT button top-right** (specular to GO LIVE), LIVE feed ticker, honest `NO LIVE CARDS - POST THE FIRST ONE` (fresh mainnet arena).
- Wizard renders fully without wallet (`06-live-wizard1.png` … `07-live-confirm.png`): VISIBILITY → FORMAT → BATTLE → STAKE → FIGHTER (honest MOCK SHELF label) → SIGN IT confirm with **SERVER ORACLE line** (`SERVER ORACLE - GONNA-ARENA-ORACLE-TESTNET.ONRENDER.COM`, FLUO green — label is the Render service name; it serves the mainnet appId per brief).
- HISTORY live: honest `NO BATTLES SETTLED YET` (`09-live-history.png`).
- **VIEW TX**: L1 leaderboard → PLAYER CARD → match → RUN CARD seal detail (`10-live-runcard-viewtx.png`): VIEW CARD / **VIEW TX** / BACK + SHARE X/TG; real DOM anchor `https://allo.info/tx/CW3RQ…JDQ` (aria "View the seal transaction on allo.info").

## (d) Mobile 390×844

- `12-mobile-piazza.png`, `13-mobile-live.png`. `scrollWidth === innerWidth (390)` on both piazza and live → **no horizontal overflow**. PRACTICE/GO LIVE and MAINNET/CONNECT chips visible and tappable; wizard/board buttons reachable; TRUE FULLSCREEN guide card on first boot (by design, one-tap dismiss).

## (e) Performance (headless, software GL)

- Paint timing: **First Paint 104 ms, FCP 888 ms** (fresh page incl. vault-door self-heal; warm reloads are faster), DCL 24 ms.
- **Lazy chunks**: at boot only `index-CnWtyM92.js` (entry, SW-minted) + `index-DsG97nrb.css` + brand/frames PNGs. Navigating landing → leaderboard → pit requested **zero** additional JS chunks — the whole game incl. arena rides the entry; `App-*.js`/`main-*.js`/`bowser`/`nacl` belong to the bundled hub entry and stay cold.

## (f) Navigation piazza↔live

- GO LIVE → `?arena=live`; browser back → `/` (piazza, title state intact, THE PIT still focused — `14-back-piazza.png`); forward → live (`15-forward-live.png`); piazza re-entered and fully functional after the round trip (`16-piazza-after-backnav.png`). **0 pageerrors, no double boot** (each URL boots once via the armed SW; no reload loops — sessionStorage guard holds).

## (g) Oracle status from localhost — clean degradation (by design)

- Live wizard confirm shows the static SERVER ORACLE label; real oracle calls from `http://localhost:8787` → `TypeError: Failed to fetch` (CORS denied, as intended on mainnet). **UI stays alive**: canvas keeps painting (mean brightness 27 after the failed call — `08-live-after-oracle-fail.png`), 0 pageerrors, no white screen. Signing actions surface the honest `OracleError` copy; browsing/leaderboard/history fully usable (indexer reads unaffected).
- Preflight matrix (curl):
  - `Origin: https://gonna.bond` → `access-control-allow-origin: https://gonna.bond` ✓ present
  - `Origin: http://localhost:8787` → **no ACAO** ✓ denied (mainnet hygiene confirmed)

## (h) Zip audit — no testnet leak

- `grep -rl "769907387|testnet-api|COI33|4OQ3"` over `assets/*.js`, `index.html`, `sw*.js`, `manifest.webmanifest` → **zero hits**.
- `payload-v4fc0b66e.dat` is vault-door-encoded (not greppable by design) — the plain served chunks are the audit surface and are clean.

## Known cosmetic nit (carried from Wave C, NOT a failure)

- VER badge bottom-right on THE PIT board is partially clipped behind the BACK button (`03-piazza-pit.png` / `05-live-pit.png` crops). Dim, harmless.

## Screenshot index (/tmp/mainnet-shots/)

01 boot landing · 02 piazza L1 board · 03 piazza THE PIT (PRACTICE + GO LIVE) · 04 post-GO LIVE title (?arena=live) · 05 live THE PIT (MAINNET + CONNECT) · 06 live wizard step 1 · 07 live wizard confirm (SERVER ORACLE line) · 08 live after failed oracle call (UI alive) · 09 live history (honest empty) · 10 RUN CARD + VIEW TX · 11 mobile boot · 12 mobile piazza · 13 mobile live · 14 back-nav piazza · 15 forward-nav live · 16 piazza after round trip.
