// ============================================================================
// v16 — INPUT LOG (SPEC-oracle §5 + SPEC-m2 §2): a per-frame input bitmask
// recorded ONLY during sealed ARENA runs and shipped inside the server-oracle
// sign-score body. M1: the server validates the STRUCTURE; M2 replays it.
// Pure codec — no window, no storage, fully testable in node.
//
// v1 -> v2 (SPEC-m2 §2, M2-2): the recorder now starts at the FIRST frame of
// scene==='play' — the intro title card is NEVER in the buffer (M2-0 finding:
// START is not in the bitmask, so the intro length is unrecoverable from a
// v1 log). v2 headers also carry the REAL seed label: 'PIT-<cid>' (stage) or
// 'RUN-<cid>' (seeded FULL RUN campaign). Decode ACCEPTS v1 and v2 (backward
// compat: a v1 log stays decodable; its intro-inclusive semantics are a
// server-side legacy matter, SPEC-m2 §5). Encode ALWAYS emits v2.
//
// Wire layout (big-endian, no padding):
//   'G' 'I' 'L'            magic
//   u8                     version (1 legacy | 2 current)
//   u8                     flags (bit0 = truncated: the run passed the frame
//                          cap and the tail was honestly CUT, not hidden)
//   u16 buildLen + utf8    build (__GONNA_VER of the vault-door build)
//   u16 seedLen  + utf8    seedLabel ('PIT-<cid>' / 'RUN-<cid>'; 'UNSEEDED'
//                          only on legacy v1 full-run logs)
//   u32 frames             recorded frame count (<= INPUT_LOG_CAP)
//   frames x u8            per-frame button bitmask
// Bitmask bits: 0 up · 1 down · 2 left · 3 right · 4 punch · 5 kick · 6 jump ·
// 7 special (input.ts Btn level flags, snapshotted at the top of Game.step).
// ============================================================================
import { b64ToBytes, bytesToB64 } from '../b64';

export const INPUT_LOG_VERSION = 2;
export const INPUT_LOG_MIN_VERSION = 1; // decode accepts v1 (legacy) and v2
export const INPUT_LOG_CAP = 300000; // SPEC §5: ~300KB raw cap
const MAGIC = [0x47, 0x49, 0x4c]; // 'GIL'

export interface InputLog {
  v: 1 | 2;
  build: string;
  seedLabel: string;
  frames: number;
  truncated: boolean;
  masks: Uint8Array; // exactly `frames` bytes
}

// input.ts down-flags -> 1 byte (structural: engine Input + node tests both fit)
export interface DownFlags {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  punch: boolean;
  kick: boolean;
  jump: boolean;
  special: boolean;
}
export function maskFromDown(d: DownFlags): number {
  return (
    (d.up ? 1 : 0) |
    (d.down ? 2 : 0) |
    (d.left ? 4 : 0) |
    (d.right ? 8 : 0) |
    (d.punch ? 16 : 0) |
    (d.kick ? 32 : 0) |
    (d.jump ? 64 : 0) |
    (d.special ? 128 : 0)
  );
}

export function encodeInputLog(log: InputLog): Uint8Array {
  const enc = new TextEncoder();
  const build = enc.encode(log.build);
  const seed = enc.encode(log.seedLabel);
  if (build.length > 0xffff || seed.length > 0xffff) throw new Error('input log: build/seedLabel too long');
  if (log.masks.length < log.frames) throw new Error('input log: masks shorter than frames');
  const frames = Math.min(log.frames, INPUT_LOG_CAP);
  const truncated = log.truncated || log.frames > INPUT_LOG_CAP; // honest cut
  const out = new Uint8Array(3 + 1 + 1 + 2 + build.length + 2 + seed.length + 4 + frames);
  const dv = new DataView(out.buffer);
  out[0] = MAGIC[0];
  out[1] = MAGIC[1];
  out[2] = MAGIC[2];
  out[3] = INPUT_LOG_VERSION; // encode ALWAYS emits v2 (SPEC-m2 §2)
  out[4] = truncated ? 1 : 0;
  dv.setUint16(5, build.length, false);
  out.set(build, 7);
  const p2 = 7 + build.length;
  dv.setUint16(p2, seed.length, false);
  out.set(seed, p2 + 2);
  const p3 = p2 + 2 + seed.length;
  dv.setUint32(p3, frames, false);
  out.set(log.masks.subarray(0, frames), p3 + 4);
  return out;
}

export function decodeInputLog(bytes: Uint8Array): InputLog {
  if (bytes.length < 13) throw new Error('input log: too short');
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2]) throw new Error('input log: bad magic');
  if (bytes[3] < INPUT_LOG_MIN_VERSION || bytes[3] > INPUT_LOG_VERSION) throw new Error('input log: unsupported version ' + bytes[3]);
  const v = bytes[3] as 1 | 2;
  const truncated = (bytes[4] & 1) === 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const buildLen = dv.getUint16(5, false);
  let p = 7 + buildLen;
  if (bytes.length < p + 2) throw new Error('input log: truncated header');
  const build = dec.decode(bytes.subarray(7, p));
  const seedLen = dv.getUint16(p, false);
  p += 2;
  if (bytes.length < p + seedLen + 4) throw new Error('input log: truncated header');
  const seedLabel = dec.decode(bytes.subarray(p, p + seedLen));
  p += seedLen;
  const frames = dv.getUint32(p, false);
  p += 4;
  if (frames > INPUT_LOG_CAP) throw new Error('input log: frames over cap');
  if (bytes.length !== p + frames) throw new Error('input log: frame bytes mismatch');
  return { v, build, seedLabel, frames, truncated, masks: bytes.slice(p) };
}

export function encodeInputLogB64(log: InputLog): string {
  return bytesToB64(encodeInputLog(log));
}

export function decodeInputLogB64(s: string): InputLog {
  return decodeInputLog(b64ToBytes(s));
}
