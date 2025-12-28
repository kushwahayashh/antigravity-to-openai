/**
 * Antigravity Proxy v2 - Improved OpenAI-compatible proxy for Google's Antigravity API
 * Ported conversion logic from CLIProxyAPIPlus (Go) to TypeScript
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { randomUUID } from 'crypto';

// ============================================================================
// Constants
// ============================================================================

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

// Base URLs with fallback order (matching CLIProxyAPIPlus)
const ANTIGRAVITY_BASE_URLS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

const ANTIGRAVITY_STREAM_PATH = '/v1internal:streamGenerateContent';
const ANTIGRAVITY_GENERATE_PATH = '/v1internal:generateContent';
const ANTIGRAVITY_MODELS_PATH = '/v1internal:fetchAvailableModels';
const DEFAULT_USER_AGENT = 'antigravity/1.11.5 windows/amd64';

// Thought signature for function calls (matches CLIProxyAPIPlus)
const FUNCTION_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

// Safety settings (matching CLIProxyAPIPlus common.AttachDefaultSafetySettings)
const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
];

// ============================================================================
// Model Name Mappings (from antigravity_executor.go)
// ============================================================================

// No model name transformations - pass through as-is
function alias2ModelName(alias: string): string {
  return alias;
}

function modelName2Alias(name: string): string {
  return name;
}

// ============================================================================
// Thinking Support Detection
// ============================================================================

function modelSupportsThinking(model: string): boolean {
  const lower = model.toLowerCase();
  if (lower.includes('image')) return false;
  return lower.includes('thinking') ||
    lower.includes('gemini-3') ||
    lower.includes('gemini-2.5-pro') ||
    lower.includes('gemini-2.5-flash');
}

function modelUsesThinkingLevels(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes('gemini-3');
}

// ============================================================================
// Utility Functions
// ============================================================================

function getConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming'), 'opencode');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(xdgConfig, 'opencode');
}

const ACCOUNTS_PATH = path.join(getConfigDir(), 'antigravity-accounts.json');

function generateRequestId(): string {
  return `agent-${randomUUID()}`;
}

function generateSessionId(): string {
  const n = Math.floor(Math.random() * 9_000_000_000_000_000_000);
  return `-${n}`;
}

function generateProjectId(): string {
  const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
  const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomPart = randomUUID().substring(0, 5).toLowerCase();
  return `${adj}-${noun}-${randomPart}`;
}

// ============================================================================
// Account Management
// ============================================================================

interface Account {
  email?: string;
  refreshToken: string;
  projectId: string;
  addedAt: number;
  lastUsed: number;
}

interface AccountStorage {
  version: number;
  accounts: Account[];
  activeIndex: number;
}

function accountsExist(): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')) as AccountStorage;
    return data.accounts && data.accounts.length > 0;
  } catch {
    return false;
  }
}

function getActiveAccount(): Account {
  const data = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')) as AccountStorage;
  const account = data.accounts[data.activeIndex || 0];
  if (!account) {
    throw new Error('No account found');
  }
  return account;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
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

// ============================================================================
// MIME Types (matching misc.MimeTypes from CLIProxyAPIPlus)
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'pdf': 'application/pdf',
  'txt': 'text/plain',
  'json': 'application/json',
  'xml': 'application/xml',
  'html': 'text/html',
  'css': 'text/css',
  'js': 'application/javascript',
  'ts': 'text/typescript',
  'py': 'text/x-python',
  'md': 'text/markdown',
};

// ============================================================================
// JSON Schema Cleaning (matching util.CleanJSONSchemaForGemini)
// ============================================================================

function cleanJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  const unsupportedFields = [
    '$schema', 'additionalProperties', '$id', '$ref', '$defs',
    'definitions', 'examples', 'default', 'const'
  ];

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

// ============================================================================
// Request Translation: OpenAI → Antigravity
// (Ported from antigravity_openai_request.go)
// ============================================================================

interface OpenAIMessage {
  role: string;
  content: string | any[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

interface OpenAIRequest {
  model?: string;
  messages?: OpenAIMessage[];
  tools?: any[];
  tool_choice?: any;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  stream?: boolean;
  reasoning_effort?: string;
  thinking?: { type: string; budget_tokens?: number };
  modalities?: string[];
  image_config?: { aspect_ratio?: string; image_size?: string };
}

function convertOpenAIRequestToAntigravity(modelName: string, request: OpenAIRequest): any {
  // Base envelope
  const out: any = {
    project: '',
    model: alias2ModelName(modelName),
    userAgent: 'antigravity',
    requestId: generateRequestId(),
    request: {
      contents: [],
      sessionId: generateSessionId(),
      toolConfig: {
        functionCallingConfig: { mode: 'VALIDATED' }
      },
      safetySettings: DEFAULT_SAFETY_SETTINGS,
    }
  };

  // Handle thinking config
  const supportsThinking = modelSupportsThinking(modelName);

  if (supportsThinking) {
    out.request.generationConfig = out.request.generationConfig || {};

    // Determine thinking budget
    let thinkingBudget = 16384; // Default budget

    if (request.reasoning_effort) {
      thinkingBudget = mapReasoningEffortToBudget(request.reasoning_effort);
    } else if (request.thinking?.type === 'enabled' && request.thinking.budget_tokens) {
      thinkingBudget = request.thinking.budget_tokens;
    }

    // Set thinking config with correct property name (includeThoughts, not include_thoughts)
    out.request.generationConfig.thinkingConfig = {
      thinkingBudget: thinkingBudget,
      includeThoughts: true
    };

    // Ensure maxOutputTokens is large enough to accommodate thinking
    if (!out.request.generationConfig.maxOutputTokens ||
      out.request.generationConfig.maxOutputTokens <= thinkingBudget) {
      out.request.generationConfig.maxOutputTokens = thinkingBudget + 8000;
    }
  }

  // Generation config
  if (request.temperature !== undefined || request.top_p !== undefined ||
    request.top_k !== undefined || request.max_tokens !== undefined) {
    out.request.generationConfig = out.request.generationConfig || {};
    if (request.temperature !== undefined) {
      out.request.generationConfig.temperature = request.temperature;
    }
    if (request.top_p !== undefined) {
      out.request.generationConfig.topP = request.top_p;
    }
    if (request.top_k !== undefined) {
      out.request.generationConfig.topK = request.top_k;
    }
    if (request.max_tokens !== undefined) {
      out.request.generationConfig.maxOutputTokens = request.max_tokens;
    }
  }

  // Handle modalities
  if (request.modalities && request.modalities.length > 0) {
    out.request.generationConfig = out.request.generationConfig || {};
    out.request.generationConfig.responseModalities = request.modalities.map(m => m.toUpperCase());
  }

  // Handle image_config
  if (request.image_config) {
    out.request.generationConfig = out.request.generationConfig || {};
    out.request.generationConfig.imageConfig = {};
    if (request.image_config.aspect_ratio) {
      out.request.generationConfig.imageConfig.aspectRatio = request.image_config.aspect_ratio;
    }
    if (request.image_config.image_size) {
      // Normalize to uppercase (e.g., "4k" -> "4K")
      const imageSize = request.image_config.image_size.toUpperCase();
      out.request.generationConfig.imageConfig.imageSize = imageSize;
    }
  }

  // Process messages
  if (request.messages && request.messages.length > 0) {
    // First pass: build tool_call_id -> function name map
    const tcId2Name: Record<string, string> = {};
    for (const m of request.messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (tc.type === 'function' && tc.id && tc.function?.name) {
            tcId2Name[tc.id] = tc.function.name;
          }
        }
      }
    }

    // Second pass: build tool responses cache
    const toolResponses: Record<string, string> = {};
    for (const m of request.messages) {
      if (m.role === 'tool' && m.tool_call_id) {
        toolResponses[m.tool_call_id] = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      }
    }

    // Third pass: build contents
    for (let i = 0; i < request.messages.length; i++) {
      const m = request.messages[i]!;
      const role = m.role;
      const content = m.content;

      if (role === 'system' && request.messages.length > 1) {
        // System message -> systemInstruction
        const text = typeof content === 'string' ? content : '';
        out.request.systemInstruction = {
          role: 'user',
          parts: [{ text }]
        };
      } else if (role === 'user' || (role === 'system' && request.messages.length === 1)) {
        // User message
        const node: any = { role: 'user', parts: [] };

        if (typeof content === 'string') {
          node.parts.push({ text: content });
        } else if (Array.isArray(content)) {
          for (const item of content) {
            switch (item.type) {
              case 'text':
                node.parts.push({ text: item.text });
                break;
              case 'image_url':
                const imageUrl = item.image_url?.url || '';
                if (imageUrl.startsWith('data:')) {
                  const [header, data] = imageUrl.substring(5).split(';base64,');
                  if (header && data) {
                    node.parts.push({
                      inlineData: { mime_type: header, data }
                    });
                  }
                }
                break;
              case 'file':
                const filename = item.file?.filename || '';
                const fileData = item.file?.file_data || '';
                const ext = filename.split('.').pop()?.toLowerCase() || '';
                const mimeType = MIME_TYPES[ext];
                if (mimeType && fileData) {
                  node.parts.push({
                    inlineData: { mime_type: mimeType, data: fileData }
                  });
                }
                break;
            }
          }
        }

        if (node.parts.length > 0) {
          out.request.contents.push(node);
        }
      } else if (role === 'assistant') {
        // Assistant message
        const node: any = { role: 'model', parts: [] };

        if (typeof content === 'string' && content) {
          node.parts.push({ text: content });
        }

        // Handle tool_calls
        if (m.tool_calls && m.tool_calls.length > 0) {
          const fIds: string[] = [];

          for (const tc of m.tool_calls) {
            if (tc.type !== 'function') continue;

            const fid = tc.id || '';
            const fname = tc.function?.name || '';
            let fargs = tc.function?.arguments || '{}';

            if (typeof fargs === 'string') {
              try {
                fargs = JSON.parse(fargs);
              } catch {
                fargs = { raw: fargs };
              }
            }

            node.parts.push({
              functionCall: {
                id: fid,
                name: fname,
                args: fargs
              },
              thoughtSignature: FUNCTION_THOUGHT_SIGNATURE
            });

            if (fid) fIds.push(fid);
          }

          if (node.parts.length > 0) {
            out.request.contents.push(node);
          }

          // Add function responses
          if (fIds.length > 0) {
            const toolNode: any = { role: 'user', parts: [] };

            for (const fid of fIds) {
              const name = tcId2Name[fid];
              if (name) {
                let resp = toolResponses[fid] || '{}';
                let result: any;

                try {
                  result = JSON.parse(resp);
                } catch {
                  result = resp;
                }

                toolNode.parts.push({
                  functionResponse: {
                    id: fid,
                    name,
                    response: { result }
                  }
                });
              }
            }

            if (toolNode.parts.length > 0) {
              out.request.contents.push(toolNode);
            }
          }
        } else if (node.parts.length > 0) {
          out.request.contents.push(node);
        }
      }
      // Skip 'tool' messages - they're handled with assistant tool_calls
    }
  }

  // Process tools
  if (request.tools && request.tools.length > 0) {
    const toolNode: any = { functionDeclarations: [] };

    for (const t of request.tools) {
      if (t.type === 'function' && t.function) {
        const fn = t.function;
        const decl: any = {
          name: fn.name,
          description: fn.description || ''
        };

        if (fn.parameters) {
          decl.parametersJsonSchema = cleanJsonSchema(fn.parameters);
        } else {
          decl.parametersJsonSchema = { type: 'object', properties: {} };
        }

        toolNode.functionDeclarations.push(decl);
      }

      if (t.google_search) {
        toolNode.googleSearch = t.google_search;
      }
    }

    if (toolNode.functionDeclarations.length > 0 || toolNode.googleSearch) {
      out.request.tools = [toolNode];
    }
  }

  // Handle tool_choice
  if (request.tool_choice) {
    out.request.toolConfig = out.request.toolConfig || {};

    if (request.tool_choice === 'none') {
      out.request.toolConfig.functionCallingConfig = { mode: 'NONE' };
    } else if (request.tool_choice === 'auto') {
      out.request.toolConfig.functionCallingConfig = { mode: 'AUTO' };
    } else if (request.tool_choice === 'required') {
      out.request.toolConfig.functionCallingConfig = { mode: 'ANY' };
    } else if (typeof request.tool_choice === 'object' && request.tool_choice.function?.name) {
      out.request.toolConfig.functionCallingConfig = {
        mode: 'ANY',
        allowedFunctionNames: [request.tool_choice.function.name]
      };
    }
  }

  return out;
}

function mapReasoningEffortToBudget(effort: string): number {
  switch (effort.toLowerCase()) {
    case 'minimal': return 1024;
    case 'low': return 4096;
    case 'medium': return 8192;
    case 'high': return 16384;
    case 'xhigh': return 32768;
    default: return 8192;
  }
}

// ============================================================================
// Response Translation: Antigravity → OpenAI
// (Ported from antigravity_openai_response.go)
// ============================================================================

interface StreamState {
  unixTimestamp: number;
  functionIndex: number;
}

let functionCallIdCounter = 0;

function convertAntigravityStreamChunkToOpenAI(
  rawJSON: any,
  state: StreamState
): string | null {
  // Handle the nested response structure
  const response = rawJSON.response || rawJSON;

  // Base template
  const template: any = {
    id: '',
    object: 'chat.completion.chunk',
    created: state.unixTimestamp || Math.floor(Date.now() / 1000),
    model: 'model',
    choices: [{
      index: 0,
      delta: {},
      finish_reason: null,
      native_finish_reason: null
    }]
  };

  // Extract model version
  if (response.modelVersion) {
    template.model = response.modelVersion;
  }

  // Extract creation timestamp
  if (response.createTime) {
    try {
      const t = new Date(response.createTime);
      state.unixTimestamp = Math.floor(t.getTime() / 1000);
      template.created = state.unixTimestamp;
    } catch { }
  }

  // Extract response ID
  if (response.responseId) {
    template.id = response.responseId;
  }

  // Extract finish reason
  if (response.candidates?.[0]?.finishReason) {
    const fr = response.candidates[0].finishReason.toLowerCase();
    template.choices[0].finish_reason = fr === 'stop' ? 'stop' : fr;
    template.choices[0].native_finish_reason = fr;
  }

  // Extract usage metadata
  if (response.usageMetadata || rawJSON.usageMetadata) {
    const usage = response.usageMetadata || rawJSON.usageMetadata;
    template.usage = {
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
      prompt_tokens: (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0)
    };
    if (usage.thoughtsTokenCount > 0) {
      template.usage.completion_tokens_details = {
        reasoning_tokens: usage.thoughtsTokenCount
      };
    }
  }

  // Process content parts
  const parts = response.candidates?.[0]?.content?.parts || [];
  let hasFunctionCall = false;
  let hasContent = false;

  for (const part of parts) {
    // Check for thoughtSignature-only parts (skip them)
    const hasThoughtSig = part.thoughtSignature || part.thought_signature;
    const hasPayload = part.text !== undefined || part.functionCall || part.inlineData || part.inline_data;

    if (hasThoughtSig && !hasPayload) {
      continue;
    }

    if (part.text !== undefined) {
      hasContent = true;
      template.choices[0].delta.role = 'assistant';

      if (part.thought === true) {
        template.choices[0].delta.reasoning_content = part.text;
      } else {
        template.choices[0].delta.content = part.text;
      }
    } else if (part.functionCall) {
      hasFunctionCall = true;
      hasContent = true;

      if (!template.choices[0].delta.tool_calls) {
        template.choices[0].delta.tool_calls = [];
      }

      const fcName = part.functionCall.name || '';
      const fcId = `${fcName}-${Date.now()}-${++functionCallIdCounter}`;

      template.choices[0].delta.tool_calls.push({
        id: fcId,
        index: state.functionIndex++,
        type: 'function',
        function: {
          name: fcName,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });

      template.choices[0].delta.role = 'assistant';
    } else if (part.inlineData || part.inline_data) {
      hasContent = true;
      const inlineData = part.inlineData || part.inline_data;
      const data = inlineData.data;

      if (data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
        const imageUrl = `data:${mimeType};base64,${data}`;

        if (!template.choices[0].delta.images) {
          template.choices[0].delta.images = [];
        }

        template.choices[0].delta.images.push({
          type: 'image_url',
          image_url: { url: imageUrl }
        });

        template.choices[0].delta.role = 'assistant';
      }
    }
  }

  if (hasFunctionCall) {
    template.choices[0].finish_reason = 'tool_calls';
    template.choices[0].native_finish_reason = 'tool_calls';
  }

  // Only return if we have actual content
  if (!hasContent && !template.choices[0].finish_reason && !template.usage) {
    return null;
  }

  return JSON.stringify(template);
}

function convertAntigravityNonStreamToOpenAI(rawJSON: any): string {
  const response = rawJSON.response || rawJSON;

  const template: any = {
    id: '',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'model',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        reasoning_content: null,
        tool_calls: null
      },
      finish_reason: null,
      native_finish_reason: null
    }]
  };

  if (response.modelVersion) {
    template.model = response.modelVersion;
  }

  if (response.responseId) {
    template.id = response.responseId;
  }

  if (response.candidates?.[0]?.finishReason) {
    const fr = response.candidates[0].finishReason.toLowerCase();
    template.choices[0].finish_reason = fr === 'stop' ? 'stop' : fr;
    template.choices[0].native_finish_reason = fr;
  }

  if (response.usageMetadata) {
    template.usage = {
      completion_tokens: response.usageMetadata.candidatesTokenCount || 0,
      total_tokens: response.usageMetadata.totalTokenCount || 0,
      prompt_tokens: (response.usageMetadata.promptTokenCount || 0) + (response.usageMetadata.thoughtsTokenCount || 0)
    };
    if (response.usageMetadata.thoughtsTokenCount > 0) {
      template.usage.completion_tokens_details = {
        reasoning_tokens: response.usageMetadata.thoughtsTokenCount
      };
    }
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  let hasFunctionCall = false;
  let textContent = '';
  let reasoningContent = '';

  for (const part of parts) {
    if (part.text !== undefined) {
      if (part.thought === true) {
        reasoningContent += part.text;
      } else {
        textContent += part.text;
      }
    } else if (part.functionCall) {
      hasFunctionCall = true;

      if (!template.choices[0].message.tool_calls) {
        template.choices[0].message.tool_calls = [];
      }

      const fcName = part.functionCall.name || '';
      const fcId = `${fcName}-${Date.now()}-${++functionCallIdCounter}`;

      template.choices[0].message.tool_calls.push({
        id: fcId,
        type: 'function',
        function: {
          name: fcName,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    } else if (part.inlineData || part.inline_data) {
      const inlineData = part.inlineData || part.inline_data;
      const data = inlineData.data;

      if (data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
        const imageUrl = `data:${mimeType};base64,${data}`;

        if (!template.choices[0].message.images) {
          template.choices[0].message.images = [];
        }

        template.choices[0].message.images.push({
          type: 'image_url',
          image_url: { url: imageUrl }
        });
      }
    }
  }

  if (textContent) {
    template.choices[0].message.content = textContent;
  }
  if (reasoningContent) {
    template.choices[0].message.reasoning_content = reasoningContent;
  }

  if (hasFunctionCall) {
    template.choices[0].finish_reason = 'tool_calls';
    template.choices[0].native_finish_reason = 'tool_calls';
  }

  return JSON.stringify(template);
}

// ============================================================================
// Available Models Fetching
// ============================================================================

let availableModels: string[] = [];
let selectedModel = 'gemini-3-flash';

async function fetchAvailableModels(): Promise<string[]> {
  try {
    const account = getActiveAccount();
    const token = await getAccessToken(account.refreshToken);

    for (const baseUrl of ANTIGRAVITY_BASE_URLS) {
      try {
        const response = await fetch(`${baseUrl}${ANTIGRAVITY_MODELS_PATH}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': DEFAULT_USER_AGENT,
          },
          body: JSON.stringify({})
        });

        if (response.ok) {
          const data = await response.json() as any;
          if (data.models) {
            const models: string[] = [];
            for (const originalName of Object.keys(data.models)) {
              const aliasName = modelName2Alias(originalName);
              if (aliasName) {
                models.push(aliasName);
              }
            }
            if (models.length > 0) {
              return models;
            }
          }
        }
      } catch (err) {
        console.log(`Failed to fetch from ${baseUrl}, trying next...`);
      }
    }
  } catch (err) {
    console.log('Failed to fetch models:', err);
  }

  // Fallback models (using real internal names, no aliases)
  return [
    'gemini-3-flash',
    'gemini-3-pro',
    'gemini-3-pro-image',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking',
  ];
}

// ============================================================================
// Proxy Server
// ============================================================================

function createProxyServer() {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // GET /v1/models
    if (req.method === 'GET' && req.url === '/v1/models') {
      const models = availableModels.map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'google'
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
      return;
    }

    // POST /v1/chat/completions
    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url?.startsWith('/v1/chat/completions'))) {
      let bodyText = '';
      req.on('data', chunk => bodyText += chunk);
      req.on('end', async () => {
        try {
          const openaiBody: OpenAIRequest = JSON.parse(bodyText);

          // Determine model
          let modelName = selectedModel;
          if (openaiBody.model) {
            const requestModel = openaiBody.model.split('/').pop();
            if (requestModel && requestModel !== 'chatcompletions') {
              modelName = requestModel;
            }
          }

          // Get account and token
          const account = getActiveAccount();
          const token = await getAccessToken(account.refreshToken);

          // Convert request
          const antigravityBody = convertOpenAIRequestToAntigravity(modelName, openaiBody);
          antigravityBody.project = account.projectId || generateProjectId();

          // Simple thought stripping to avoid sending 'thought: true' back to the model
          // which can cause 400 errors.
          if (antigravityBody.request.contents) {
            antigravityBody.request.contents = antigravityBody.request.contents.map((content: any) => {
              if (content.parts) {
                content.parts = content.parts.filter((part: any) => !part.thought);
              }
              return content;
            }).filter((content: any) => content.parts && content.parts.length > 0);
          }

          const isStream = openaiBody.stream !== false;
          const targetPath = isStream ? `${ANTIGRAVITY_STREAM_PATH}?alt=sse` : ANTIGRAVITY_GENERATE_PATH;

          // Try each base URL
          let lastError: Error | null = null;
          for (const baseUrl of ANTIGRAVITY_BASE_URLS) {
            try {
              const response = await fetch(`${baseUrl}${targetPath}`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  'User-Agent': DEFAULT_USER_AGENT,
                  'Accept': isStream ? 'text/event-stream' : 'application/json',
                },
                body: JSON.stringify(antigravityBody)
              });

              if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 429) {
                  // Rate limited, try next URL
                  console.log(`Rate limited on ${baseUrl}, trying next...`);
                  continue;
                }
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(errorText);
                return;
              }

              if (isStream) {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive'
                });

                const reader = response.body?.getReader();
                if (!reader) {
                  res.write('data: [DONE]\n\n');
                  res.end();
                  return;
                }

                const decoder = new TextDecoder();
                let buffer = '';
                const state: StreamState = { unixTimestamp: 0, functionIndex: 0 };

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || '';

                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      const jsonStr = line.slice(6).trim();
                      if (!jsonStr || jsonStr === '[DONE]') continue;

                      try {
                        const chunk = JSON.parse(jsonStr);
                        const openaiChunk = convertAntigravityStreamChunkToOpenAI(chunk, state);
                        if (openaiChunk) {
                          res.write(`data: ${openaiChunk}\n\n`);
                        }
                      } catch (parseErr) {
                        console.error('Parse error:', parseErr);
                      }
                    }
                  }
                }

                res.write('data: [DONE]\n\n');
                res.end();
              } else {
                const data = await response.json();
                const openaiResponse = convertAntigravityNonStreamToOpenAI(data);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(openaiResponse);
              }

              return;
            } catch (err) {
              lastError = err as Error;
              console.log(`Error on ${baseUrl}:`, err);
            }
          }

          // All URLs failed
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: lastError?.message || 'All upstream URLs failed',
              type: 'proxy_error'
            }
          }));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: err.message, type: 'proxy_error' }
          }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return server;
}

// ============================================================================
// Model Display
// ============================================================================

function displayAvailableModels(models: string[]) {
  console.log('\nAvailable models:');
  models.forEach((id, index) => {
    console.log(`  ${index + 1}. ${id}`);
  });
  console.log('');
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

// ============================================================================
// OAuth Authentication
// ============================================================================

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
    for (const baseUrl of ANTIGRAVITY_BASE_URLS) {
      const response = await fetch(`${baseUrl}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': DEFAULT_USER_AGENT,
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
    }
  } catch { }
  return '';
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

async function promptManualCallback(): Promise<URL> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve, reject) => {
    console.log('\n=== IMPORTANT ===');
    console.log('After clicking "Allow" in Google, your browser will try to go to localhost:51121');
    console.log('The page will keep LOADING FOREVER or show an error - THIS IS EXPECTED!');
    console.log('');
    console.log('DO NOT WAIT for the page to load!');
    console.log('Just look at your ADDRESS BAR - it already has the URL you need:');
    console.log('   http://localhost:51121/oauth-callback?state=...&code=...');
    console.log('');
    console.log('Copy that URL from the address bar RIGHT NOW (while it\'s still loading)\n');

    rl.question('Paste callback URL: ', (answer) => {
      rl.close();
      const trimmed = answer.trim();

      if (!trimmed) {
        reject(new Error('No URL provided'));
        return;
      }

      try {
        const url = new URL(trimmed);
        const error = url.searchParams.get('error');
        if (error) {
          const errorDesc = url.searchParams.get('error_description') || error;
          reject(new Error(`OAuth error: ${errorDesc}`));
          return;
        }

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
  console.log('Opening browser for Google login...\n');

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

  openBrowser(authUrl.toString());

  const callbackUrl = await startOAuthListener();

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

  const storage: AccountStorage = {
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

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.log('Antigravity Proxy v2 - OpenAI-compatible API');
  console.log('=============================================\n');

  // Check for --reauth flag
  const args = process.argv.slice(2);
  if (args.includes('--reauth')) {
    clearAccounts();
  }

  // Check if accounts exist, if not authenticate
  if (!accountsExist()) {
    await authenticate();
  }

  // Fetch available models
  console.log('Fetching available models...');
  availableModels = await fetchAvailableModels();
  
  // Display available models
  displayAvailableModels(availableModels);

  // Start server immediately
  const server = createProxyServer();
  const PORT = parseInt(process.env.PORT || '3460', 10);
  const HOST = process.env.HOST || '127.0.0.1';

  server.listen(PORT, HOST, () => {
    console.log(`✓ Proxy running at http://${HOST}:${PORT}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /v1/models           - List available models`);
    console.log(`  POST /v1/chat/completions - Chat completions\n`);
  });
}

main().catch(console.error);