import Game from '../game/Game';

// v9.2: the React InstallHint is gone — the non-invasive FULLSCREEN GUIDE
// (src/game/fsguide.ts, one-shot pixel card on the title screen + ⛶ in the
// pause menu) owns the install/fullscreen message now.
export default function Home() {
  return (
    <div className="fixed inset-0 bg-[#05060a]">
      <Game />
    </div>
  );
}
