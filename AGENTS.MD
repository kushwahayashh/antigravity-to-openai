# AGENTS.md

This file provides coding guidance for AI agents when working with code in this repository.

## Overview

This is a **standalone proxy server** that enables access to Google's Antigravity IDE backend API. It allows users to access models like `gemini-3-pro-high` and `claude-sonnet-4-5` using their Google credentials via an OpenAI-compatible API.

## Commands

```bash
# Install dependencies
npm install

# Start the proxy server
npm start

# Type checking only
npm run typecheck
```

## Code Architecture

### Proxy Server (start-proxy.ts)

The entire application is contained in a single file [`start-proxy.ts`](start-proxy.ts) which implements:

1. **OAuth Authentication**: PKCE-based OAuth flow with Google for obtaining access tokens
2. **Token Management**: Automatic token refresh using stored refresh tokens
3. **Account Storage**: Persists accounts to `~/.config/opencode/antigravity-accounts.json`
4. **OpenAI-to-Google Translation**: Transforms OpenAI API format requests to Google's Antigravity format
5. **Streaming Response Handling**: Converts Google's SSE responses back to OpenAI streaming format
6. **Model Selection**: Interactive CLI model selection at startup

### Key Functions

- [`authenticate()`](start-proxy.ts:559): Handles the OAuth flow with Google
- [`transformOpenAiToGoogle()`](start-proxy.ts:97): Converts OpenAI request format to Google format
- [`transformGoogleChunkToOpenAi()`](start-proxy.ts:175): Converts Google streaming chunks to OpenAI format
- [`createProxyServer()`](start-proxy.ts:279): Creates the HTTP proxy server
- [`fetchAvailableModels()`](start-proxy.ts:224): Retrieves available models from the Antigravity API

### API Endpoints

The proxy exposes:
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions (OpenAI-compatible)

### Configuration

- Default port: `3460` (configurable via `PORT` env var)
- Default host: `127.0.0.1` (configurable via `HOST` env var)
- Endpoint: `https://daily-cloudcode-pa.sandbox.googleapis.com`

## TypeScript Configuration

- Target: `ESNext`
- Module: `Preserve`
- Module Resolution: `bundler`
- Strict mode enabled

## Dependencies

- **tsx**: TypeScript execution runtime
- **typescript**: Type checking
