'use client';
import { getSession, hasSession } from '@/lib/local/runtime';
import type { LocalClient } from '@/core/localclient';

/** The data client the screens use. Same call shape as the original web app's database client. */
export function localDb(): LocalClient {
  return getSession().client;
}
export { hasSession };
