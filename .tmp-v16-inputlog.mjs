// src/game/b64.ts
var T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var R = /* @__PURE__ */ new Map();
for (let i = 0; i < 64; i++) R.set(T[i], i);
function b64ToBytes(s) {
  const clean = s.replace(/[\s=]+/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = R.get(clean[i]);
    const c1 = R.get(clean[i + 1]);
    if (c0 === void 0 || c1 === void 0) throw new Error("bad base64");
    const c2 = R.get(clean[i + 2]);
    const c3 = R.get(clean[i + 3]);
    const n = c0 << 18 | c1 << 12 | (c2 ?? 0) << 6 | (c3 ?? 0);
    out.push(n >> 16 & 255);
    if (c2 !== void 0) out.push(n >> 8 & 255);
    if (c3 !== void 0) out.push(n & 255);
  }
  return new Uint8Array(out);
}
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i] ?? 0;
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    const n = b1 << 16 | (b2 ?? 0) << 8 | (b3 ?? 0);
    s += (T[n >> 18 & 63] ?? "") + (T[n >> 12 & 63] ?? "");
    s += b2 === void 0 ? "=" : T[n >> 6 & 63] ?? "";
    s += b3 === void 0 ? "=" : T[n & 63] ?? "";
  }
  return s;
}

// src/game/arena/inputLog.ts
var INPUT_LOG_VERSION = 2;
var INPUT_LOG_MIN_VERSION = 1;
var INPUT_LOG_CAP = 3e5;
var MAGIC = [71, 73, 76];
function maskFromDown(d) {
  return (d.up ? 1 : 0) | (d.down ? 2 : 0) | (d.left ? 4 : 0) | (d.right ? 8 : 0) | (d.punch ? 16 : 0) | (d.kick ? 32 : 0) | (d.jump ? 64 : 0) | (d.special ? 128 : 0);
}
function encodeInputLog(log) {
  const enc = new TextEncoder();
  const build = enc.encode(log.build);
  const seed = enc.encode(log.seedLabel);
  if (build.length > 65535 || seed.length > 65535) throw new Error("input log: build/seedLabel too long");
  if (log.masks.length < log.frames) throw new Error("input log: masks shorter than frames");
  const frames = Math.min(log.frames, INPUT_LOG_CAP);
  const truncated = log.truncated || log.frames > INPUT_LOG_CAP;
  const out = new Uint8Array(3 + 1 + 1 + 2 + build.length + 2 + seed.length + 4 + frames);
  const dv = new DataView(out.buffer);
  out[0] = MAGIC[0];
  out[1] = MAGIC[1];
  out[2] = MAGIC[2];
  out[3] = INPUT_LOG_VERSION;
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
function decodeInputLog(bytes) {
  if (bytes.length < 13) throw new Error("input log: too short");
  if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1] || bytes[2] !== MAGIC[2]) throw new Error("input log: bad magic");
  if (bytes[3] < INPUT_LOG_MIN_VERSION || bytes[3] > INPUT_LOG_VERSION) throw new Error("input log: unsupported version " + bytes[3]);
  const v = bytes[3];
  const truncated = (bytes[4] & 1) === 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const buildLen = dv.getUint16(5, false);
  let p = 7 + buildLen;
  if (bytes.length < p + 2) throw new Error("input log: truncated header");
  const build = dec.decode(bytes.subarray(7, p));
  const seedLen = dv.getUint16(p, false);
  p += 2;
  if (bytes.length < p + seedLen + 4) throw new Error("input log: truncated header");
  const seedLabel = dec.decode(bytes.subarray(p, p + seedLen));
  p += seedLen;
  const frames = dv.getUint32(p, false);
  p += 4;
  if (frames > INPUT_LOG_CAP) throw new Error("input log: frames over cap");
  if (bytes.length !== p + frames) throw new Error("input log: frame bytes mismatch");
  return { v, build, seedLabel, frames, truncated, masks: bytes.slice(p) };
}
function encodeInputLogB64(log) {
  return bytesToB64(encodeInputLog(log));
}
function decodeInputLogB64(s) {
  return decodeInputLog(b64ToBytes(s));
}
export {
  INPUT_LOG_CAP,
  INPUT_LOG_MIN_VERSION,
  INPUT_LOG_VERSION,
  decodeInputLog,
  decodeInputLogB64,
  encodeInputLog,
  encodeInputLogB64,
  maskFromDown
};
