import type { DeviceKind } from '../../../shared/network';

/*
 * This device's pairing, as a phone or tablet keeps it: its token, kept in
 * the browser's storage for this address (never a cookie), sent with every
 * request. Drashti keeps only a hash of it.
 */

const KEY = 'drashti.device';

export interface Paired {
  token: string;
  name: string;
  kind: DeviceKind;
}

export function paired(): Paired | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Paired>;
    return typeof p.token === 'string' && typeof p.name === 'string' && typeof p.kind === 'string'
      ? (p as Paired)
      : null;
  } catch {
    return null;
  }
}

export function keepPairing(p: Paired): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private browsing without storage: it works until the page is closed.
  }
  memory = p;
}

export function forgetPairing(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

let memory: Paired | null = null;

/** The pairing in use: as kept, or (where the browser keeps nothing) for this page only. */
export const current = (): Paired | null => paired() ?? memory;

/** Each kind of device's page. */
export const PAGE_OF: Record<DeviceKind, string> = {
  remote: '/remote',
  stage: '/stage',
  announcements: '/announce',
};

/** Back to pairing (the pairing was removed in Drashti). */
export function toPairing(): void {
  forgetPairing();
  if (location.pathname !== '/pair') location.replace('/pair');
}

export type ApiAnswer<T> = ({ ok: true } & T) | { ok: false; message: string; status: number };

/**
 * A request to Drashti with this device's token. A token Drashti no longer
 * knows goes back to pairing; a token given here (the announcements poster's)
 * leaves the pairing alone, and the caller deals with a 401.
 */
export async function api<T = Record<string, unknown>>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
): Promise<ApiAnswer<T>> {
  const own = init.token === undefined;
  const token = init.token ?? current()?.token;
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Drashti cannot be reached. Check this phone is on the same Wi-Fi.',
    };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // An answer without JSON.
  }
  if (response.status === 401 && own && token && path !== '/api/v1/pair') toPairing();
  if (!response.ok || body['ok'] !== true)
    return {
      ok: false,
      status: response.status,
      message:
        typeof body['message'] === 'string' ? body['message'] : `Drashti said no (${response.status}).`,
    };
  return body as { ok: true } & T;
}
