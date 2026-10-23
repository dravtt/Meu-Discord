import { getToken, setToken } from './api';
import type { User } from './types';

/** Accounts logged in on this device, so you can switch between them without typing the password again. */
export interface SavedAccount { id: string; username: string; displayName: string; avatarUrl: string | null; token: string }

const KEY = 'nexo.accounts';
export const MAX_ACCOUNTS = 5;

export function savedAccounts(): SavedAccount[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function store(list: SavedAccount[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS))); } catch { /* storage unavailable */ }
}

/** Remembers (or refreshes) the account that is logged in now. */
export function rememberAccount(me: User) {
  const token = getToken();
  if (!token) return;
  const entry = { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl, token };
  store([entry, ...savedAccounts().filter((a) => a.id !== me.id)]);
}

export function forgetAccount(id: string) { store(savedAccounts().filter((a) => a.id !== id)); }

export function switchTo(account: SavedAccount) {
  setToken(account.token);
  location.hash = '';
  location.reload();
}

/** Goes to the login screen to add another account; the current one stays saved. */
export function addAccount() {
  setToken(null);
  location.reload();
}
