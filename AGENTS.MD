# AGENTS.md

This file provides coding guidance for AI agents when working with code in this repository.

## Overview

This is an **opencode plugin** that enables OAuth authentication with Google's Antigravity IDE backend. It allows users to access models like `gemini-3-pro-high` and `claude-sonnet-4-5` using their Google credentials.

## Build & Test Commands

```bash
# Install dependencies
npm install

# Build (compiles TypeScript)
npm run build

# Type checking only
npm run typecheck

# Run tests
npm test
```

## Code Architecture

### Plugin Flow (src/plugin.ts)

The main entry point `createAntigravityPlugin` orchestrates a request interception flow:

1.  **Auth Validation**: Checks if the request is for the Antigravity provider and if OAuth is used.
2.  **Token Refresh**: Checks for expired access tokens and refreshes them using `refreshAccessToken`.
3.  **Project Context**: Resolves the effective Google Cloud project ID.
4.  **Endpoint Fallback**: Tries multiple Antigravity endpoints in sequence (`daily` → `autopush` → `prod`) if requests fail with specific error codes (403, 404, 429, 5xx).
5.  **Response Transformation**: Converts the Antigravity response format to what opencode expects.

### Module Organization

**Core Plugin** (`src/plugin.ts`)
- Plugin definition and request interception logic.
- Implements endpoint fallback strategy.

**Authentication** (`src/antigravity/oauth.ts`, `src/plugin/auth.ts`)
- Handles OAuth flow, token exchange, and token validation.
- `src/plugin/server.ts`: Local HTTP server for OAuth callback.

**Request Handling** (`src/plugin/request.ts`)
- `prepareAntigravityRequest`: Prepares headers and body for Antigravity API.
- `transformAntigravityResponse`: Handles response transformation.

**Configuration** (`src/constants.ts`)
- Contains constants like provider IDs, redirect URIs, and endpoint URLs.

## Key Design Patterns

**1. Endpoint Fallback**:
- The plugin robustly handles service availability by iterating through a list of fallback endpoints defined in `ANTIGRAVITY_ENDPOINT_FALLBACKS`.

**2. Automatic Token Refresh**:
- Access tokens are automatically checked for expiration and refreshed before requests are sent.

**3. Debug Logging**:
- Extensive debug logging is available via `startAntigravityDebugRequest` when enabled.

## TypeScript Configuration

- Target: `ESNext`
- Module: `Preserve`
- Module Resolution: `bundler`
- Strict mode enabled.

## Dependencies

- `@openauthjs/openauth`: Handles OAuth PKCE implementation.
- `vitest`: Testing framework.
- `typescript`: Peer dependency.
