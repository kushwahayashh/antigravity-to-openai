/**
 * Manual OAuth authentication support for cases where the local callback server
 * isn't accessible (e.g., signing in on a different machine).
 */

import { exchangeAntigravity, type AntigravityTokenExchangeResult } from "../antigravity/oauth";

export interface ParsedCallbackURL {
  code: string;
  state: string;
  scope?: string;
}

/**
 * Parse an OAuth callback URL to extract the authorization code and state.
 * 
 * @param callbackUrl - The full callback URL from the browser after OAuth redirect
 * @returns Parsed components needed for token exchange
 * @throws Error if the URL is invalid or missing required parameters
 * 
 * @example
 * ```ts
 * const url = "http://localhost:51121/oauth-callback?state=...&code=...&scope=...";
 * const parsed = parseOAuthCallbackURL(url);
 * // { code: "4/0ATX...", state: "eyJ2ZXJ...", scope: "email profile..." }
 * ```
 */
export function parseOAuthCallbackURL(callbackUrl: string): ParsedCallbackURL {
  let url: URL;
  
  try {
    url = new URL(callbackUrl);
  } catch (error) {
    throw new Error(`Invalid callback URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Check for error parameters that Google might send FIRST
  const error = url.searchParams.get("error");
  if (error) {
    const errorDescription = url.searchParams.get("error_description") || error;
    throw new Error(`OAuth error: ${errorDescription}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const scope = url.searchParams.get("scope") || undefined;

  if (!code) {
    throw new Error("Missing 'code' parameter in callback URL");
  }

  if (!state) {
    throw new Error("Missing 'state' parameter in callback URL");
  }

  return { code, state, scope };
}

/**
 * Complete OAuth authentication using a manually provided callback URL.
 * This is useful when the local OAuth server isn't accessible.
 * 
 * @param callbackUrl - The full callback URL from the browser
 * @returns Token exchange result with access/refresh tokens
 * 
 * @example
 * ```ts
 * const result = await authenticateWithManualURL(
 *   "http://localhost:51121/oauth-callback?state=...&code=..."
 * );
 * 
 * if (result.type === "success") {
 *   console.log("Access token:", result.access);
 *   console.log("Email:", result.email);
 * } else {
 *   console.error("Auth failed:", result.error);
 * }
 * ```
 */
export async function authenticateWithManualURL(
  callbackUrl: string
): Promise<AntigravityTokenExchangeResult> {
  const { code, state } = parseOAuthCallbackURL(callbackUrl);
  return exchangeAntigravity(code, state);
}