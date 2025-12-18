import { accessTokenExpired } from "./auth";
import type { OAuthAuthDetails } from "./types";

const authCache = new Map<string, OAuthAuthDetails>();

const thoughtSignatureCache = new Map<string, string>();

/**
 * Stores a thought signature for a given tool call ID.
 */
export function storeThoughtSignature(callId: string, signature: string): void {
  thoughtSignatureCache.set(callId, signature);
  if (thoughtSignatureCache.size > 2000) {
    const firstKey = thoughtSignatureCache.keys().next().value;
    if (firstKey) {
      thoughtSignatureCache.delete(firstKey);
    }
  }
}

/**
 * Retrieves a thought signature for a given tool call ID.
 */
export function resolveThoughtSignature(callId: string): string | undefined {
  return thoughtSignatureCache.get(callId);
}

/**
 * Produces a stable cache key from a refresh token string.
 */

function normalizeRefreshKey(refresh?: string): string | undefined {
  const key = refresh?.trim();
  return key ? key : undefined;
}

/**
 * Returns a cached auth snapshot when available, favoring unexpired tokens.
 */
export function resolveCachedAuth(auth: OAuthAuthDetails): OAuthAuthDetails {
  const key = normalizeRefreshKey(auth.refresh);
  if (!key) {
    return auth;
  }

  const cached = authCache.get(key);
  if (!cached) {
    authCache.set(key, auth);
    return auth;
  }

  if (!accessTokenExpired(auth)) {
    authCache.set(key, auth);
    return auth;
  }

  if (!accessTokenExpired(cached)) {
    return cached;
  }

  authCache.set(key, auth);
  return auth;
}

/**
 * Stores the latest auth snapshot keyed by refresh token.
 */
export function storeCachedAuth(auth: OAuthAuthDetails): void {
  const key = normalizeRefreshKey(auth.refresh);
  if (!key) {
    return;
  }
  authCache.set(key, auth);
}

/**
 * Clears cached auth globally or for a specific refresh token.
 */
export function clearCachedAuth(refresh?: string): void {
  if (!refresh) {
    authCache.clear();
    return;
  }
  const key = normalizeRefreshKey(refresh);
  if (key) {
    authCache.delete(key);
  }
}
