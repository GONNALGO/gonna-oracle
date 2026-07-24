// v6.2 — iOS "Add to Home Screen" hint. iPhone Safari blocks the Fullscreen
// API for web pages; the ONLY way to true fullscreen there is launching from
// a home-screen icon (apple-mobile-web-app-capable). This one-time card
// teaches that, in the game's byzantine pixel aesthetic.
//
// Show rules (ALL must hold):
//  - iPhone/iPad Safari (other iOS browsers can't Add to Home Screen)
//  - NOT already standalone/PWA (navigator.standalone / display-mode)
//  - user is in LANDSCAPE or has started PLAYING
//  - never shown before on this device (localStorage flag, set when shown)
// Never on desktop. Non-blocking: pointer-events only on the OK button.
import { useEffect, useState } from 'react';

const LS_KEY = 'gonna.a2hs.v1';

function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS =
    /iP(hone|ad|od)/.test(ua) ||
    // iPadOS 13+ reports a Mac UA — detect via touch points
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  // only real Safari offers "Add to Home Screen"
  if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|GSA\//.test(ua)) return false;
  return true;
}

function isStandalone(): boolean {
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches
    );
  } catch {
    return false;
  }
}

export default function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIOSSafari() || isStandalone()) return;
    try {
      if (window.localStorage.getItem(LS_KEY)) return;
    } catch {
      /* private mode: still show, just can't persist */
    }
    const check = () => {
      const landscape = window.innerWidth > window.innerHeight;
      const g = (window as unknown as { __gonna?: { sceneName?: string } }).__gonna;
      const playing = g?.sceneName === 'play';
      if (!landscape && !playing) return;
      try {
        window.localStorage.setItem(LS_KEY, '1'); // max once per device
      } catch {
        /* ignore */
      }
      setShow(true);
    };
    check();
    const iv = window.setInterval(check, 800);
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      id="gonna-a2hs"
      role="dialog"
      aria-label="Install GONNA FIGHT for true fullscreen"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        zIndex: 50,
        pointerEvents: 'none', // non-blocking: only the OK button is clickable
        maxWidth: 'min(92vw, 420px)',
        background: '#0b0d14',
        border: '3px solid #b8860b',
        boxShadow:
          '0 0 0 2px #05060a, 0 0 18px rgba(184,134,11,0.45), inset 0 0 0 1px rgba(245,197,66,0.25)',
        padding: '10px 12px',
        fontFamily: "'Courier New', ui-monospace, monospace",
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        imageRendering: 'pixelated',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: '#f5c542',
          fontSize: 12,
          lineHeight: 1.5,
          textShadow: '1px 1px 0 #000',
        }}
      >
        {/* iOS share glyph: square with up arrow */}
        <svg
          width="20"
          height="24"
          viewBox="0 0 20 24"
          aria-hidden="true"
          style={{ flex: '0 0 auto' }}
        >
          <path
            d="M10 1 L10 13 M5.5 5.5 L10 1 L14.5 5.5"
            stroke="#4da3ff"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="square"
          />
          <path
            d="M5 10 L3 10 L3 23 L17 23 L17 10 L15 10"
            stroke="#4da3ff"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="square"
          />
        </svg>
        <span>
          For true fullscreen: <span style={{ color: '#4da3ff' }}>Share</span> &rarr;{' '}
          <span style={{ color: '#e8ecf4' }}>&laquo;Add to Home Screen&raquo;</span>
        </span>
        <button
          id="gonna-a2hs-ok"
          type="button"
          onClick={() => setShow(false)}
          style={{
            pointerEvents: 'auto',
            flex: '0 0 auto',
            background: '#b8860b',
            color: '#05060a',
            border: '2px solid #f5c542',
            boxShadow: '2px 2px 0 #000',
            font: 'inherit',
            fontSize: 12,
            padding: '6px 10px',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
