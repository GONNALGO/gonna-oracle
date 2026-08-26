// Byte-exact vectors vs contract.py (FROZEN). The expected hex below was
// generated with an independent Python port of contract.py (PyNaCl +
// hashlib) using the fixed THROWAWAY seed bytes(range(32)) — regenerated
// for app v2.1 769907387 (app id is inside every signed message) — never a real
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
const APP_ID = 769907387;
const ADDR1 = hex('a4f35b1c9a855872d68c176a6d59c517ff747790cf003a7e6f97b402765c91d9');
const ADDR2 = hex('141ab516b1c4946f6657c53c17d73a02cb1735fc111df956776c256c532773b4');
const ADDR3 = hex('48e4c34ad462a04db75363526af52fa721559e7cbae31d8fd901842fdf719548');

describe('score message (SPEC §1, contract.py build_score_msg)', () => {
  it('is exactly 66 bytes and byte-exact', () => {
    const m = scoreMsg(APP_ID, 42, 3, ADDR1, 987654);
    expect(m.length).toBe(66);
    expect(SCORE_MSG_LEN).toBe(66);
    expect(toHex(m)).toBe(
      '51412d53434f52457c000000002de3dabb000000000000002a03' +
        'a4f35b1c9a855872d68c176a6d59c517ff747790cf003a7e6f97b402765c91d9' +
        '00000000000f1206',
    );
  });

  it('ed25519 detached sig matches PyNaCl SigningKey(seed).sign', () => {
    const m = scoreMsg(APP_ID, 42, 3, ADDR1, 987654);
    const sig = signerFromSeed(SEED).sign(m);
    expect(toHex(sig)).toBe(
      'c5546dd71a4a90404947fcbe26524896e864da589b4cc1b1e20048a572d0228bac669060b9d35a383460c0ca1706a07df407551bf78a75e2b5b0b90ad752460a',
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
      '51412d564552444943547c000000002de3dabb000000000000002a00' +
        '0000000000000000000000000000000000000000000000000000000000000000' +
        '915afa657a71d173e2673e2b9f0fcab193c1937c0ca3a02aa98882bc8a7f9479',
    );
    expect(toHex(signerFromSeed(SEED).sign(m))).toBe(
      '1296687d75328f3eb9725b165f663cfb4fdde1a8fe051c34d2cc4af838da2b8dd46dd77abaef2a69bff211d9c5155351ad6179f3d6ece6add0281bc631810903',
    );
  });

  it('STAGE verdict msg is byte-exact (92 B) and sig matches PyNaCl', () => {
    const d = verdictDigest(entries);
    const m = verdictMsg(APP_ID, 42, 1, verdictExtraStage(5), d);
    expect(m.length).toBe(VERDICT_MSG_LEN);
    expect(toHex(m)).toBe(
      '51412d564552444943547c000000002de3dabb000000000000002a01' +
        '0000000000000000000000000000000000000000000000000000000000000005' +
        '915afa657a71d173e2673e2b9f0fcab193c1937c0ca3a02aa98882bc8a7f9479',
    );
    expect(toHex(signerFromSeed(SEED).sign(m))).toBe(
      '0935385004abc80cf9952692f1eef491fa6f785b67e685f3372c0f8f2e5669cc4a10bc91fa138f4b1b653a8123b605df9632e217879597bec21623dfbed2670e',
    );
  });
});
