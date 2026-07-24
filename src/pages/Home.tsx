import Game from '../game/Game';
import InstallHint from '../game/InstallHint';

export default function Home() {
  return (
    <div className="fixed inset-0 bg-[#05060a]">
      <Game />
      <InstallHint />
    </div>
  );
}
