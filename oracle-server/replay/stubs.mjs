// ============================================================================
// M2-0 SPIKE — minimal browser stubs to boot the GONNA engine HEADLESS in Node.
// The sim path (Game.step -> updatePlay) never renders; canvas/Image/Audio are
// only touched at CONSTRUCTION (buildArt paints into offscreen canvases,
// AudioSys lazily creates an AudioContext, skins load portraits fire-and-
// forget). Everything here is a structural no-op: any 2d call succeeds and
// returns a plausible value, storage is a Map, rAF never fires (we step
// manually), Image never loads (nothing awaits it outside Game.boot, which we
// bypass by calling the constructor directly).
// ============================================================================

const noop = () => {};

function makeGradient() {
  return { addColorStop: noop };
}

export function makeCtx2D(canvas) {
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'canvas') return canvas;
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => makeGradient();
      }
      if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
      if (prop === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
      if (prop === 'getLineDash') return () => [];
      if (typeof prop === 'string' && !(prop in t)) t[prop] = noop; // method: no-op
      return t[prop];
    },
    set(t, prop, v) {
      t[prop] = v;
      return true;
    },
  });
}

export function makeCanvas() {
  const c = {
    width: 300,
    height: 150,
    style: {},
    addEventListener: noop,
    removeEventListener: noop,
    toDataURL: () => 'data:image/png;base64,',
    getContext() {
      return (this._ctx ??= makeCtx2D(this));
    },
  };
  return c;
}

function makeElement(tag) {
  if (tag === 'canvas') return makeCanvas();
  return {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    setAttribute: noop,
    getAttribute: () => null,
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: (x) => x,
    removeChild: noop,
    remove: noop,
    focus: noop,
    blur: noop,
    click: noop,
    select: noop,
  };
}

class AudioParamStub {
  constructor(v = 0) { this.value = v; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}

class AudioNodeStub {
  constructor() {
    this.gain = new AudioParamStub(1);
    this.frequency = new AudioParamStub(440);
    this.Q = new AudioParamStub(1);
    this.detune = new AudioParamStub(0);
    this.playbackRate = new AudioParamStub(1);
    this.pan = new AudioParamStub(0);
    this.threshold = new AudioParamStub(0);
    this.knee = new AudioParamStub(0);
    this.ratio = new AudioParamStub(1);
    this.attack = new AudioParamStub(0);
    this.release = new AudioParamStub(0);
    this.type = 'sine';
    this.buffer = null;
    this.loop = false;
  }
  createStereoPanner() { return new AudioNodeStub(); }
  connect(x) { return x; }
  disconnect() {}
  start() {}
  stop() {}
  setPeriodicWave() {}
}

class AudioContextStub {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new AudioNodeStub();
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createGain() { return new AudioNodeStub(); }
  createOscillator() { return new AudioNodeStub(); }
  createBufferSource() { return new AudioNodeStub(); }
  createBiquadFilter() { return new AudioNodeStub(); }
  createDynamicsCompressor() { return new AudioNodeStub(); }
  createStereoPanner() { return new AudioNodeStub(); }
  createPeriodicWave() { return {}; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), duration: len / 44100 }; }
}

class StorageStub {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

class ImageStub {
  constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null; }
  set src(_v) { /* never fires onload: nothing in the sim path awaits images */ }
}

class AudioStub {
  play() { return Promise.resolve(); }
  pause() {}
}

let installed = false;
export function installBrowserStubs() {
  if (installed) return;
  installed = true;
  const g = globalThis;
  const localStorage = new StorageStub();
  const documentStub = {
    createElement: makeElement,
    createElementNS: (_ns, tag) => makeElement(tag),
    body: makeElement('body'),
    head: makeElement('head'),
    documentElement: makeElement('html'),
    activeElement: null,
    hidden: false,
    addEventListener: noop,
    removeEventListener: noop,
    fonts: { load: () => Promise.resolve(), ready: Promise.resolve() },
  };
  g.window = g;
  g.document = documentStub;
  g.localStorage = localStorage;
  g.sessionStorage = new StorageStub();
  g.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '', hash: '', replace: noop, assign: noop };
  g.history = { replaceState: noop, pushState: noop };
  g.navigator = { userAgent: 'm2-replay-headless', vibrate: () => false, maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() }, mediaDevices: undefined };
  g.innerWidth = 1280;
  g.innerHeight = 720;
  g.devicePixelRatio = 1;
  g.visualViewport = undefined;
  g.addEventListener = noop;
  g.removeEventListener = noop;
  g.requestAnimationFrame = () => 0; // never fires: the harness steps manually
  g.cancelAnimationFrame = noop;
  g.scrollTo = noop;
  g.open = () => null;
  g.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
  g.Image = ImageStub;
  g.Audio = AudioStub;
  g.AudioContext = AudioContextStub;
  g.webkitAudioContext = AudioContextStub;
  g.fetch = () => Promise.reject(new Error('headless stub: no network'));
  g.prompt = () => null;
  g.alert = noop;
  if (typeof g.performance === 'undefined') g.performance = { now: () => Date.now() };
  return { localStorage, document: documentStub };
}
