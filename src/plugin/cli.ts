import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export type AuthMode = "automatic" | "manual";

/**
 * Prompts the user for a project ID via stdin/stdout.
 */
export async function promptProjectId(): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Project ID (leave blank to use your default project): ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

/**
 * Prompts user whether they want to add another OAuth account.
 */
export async function promptAddAnotherAccount(currentCount: number): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`Add another account? (${currentCount} added) (y/n): `);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

export type LoginMode = "add" | "fresh";

export interface ExistingAccountInfo {
  email?: string;
  index: number;
}

/**
 * Prompts user to choose login mode when accounts already exist.
 * Returns "add" to append new accounts, "fresh" to clear and start over.
 */
export async function promptLoginMode(existingAccounts: ExistingAccountInfo[]): Promise<LoginMode> {
  const rl = createInterface({ input, output });
  try {
    console.log(`\n${existingAccounts.length} account(s) saved:`);
    for (const acc of existingAccounts) {
      const label = acc.email || `Account ${acc.index + 1}`;
      console.log(`  ${acc.index + 1}. ${label}`);
    }
    console.log("");

    while (true) {
      const answer = await rl.question("(a)dd new account(s) or (f)resh start? [a/f]: ");
      const normalized = answer.trim().toLowerCase();

      if (normalized === "a" || normalized === "add") {
        return "add";
      }
      if (normalized === "f" || normalized === "fresh") {
        return "fresh";
      }

      console.log("Please enter 'a' to add accounts or 'f' to start fresh.");
    }
  } finally {
    rl.close();
  }
}

/**
 * Prompts user to choose between automatic (local server) or manual (paste URL) auth mode.
 */
export async function promptAuthMode(): Promise<AuthMode> {
  const rl = createInterface({ input, output });
  try {
    console.log("\nChoose authentication method:");
    console.log("  1. Automatic (local OAuth server) - for signing in on this machine");
    console.log("  2. Manual (paste callback URL) - for signing in on a different machine");
    console.log("");

    while (true) {
      const answer = await rl.question("Select mode [1/2]: ");
      const normalized = answer.trim();

      if (normalized === "1" || normalized.toLowerCase() === "automatic") {
        return "automatic";
      }
      if (normalized === "2" || normalized.toLowerCase() === "manual") {
        return "manual";
      }

      console.log("Please enter '1' for automatic or '2' for manual.");
    }
  } finally {
    rl.close();
  }
}

/**
 * Prompts user to paste the OAuth callback URL after manual authentication.
 */
export async function promptCallbackURL(): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    console.log("\nAfter signing in with Google, you'll be redirected to a localhost URL.");
    console.log("Copy the ENTIRE URL from your browser's address bar and paste it below.");
    console.log("It should look like: http://localhost:51121/oauth-callback?state=...&code=...\n");

    const url = await rl.question("Paste callback URL: ");
    return url.trim();
  } finally {
    rl.close();
  }
}
