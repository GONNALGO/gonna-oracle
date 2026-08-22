// scripts/oracle-link.mjs — generate the ORACLE MASTER LINK for staging.
// ⚠ TESTNET ONLY. Reads the gitignored deploy/testnet.secrets.json (never
// commit it), base64url-encodes the 25-word oracle mnemonic, and — LESSON
// FROM THE BROKEN v10 TOKEN — verifies with a ROUNDTRIP DECODE using the
// exact same algorithm as src/game/arena/oracleLink.ts decodeToken().
//
// USAGE: node scripts/oracle-link.mjs
import { readFileSync } from 'node:fs';

const secrets = JSON.parse(readFileSync('contracts/quantum-arena/deploy/testnet.secrets.json', 'utf8'));
const mn = typeof secrets.ORACLE === 'string' ? secrets.ORACLE : (secrets.ORACLE.mnemonic ?? secrets.ORACLE.mn);
if (!mn || mn.trim().split(/\s+/).length !== 25) throw new Error('ORACLE mnemonic missing or not 25 words');

const token = Buffer.from(mn.trim(), 'utf8')
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

// --- ROUNDTRIP ASSERT: decodeToken() logic mirrored from oracleLink.ts ---
let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
while (b64.length % 4 !== 0) b64 += '=';
const back = Buffer.from(b64, 'base64').toString('utf8').trim();
if (back !== mn.trim()) throw new Error('ROUNDTRIP FAILED — token does not decode back to the mnemonic');
if (back.split(/\s+/).length !== 25) throw new Error('ROUNDTRIP FAILED — decoded word count != 25');

console.log('token length:', token.length, '| roundtrip: OK');
console.log('');
console.log('https://gonna.bond/arena-testnet/#oracle=' + token);
