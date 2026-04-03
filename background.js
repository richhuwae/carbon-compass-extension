// ============ CARBON CALCULATION CONSTANTS ============
// All values traceable to peer-reviewed academic sources
// Updated with EcoLogits/CodeCarbon LCA methodology (April 2026)
const CARBON_INTENSITY        = 590.4;   // gCO₂eq/kWh — EcoLogits World Mix (ADEME Base Empreinte®)
const WATER_PER_KWH           = 3.78;    // L/kWh      — off-site WUE proxy (power generation)
const PUE                     = 1.2;     // Power Usage Effectiveness — EcoLogits default
const DATA_ENERGY             = 0.006;   // kWh/MB     — Shift Project 2023

// ============ EMBODIED CARBON CONSTANTS (EcoLogits-style allocation) ============
const BATCH_SIZE_DEFAULT       = 64;        // EcoLogits default inference batch
const HW_LIFETIME_SECONDS      = 3 * 365 * 24 * 3600; // 3-year hardware lifetime
const SERVER_EMBODIED_CO2_G    = 5700000;   // p5.48xlarge server (without GPUs), gCO₂eq
const GPU_EMBODIED_CO2_G       = 273000;    // NVIDIA H100 80GB, gCO₂eq
const GPU_INSTALLED_PER_SERVER = 8;         // reference host topology
const GPU_MEMORY_GB            = 80;        // H100 80GB
const MODEL_QUANT_BITS         = 16;        // default inference precision assumption
const MODEL_MEMORY_OVERHEAD    = 1.2;       // transformer inference memory overhead

// ============ ECOLOGITS PER-TOKEN CO₂ LOOKUP TABLE ============
// Based on EcoLogits Calculator data (https://huggingface.co/spaces/genai-impact/ecologits-calculator)
// Values are gCO₂eq per output token, averaged across multiple prompts
// Source: EcoLogits_Calculator_Summary.xlsx provided by user
const ECOLOGITS_CO2_PER_TOKEN = {
  // OpenAI models
  'gpt-4o':          0.0008,   // 0.12g / 150 tokens
  'gpt-4o-mini':     0.00013,  // 0.02g / 150 tokens
  'gpt-4':           0.0012,   // Conservative estimate (not in Excel, using GPT-4o * 1.5)
  'gpt-4-turbo':     0.0009,   // Between GPT-4 and GPT-4o
  'gpt-3.5-turbo':   0.0004,   // Smaller model estimate
  'gpt-3.5':         0.0004,
  
  // Anthropic models (from Excel)
  'claude-3-7-sonnet': 0.00018, // 0.03g / 150 tokens
  'claude-4-sonnet':   0.00018,
  'claude-sonnet':     0.00018,
  'claude-opus':       0.00054, // 0.08g / 150 tokens
  'claude-haiku':      0.00007, // 0.01g / 150 tokens
  
  // Google models (from Excel)
  'gemini-2-5-pro':  0.00033,   // 0.05g / 150 tokens
  'gemini-2-5-flash': 0.00007,  // 0.01g / 150 tokens
  'gemini-pro':      0.00033,
  'gemini-ultra':    0.0006,
  'gemini-flash':    0.00007,
  
  // Other models
  'deepseek':        0.0002,    // Efficient Chinese model estimate
  'perplexity':      0.0005,    // Mixed model estimate
  'llama':           0.0003,    // Open source estimate
  'mistral':         0.0002,
  
  // Fallback
  'default':         0.0005,    // Conservative average
};

// Helper: Get CO₂ per token for a given model
function getCO2PerToken(modelStr) {
  const canonical = canonicalModelName(modelStr);
  
  // Try exact match first
  if (ECOLOGITS_CO2_PER_TOKEN[canonical]) {
    return ECOLOGITS_CO2_PER_TOKEN[canonical];
  }
  
  // Try partial match (e.g., "gpt-4-0125-preview" → "gpt-4")
  for (const [key, value] of Object.entries(ECOLOGITS_CO2_PER_TOKEN)) {
    if (canonical.includes(key) || key.includes(canonical)) {
      return value;
    }
  }
  
  return ECOLOGITS_CO2_PER_TOKEN['default'];
}

// ============ ECOLOGITS PARAMETRIC INFERENCE MODELS ============
// Usage-model regressions from EcoLogits LLM Inference methodology.
// f_E: Wh / output token ; f_L: sec / output token
const LLM_ENERGY_ALPHA = 1.17e-6;
const LLM_ENERGY_BETA  = -1.12e-2;
const LLM_ENERGY_GAMMA = 4.05e-5;
const LLM_LAT_ALPHA    = 6.78e-4;
const LLM_LAT_BETA     = 3.12e-4;
const LLM_LAT_GAMMA    = 1.94e-2;
const SERVER_POWER_NO_GPU_KW = 1.2; // p5.48xlarge reference

// Model architecture approximations for EcoLogits-style inference:
// totalParamsB drives hosting footprint (GPU count), activeParamsB drives per-token GPU energy/latency.
const MODEL_PROFILE = {
  'gpt-4o':           { totalParamsB: 800,  activeParamsB: 220 },
  'gpt-4.1':          { totalParamsB: 800,  activeParamsB: 220 },
  'gpt-4.1-mini':     { totalParamsB: 30,   activeParamsB: 30  },
  'gpt-4':            { totalParamsB: 1800, activeParamsB: 220 },
  'gpt-4-turbo':      { totalParamsB: 880,  activeParamsB: 176 },
  'gpt-4o-mini':      { totalParamsB: 8,    activeParamsB: 8   },
  'o1':               { totalParamsB: 1800, activeParamsB: 352 },
  'o1-mini':          { totalParamsB: 100,  activeParamsB: 100 },
  'o3-mini':          { totalParamsB: 400,  activeParamsB: 120 },
  'o3':               { totalParamsB: 2000, activeParamsB: 400 },
  'gpt-3.5':          { totalParamsB: 175,  activeParamsB: 175 },
  'gpt-3.5-turbo':    { totalParamsB: 175,  activeParamsB: 175 },
  'claude-3.7-sonnet':{ totalParamsB: 1200, activeParamsB: 240 },
  'claude-4-sonnet':  { totalParamsB: 1400, activeParamsB: 280 },
  'claude-opus':      { totalParamsB: 2000, activeParamsB: 400 },
  'claude-sonnet':    { totalParamsB: 1000, activeParamsB: 200 },
  'claude-haiku':     { totalParamsB: 70,   activeParamsB: 70  },
  'gemini-2.5-pro':   { totalParamsB: 500,  activeParamsB: 220 },
  'gemini-2.5-flash': { totalParamsB: 80,   activeParamsB: 80  },
  'gemini-2.0-flash': { totalParamsB: 50,   activeParamsB: 50  },
  'gemini-1.5-pro':   { totalParamsB: 400,  activeParamsB: 180 },
  'gemini-1.5-flash': { totalParamsB: 60,   activeParamsB: 60  },
  'gemini-pro':       { totalParamsB: 400,  activeParamsB: 180 },
  'gemini-flash':     { totalParamsB: 60,   activeParamsB: 60  },
  'deepseek-r1':      { totalParamsB: 671,  activeParamsB: 37  },
  'deepseek-v3':      { totalParamsB: 671,  activeParamsB: 37  },
  'deepseek':         { totalParamsB: 671,  activeParamsB: 37  },
  'llama-3.1-70b':    { totalParamsB: 70,   activeParamsB: 70  },
  'llama-3.1-8b':     { totalParamsB: 8,    activeParamsB: 8   },
  'llama-3-70b':      { totalParamsB: 70,   activeParamsB: 70  },
  'llama-3-8b':       { totalParamsB: 8,    activeParamsB: 8   },
  'mixtral-8x22b':    { totalParamsB: 141,  activeParamsB: 39  },
  'mixtral-8x7b':     { totalParamsB: 47,   activeParamsB: 13  },
  'mistral-large':    { totalParamsB: 123,  activeParamsB: 123 },
  'qwen-2.5-72b':     { totalParamsB: 72,   activeParamsB: 72  },
  'qwen-2.5-7b':      { totalParamsB: 7,    activeParamsB: 7   },
  'command-r-plus':   { totalParamsB: 104,  activeParamsB: 104 },
  'command-r':        { totalParamsB: 35,   activeParamsB: 35  },
  'sonar-pro':        { totalParamsB: 180,  activeParamsB: 180 },
  'sonar':            { totalParamsB: 70,   activeParamsB: 70  },
  'default':          { totalParamsB: 175,  activeParamsB: 175 },
};

function modelProfile(modelStr) {
  const key = canonicalModelName(modelStr);
  return MODEL_PROFILE[key] || MODEL_PROFILE.default;
}

function modelTotalParamsB(modelStr) {
  return modelProfile(modelStr).totalParamsB;
}

function estimateGpuCount(modelStr) {
  const totalParamsB = modelTotalParamsB(modelStr);
  const modelMemoryGB = MODEL_MEMORY_OVERHEAD * totalParamsB * (MODEL_QUANT_BITS / 8);
  const minGpuCount = Math.max(1, Math.ceil(modelMemoryGB / GPU_MEMORY_GB));
  // Cap at 16 GPUs max to avoid over-inflated estimates for frontier models
  return Math.min(16, 2 ** Math.ceil(Math.log2(minGpuCount)));
}

function gpuEnergyPerOutputTokenWh(activeParamsB, batchSize = BATCH_SIZE_DEFAULT) {
  return (LLM_ENERGY_ALPHA * Math.exp(LLM_ENERGY_BETA * batchSize) * activeParamsB) + LLM_ENERGY_GAMMA;
}

function generationLatencySeconds(outputTokens, activeParamsB, batchSize = BATCH_SIZE_DEFAULT) {
  const perToken = (LLM_LAT_ALPHA * activeParamsB) + (LLM_LAT_BETA * batchSize) + LLM_LAT_GAMMA;
  return Math.max(1, outputTokens) * perToken;
}

function estimateRequestITEnergy(outputTokens, modelStr) {
  const profile = modelProfile(modelStr);
  const gpuRequired = estimateGpuCount(modelStr);

  const eGpuPerTokenWh = gpuEnergyPerOutputTokenWh(profile.activeParamsB);
  const eGpuKwh = (Math.max(1, outputTokens) * eGpuPerTokenWh * gpuRequired) / 1000;

  const inferenceSeconds = generationLatencySeconds(outputTokens, profile.activeParamsB);
  const eServerNoGpuKwh =
    (inferenceSeconds / 3600) * SERVER_POWER_NO_GPU_KW *
    (gpuRequired / GPU_INSTALLED_PER_SERVER) * (1 / BATCH_SIZE_DEFAULT);

  return {
    energyITKwh: eGpuKwh + eServerNoGpuKwh,
    inferenceSeconds,
    gpuRequired,
  };
}

function embodiedCo2ForRequest(inferenceSeconds, modelStr, gpuRequiredHint) {
  const gpuRequired = gpuRequiredHint || estimateGpuCount(modelStr);
  const serverEmbodied =
    (gpuRequired / GPU_INSTALLED_PER_SERVER) * SERVER_EMBODIED_CO2_G +
    gpuRequired * GPU_EMBODIED_CO2_G;
  return (inferenceSeconds / (BATCH_SIZE_DEFAULT * HW_LIFETIME_SECONDS)) * serverEmbodied;
}

function canonicalModelName(modelStr) {
  const raw = (modelStr || '').toLowerCase();
  const norm = raw.replace(/[_\s]+/g, '-');
  if (!raw) return 'unknown';

  if (norm.includes('gpt-4o-mini')) return 'gpt-4o-mini';
  if (norm.includes('gpt-4o')) return 'gpt-4o';
  if (norm.includes('gpt-4.1-mini') || norm.includes('gpt-4-1-mini')) return 'gpt-4.1-mini';
  if (norm.includes('gpt-4.1') || norm.includes('gpt-4-1')) return 'gpt-4.1';
  if (norm.includes('gpt-4-turbo')) return 'gpt-4-turbo';
  if (norm.includes('gpt-4')) return 'gpt-4';
  if (norm.includes('gpt-3.5-turbo') || norm.includes('gpt-35-turbo')) return 'gpt-3.5-turbo';
  if (norm.includes('gpt-3.5') || norm.includes('gpt-35')) return 'gpt-3.5';
  if (norm.includes('o3-mini')) return 'o3-mini';
  if (norm.includes('o1-mini')) return 'o1-mini';
  if (norm.includes('o1')) return 'o1';
  if (norm.includes('o3')) return 'o3';

  if (norm.includes('claude-opus') || norm.includes('claude-3-opus')) return 'claude-opus';
  if (norm.includes('claude-3.7-sonnet') || norm.includes('claude-3-7-sonnet')) return 'claude-3.7-sonnet';
  if (norm.includes('claude-4-sonnet')) return 'claude-4-sonnet';
  if (norm.includes('claude-sonnet') || norm.includes('claude-3.5-sonnet') || norm.includes('claude-3-5-sonnet') || norm.includes('claude-3-sonnet')) return 'claude-sonnet';
  if (norm.includes('claude-haiku') || norm.includes('claude-3-haiku')) return 'claude-haiku';

  if (norm.includes('gemini-2.5-pro')) return 'gemini-2.5-pro';
  if (norm.includes('gemini-2.5-flash')) return 'gemini-2.5-flash';
  if (norm.includes('gemini-2.0-flash')) return 'gemini-2.0-flash';
  if (norm.includes('gemini-1.5-pro')) return 'gemini-1.5-pro';
  if (norm.includes('gemini-1.5-flash')) return 'gemini-1.5-flash';
  if (norm.includes('gemini-pro')) return 'gemini-pro';
  if (norm.includes('gemini-flash')) return 'gemini-flash';

  if (norm.includes('deepseek-r1')) return 'deepseek-r1';
  if (norm.includes('deepseek-v3')) return 'deepseek-v3';
  if (norm.includes('deepseek')) return 'deepseek';

  if (norm.includes('llama-3.1-70b')) return 'llama-3.1-70b';
  if (norm.includes('llama-3.1-8b')) return 'llama-3.1-8b';
  if (norm.includes('llama-3-70b')) return 'llama-3-70b';
  if (norm.includes('llama-3-8b')) return 'llama-3-8b';
  if (norm.includes('mixtral-8x22b')) return 'mixtral-8x22b';
  if (norm.includes('mixtral-8x7b')) return 'mixtral-8x7b';
  if (norm.includes('mistral-large')) return 'mistral-large';
  if (norm.includes('qwen-2.5-72b')) return 'qwen-2.5-72b';
  if (norm.includes('qwen-2.5-7b')) return 'qwen-2.5-7b';
  if (norm.includes('command-r-plus')) return 'command-r-plus';
  if (norm.includes('command-r')) return 'command-r';
  if (norm.includes('sonar-pro')) return 'sonar-pro';
  if (norm.includes('sonar')) return 'sonar';

  return norm.slice(0, 40);
}

// Platform-level infra assumptions (EcoLogits-style provider mapping)
// WUE values below are on-site data-center water usage estimates (L/kWh IT),
// while WATER_PER_KWH is used as off-site electricity water factor proxy.
const PLATFORM_INFRA = {
  chatgpt:    { pue: 1.20, wueOnSite: 0.569 }, // OpenAI on Azure
  copilot:    { pue: 1.20, wueOnSite: 0.569 }, // Microsoft stack
  claude:     { pue: 1.12, wueOnSite: 0.56  }, // midpoint of Anthropic ranges
  gemini:     { pue: 1.09, wueOnSite: 0.99  }, // Google
  deepseek:   { pue: 1.20, wueOnSite: 0.569 }, // fallback (provider public data limited)
  perplexity: { pue: 1.20, wueOnSite: 0.569 }, // fallback
  poe:        { pue: 1.20, wueOnSite: 0.569 }, // fallback
  other:      { pue: PUE,  wueOnSite: 0.569 },
};

function infraForPlatform(platform) {
  return PLATFORM_INFRA[platform] || PLATFORM_INFRA.other;
}

// ============ BEHAVIOR PROFILE ============
// Persists across sessions to build personalized recommendations over time.
// hourlyUsage[0..23]: prompt counts per hour of day (lifetime)
// topPlatforms: { chatgpt: N, claude: N, ... } lifetime call counts
// peakHour: hour with most prompts
// totalSessions: number of days with any AI usage
// sessionCO2Total: accumulates CO2 across all tabs in current browser session (resets on browser restart)
// sessionCallsTotal: accumulates prompt count across all tabs in current browser session
const FRESH_PROFILE = () => ({
  hourlyUsage: new Array(24).fill(0),  // lifetime calls by hour
  topPlatforms: {},                    // lifetime calls by platform
  totalSessions: 0,                    // days with ≥1 AI call
  totalPrompts: 0,                     // lifetime prompt count
  totalTokens: 0,                      // lifetime token count
  sessionCO2Total: 0,                  // browser session total (resets on restart)
  sessionCallsTotal: 0,                // browser session call count
});

let behaviorProfile = FRESH_PROFILE();

// ============ INITIALIZATION ============
// Fix: guard against race condition where a message arrives before
// chrome.storage.local.get resolves, which would use/overwrite empty state.
let todayData     = null;
let weeklyHistory = [];   // array of up to 7 past days, newest first
let initResolve;
const initDone = new Promise(resolve => { initResolve = resolve; });

// Reload content scripts in all tabs when extension is installed/updated
// so old tabs don't keep using invalidated extension context
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {}); // ignore errors for protected pages
      }
    });
  });
});

chrome.storage.local.get(['todayData', 'weeklyHistory', 'behaviorProfile'], (result) => {
  // Merge saved profile with FRESH_PROFILE to ensure all fields exist (backwards compatibility)
  if (result.behaviorProfile) {
    behaviorProfile = { ...FRESH_PROFILE(), ...result.behaviorProfile };
  }
  console.log('🌱 Carbon Compass: Loading saved data...');
  console.log('🌱 Session totals: ', behaviorProfile.sessionCallsTotal, 'calls,', behaviorProfile.sessionCO2Total?.toFixed(3), 'g CO₂');

  const now = new Date();

  // ---- Restore weekly history ----
  if (Array.isArray(result.weeklyHistory)) {
    weeklyHistory = result.weeklyHistory;
  }

  // ---- Restore or initialise today's data ----
  if (result.todayData) {
    const saved    = result.todayData;
    const lastDate = new Date(saved.lastUpdated);
    const sameDay  = (
      lastDate.getDate()     === now.getDate()     &&
      lastDate.getMonth()    === now.getMonth()    &&
      lastDate.getFullYear() === now.getFullYear()
    );

    if (sameDay) {
      todayData = saved;
      console.log(`🌱 Loaded — AI:${todayData.aiCalls} calls, ${todayData.aiCO2?.toFixed(3)}g AI CO₂`);
    } else {
      // New day: archive yesterday before resetting
      archiveDay(saved);
      todayData = freshData(now);
      saveAll();
      console.log('🌱 New day — archived yesterday, starting fresh');
    }
  } else {
    todayData = freshData(now);
    saveAll();
    console.log('🌱 Starting fresh');
  }

  initResolve();
});

function freshData(date) {
  return {
    co2: 0, water: 0, aiCalls: 0,
    aiCO2: 0, aiTokens: 0,          // AI totals
    aiEnergyKwh: 0,                 // request energy incl. PUE
    aiEnergyITKwh: 0,               // server IT energy before PUE
    aiWaterOnSite: 0,               // WUE on-site component (L)
    aiWaterOffSite: 0,              // WUE off-site component (L)
    aiEmbodiedInferenceSec: 0,      // embodied allocation basis
    aiUsageCO2: 0,                   // usage-phase CO₂ (electricity)
    aiEmbodiedCO2: 0,                // embodied CO₂ (hardware manufacturing)
    promptTokens: 0,                 // tokens sent TO model (prompt + history)
    completionTokens: 0,             // tokens received FROM model (response)
    platformStats: {},               // { chatgpt: {calls,co2,tokens,promptTokens,completionTokens}, ... }
    modelStats: {},                  // { modelKey: {calls,co2,tokens,platform} }
    lastUpdated: (date || new Date()).toISOString()
  };
}

function archiveDay(data) {
  // Prepend yesterday to history, keep only 7 days
  weeklyHistory.unshift({ ...data });
  if (weeklyHistory.length > 7) weeklyHistory = weeklyHistory.slice(0, 7);
}

function saveAll() {
  chrome.storage.local.set({ todayData, weeklyHistory, behaviorProfile });
}

// ============ MESSAGE HANDLERS ============
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Always wait for storage to finish loading before handling messages
  initDone.then(() => {
    console.log('🌱 Carbon Compass: Received:', message.type);

    if (message.type === 'AI_USAGE') {
      // Prefer real token count from API interception; fall back to textarea estimate
      const tokens   = message.tokens ?? estimateTokens(message.prompt);
      const model    = message.model    || 'default';
      const platform = message.platform || 'other';
      
      console.log('🔍 TOKEN DEBUG:', {
        platform,
        model,
        promptLength: message.prompt?.length || 0,
        promptPreview: message.prompt?.substring(0, 50) || '(no prompt)',
        providedTokens: message.tokens,
        providedPromptTokens: message.promptTokens,
        providedCompletionTokens: message.completionTokens,
        estimatedTotal: tokens
      });
      
      // If API intercept provided token breakdown, use it; otherwise estimate from prompt
      let pTok = message.promptTokens || 0;
      let cTok = message.completionTokens || 0;
      
      // If neither was provided (fallback path), estimate from prompt and assume average completion
      if (pTok === 0 && cTok === 0) {
        if (message.prompt) {
          pTok = estimateTokens(message.prompt);
          cTok = message.tokens ? Math.max(0, tokens - pTok) : Math.round(pTok * 3);
          console.log('🔍 TOKEN ESTIMATION PATH 1 (from prompt):', { pTok, cTok, total: pTok + cTok });
        } else if (tokens > 0) {
          pTok = Math.round(tokens * 0.25);
          cTok = tokens - pTok;
          console.log('🔍 TOKEN ESTIMATION PATH 2 (split total):', { pTok, cTok, total: tokens });
        }
      } else {
        console.log('🔍 TOKEN FROM API INTERCEPT:', { pTok, cTok, total: pTok + cTok });
      }

      // ============ ECOLOGITS PARAMETRIC CALCULATION ============
      // Full methodology: https://ecologits.ai/latest/methodology/llm_inference/
      const profile = modelProfile(model);
      const infra = infraForPlatform(platform);
      const outputTokens = cTok || Math.round(tokens * 0.75);
      
      // GPU energy: f_E(P,B) = α·exp(β·B)·P + γ (Wh per token)
      const eGpuPerToken = gpuEnergyPerOutputTokenWh(profile.activeParamsB, BATCH_SIZE_DEFAULT);
      const gpuCount = estimateGpuCount(model);
      const eGpuKwh = (outputTokens * eGpuPerToken * gpuCount) / 1000;
      
      // Generation latency (seconds)
      const deltaT = generationLatencySeconds(outputTokens, profile.activeParamsB, BATCH_SIZE_DEFAULT);
      
      // Server energy without GPU (kWh)
      const eServerNoGpu = (deltaT / 3600) * SERVER_POWER_NO_GPU_KW * 
        (gpuCount / GPU_INSTALLED_PER_SERVER) * (1 / BATCH_SIZE_DEFAULT);
      
      // Total IT energy (kWh)
      const eServer = eGpuKwh + eServerNoGpu;
      
      // Request energy with PUE (kWh)
      const eRequest = infra.pue * eServer;
      
      // Usage-phase GWP (gCO2eq)
      const gwpUsage = eRequest * CARBON_INTENSITY;
      
      // Embodied-phase GWP (gCO2eq)
      const serverEmbodied = (gpuCount / GPU_INSTALLED_PER_SERVER) * SERVER_EMBODIED_CO2_G + 
        gpuCount * GPU_EMBODIED_CO2_G;
      const gwpEmbodied = (deltaT / (BATCH_SIZE_DEFAULT * HW_LIFETIME_SECONDS)) * serverEmbodied;
      
      // Total CO2
      const totalCO2 = gwpUsage + gwpEmbodied;
      
      // Water consumption (L) = E_server × (WUE_onsite + PUE × WUE_offsite)
      const water = eServer * (infra.wueOnSite + infra.pue * WATER_PER_KWH);
      
      // Source indicator for transparency
      const source = 'ecologits-parametric';

      todayData.aiCalls++;
      todayData.co2              += totalCO2;
      todayData.water            += water;
      todayData.aiCO2             = (todayData.aiCO2             || 0) + totalCO2;
      todayData.aiUsageCO2        = (todayData.aiUsageCO2        || 0) + gwpUsage;
      todayData.aiEmbodiedCO2     = (todayData.aiEmbodiedCO2     || 0) + gwpEmbodied;
      todayData.aiTokens          = (todayData.aiTokens          || 0) + tokens;
      todayData.promptTokens      = (todayData.promptTokens      || 0) + pTok;
      todayData.completionTokens  = (todayData.completionTokens  || 0) + cTok;
      todayData.energyKwh         = (todayData.energyKwh         || 0) + eRequest;

      // Accumulate per-platform stats
      if (!todayData.platformStats) todayData.platformStats = {};
      const ps = todayData.platformStats[platform] || { calls: 0, co2: 0, tokens: 0, promptTokens: 0, completionTokens: 0, energy: 0 };
      ps.calls++;
      ps.co2              += totalCO2;
      ps.tokens           += tokens;
      ps.promptTokens     += pTok;
      ps.completionTokens += cTok;
      ps.energy           = (ps.energy || 0) + eRequest;
      todayData.platformStats[platform] = ps;

      // Accumulate per-model stats (for top-model dashboard)
      if (!todayData.modelStats) todayData.modelStats = {};
      const modelKey = canonicalModelName(model);
      const ms = todayData.modelStats[modelKey] || { calls: 0, co2: 0, tokens: 0, platform, energy: 0 };
      ms.calls++;
      ms.co2 += totalCO2;
      ms.tokens += tokens;
      ms.platform = platform;
      ms.energy = (ms.energy || 0) + eRequest;
      todayData.modelStats[modelKey] = ms;

      // ── Update behavior profile (including browser session totals) ──
      const hour = new Date().getHours();
      if (!behaviorProfile.hourlyUsage) behaviorProfile = FRESH_PROFILE();
      behaviorProfile.hourlyUsage[hour] = (behaviorProfile.hourlyUsage[hour] || 0) + 1;
      behaviorProfile.topPlatforms[platform] = (behaviorProfile.topPlatforms[platform] || 0) + 1;
      behaviorProfile.totalPrompts = (behaviorProfile.totalPrompts || 0) + 1;
      behaviorProfile.totalTokens  = (behaviorProfile.totalTokens  || 0) + tokens;
      
      // Browser session accumulator (resets on browser restart, not on tab close)
      const oldSessionCO2 = behaviorProfile.sessionCO2Total || 0;
      const oldSessionCalls = behaviorProfile.sessionCallsTotal || 0;
      behaviorProfile.sessionCO2Total = oldSessionCO2 + totalCO2;
      behaviorProfile.sessionCallsTotal = oldSessionCalls + 1;

      saveAll();

      console.log(`🌱 AI[${platform}/${model}]: +${tokens}tok (↑${pTok} ↓${cTok}) → ${totalCO2.toFixed(4)}g CO₂ (usage:${gwpUsage.toFixed(4)}g + embodied:${gwpEmbodied.toFixed(4)}g) | ${eRequest.toFixed(6)}kWh | source:${source}`);
      sendResponse({ 
        co2: totalCO2, 
        water, 
        energy: eRequest,
        tokens, 
        promptTokens: pTok, 
        completionTokens: cTok, 
        model: modelKey, 
        modelResolved: `${platform}/${modelKey}`,
        platform,
        source,
        usage: { gwp: gwpUsage, energy: eRequest },
        embodied: { gwp: gwpEmbodied },
        sessionCO2: behaviorProfile.sessionCO2Total,
        sessionCalls: behaviorProfile.sessionCallsTotal
      });
    }

    else if (message.type === 'GET_TODAY') {
      sendResponse(todayData);
    }

    else if (message.type === 'GET_BEHAVIOR') {
      sendResponse(behaviorProfile);
    }

    else if (message.type === 'GET_HISTORY') {
      // Return today + last 7 archived days for the dashboard charts
      sendResponse({ today: todayData, history: weeklyHistory });
    }

    else if (message.type === 'RESET_DAY') {
      todayData = freshData();
      saveAll();
      console.log('🌱 Carbon Compass: Data reset');
      sendResponse({ success: true });
    }
  });

  return true; // keep the channel open for async sendResponse
});

// ============ MIDNIGHT RESET VIA ALARMS ============
// Service workers are killed after ~30s of inactivity; setInterval is unreliable in MV3.
// chrome.alarms persists across service worker restarts — the correct approach.
chrome.alarms.create('midnightCheck', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'midnightCheck') return;

  initDone.then(() => {
    const now      = new Date();
    const lastDate = new Date(todayData.lastUpdated);
    const sameDay  = (
      lastDate.getDate()     === now.getDate()     &&
      lastDate.getMonth()    === now.getMonth()    &&
      lastDate.getFullYear() === now.getFullYear()
    );

    if (!sameDay) {
      console.log('🌱 Carbon Compass: Midnight alarm — archiving and resetting');
      if (todayData.aiCalls > 0) {
        behaviorProfile.totalSessions = (behaviorProfile.totalSessions || 0) + 1;
      }
      archiveDay(todayData);
      todayData = freshData(now);
      saveAll();
    }
  });
});

// ============ HELPERS ============
function estimateTokens(text) {
  if (!text) return 0;
  // ~4 characters per token — standard industry approximation (OpenAI tokenizer research)
  const tokens = Math.ceil(text.length / 4);
  console.log(`🔍 estimateTokens: ${text.length} chars → ${tokens} tokens (preview: "${text.substring(0, 30)}...")`);
  return tokens;
}

console.log('🌱 Carbon Compass: Background service worker ready');
