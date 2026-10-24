import { useStore } from './store';
import { setActivity } from '../components/Activity';

type Detected = { name: string; steamId?: number; catalogId?: string } | null;
const native = (window as any).nexoNative as undefined | { runningGame?: () => Promise<Detected> };

/**
 * In the desktop app, checks every 20 s which game is open and shows it as "Jogando …" — but only
 * while the person is Disponível. Each check also sends the game to the server, which adds up the
 * time played that week. Browsers have no detection, so nothing happens there.
 */
export function startGameDetection() {
  if (!native?.runningGame) return () => {};
  let showing = false;
  async function check() {
    const me = useStore.getState().me;
    if (!me) return;
    const online = (useStore.getState().presence[me.id]?.status ?? me.status) === 'online';
    const game = online ? await native!.runningGame!().catch(() => null) : null;
    if (game) {
      // Each heartbeat refreshes the activity and counts the time played.
      await setActivity({ ...game, source: 'auto' }).catch(() => {});
      showing = true;
    } else if (showing) {
      await setActivity(null).catch(() => {});
      showing = false;
    }
  }
  void check();
  const t = setInterval(() => void check(), 20_000);
  return () => clearInterval(t);
}
