import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';

// Constants
const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const ANTIGRAVITY_CLIENT_SECRET = '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';
const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:51121/oauth-callback';
const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];
const ANTIGRAVITY_ENDPOINT = 'https://daily-cloudcode-pa.sandbox.googleapis.com';

function getConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'opencode');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(xdgConfig, 'opencode');
}

const ACCOUNTS_PATH = path.join(getConfigDir(), 'antigravity-accounts.json');

// Fetched models list (populated at startup)
let availableModels: string[] = [];

// Default model (can be changed via selection)
let selectedModel = 'gemini-3-flash';

// Cache for thought signatures to satisfy Gemini 3's requirement
const thoughtSignatureCache = new Map<string, string>();

function getActiveAccount() {
  const data = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
  return data.accounts[data.activeIndex || 0];
}

async function getAccessToken(refreshToken: string) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
      client_secret: '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',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await resp.json() as any;
  if (!json.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(json));
  }
  return json.access_token;
}

function cleanJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const unsupportedFields = ['$schema', 'additionalProperties', '$id', '$ref', '$defs', 'definitions', 'examples', 'default'];
  const cleaned: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (unsupportedFields.includes(key)) continue;
    if (key === 'properties' && typeof value === 'object') {
      cleaned.properties = {};
      for (const [propName, propValue] of Object.entries(value as object)) {
        cleaned.properties[propName] = cleanJsonSchema(propValue);
      }
    } else if (key === 'items' && typeof value === 'object') {
      cleaned.items = cleanJsonSchema(value);
    } else if (Array.isArray(value)) {
      cleaned[key] = value.map(item => typeof item === 'object' ? cleanJsonSchema(item) : item);
    } else if (typeof value === 'object') {
      cleaned[key] = cleanJsonSchema(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function convertToolToFunctionDeclaration(tool: any) {
  if (tool.type !== 'function') return null;
  const fn = tool.function;
  const cleanedParams = cleanJsonSchema(fn.parameters) || { type: 'object', properties: {} };
  return {
    name: fn.name,
    description: fn.description || '',
    parameters: cleanedParams
  };
}

function transformOpenAiToGoogle(body: any) {
  const contents: any[] = [];
  for (const m of (body.messages || [])) {
    let role = m.role;
    if (role === 'assistant') role = 'model';
    if (role === 'system') role = 'user';
    const parts: any[] = [];
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: m.name || 'unknown',
            response: { result: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }
          }
        }]
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        if (tc.type === 'function') {
          let args = tc.function.arguments;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = { raw: args }; }
          }
          const functionCallPart: any = {
            functionCall: { name: tc.function.name, args: args || {} }
          };
          if (tc.id && thoughtSignatureCache.has(tc.id)) {
            functionCallPart.thoughtSignature = thoughtSignatureCache.get(tc.id);
          }
          parts.push(functionCallPart);
        }
      }
      if (m.content) parts.push({ text: m.content });
      contents.push({ role: 'model', parts });
      continue;
    }
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content.map((p: any) => p.text || '').join('\n');
    }
    if (text) parts.push({ text });
    if (parts.length > 0) contents.push({ role, parts });
  }
  const result: any = { contents };
  if (body.tools && body.tools.length > 0) {
    const functionDeclarations = body.tools.map(convertToolToFunctionDeclaration).filter(Boolean);
    if (functionDeclarations.length > 0) result.tools = [{ functionDeclarations }];
  }
  if (body.tool_choice) {
    result.toolConfig = {};
    if (body.tool_choice === 'none') result.toolConfig.functionCallingConfig = { mode: 'NONE' };
    else if (body.tool_choice === 'auto') result.toolConfig.functionCallingConfig = { mode: 'AUTO' };
    else if (body.tool_choice === 'required') result.toolConfig.functionCallingConfig = { mode: 'ANY' };
    else if (typeof body.tool_choice === 'object' && body.tool_choice.function) {
      result.toolConfig.functionCallingConfig = { mode: 'ANY', allowedFunctionNames: [body.tool_choice.function.name] };
    }
  }
  if (body.max_tokens || body.temperature || body.top_p || body.model?.includes('thinking') || body.model?.includes('gemini-3')) {
    result.generationConfig = {};
    if (body.max_tokens) result.generationConfig.maxOutputTokens = body.max_tokens;
    if (body.temperature !== undefined) result.generationConfig.temperature = body.temperature;
    if (body.top_p !== undefined) result.generationConfig.topP = body.top_p;
    if (body.model?.includes('thinking') || body.model?.includes('gemini-3')) {
      const budget = 16000;
      result.generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: budget };
      if (!result.generationConfig.maxOutputTokens || result.generationConfig.maxOutputTokens <= budget) {
        result.generationConfig.maxOutputTokens = budget + 4000;
      }
    }
  }
  return result;
}

function transformGoogleChunkToOpenAi(chunk: any, model: string, isFirst: boolean, toolCallIndex: { current: number }) {
  const innerChunk = chunk.response || chunk;
  const candidates = innerChunk.candidates || [];
  const firstCandidate = candidates[0] || {};
  const content = firstCandidate.content || {};
  const parts = content.parts || [];
  let deltaText = '';
  const toolCalls: any[] = [];
  let reasoningText = '';
  for (const part of parts) {
    if (part.thought === true || part.type === 'reasoning' || part.thoughtText) {
      reasoningText += (part.thoughtText || part.text || '');
      continue;
    }
    if (part.text) deltaText += part.text;
    if (part.functionCall) {
      const callId = `call_${Date.now()}_${toolCallIndex.current}`;
      if (part.thoughtSignature) {
        thoughtSignatureCache.set(callId, part.thoughtSignature);
        if (thoughtSignatureCache.size > 1000) {
          const firstKey = thoughtSignatureCache.keys().next().value;
          if (firstKey) thoughtSignatureCache.delete(firstKey);
        }
      }
      toolCalls.push({
        index: toolCallIndex.current, id: callId, type: 'function',
        function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) }
      });
      toolCallIndex.current++;
    }
  }
  const finishReason = firstCandidate.finishReason;
  const delta: any = {};
  if (isFirst) delta.role = 'assistant';
  if (reasoningText) delta.reasoning_content = reasoningText;
  if (deltaText) delta.content = deltaText;
  if (toolCalls.length > 0) delta.tool_calls = toolCalls;
  return {
    id: chunk.responseId || `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{
      index: 0, delta: delta,
      finish_reason: finishReason ? (finishReason === 'STOP' ? 'stop' : finishReason.toLowerCase()) : null
    }]
  };
}

async function fetchAvailableModels(): Promise<string[]> {
  try {
    const account = getActiveAccount();
    const token = await getAccessToken(account.refreshToken);

    const response = await fetch(`${ANTIGRAVITY_ENDPOINT}/v1internal:listModels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity/1.11.5 windows/amd64',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      },
      body: JSON.stringify({ project: account.projectId })
    });

    if (response.ok) {
      const data = await response.json() as any;
      if (data.models && Array.isArray(data.models)) {
        return data.models.map((m: any) => m.name || m.id || m).filter(Boolean);
      }
    }

    // Fallback: try alternate endpoint
    const altResponse = await fetch(`${ANTIGRAVITY_ENDPOINT}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'antigravity/1.11.5 windows/amd64',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      }
    });

    if (altResponse.ok) {
      const altData = await altResponse.json() as any;
      if (altData.models && Array.isArray(altData.models)) {
        return altData.models.map((m: any) => m.name || m.id || m).filter(Boolean);
      }
    }
  } catch (err) {
    // Silently fail and use fallback
  }

  // Fallback models if API fetch fails
  return [
    'gemini-3-flash',
    'gemini-3-pro-low',
    'gemini-3-pro-high',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking',
    'gpt-oss-120b-medium',
  ];
}

function createProxyServer() {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      const models = availableModels.map(id => ({
        id,
        object: 'model',
        created: 1677610602,
        owned_by: 'google'
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
      return;
    }

    if (req.method === 'POST') {
      let bodyText = '';
      req.on('data', chunk => bodyText += chunk);
      req.on('end', async () => {
        try {
          const openaiBody = JSON.parse(bodyText);
          const googleBody = transformOpenAiToGoogle(openaiBody);
          const account = getActiveAccount();
          const token = await getAccessToken(account.refreshToken);

          // Use the model from request, or fall back to selected model
          let modelName = selectedModel;
          if (openaiBody.model) {
            const requestModel = openaiBody.model.split('/').pop();
            if (requestModel && requestModel !== 'chatcompletions') {
              modelName = requestModel;
            }
          }

          const wrappedBody = { project: account.projectId, model: modelName, request: googleBody };
          const targetUrl = `${ANTIGRAVITY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`;
          const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
              'User-Agent': 'antigravity/1.11.5 windows/amd64',
              'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
            },
            body: JSON.stringify(wrappedBody)
          });
          if (!response.ok) {
            const errorText = await response.text();
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(errorText); return;
          }
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          const reader = response.body?.getReader();
          if (!reader) { res.end('data: [DONE]\n\n'); return; }
          const decoder = new TextDecoder();
          let buffer = ''; let isFirst = true; const toolCallIndex = { current: 0 };
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n'); buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;
                try {
                  const googleChunk = JSON.parse(jsonStr);
                  const openaiChunk = transformGoogleChunkToOpenAi(googleChunk, modelName, isFirst, toolCallIndex);
                  isFirst = false;
                  res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                } catch (parseErr) { }
              }
            }
          }
          res.write('data: [DONE]\n\n'); res.end();
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_error' } }));
        }
      });
    } else {
      res.writeHead(404); res.end();
    }
  });

  return server;
}

function displayModelMenu(models: string[]) {
  console.log('\nSelect model:');
  console.log('  0. [Re-authenticate with Google]');
  models.forEach((id, index) => {
    console.log(`  ${index + 1}. ${id}`);
  });
}

async function selectModel(models: string[]): Promise<string | 'reauth'> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    displayModelMenu(models);
    rl.question(`\nChoice [1]: `, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve(models[0]!);
        return;
      }
      const num = parseInt(trimmed, 10);
      if (num === 0) {
        resolve('reauth');
        return;
      }
      if (num >= 1 && num <= models.length) {
        resolve(models[num - 1]!);
      } else {
        resolve(models[0]!);
      }
    });
  });
}

// Simple PKCE implementation
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = Buffer.from(array).toString('base64url');

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const challenge = Buffer.from(hashBuffer).toString('base64url');

  return { verifier, challenge };
}

function encodeState(payload: { verifier: string; projectId: string }): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeState(state: string): { verifier: string; projectId: string } {
  const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json);
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

async function fetchProjectID(accessToken: string): Promise<string> {
  try {
    const response = await fetch(`${ANTIGRAVITY_ENDPOINT}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity/1.11.5 windows/amd64',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      },
      body: JSON.stringify({
        metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }
      })
    });

    if (response.ok) {
      const data = await response.json() as any;
      if (typeof data.cloudaicompanionProject === 'string') return data.cloudaicompanionProject;
      if (data.cloudaicompanionProject?.id) return data.cloudaicompanionProject.id;
    }
  } catch { }
  return '';
}

async function promptManualCallback(): Promise<URL> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve, reject) => {
    console.log('\nAfter signing in with Google, copy the ENTIRE URL from your browser.');
    console.log('It should look like: http://localhost:51121/oauth-callback?state=...&code=...\n');

    rl.question('Paste callback URL: ', (answer) => {
      rl.close();
      const trimmed = answer.trim();

      if (!trimmed) {
        reject(new Error('No URL provided'));
        return;
      }

      try {
        const url = new URL(trimmed);

        // Check for OAuth errors
        const error = url.searchParams.get('error');
        if (error) {
          const errorDesc = url.searchParams.get('error_description') || error;
          reject(new Error(`OAuth error: ${errorDesc}`));
          return;
        }

        // Validate required parameters
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code) {
          reject(new Error('Missing code parameter in URL'));
          return;
        }

        if (!state) {
          reject(new Error('Missing state parameter in URL'));
          return;
        }

        resolve(url);
      } catch (err) {
        reject(new Error(`Invalid URL: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  });
}

async function startOAuthListener(): Promise<URL> {
  const redirectUri = new URL(ANTIGRAVITY_REDIRECT_URI);
  const port = parseInt(redirectUri.port) || 80;
  const callbackPath = redirectUri.pathname || '/';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout'));
    }, 5 * 60 * 1000);

    const server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400); res.end('Invalid'); return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== callbackPath) {
        res.writeHead(404); res.end('Not found'); return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Authentication successful!</h2><p>You can close this tab.</p></body></html>');

      clearTimeout(timeout);
      server.close();
      resolve(url);
    });

    server.listen(port, '127.0.0.1');
  });
}

async function promptAuthMode(): Promise<'automatic' | 'manual'> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('\nChoose authentication method:');
    console.log('  1. Automatic (local OAuth server) - sign in on this machine');
    console.log('  2. Manual (paste callback URL) - sign in on a different machine\n');

    rl.question('Select mode [1]: ', (answer) => {
      rl.close();
      const trimmed = answer.trim();

      if (trimmed === '2' || trimmed.toLowerCase() === 'manual') {
        resolve('manual');
      } else {
        resolve('automatic');
      }
    });
  });
}

async function authenticate(): Promise<void> {
  console.log('\nStarting authentication...\n');

  const authMode = await promptAuthMode();

  const pkce = await generatePKCE();
  const state = encodeState({ verifier: pkce.verifier, projectId: '' });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', ANTIGRAVITY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', ANTIGRAVITY_REDIRECT_URI);
  authUrl.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '));
  authUrl.searchParams.set('code_challenge', pkce.challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  console.log('\nOAuth URL:');
  console.log(authUrl.toString());
  console.log('');

  let callbackUrl: URL;

  if (authMode === 'manual') {
    console.log('Instructions:');
    console.log('1. Open the URL above in your browser (on any device)');
    console.log('2. Sign in with your Google account');
    console.log('3. After approving, copy the ENTIRE URL from your browser\'s address bar');
    console.log('4. Paste it below\n');

    callbackUrl = await promptManualCallback();
  } else {
    console.log('Opening browser for Google login...\n');
    openBrowser(authUrl.toString());

    try {
      callbackUrl = await startOAuthListener();
    } catch (error) {
      console.log('\nAutomatic callback failed. Switching to manual mode...\n');
      callbackUrl = await promptManualCallback();
    }
  }

  const code = callbackUrl.searchParams.get('code');
  const returnedState = callbackUrl.searchParams.get('state');

  if (!code || !returnedState) {
    throw new Error('Missing code or state in callback');
  }

  const { verifier } = decodeState(returnedState);

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: ANTIGRAVITY_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error('Token exchange failed: ' + await tokenResponse.text());
  }

  const tokens = await tokenResponse.json() as any;

  // Get user info
  let email: string | undefined;
  try {
    const userResp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    if (userResp.ok) {
      const user = await userResp.json() as any;
      email = user.email;
    }
  } catch { }

  // Get project ID
  const projectId = await fetchProjectID(tokens.access_token);

  // Save account
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });

  const storage = {
    version: 1,
    accounts: [{
      email,
      refreshToken: tokens.refresh_token,
      projectId,
      addedAt: Date.now(),
      lastUsed: Date.now(),
    }],
    activeIndex: 0
  };

  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(storage, null, 2));
  console.log(`\nAuthenticated as: ${email || 'Unknown'}`);
  console.log(`Project ID: ${projectId || 'auto-detected'}\n`);
}

function clearAccounts(): void {
  try {
    if (fs.existsSync(ACCOUNTS_PATH)) {
      fs.unlinkSync(ACCOUNTS_PATH);
      console.log('Cleared existing account data.');
    }
  } catch (err) {
    console.error('Failed to clear accounts:', err);
  }
}

function accountsExist(): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
    return data.accounts && data.accounts.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  // Check if accounts exist, if not authenticate
  if (!accountsExist()) {
    await authenticate();
  }

  // Fetch available models
  console.log('Fetching models...');
  availableModels = await fetchAvailableModels();

  // Check for command line argument for model
  const args = process.argv.slice(2);
  const modelArg = args.find(arg => arg.startsWith('--model='));

  if (modelArg) {
    const modelId = modelArg.split('=')[1];
    if (availableModels.includes(modelId!)) {
      selectedModel = modelId!;
    } else {
      const choice = await selectModel(availableModels);
      if (choice === 'reauth') {
        clearAccounts();
        await authenticate();
        console.log('Fetching models...');
        availableModels = await fetchAvailableModels();
        selectedModel = await selectModel(availableModels) as string;
      } else {
        selectedModel = choice;
      }
    }
  } else {
    const choice = await selectModel(availableModels);
    if (choice === 'reauth') {
      clearAccounts();
      await authenticate();
      console.log('Fetching models...');
      availableModels = await fetchAvailableModels();
      selectedModel = await selectModel(availableModels) as string;
    } else {
      selectedModel = choice;
    }
  }

  const server = createProxyServer();
  const PORT = parseInt(process.env.PORT || '3460', 10);
  const HOST = process.env.HOST || '127.0.0.1';

  server.listen(PORT, HOST, () => {
    console.log(`\nProxy running at http://${HOST}:${PORT}`);
    console.log(`Model: ${selectedModel}\n`);
  });
}

main().catch(console.error);