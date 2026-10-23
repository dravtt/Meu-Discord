import { useStore } from './store';
import { setActivity } from '../components/Activity';

type Detected = { name: string; steamId?: number; catalogId?: string } | null;
const native = (window as any).nexoNative as undefined | { runningGame?: () => Promise<Detected> };

/**
 * In the desktop app, checks every 20 s which game is open and shows it as "Jogando …".
 * A game picked by hand is left alone; one detected here is cleared when the game closes.
 */
export function startGameDetection() {
  if (!native?.runningGame) return () => {};
  let last: string | null = null;
  async function check() {
    const me = useStore.getState().me;
    if (!me) return;
    const current = useStore.getState().presence[me.id]?.activity ?? null;
    const game = await native!.runningGame!().catch(() => null);
    const key = game?.name ?? null;
    if (key === last) return;
    last = key;
    if (game) {
      if (current?.source === 'manual' && current.name !== game.name) return;
      await setActivity({ ...game, source: 'auto' }).catch(() => { last = null; });
    } else if (current?.source === 'auto') {
      await setActivity(null).catch(() => { last = 'retry'; });
    }
  }
  void check();
  const t = setInterval(() => void check(), 20_000);
  return () => clearInterval(t);
}
