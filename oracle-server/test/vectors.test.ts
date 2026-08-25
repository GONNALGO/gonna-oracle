// Byte-exact vectors vs contract.py (FROZEN). The expected hex below was
// generated with an independent Python port of contract.py (PyNaCl +
// hashlib) using the fixed THROWAWAY seed bytes(range(32)) — never a real
// key. If these pass, our messages/signatures are what the chain verifies.
import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import {
  scoreMsg,
  verdictDigest,
  verdictExtraFull,
  verdictExtraStage,
  verdictMsg,
  signerFromSeed,
  SCORE_MSG_LEN,
  VERDICT_MSG_LEN,
} from '../src/sign.js';

const hex = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const SEED = new Uint8Array(Array.from({ length: 32 }, (_, i) => i)); // throwaway
const APP_ID = 769767443;
const ADDR1 = hex('a4f35b1c9a855872d68c176a6d59c517ff747790cf003a7e6f97b402765c91d9');
const ADDR2 = hex('141ab516b1c4946f6657c53c17d73a02cb1735fc111df956776c256c532773b4');
const ADDR3 = hex('48e4c34ad462a04db75363526af52fa721559e7cbae31d8fd901842fdf719548');

describe('score message (SPEC §1, contract.py build_score_msg)', () => {
  it('is exactly 66 bytes and byte-exact', () => {
    const m = scoreMsg(APP_ID, 42, 3, ADDR1, 987654);
    expect(m.length).toBe(66);
    expect(SCORE_MSG_LEN).toBe(66);
    expect(toHex(m)).toBe(
      '51412d53434f52457c000000002de1b813000000000000002a03' +
        'a4f35b1c9a855872d68c176a6d59c517ff747790cf003a7e6f97b402765c91d9' +
        '00000000000f1206',
    );
  });

  it('ed25519 detached sig matches PyNaCl SigningKey(seed).sign', () => {
    const m = scoreMsg(APP_ID, 42, 3, ADDR1, 987654);
    const sig = signerFromSeed(SEED).sign(m);
    expect(toHex(sig)).toBe(
      'd65e3928c8fa51647b0b438bc301c7219f1c20b6cb4b2fd6f7758d1b0da93a5d6cacde7251a332d5528fb71d5cd67b9c7bf8bc3b2bf776d8c092607ec5051e05',
    );
    // and it verifies against the derived public key
    const pub = signerFromSeed(SEED).publicKey;
    expect(toHex(pub)).toBe('03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8');
    expect(nacl.sign.detached.verify(m, sig, pub)).toBe(true);
  });
});

describe('verdict message (SPEC §1, contract.py resolve)', () => {
  // seats 0..4, seats 1 and 3 UNSIGNED -> digest over seats 0,2,4 in order
  const entries = [
    { seat: 0, addr: ADDR1, score: 111 },
    { seat: 2, addr: ADDR2, score: 22222 },
    { seat: 4, addr: ADDR3, score: 3333333 },
  ];

  it('digest skips unsigned seats, keeps seat order', () => {
    const d = verdictDigest(entries);
    expect(toHex(d)).toBe('915afa657a71d173e2673e2b9f0fcab193c1937c0ca3a02aa98882bc8a7f9479');
    // order matters: shuffled seats give a different digest
    const shuffled = verdictDigest([entries[2]!, entries[0]!, entries[1]!]);
    expect(toHex(shuffled)).not.toBe(toHex(d));
  });

  it('extra FULL = 32x0, STAGE = 24x0 | u64be(idx)', () => {
    expect(toHex(verdictExtraFull())).toBe('00'.repeat(32));
    expect(toHex(verdictExtraStage(5))).toBe('00'.repeat(24) + '0000000000000005');
  });

  it('FULL verdict msg is byte-exact (92 B) and sig matches PyNaCl', () => {
    const d = verdictDigest(entries);
    const m = verdictMsg(APP_ID, 42, 0, verdictExtraFull(), d);
    expect(m.length).toBe(VERDICT_MSG_LEN);
    expect(toHex(m)).toBe(
      '51412d564552444943547c000000002de1b813000000000000002a00' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '915afa657a71d173e2673e2b9f0fcab193c1937c0ca3a02aa98882bc8a7f9479',
    );
    expect(toHex(signerFromSeed(SEED).sign(m))).toBe(
      '2bd57cadd10467d5b8fed87920519600d0e9c969de210403b9787225e4e8236f3160d179a8664d6f16f0d46b68261d124c52df644e02e3d14e71903e33096b0e',
    );
  });

  it('STAGE verdict msg is byte-exact (92 B) and sig matches PyNaCl', () => {
    const d = verdictDigest(entries);
    const m = verdictMsg(APP_ID, 42, 1, verdictExtraStage(5), d);
    expect(m.length).toBe(VERDICT_MSG_LEN);
    expect(toHex(m)).toBe(
      '51412d564552444943547c000000002de1b813000000000000002a01' +
        '0000000000000000000000000000000000000000000000000000000000000005' +
        '915afa657a71d173e2673e2b9f0fcab193c1937c0ca3a02aa98882bc8a7f9479',
    );
    expect(toHex(signerFromSeed(SEED).sign(m))).toBe(
      '7d6e43dd49915feb70d565035dd1dbd7bdac61636afe25eebf7947745dfe5849782b0b1931f7f389f3ce8bd3a8005a6d6f24639930e833332cd78cf5e9a72d04',
    );
  });
});
