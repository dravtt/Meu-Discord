import { create } from 'zustand';
import { useStore } from './store';
import { setActivity } from '../components/Activity';

type Detected = { name: string; steamId?: number; catalogId?: string } | null;
const native = (window as any).nexoNative as undefined | { runningGame?: () => Promise<Detected> };

/** Whether this window can see the games that are open, and what it saw last. */
export const useGameDetect = create<{ available: boolean; checkedAt: number | null; detected: Detected }>(() => ({
  available: !!native?.runningGame, checkedAt: null, detected: null,
}));

/**
 * In the desktop app, checks every 20 s which game is open and shows it as "Jogando …" — but only
 * while the person is Disponível. Each check also sends the game to the server, which adds up the
 * time played that week. Browsers cannot see other programs, so nothing happens there.
 */
export function startGameDetection() {
  if (!native?.runningGame) return () => {};
  let showing = false;
  let busy = false;
  async function check() {
    const me = useStore.getState().me;
    if (!me || busy) return;
    busy = true;
    try {
      const game = await native!.runningGame!().catch(() => null);
      useGameDetect.setState({ checkedAt: Date.now(), detected: game });
      const online = (useStore.getState().presence[me.id]?.status ?? me.status) === 'online';
      if (game && online) {
        // Each heartbeat refreshes the activity and counts the time played.
        await setActivity({ ...game, source: 'auto' }).catch(() => {});
        showing = true;
      } else if (showing) {
        await setActivity(null).catch(() => {});
        showing = false;
      }
    } finally { busy = false; }
  }
  void check();
  const t = setInterval(() => void check(), 20_000);
  return () => clearInterval(t);
}
