// THE SOVEREIGN CEREMONY — v9.3.0
// One wallet took both thrones of COMPETITION 01 (top wallet + top GONNA NFT).
// When THAT wallet connects, the game mints his coin — once in history.
// No white flashes. Gold, fluo green, darkness. Screenshot-grade.
const WINNER = '7XB3ADS5HLBXFJH6NGY7S4Z5AJ6FYT7JOSDALYTOO3SIW3BCAC2Y2NQK4I';
const FLAG = 'gonna.sovereign.v1';
const RM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let open = false;

function flag(): boolean {
  try { return !!localStorage.getItem(FLAG); } catch { return true; }
}
function setFlag(): void {
  try { localStorage.setItem(FLAG, '1'); } catch { /* private mode — ceremony still plays */ }
}

/** Called by wallet.ts on every successful session (connect / restore). */
export function maybeSovereign(address: string | null): void {
  if (open || !address || address !== WINNER || flag()) return;
  showWarning();
}

/* ---------- audio: one deep byzantine thump (user gesture = I'M READY) ---------- */
function thump(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const t = ctx.currentTime;
    // low sine drop — the hammer
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 1);
    // metallic tick — the die hitting gold
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(2400, t);
    o2.frequency.exponentialRampToValueAtTime(900, t + 0.08);
    g2.gain.setValueAtTime(0.25, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o2.connect(g2).connect(ctx.destination);
    o2.start(t); o2.stop(t + 0.2);
    setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch { /* silence is noble too */ }
}

/* ---------- styles ---------- */
const CSS = `
.sov-veil{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(120% 90% at 50% 40%,rgba(14,20,12,.96) 0%,rgba(2,4,3,.985) 70%);
  font-family:'JetBrains Mono',monospace;opacity:0;transition:opacity .45s ease}
.sov-veil.on{opacity:1}
.sov-veil.shake{animation:sovShake .34s cubic-bezier(.2,.7,.2,1)}
@keyframes sovShake{0%{transform:translate(0,0)}18%{transform:translate(-4px,2px)}38%{transform:translate(4px,-2px)}58%{transform:translate(-3px,-1px)}78%{transform:translate(2px,1px)}100%{transform:translate(0,0)}}
.sov-warn{max-width:min(460px,88vw);text-align:center;border:1px solid rgba(201,169,110,.55);border-radius:14px;
  padding:34px 30px 28px;background:linear-gradient(180deg,rgba(20,16,8,.85),rgba(6,8,6,.92));
  box-shadow:0 0 60px rgba(201,169,110,.18),inset 0 0 40px rgba(201,169,110,.05)}
.sov-kick{font-size:10px;letter-spacing:.34em;color:#c9a96a;text-shadow:0 0 14px rgba(201,169,110,.5)}
.sov-t1{margin-top:16px;font-size:13px;letter-spacing:.18em;line-height:2;color:#e8e4da}
.sov-t2{margin-top:10px;font-size:11px;letter-spacing:.22em;line-height:2;color:#39ff6e;text-shadow:0 0 12px rgba(57,255,110,.4)}
.sov-btns{margin-top:26px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.sov-go{font-family:inherit;font-size:11px;letter-spacing:.28em;color:#0a0f0a;background:linear-gradient(180deg,#e9c877,#b8933f);
  border:none;border-radius:9px;padding:13px 26px;cursor:pointer;box-shadow:0 0 24px rgba(201,169,110,.35)}
.sov-go:hover{filter:brightness(1.1)}
.sov-later{font-family:inherit;font-size:10px;letter-spacing:.24em;color:#6a6a7a;background:none;border:1px solid rgba(120,120,140,.3);
  border-radius:9px;padding:13px 20px;cursor:pointer}
.sov-later:hover{color:#a0a0b0}
/* --- the coin --- */
.sov-stage{perspective:900px;display:flex;flex-direction:column;align-items:center}
.sov-coin{width:min(58vmin,340px);height:min(58vmin,340px);position:relative;transform-style:preserve-3d;
  animation:sovSpin 1.5s cubic-bezier(.25,.7,.25,1) both}
@keyframes sovSpin{0%{transform:rotateY(0) scale(.4);opacity:0}12%{opacity:1}100%{transform:rotateY(720deg) scale(1);opacity:1}}
.sov-coin.faceA{animation:none;transition:transform 1s cubic-bezier(.2,.8,.2,1);transform:rotateY(0)}
.sov-coin.faceB{transition:transform 1.15s cubic-bezier(.2,.8,.2,1);transform:rotateY(180deg)}
.sov-coin.dock{transition:transform 1.1s cubic-bezier(.5,0,.2,1),opacity 1.1s;transform:rotateY(180deg) scale(.18) translateY(-175%);opacity:.95}
.sov-face{position:absolute;inset:0;border-radius:50%;backface-visibility:hidden;-webkit-backface-visibility:hidden;
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  background:radial-gradient(circle at 34% 30%,#f6e3ae 0%,#e9c877 26%,#c9a24b 58%,#8a6a26 100%);
  box-shadow:0 0 70px rgba(233,200,119,.4),inset 0 0 40px rgba(90,66,20,.55),inset 0 0 8px rgba(60,44,12,.8);
  border:3px solid #6d531d}
.sov-face.back{transform:rotateY(180deg)}
.sov-face.blank{background:radial-gradient(circle at 38% 32%,#d9bd7f 0%,#c4a052 45%,#93712c 100%);
  border:3px dashed rgba(109,83,29,.9)}
.sov-ring{position:absolute;inset:5.5%;border:2px solid rgba(109,83,29,.75);border-radius:50%}
.sov-ring2{position:absolute;inset:9%;border:1px solid rgba(109,83,29,.5);border-radius:50%}
.sov-laurel{position:absolute;inset:0;width:100%;height:100%}
.sov-f-kick{font-size:clamp(7px,1.7vmin,10px);letter-spacing:.3em;color:#5c4517}
.sov-f-name{margin-top:4%;font-size:clamp(13px,4.4vmin,26px);letter-spacing:.08em;color:#3d2d0c;font-weight:700;
  text-shadow:0 1px 0 rgba(255,240,200,.6),0 -1px 1px rgba(70,50,12,.7)}
.sov-f-title{margin-top:3%;font-size:clamp(8px,2.2vmin,13px);letter-spacing:.26em;color:#4a370f}
.sov-f-amt{font-size:clamp(11px,3.5vmin,20px);letter-spacing:.02em;color:#3d2d0c;font-weight:700;max-width:82%;
  text-shadow:0 1px 0 rgba(255,240,200,.6),0 -1px 1px rgba(70,50,12,.7)}
.sov-f-sub{margin-top:3.5%;font-size:clamp(6px,1.7vmin,10px);letter-spacing:.16em;color:#5c4517;line-height:1.9;max-width:74%}
.sov-wave{position:absolute;left:50%;top:50%;width:min(58vmin,340px);height:min(58vmin,340px);border-radius:50%;
  border:2px solid rgba(233,200,119,.85);transform:translate(-50%,-50%);pointer-events:none;opacity:0}
.sov-wave.go{animation:sovWave 1s ease-out .05s both}
@keyframes sovWave{0%{opacity:.9;transform:translate(-50%,-50%) scale(.6)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.1)}}
.sov-cap{position:fixed;left:0;right:0;bottom:9vh;text-align:center;opacity:0;transition:opacity .8s ease}
.sov-cap.on{opacity:1}
.sov-cap1{font-size:clamp(9px,2.4vmin,12px);letter-spacing:.3em;color:#c9a96a;text-shadow:0 0 16px rgba(201,169,110,.5)}
.sov-cap2{margin-top:10px;font-size:clamp(8px,2vmin,10px);letter-spacing:.24em;color:#39ff6e}
.sov-close{margin-top:20px}
.sov-proof{color:#8db8c9;text-decoration:none;border-bottom:1px solid rgba(141,184,201,.35)}
`;

const LAUREL = `<svg class="sov-laurel" viewBox="0 0 200 200" aria-hidden="true">
  <g fill="none" stroke="#5c4517" stroke-width="2.4" stroke-linecap="round">
    <path d="M100 178 C 62 170 38 138 36 100" opacity=".9"/>
    <path d="M100 178 C 138 170 162 138 164 100" opacity=".9"/>
  </g>
  <g fill="#5c4517">
    ${[0,1,2,3,4,5].map(i => {
      const a = 210 + i * 14, r = 82;
      const x = (100 + r * Math.cos((a * Math.PI) / 180)).toFixed(1);
      const y = (100 + r * Math.sin((a * Math.PI) / 180) * -1).toFixed(1);
      return `<ellipse cx="${x}" cy="${y}" rx="7.5" ry="3.2" transform="rotate(${a + 64} ${x} ${y})"/>`;
    }).join('')}
    ${[0,1,2,3,4,5].map(i => {
      const a = 330 - i * 14, r = 82;
      const x = (100 + r * Math.cos((a * Math.PI) / 180)).toFixed(1);
      const y = (100 + r * Math.sin((a * Math.PI) / 180) * -1).toFixed(1);
      return `<ellipse cx="${x}" cy="${y}" rx="7.5" ry="3.2" transform="rotate(${(a + 116) % 360} ${x} ${y})"/>`;
    }).join('')}
  </g>
</svg>`;

const FACE_A = `<div class="sov-ring"></div><div class="sov-ring2"></div>${LAUREL}
  <div class="sov-f-kick">COMPETITION 01 — GONNAVERSE</div>
  <div class="sov-f-name">FRIEDBEAN.ALGO</div>
  <div class="sov-f-title">SOVEREIGN OF GENESIS</div>`;

const FACE_B = `<div class="sov-ring"></div><div class="sov-ring2"></div>${LAUREL}
  <div class="sov-f-kick">THE SWEEP — BOTH THRONES</div>
  <div class="sov-f-amt">1,000,000,000 $GONNA</div>
  <div class="sov-f-sub">TX 64UCGD…VKZA · BLOCK #63,821,614<br>SEALED ON ALGORAND</div>`;

/* ---------- phase 0: the warning ---------- */
function showWarning(): void {
  open = true;
  const style = document.createElement('style');
  style.id = 'sov-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  const v = document.createElement('div');
  v.className = 'sov-veil';
  v.innerHTML = `<div class="sov-warn">
    <div class="sov-kick">⚜ THE CROWN HAS ARRIVED ⚜</div>
    <div class="sov-t1">SOVEREIGN OF GENESIS —<br>THIS PLAYS ONCE IN HISTORY.</div>
    <div class="sov-t2">NO REPLAYS. NO RERUNS.<br>READY YOUR SCREENSHOT, CHAMP.</div>
    <div class="sov-btns">
      <button class="sov-go" type="button">I'M READY →</button>
      <button class="sov-later" type="button">NOT YET</button>
    </div>
  </div>`;
  document.body.appendChild(v);
  requestAnimationFrame(() => v.classList.add('on'));
  v.querySelector('.sov-later')!.addEventListener('click', () => {
    // no flag — the crown waits for the next connect
    v.classList.remove('on');
    setTimeout(() => { v.remove(); style.remove(); open = false; }, 500);
  });
  v.querySelector('.sov-go')!.addEventListener('click', () => {
    v.remove();
    startCeremony();
  });
}

/* ---------- the minting ---------- */
function startCeremony(): void {
  const v = document.createElement('div');
  v.className = 'sov-veil on';
  v.innerHTML = `<div class="sov-stage">
    <div class="sov-coin" id="sovCoin">
      <div class="sov-face blank"></div>
    </div>
    <div class="sov-wave" id="sovWave"></div>
  </div>
  <div class="sov-cap" id="sovCap">
    <div class="sov-cap1">THE COIN IS YOURS FOREVER. SKRRT SKRRT.</div>
    <div class="sov-cap2"><a class="sov-proof" href="https://allo.info/tx/64UCGDUA7DR6VKEH552LJCJR6GCCYMHZMDJODT6PYPM764XSVKZA" target="_blank" rel="noopener">PROOF ON-CHAIN ↗</a></div>
    <div class="sov-close"><button class="sov-go" type="button">ENTER THE VAULT →</button></div>
  </div>`;
  document.body.appendChild(v);
  const coin = v.querySelector('#sovCoin') as HTMLElement;
  const wave = v.querySelector('#sovWave') as HTMLElement;
  const cap = v.querySelector('#sovCap') as HTMLElement;

  const strike = () => {
    v.classList.add('shake');
    wave.classList.add('go');
    thump();
    setTimeout(() => v.classList.remove('shake'), 400);
  };
  const revealA = () => {
    coin.innerHTML = `<div class="sov-face">${FACE_A}</div><div class="sov-face back">${FACE_B}</div>`;
    coin.classList.add('faceA');
  };
  const revealB = () => coin.classList.add('faceB');
  const dock = () => {
    coin.classList.add('dock');
    cap.classList.add('on');
    setFlag();
  };

  if (RM) {
    strike(); revealA(); revealB(); dock();
  } else {
    setTimeout(strike, 1500);          // spin ends → the hammer falls
    setTimeout(revealA, 1650);         // struck coin settles on face A
    setTimeout(revealB, 4300);         // the flip — the prize
    setTimeout(dock, 7200);            // docks forever + caption
  }
  v.querySelector('.sov-go')!.addEventListener('click', () => {
    v.classList.remove('on');
    setTimeout(() => {
      v.remove();
      const st = document.getElementById('sov-css');
      if (st) st.remove();
      open = false;
    }, 500);
  });
}

/* dev-only QA hook — tree-shaken out of production builds */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sov = {
    warn: showWarning,
    play: () => { const s = document.createElement('style'); s.id = 'sov-css'; s.textContent = CSS; document.head.appendChild(s); startCeremony(); },
    reset: () => { try { localStorage.removeItem(FLAG); } catch { /* noop */ } },
  };
}
