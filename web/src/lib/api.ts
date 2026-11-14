import { signOutWith } from './accounts';

const TOKEN_KEY = 'nexo.token';

/** API origin. Empty in the browser (same origin / Vite proxy); set by the desktop app. */
export const API_BASE: string = (window as any).nexoNative?.apiBase ?? import.meta.env.VITE_API_BASE ?? '';

/** Uploaded files are served by this same server. An address saved with another host (a PC that ran it locally, an old tunnel) is turned back into a path. */
const OLD_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|[^/]*trycloudflare\.com)(:\d+)?(\/uploads\/.+)$/;
export const assetUrl = (url: string | null | undefined) => {
  if (!url) return '';
  const m = OLD_HOST.exec(url);
  if (m) url = m[3];
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
};

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.body); }
  const res = await fetch(`${API_BASE}/api${path}`, { method: options.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) { setToken(null); location.reload(); }
    if (res.status === 403 && data.code === 'banned' && token) signOutWith(data.error);
    throw new ApiError(res.status, data.error ?? 'Erro inesperado', data.code);
  }
  return data as T;
}
