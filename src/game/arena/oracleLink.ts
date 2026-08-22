// ============================================================================
// ⚠⚠⚠  TESTNET ONLY — NEVER SHIP TO MAINNET  ⚠⚠⚠
// ORACLE MASTER LINK: the arena-testnet staging owner can arm the dev oracle
// by opening a link carrying the key in the URL hash:
//   https://gonna.bond/arena-testnet/#oracle=<base64url(25-word mnemonic)>
// On boot we decode it into localStorage (the key devOracle.ts reads) and
// IMMEDIATELY scrub the hash via history.replaceState — the key must never
// linger in the address bar, screenshots or copy-pasted links.
// HARD GUARD: adoption happens ONLY when arenaMode()==='testnet'. On any
// mock/mainnet context the hash is ignored (and left untouched).
// ============================================================================
import { arenaMode } from './chainAdapter';
import { armDevOracle } from './devOracle';

function decodeToken(tok: string): string | null {
  // base64url of the mnemonic (preferred — no spaces/escaping issues)
  try {
    let b64 = tok.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '='; // atob wants padding
    const words = atob(b64);
    if (words.trim().split(/\s+/).length === 25) return words.trim();
  } catch { /* not base64 */ }
  // fallback: raw words, URL-encoded
  try {
    const words = decodeURIComponent(tok).replace(/\+/g, ' ').trim();
    if (words.split(/\s+/).length === 25) return words;
  } catch { /* not decodable */ }
  return null;
}

export function adoptOracleFromHash(): boolean {
  try {
    const h = window.location.hash || '';
    const m = h.match(/#oracle=([A-Za-z0-9_\-%.+]+)/);
    if (!m) return false;
    // scrub FIRST, in every mode: an #oracle= hash is not a route and would
    // break the HashRouter even when we refuse to arm (mock/mainnet)
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (arenaMode() !== 'testnet') return false; // HARD GUARD — never arm outside testnet
    const mn = decodeToken(m[1]);
    if (!mn) return false;
    armDevOracle(mn);
    return true;
  } catch {
    return false;
  }
}
