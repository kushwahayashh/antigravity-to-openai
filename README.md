# Antigravity Proxy Server

A **standalone proxy server** that enables access to Google's Antigravity IDE backend API. It allows you to access premium models like `gemini-3-pro-high`, `claude-sonnet-4-5`, and `claude-opus-4-5-thinking` using your Google credentials via an OpenAI-compatible API.

## What you get

- **Google OAuth sign-in** with automatic token refresh
- **OpenAI-compatible API** on `http://127.0.0.1:3460`
- **Model selection** at startup with interactive CLI
- **Streaming support** for chat completions

## Quick start

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Start the proxy

```bash
npm start
```

On first run, you'll be guided through Google OAuth authentication:

1. Choose authentication mode (automatic browser or manual URL paste)
2. Sign in with your Google account
3. Select a model from the available list

### Step 3: Use the proxy

The proxy exposes an OpenAI-compatible API at `http://127.0.0.1:3460`:

```bash
curl http://127.0.0.1:3460/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-pro-high",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

Or use it with any OpenAI-compatible client:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:3460/v1",
    api_key="not-needed"
)

response = client.chat.completions.create(
    model="gemini-3-pro-high",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Available Models

- `gemini-3-flash` - Fast Gemini 3 model
- `gemini-3-pro-low` - Gemini 3 Pro (lower quality tier)
- `gemini-3-pro-high` - Gemini 3 Pro (higher quality tier)
- `claude-sonnet-4-5` - Claude Sonnet 4.5
- `claude-sonnet-4-5-thinking` - Claude Sonnet 4.5 with thinking
- `claude-opus-4-5-thinking` - Claude Opus 4.5 with thinking
- `gpt-oss-120b-medium` - GPT-OSS 120B

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | List available models |
| `/v1/chat/completions` | POST | Chat completions (OpenAI format) |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3460` | Server port |
| `HOST` | `127.0.0.1` | Server host |

You can also specify a model via command line:

```bash
npm start -- --model=gemini-3-pro-high
```

## Account Storage

Accounts are stored at:
- **Linux/macOS**: `~/.config/opencode/antigravity-accounts.json`
- **Windows**: `%APPDATA%\opencode\antigravity-accounts.json`

This file contains OAuth refresh tokens — treat it like a password.

## Safety, usage, and risk notices

### Intended use

- Personal / internal development only
- Respect internal quotas and data handling policies
- Not for production services or bypassing intended limits

### Not suitable for

- Production application traffic
- High-volume automated extraction
- Any use that violates Acceptable Use Policies

### ⚠️ Warning (assumption of risk)

By using this software, you acknowledge and accept the following:

- **Terms of Service risk:** This approach may violate the Terms of Service of AI model providers (Anthropic, OpenAI, etc.). You are solely responsible for ensuring compliance with all applicable terms and policies.
- **Account risk:** Providers may detect this usage pattern and take punitive action, including suspension, permanent ban, or loss of access to paid subscriptions.
- **No guarantees:** Providers may change APIs, authentication, or policies at any time, which can break this method without notice.
- **Assumption of risk:** You assume all legal, financial, and technical risks. The authors and contributors of this project bear no responsibility for any consequences arising from your use.

Use at your own risk. Proceed only if you understand and accept these risks.

## Legal

- Not affiliated with Google. This is an independent open-source project and is not endorsed by, sponsored by, or affiliated with Google LLC.
- "Antigravity", "Gemini", "Google Cloud", and "Google" are trademarks of Google LLC.
- Software is provided "as is", without warranty. You are responsible for complying with Google's Terms of Service and Acceptable Use Policy.

## Credits

Built with help and inspiration from:

- [opencode-gemini-auth](https://github.com/jenslys/opencode-gemini-auth) — Gemini OAuth groundwork by [@jenslys](https://github.com/jenslys)
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — Helpful reference for Antigravity API

## License

MIT
