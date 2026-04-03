// ============ AI PLATFORM DETECTION ============
const AI_PLATFORMS = [
  'chat.openai.com', 'chatgpt.com', 'claude.ai',
  'gemini.google.com', 'perplexity.ai', 'copilot.microsoft.com',
  'deepseek.com', 'poe.com', 'anthropic.com'
];

const isAIPlatform = () => AI_PLATFORMS.some(d => window.location.hostname.includes(d));

// Map hostname → short platform key stored in background.js
function getPlatformName() {
  const h = window.location.hostname;
  if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'chatgpt';
  if (h.includes('claude.ai') || h.includes('anthropic.com'))      return 'claude';
  if (h.includes('gemini.google.com'))                              return 'gemini';
  if (h.includes('deepseek.com'))                                   return 'deepseek';
  if (h.includes('perplexity.ai'))                                  return 'perplexity';
  if (h.includes('copilot.microsoft.com'))                          return 'copilot';
  if (h.includes('poe.com'))                                        return 'poe';
  return 'other';
}

// ── Session-level CO₂ accumulator — NOW MANAGED BY background.js, NOT content.js ──
// Content.js receives sessionCO2/sessionCalls in the response from background.js

// ============ SAFE MESSAGING ============
// Handles extension context invalidation errors gracefully (e.g. after extension reload)
function safeSendMessage(message, callback) {
  try {
    if (!chrome.runtime?.id) {
      // Extension context is gone — stop all activity silently
      return;
    }
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.log('🌱 Carbon Compass: Context lost (normal during reload)');
        return;
      }
      if (callback) callback(response);
    });
  } catch (e) {
    console.log('🌱 Carbon Compass: Message failed (extension reloading)');
  }
}

// ============ AI DETECTION ============
if (isAIPlatform()) {
  console.log('🌱 Carbon Compass: AI platform detected —', window.location.hostname);
  setupAIDetection();
}

function setupAIDetection() {
  console.log('🌱 Carbon Compass: AI detection running');

  // --- Event delegation: catches Enter key on any textarea/input/contenteditable ---
  // Modern AI platforms (ChatGPT, Claude.ai, Gemini) use <div contenteditable="true">,
  // not <textarea>. We must handle all three to reliably detect submissions.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = e.target;
    // contentEditable check must also handle child elements (e.g. <p> inside the editable div
    // returns "inherit" not "true" — traverse up to the nearest contenteditable ancestor)
    const editableAncestor = el.closest('[contenteditable="true"]');
    const isInput = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
      || el.contentEditable === 'true' || editableAncestor !== null;
    if (!isInput) return;
    const source = editableAncestor || el;
    const text = (source.value || source.innerText || '').trim();
    if (text.length > 5) detectPrompt(text);
  }, true); // capture phase so we see it before the site's own handler

  // --- Click delegation on send buttons ---
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
    if (!label.includes('send') && btn.type !== 'submit') return;

    // Find the active textarea OR contenteditable input (ChatGPT/Claude.ai/Gemini use contenteditable)
    const textarea = document.querySelector('textarea');
    const editable = document.querySelector('[contenteditable="true"]');
    const text = (textarea?.value || editable?.innerText || '').trim();
    if (text.length > 5) detectPrompt(text);
  }, true);
}

// Platforms where we can intercept real API calls for accurate token counts
const API_INTERCEPT_PLATFORMS = [
  'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com',
  'deepseek.com', 'perplexity.ai', 'copilot.microsoft.com', 'poe.com'
];
const hasApiIntercept = () => API_INTERCEPT_PLATFORMS.some(d => window.location.hostname.includes(d));

function guessModelFromURL() {
  const url = window.location.href.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  
  // ChatGPT URL patterns: /g/[gpt-model] or contains gpt-4, gpt-3.5, etc
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
    if (path.includes('/gpts') || path.includes('gpt-4')) return 'GPT-4';
    if (path.includes('gpt-3.5') || path.includes('turbo')) return 'GPT-3.5-turbo';
    if (url.includes('gpt')) return 'GPT-4'; // default to GPT-4 for ChatGPT
  }
  
  // Claude URL patterns
  if (url.includes('claude.ai')) {
    if (url.includes('sonnet')) return 'Claude Sonnet 4';
    if (url.includes('opus')) return 'Claude Opus';
    if (url.includes('haiku')) return 'Claude Haiku';
    return 'Claude Sonnet 4'; // default
  }
  
  // Gemini
  if (url.includes('gemini.google.com')) {
    if (url.includes('pro')) return 'Gemini Pro';
    if (url.includes('ultra')) return 'Gemini Ultra';
    return 'Gemini Pro';
  }
  
  // DeepSeek
  if (url.includes('deepseek.com')) {
    return 'DeepSeek';
  }
  
  // Perplexity
  if (url.includes('perplexity.ai')) {
    return 'Perplexity';
  }
  
  return ''; // no guess
}

let lastDetection = 0;
let activePromptRun = null;  // active prompt submission lifecycle (fallback vs intercept)
let pendingModelHint = '';   // model selected by user (request-level hint)
let lastPromptFingerprint = '';
let lastPromptAt = 0;

function detectPrompt(promptText) {
  const trimmed = String(promptText || '').trim();
  if (trimmed.length <= 5) return;
  const now = Date.now();

  const fingerprint = `${getPlatformName()}::${trimmed}`;
  if (fingerprint === lastPromptFingerprint && now - lastPromptAt < 8000) {
    console.log('🔍 DUPLICATE PROMPT: Ignoring repeated submission');
    return;
  }
  lastPromptFingerprint = fingerprint;
  lastPromptAt = now;

  // Debounce: ignore duplicate detections within 3 seconds
  if (now - lastDetection < 3000) {
    console.log('🔍 DEBOUNCED: Ignoring duplicate detection within 3s');
    return;
  }
  lastDetection = now;
  pendingModelHint = guessModelFromURL() || ''; // Initialize with URL-based guess
  const promptRun = {
    id: `${now}-${Math.random().toString(16).slice(2)}`,
    interceptFired: false,
    modelHint: pendingModelHint,
  };
  activePromptRun = promptRun;

  console.log('🌱 Carbon Compass: AI prompt detected — length:', trimmed.length, 'model hint:', pendingModelHint);
  console.log('🔍 PROMPT TEXT:', trimmed.substring(0, 100));

  if (hasApiIntercept()) {
    // Show pending nudge immediately; fetch interceptor will replace it with real counts.
    // FALLBACK: if no intercept fires within 3s (e.g. Gemini web app uses internal URLs
    // that don't match generativelanguage.googleapis.com), fall back to text estimate.
    showPendingNudge();
    setTimeout(() => {
      if (activePromptRun !== promptRun) {
        console.log('🔍 STALE FALLBACK: Newer prompt exists, skipping old fallback');
        return;
      }
      if (!promptRun.interceptFired) {
        console.log('🌱 Carbon Compass: API intercept timeout — falling back to estimate');
        console.log('🔍 FALLBACK PROMPT LENGTH:', trimmed.length, 'truncated to:', Math.min(trimmed.length, 500));
        safeSendMessage(
          { type: 'AI_USAGE', prompt: trimmed.substring(0, 500), platform: getPlatformName(), model: pendingModelHint || undefined },
          (response) => {
            if (response) {
              promptRun.interceptFired = true; // prevent double-counting if intercept fires late
              showCarbonNudge(response.co2, response.water, response.tokens, response.promptTokens, response.completionTokens, response.sessionCO2, pendingModelHint || '', getPlatformName(), response.sessionCalls);
            }
          }
        );
      } else {
        console.log('🔍 INTERCEPT FIRED: Skipping fallback estimate');
      }
    }, 3000);
  } else {
    // Unsupported platform: fall back to textarea length estimate immediately
    safeSendMessage(
      { type: 'AI_USAGE', prompt: trimmed.substring(0, 500), platform: getPlatformName(), model: pendingModelHint || undefined },
      (response) => {
        if (response) {
          showCarbonNudge(response.co2, response.water, response.tokens, response.promptTokens, response.completionTokens, response.sessionCO2, response.model || pendingModelHint || '', getPlatformName(), response.sessionCalls);
        }
      }
    );
  }
}

function showPendingNudge() {
  const existing = document.getElementById('carbon-compass-nudge');
  if (existing) existing.remove();
  const nudge = document.createElement('div');
  nudge.id = 'carbon-compass-nudge';
  nudge.innerHTML = `
    <div style="
      position:fixed; bottom:20px; right:20px;
      background:linear-gradient(135deg,#1a3c2c,#2d6a4f);
      color:white; padding:12px 16px; border-radius:12px;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif; font-size:13px;
      z-index:2147483647; box-shadow:0 4px 12px rgba(0,0,0,0.3); max-width:280px;
      animation:ccSlideIn 0.3s ease;">
      <span style="font-size:20px;">🌱</span>
      &nbsp; <strong>Calculating carbon cost…</strong>
    </div>
    <style>@keyframes ccSlideIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}</style>
  `;
  document.body.appendChild(nudge);
  // Auto-dismiss after 8s in case API intercept never fires (URL mismatch etc.)
  setTimeout(() => nudge.parentNode && nudge.remove(), 8000);
}

function showCarbonNudge(co2, water, tokens, promptTokens, completionTokens, sessCO2, model, platform, sessCalls) {
  const existing = document.getElementById('carbon-compass-nudge');
  if (existing) existing.remove();

  // Format model label for display (e.g. "gpt-4o" → "GPT-4o")
  const modelLabel = model
    ? model.replace(/^(gpt|claude|gemini|deepseek)/i, m => m.toUpperCase()).replace(/-/g, ' ')
    : '';
  const sessLine = (sessCO2 > 0 && sessCalls > 1)
    ? `<div style="margin-top:4px; font-size:11px; opacity:0.85;">
         📊 Session total: <strong>${sessCO2.toFixed(3)}g CO₂</strong> across ${sessCalls} prompts
       </div>`
    : '';
  const modelLine = modelLabel
    ? `<span style="font-size:10px; opacity:0.7; margin-left:4px;">(${modelLabel})</span>`
    : '';
  
  // Format token breakdown
  const pTok = promptTokens || 0;
  const cTok = completionTokens || 0;
  const pTokStr = pTok >= 1000 ? `${(pTok/1000).toFixed(1)}K` : String(pTok);
  const cTokStr = cTok >= 1000 ? `${(cTok/1000).toFixed(1)}K` : String(cTok);

  // ── Emotional nudge selection ──
  const nudgeMsg = getEmotionalNudge(sessCalls, sessCO2, tokens);

  const nudge = document.createElement('div');
  nudge.id = 'carbon-compass-nudge';
  nudge.innerHTML = `
    <div style="
      position: fixed; bottom: 20px; right: 20px;
      background: linear-gradient(135deg, #1a3c2c, #2d6a4f);
      color: white; padding: 12px 16px; border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px;
      z-index: 2147483647; box-shadow: 0 4px 12px rgba(0,0,0,0.3); max-width: 320px;
      animation: ccSlideIn 0.3s ease;
    ">
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="font-size:24px;">${nudgeMsg.emoji}</span>
        <div style="flex:1;">
          <strong>This prompt</strong>${modelLine}<br>
          ${co2.toFixed(4)}g CO₂ &nbsp;|&nbsp; ${water.toFixed(3)}L water<br>
          <span style="font-size:11px; opacity:0.8;">↑${pTokStr} ↓${cTokStr}</span>
        </div>
        <button id="cc-nudge-close" style="
          background:none; border:none; color:white; font-size:18px;
          cursor:pointer; opacity:0.7; padding:0; line-height:1;
        ">×</button>
      </div>
      ${sessLine}
      <div style="margin-top:8px; font-size:11px; border-top:1px solid rgba(255,255,255,0.2); padding-top:8px; line-height:1.4;">
        ${nudgeMsg.message}
      </div>
    </div>
    <style>
      @keyframes ccSlideIn {
        from { transform: translateX(110%); opacity: 0; }
        to   { transform: translateX(0);   opacity: 1; }
      }
    </style>
  `;
  document.body.appendChild(nudge);
  document.getElementById('cc-nudge-close').addEventListener('click', () => nudge.remove());
  setTimeout(() => nudge.parentNode && nudge.remove(), 12000);
}

// ── Emotional nudge generator ──
// Progressive messaging: gets more emotionally charged with higher usage
function getEmotionalNudge(sessionCalls, sessionCO2, tokens) {
  // High usage session (>10 calls or >0.5g CO₂)
  if (sessionCalls > 10 || sessionCO2 > 0.5) {
    const msgs = [
      { emoji: '😢', message: '10+ prompts today. A tree absorbs 60g CO₂/day. You\'ve already used ' + (sessionCO2/60*100).toFixed(0) + '% of that.' },
      { emoji: '🌍', message: sessionCalls + ' AI calls this session. If 1 billion people did this daily, it\'d equal ' + (sessionCO2 * 1e9 / 1e6).toFixed(0) + ' tons CO₂/day.' },
      { emoji: '💔', message: 'Every query trains the model to expect instant answers. Some questions deserve time to think.' },
      { emoji: '😔', message: sessionCalls + ' calls. Could some of these have been answered by reading documentation or thinking 5 more minutes?' },
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  
  // Medium usage (5-10 calls or 0.2-0.5g)
  if (sessionCalls >= 5 || sessionCO2 >= 0.2) {
    const msgs = [
      { emoji: '🤔', message: sessionCalls + ' calls today. Could Google have answered some of these in 10 seconds?' },
      { emoji: '📚', message: 'AI is powerful, but so is reading the docs. Stack Overflow uses 0g CO₂.' },
      { emoji: '🧠', message: 'Your brain is the most energy-efficient computer. Try thinking through this one first?' },
      { emoji: '⏸️', message: sessionCalls + ' prompts. Taking a 5-min break to think saves CO₂ and sharpens your mind.' },
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  
  // Low usage (<5 calls) - gentle reminders
  const msgs = [
    { emoji: '💡', message: 'Quick tip: Batch similar questions into one prompt to cut carbon ~30%.' },
    { emoji: '🌱', message: 'Before asking AI: Could I Google this? Think it through? Read the docs?' },
    { emoji: '⚡', message: 'AI uses GPU clusters. Simple searches use your local CPU. Choose wisely.' },
    { emoji: '🍃', message: 'Every prompt has a cost. Make it count — be specific, batch questions.' },
    { emoji: '♻️', message: 'Reuse answers. Save this response instead of asking twice tomorrow.' },
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

// ============ AI API INTERCEPTION ============
// Intercepts fetch calls to AI platform APIs to get real token counts.
// The textarea only shows what the user typed in the current message.
// The actual API call includes the entire conversation history — real token count
// for a 20-message conversation can be 20× the textarea estimate.
console.log('🌱 Carbon Compass: AI API interception active');

// ── AI endpoint patterns ──
// These match the real HTTP endpoints each platform uses for streaming chat responses.
const AI_ENDPOINTS = [
  {
    name: 'ChatGPT',
    match: url => url.includes('/backend-api/conversation') || url.includes('/backend-api/f/conversation'),
    parse: parseChatGPTSSE,
  },
  {
    name: 'Claude',
    // claude.ai changed endpoint structure — match broadly on any claude.ai API call
    // that looks like a chat/message endpoint, regardless of exact path version
    match: url => url.includes('claude.ai') && (
      url.includes('/completion') || url.includes('/messages') ||
      url.includes('/append') || url.includes('/chat')
    ),
    parse: parseClaudeSSE,
  },
  {
    name: 'Gemini',
    match: url => url.includes('generativelanguage.googleapis.com') && url.includes('streamGenerateContent'),
    parse: parseGeminiSSE,
  },
  {
    name: 'DeepSeek',
    // DeepSeek uses OpenAI-compatible streaming API
    match: url => url.includes('deepseek.com') && (url.includes('/completions') || url.includes('/chat/')),
    parse: parseDeepSeekSSE,
  },
  {
    name: 'Perplexity',
    match: url => url.includes('perplexity.ai') && (
      url.includes('/chat/completions') || url.includes('/api/chat') ||
      url.includes('/api/model-labs') || url.includes('/completions')
    ),
    parse: (response, requestModel) => parseUniversalModelUsage(response, requestModel || 'perplexity'),
  },
  {
    name: 'Copilot',
    match: url => url.includes('copilot.microsoft.com') && (
      url.includes('/chat') || url.includes('/messages') || url.includes('/completions') ||
      url.includes('/conversation')
    ),
    parse: (response, requestModel) => parseUniversalModelUsage(response, requestModel || 'copilot'),
  },
  {
    name: 'Poe',
    match: url => url.includes('poe.com') && (
      url.includes('/api/') || url.includes('/gql') || url.includes('/graphql')
    ),
    parse: (response, requestModel) => parseUniversalModelUsage(response, requestModel || 'poe'),
  },
];

const _origFetch = window.fetch;
window.fetch = async function(...args) {
  const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
  const isKnownAIHost =
    url.includes('chatgpt.com') || url.includes('chat.openai.com') ||
    url.includes('claude.ai') || url.includes('gemini.google.com') ||
    url.includes('generativelanguage.googleapis.com') || url.includes('deepseek.com') ||
    url.includes('perplexity.ai') || url.includes('copilot.microsoft.com') ||
    url.includes('poe.com');
  const requestModel = isKnownAIHost ? (await extractModelFromRequest(args)) || '' : '';
  if (requestModel) pendingModelHint = requestModel;
  const response = await _origFetch.apply(this, args);

  // ── Check if this is an AI API streaming call ──
  const endpoint = AI_ENDPOINTS.find(e => e.match(url));
  if (endpoint) {
    const platform = getPlatformName();
    console.log(`🌱 Carbon Compass: AI API intercepted (${endpoint.name}) — ${url.slice(0, 80)}…`);
    // Clone so we can read the body without consuming it for the app
    endpoint.parse(response.clone(), requestModel).then(({ tokens, promptTokens, completionTokens, model }) => {
      if (model) pendingModelHint = model;
      if (tokens > 0) {
        const chosenModel = resolveBestModel({ parsedModel: model, requestModel, pendingModelHint, platform });
        console.log(`🌱 Carbon Compass: Real tokens from ${endpoint.name}: ${tokens} (↑${promptTokens} ↓${completionTokens}) model: ${chosenModel}`);
        if (activePromptRun?.interceptFired) return; // fallback already ran, skip to avoid double-count
        if (activePromptRun) activePromptRun.interceptFired = true;
        safeSendMessage({ type: 'AI_USAGE', tokens, promptTokens, completionTokens, model: chosenModel, platform }, (resp) => {
          if (resp) {
            showCarbonNudge(resp.co2, resp.water, tokens, resp.promptTokens, resp.completionTokens, resp.sessionCO2, chosenModel, platform, resp.sessionCalls);
          }
        });
      }
    }).catch(() => {});
    return response;
  }

  return response;
};

function isGenericPlatformModel(model, platform) {
  const m = (model || '').toLowerCase().trim();
  const p = (platform || '').toLowerCase().trim();
  if (!m) return true;
  const generic = new Set(['chatgpt', 'claude', 'gemini', 'deepseek', 'perplexity', 'copilot', 'poe', 'other', 'default']);
  return m === p || generic.has(m);
}

function resolveBestModel({ parsedModel, requestModel, pendingModelHint, platform }) {
  if (!isGenericPlatformModel(parsedModel, platform)) return parsedModel;
  if (requestModel) return requestModel;
  if (!isGenericPlatformModel(pendingModelHint, platform)) return pendingModelHint;
  if (parsedModel) return parsedModel;
  return platform || 'other';
}

// ── SSE stream reader ──
// Reads a streaming response body line-by-line, calls extractFn on each parsed JSON event.
async function readSSETokens(response, extractFn, accumulate) {
  const reader = response.body?.getReader();
  if (!reader) return 0;
  const decoder = new TextDecoder();
  let buffer = '';
  let total  = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const n = extractFn(JSON.parse(raw));
          if (n > 0) { if (accumulate) total += n; else total = n; }
        } catch (_) {}
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
  return total;
}

function estimateTokensFromText(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

async function extractModelFromRequest(args) {
  try {
    const req = args[0];
    const init = args[1] || {};
    const url = (typeof req === 'string' ? req : req?.url) || '';
    const fromUrl = new URL(url, window.location.origin).searchParams.get('model');
    if (fromUrl) return fromUrl;

    const body = init.body;
    if (!body) return '';
    if (typeof body === 'string') {
      const parsed = JSON.parse(body);
      return extractModelFromObject(parsed);
    }
    if (body instanceof URLSearchParams) {
      return body.get('model') || '';
    }

    if (req instanceof Request) {
      const cloned = req.clone();
      const contentType = (cloned.headers.get('content-type') || '').toLowerCase();
      const raw = await cloned.text();
      if (!raw) return '';

      if (contentType.includes('application/json') || raw.startsWith('{') || raw.startsWith('[')) {
        try {
          return extractModelFromObject(JSON.parse(raw));
        } catch (_) {}
      }

      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(raw);
        return params.get('model') || '';
      }
    }
  } catch (_) {}
  return '';
}

function extractModelFromObject(obj) {
  if (!obj) return '';
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const m = extractModelFromObject(item);
      if (m) return m;
    }
    return '';
  }
  if (typeof obj !== 'object') return '';

  const direct = obj.model || obj.model_slug || obj.modelId || obj.model_id || obj.modelName || obj.model_name || obj.modelVersion || obj.model_version || '';
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const candidates = [
    obj.metadata, obj.message, obj.request, obj.config, obj.options,
    obj.payload, obj.input, obj.query, obj.variables, obj.usageMetadata
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object') {
      const m = extractModelFromObject(c);
      if (m) return m;
    }
  }
  return '';
}

// ── ChatGPT SSE parser ──
// Each SSE event contains message.metadata.usage (token counts) and model_slug (model name).
function parseChatGPTSSE(response) {
  let model = '', promptT = 0, completionT = 0;
  return readSSETokens(response, (data) => {
    if (!model) {
      model = data?.message?.metadata?.model_slug
           || data?.message?.author?.metadata?.model_slug
           || data?.model || '';
    }
    const u1 = data?.message?.metadata?.usage;
    if (u1) { promptT = u1.prompt_tokens || 0; completionT = u1.completion_tokens || 0; return promptT + completionT; }
    const u2 = data?.usage;
    if (u2) { promptT = u2.prompt_tokens || 0; completionT = u2.completion_tokens || 0; return promptT + completionT; }
    return 0;
  }, false).then(tokens => ({ tokens, promptTokens: promptT, completionTokens: completionT, model }));
}

// ── Claude.ai SSE parser ──
// 'message_start' event has both model name and input_tokens.
// 'message_delta' has output_tokens.
function parseClaudeSSE(response) {
  let model = '', inputT = 0, outputT = 0;
  return readSSETokens(response, (data) => {
    if (data?.type === 'message_start') {
      if (!model) model = data?.message?.model || '';
      inputT += data?.message?.usage?.input_tokens || 0;
      return data?.message?.usage?.input_tokens || 0;
    }
    if (data?.type === 'message_delta') {
      outputT += data?.usage?.output_tokens || 0;
      return data?.usage?.output_tokens || 0;
    }
    return 0;
  }, true).then(tokens => ({ tokens, promptTokens: inputT, completionTokens: outputT, model }));
}

// ── Gemini SSE parser ──
// usageMetadata.totalTokenCount is the running total; modelVersion may be present.
function parseGeminiSSE(response) {
  let model = '', promptT = 0;
  return readSSETokens(response, (data) => {
    if (!model) model = data?.usageMetadata?.modelVersion || '';
    // Gemini provides promptTokenCount separately; rest is completion
    if (data?.usageMetadata?.promptTokenCount) promptT = data.usageMetadata.promptTokenCount;
    return data?.usageMetadata?.totalTokenCount || 0;
  }, false).then(tokens => ({
    tokens,
    promptTokens: promptT,
    completionTokens: tokens > promptT ? tokens - promptT : 0,
    model,
  }));
}

// ── DeepSeek SSE parser ──
// DeepSeek uses OpenAI-compatible streaming format — usage in the last non-DONE chunk.
function parseDeepSeekSSE(response) {
  let model = '', promptT = 0, completionT = 0;
  return readSSETokens(response, (data) => {
    if (!model) model = data?.model || '';
    const u = data?.usage;
    if (u) { promptT = u.prompt_tokens || 0; completionT = u.completion_tokens || 0; return promptT + completionT; }
    return 0;
  }, false).then(tokens => ({ tokens, promptTokens: promptT, completionTokens: completionT, model }));
}

async function parseUniversalModelUsage(response, fallbackModel = '') {
  const ctype = (response.headers.get('content-type') || '').toLowerCase();
  try {
    if (ctype.includes('event-stream')) {
      let model = '';
      let promptT = 0;
      let completionT = 0;
      const tokens = await readSSETokens(response, (data) => {
        if (!model) model = extractModelFromObject(data) || '';
        const u = data?.usage || data?.usageMetadata || {};
        const pt = u.prompt_tokens || u.input_tokens || u.promptTokenCount || 0;
        const ct = u.completion_tokens || u.output_tokens || 0;
        const tt = u.total_tokens || u.totalTokenCount || (pt + ct) || 0;
        if (pt) promptT = pt;
        if (ct) completionT = ct;
        return tt;
      }, false);
      return {
        tokens,
        promptTokens: promptT,
        completionTokens: completionT || Math.max(tokens - promptT, 0),
        model: model || fallbackModel,
      };
    }

    const text = await response.text();
    const json = JSON.parse(text);
    const model = extractModelFromObject(json) || fallbackModel;
    const usage = json?.usage || json?.usageMetadata || json?.metadata?.usage || {};
    const promptT = usage.prompt_tokens || usage.input_tokens || usage.promptTokenCount || 0;
    const completionT = usage.completion_tokens || usage.output_tokens || usage.candidatesTokenCount || 0;
    const totalT = usage.total_tokens || usage.totalTokenCount || usage.total || (promptT + completionT);
    if (totalT > 0) {
      return {
        tokens: totalT,
        promptTokens: promptT,
        completionTokens: completionT || Math.max(totalT - promptT, 0),
        model,
      };
    }

    const assistantText = json?.text || json?.answer || json?.output || json?.response || '';
    const estimatedOut = estimateTokensFromText(assistantText);
    return {
      tokens: estimatedOut,
      promptTokens: 0,
      completionTokens: estimatedOut,
      model,
    };
  } catch (_) {
    return { tokens: 0, promptTokens: 0, completionTokens: 0, model: fallbackModel };
  }
}

console.log('🌱 Carbon Compass: Content script ready');
