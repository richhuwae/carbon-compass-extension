// ============ CARBON COMPASS — SLM WORKER ============
// Model: Xenova/flan-t5-small (80M parameters, Apache 2.0)
// Runtime: local ONNX via Transformers.js + ORT wasm files bundled in extension.
// This avoids the deprecated Hugging Face API endpoint and keeps SLM generation
// functional without requiring external inference provider credentials.

const MODEL = {
  id: 'Xenova/flan-t5-small',
  label: 'Flan-T5-small',
  params: '80M',
  license: 'Apache 2.0',
};

const ORT_WASM_FILES = [
  'ort-wasm.wasm',
  'ort-wasm-simd.wasm',
  'ort-wasm-threaded.wasm',
  'ort-wasm-simd-threaded.wasm',
];

// ============ INFERENCE BENCHMARK CONSTANTS ============
const CPU_WATTS = 1.5;
const CARBON_INTENSITY = 590.4; // gCO2eq/kWh — EcoLogits World Mix
const WATT_TO_KWH = 1 / 1_000 / 3_600;

let generator = null;
let initPromise = null;

// ── Behavior-aware tip library (fallback when model generation fails) ──
const TIPS = {
  too_many_calls: [
    'High call count. Use RISEN: Role + Instructions + Steps + End goal + Narrowing to reduce back-and-forth.',
    'Chain related questions in one prompt to reduce round-trips and lower carbon cost.',
  ],
  high_tokens: [
    'Long context detected. Reuse one shared context block instead of repeating long references each prompt.',
    'Summarize your thread every few turns and continue from the summary to reduce token growth.',
  ],
  frontier_overuse: [
    'Use smaller models for drafting and formatting; reserve frontier models for complex reasoning only.',
    'Route simple tasks to efficient models and keep premium models for hard reasoning to cut emissions.',
  ],
  efficient: [
    'Great efficiency. Add explicit output format constraints to avoid verbose responses and extra follow-ups.',
    'Low footprint today. Use one-shot examples to get the right format in a single response.',
  ],
  needs_prompting: [
    'Use COSTAR: Context, Objective, Style, Tone, Audience, Response format for fewer retries.',
    'End prompts with concise output constraints to reduce unnecessary token-heavy responses.',
  ],
};

function postProgress(message) {
  self.postMessage({ type: 'progress', message });
}

function getBehaviorLabel(profile, todayData) {
  const calls = todayData?.aiCalls || 0;
  const avgTok = calls > 0 ? (todayData?.aiTokens || 0) / calls : 0;
  const topPlat = Object.entries(profile?.topPlatforms || {})
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  if (calls > 20) return 'too_many_calls';
  if (avgTok > 2000) return 'high_tokens';
  if ((topPlat === 'chatgpt' || topPlat === 'claude') && calls > 10) return 'frontier_overuse';
  if (calls <= 5 && avgTok < 500) return 'efficient';
  return 'needs_prompting';
}

function buildPrompt(profile, todayData) {
  const calls = todayData?.aiCalls || 0;
  const tokens = todayData?.aiTokens || 0;
  const avgTok = calls > 0 ? Math.round(tokens / calls) : 0;
  const platform = Object.entries(profile?.topPlatforms || {})
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'AI';

  // Behavior-based prompt templates (constrained for T5)
  if (calls > 15) {
    return `Complete: To reduce ${calls} daily AI prompts, batch related questions and`;
  }
  if (avgTok > 1500) {
    return `Complete: To reduce ${avgTok} average tokens per prompt, summarize context and`;
  }
  if (platform === 'chatgpt' && calls > 5) {
    return `Complete: To lower ChatGPT carbon footprint with ${calls} prompts, use smaller models for`;
  }
  if (calls <= 3) {
    return `Complete: Great low AI usage today. To stay efficient, always end prompts with`;
  }
  // Default
  return `Complete: To reduce AI carbon footprint with ${calls} prompts averaging ${avgTok} tokens, try`;
}

function normalizeTip(rawOutput) {
  const raw = (rawOutput || '').trim();
  if (!raw || raw.length < 8) return '';
  const cleaned = raw.replace(/^(tip:|answer:|output:)\s*/i, '').trim();
  // Filter obvious gibberish — must contain at least one sustainability keyword
  const keywords = ['prompt', 'ai', 'carbon', 'token', 'model', 'query', 'reduce', 'save', 'efficient', 'footprint', 'batch', 'context', 'format'];
  const hasKeyword = keywords.some(k => cleaned.toLowerCase().includes(k));
  const gibberishPatterns = ['hoop', 'eagle', 'hazard', 'basketball', 'soccer'];
  const hasGibberish = gibberishPatterns.some(g => cleaned.toLowerCase().includes(g));
  if (!hasKeyword || hasGibberish) return '';
  // Detect repetition (e.g., "use a lot of time, use a lot of time")
  const words = cleaned.toLowerCase().split(/\s+/);
  const trigrams = [];
  for (let i = 0; i < words.length - 2; i++) {
    trigrams.push(words.slice(i, i + 3).join(' '));
  }
  const uniqueTrigrams = new Set(trigrams);
  if (trigrams.length > 3 && uniqueTrigrams.size < trigrams.length * 0.6) return ''; // >40% repetition
  return cleaned;
}

function configureRuntime(env) {
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;

  const base = self.location.origin.endsWith('/') ? self.location.origin : `${self.location.origin}/`;
  const wasmPaths = {};
  ORT_WASM_FILES.forEach((file) => {
    wasmPaths[file] = `${base}${file}`;
  });

  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = wasmPaths;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.simd = false;
    env.backends.onnx.wasm.proxy = false;
  }
}

async function ensureModelReady() {
  if (generator) return generator;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      postProgress('Loading local SLM runtime...');
      
      // Prevent Node.js module loading in browser context
      self.process = self.process || {};
      self.process.env = self.process.env || {};
      self.process.env.NODE_ENV = 'production';
      self.global = self;
      
      let pipeline, env;
      
      // Try dynamic import of local ESM bundle (works in Chrome 91+ workers)
      try {
        const transformersUrl = new URL('transformers.min.js', self.location.origin).href;
        const transformers = await import(transformersUrl);
        pipeline = transformers.pipeline;
        env = transformers.env;
        postProgress('ESM loaded successfully');
      } catch (esmError) {
        // If dynamic import fails (older Chrome or CSP), fall back to rule-based tips
        console.warn('🌱 SLM: ESM import failed:', esmError.message);
        throw new Error(`ESM import not supported: ${esmError.message}. Using rule-based tips.`);
      }
      
      if (!pipeline || !env) {
        throw new Error('Transformers runtime unavailable. Run setup.sh then reload extension.');
      }

      configureRuntime(env);

      postProgress('Loading model weights (first run may take ~60s)...');

      generator = await pipeline('text2text-generation', MODEL.id, {
        quantized: true,
        progress_callback: (p) => {
          if (typeof p?.progress === 'number') {
            const pct = Math.round(p.progress);
            postProgress(`SLM download ${pct}%`);
            return;
          }
          if (p?.status) {
            postProgress(`SLM ${p.status}...`);
          }
        },
      });

      self.postMessage({
        type: 'ready',
        source: 'local',
        modelId: MODEL.id,
        modelLabel: MODEL.label,
        params: MODEL.params,
        license: MODEL.license,
      });

      return generator;
    } catch (error) {
      generator = null;
      throw error;
    } finally {
      if (!generator) initPromise = null;
    }
  })();

  return initPromise;
}

async function generate(profile, todayData) {
  const startMs = Date.now();
  let tipText = '';
  let source = 'local';

  try {
    const textGenerator = await ensureModelReady();
    const output = await textGenerator(buildPrompt(profile, todayData), {
      max_new_tokens: 30,      // Shorter, more focused completions
      temperature: 0.5,        // Lower = more deterministic/focused
      do_sample: true,
      top_p: 0.9,              // Nucleus sampling for coherence
    });
    const generated = Array.isArray(output) ? output?.[0]?.generated_text : output?.generated_text;
    tipText = normalizeTip(generated);
    if (!tipText) {
      throw new Error('SLM returned empty response');
    }
  } catch (error) {
    source = 'fallback';
    const label = getBehaviorLabel(profile, todayData);
    const pool = TIPS[label] || TIPS.needs_prompting;
    tipText = pool[Math.floor(Math.random() * pool.length)];
    self.postMessage({
      type: 'error',
      error: `SLM fallback: ${error?.message || String(error)}`,
    });
  }

  const inferenceMs = Date.now() - startMs;
  const energyKwh = CPU_WATTS * (inferenceMs / 1000) * WATT_TO_KWH;
  const co2g = energyKwh * CARBON_INTENSITY;

  self.postMessage({
    type: 'result',
    text: tipText,
    inferenceMs: Math.round(inferenceMs),
    co2g: co2g.toFixed(6),
    source,
    modelId: MODEL.id,
    modelLabel: MODEL.label,
    params: MODEL.params,
    license: MODEL.license,
  });
}

// ============ MESSAGE HANDLER ============
self.addEventListener('message', (e) => {
  if (e.data.type === 'init') {
    ensureModelReady().catch((error) => {
      self.postMessage({
        type: 'error',
        error: `SLM init failed: ${error?.message || String(error)}`,
      });
    });
    return;
  }

  if (e.data.type === 'generate') {
    generate(e.data.profile, e.data.todayData);
  }
});
