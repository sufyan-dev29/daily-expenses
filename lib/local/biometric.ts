'use client';
import { registerPlugin } from '@capacitor/core';

interface BiometricVaultPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  /** Stores `secret` encrypted with a Keystore key that needs a fingerprint/face check for every use. */
  enroll(o: { alias: string; secret: string; title: string; subtitle?: string }): Promise<void>;
  /** Shows the prompt and returns the secret. */
  unlock(o: { alias: string; title: string; subtitle?: string }): Promise<{ secret: string }>;
  remove(o: { alias: string }): Promise<void>;
}

const Vault = registerPlugin<BiometricVaultPlugin>('BiometricVault');

export class BiometricError extends Error {
  code: 'cancelled' | 'invalidated' | 'unavailable' | 'failed';
  constructor(message: string, code: BiometricError['code']) { super(message); this.code = code; }
}

function wrap(e: unknown): BiometricError {
  const err = e as { message?: string; code?: string };
  const code = err.code === 'CANCELLED' ? 'cancelled' : err.code === 'INVALIDATED' ? 'invalidated' : err.code === 'UNAVAILABLE' ? 'unavailable' : 'failed';
  const msg = code === 'cancelled' ? 'Cancelled.' : code === 'invalidated' ? 'Your fingerprints or face changed. Sign in with your password and turn biometric sign-in on again.' : code === 'unavailable' ? 'Biometric sign-in is not available on this phone.' : err.message || 'Biometric check failed.';
  return new BiometricError(msg, code);
}

export async function biometricAvailable(): Promise<boolean> {
  try { return (await Vault.isAvailable()).available; } catch { return false; }
}
export async function biometricEnroll(alias: string, secret: string): Promise<void> {
  try { await Vault.enroll({ alias, secret, title: 'Turn on biometric sign-in', subtitle: 'Confirm with your fingerprint or face' }); } catch (e) { throw wrap(e); }
}
export async function biometricUnlock(alias: string): Promise<string> {
  try { return (await Vault.unlock({ alias, title: 'Daily Expenses', subtitle: 'Sign in with your fingerprint or face' })).secret; } catch (e) { throw wrap(e); }
}
export async function biometricRemove(alias: string): Promise<void> {
  try { await Vault.remove({ alias }); } catch { /* nothing stored */ }
}
