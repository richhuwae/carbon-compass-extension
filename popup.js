// ============ CARBON ANALOGY CONSTANTS (EcoLogits) ============
// All constants from EcoLogits Calculator https://huggingface.co/spaces/genai-impact/ecologits-calculator
const CARBON_INTENSITY     = 590.4;  // gCO₂eq/kWh — EcoLogits World Mix (ADEME)
const WALKING_KJ_PER_KM    = 196;    // kJ/km, 70kg person @ 3km/h
const EV_KWH_PER_KM        = 0.17;   // kWh/km avg EV (selectra.info/tesla.com)
const STREAMING_H_PER_KGCO2 = 15.6;  // 1 kgCO₂eq = 15.6 h streaming (impactco2.fr)
const TREES_KG_PER_YEAR    = 21.77;  // kgCO₂/tree/year (US Forest Service)

// Daily AI CO₂ limit (grams). Calibrated for faster behavioral feedback.
const AI_DAILY_LIMIT_G = 1;

// Platform display labels, colours, and logo paths
const PLATFORM_META = {
  chatgpt: { 
    label: 'ChatGPT', 
    color: '#74c69d',
    logo: 'logos/icons8-chatgpt-50.png'
  },
  claude: { 
    label: 'Claude', 
    color: '#a8dadc',
    logo: 'logos/icons8-claude-48.png'
  },
  gemini: { 
    label: 'Gemini', 
    color: '#ffd166',
    logo: 'logos/icons8-gemini-ai-48.png'
  },
  deepseek: { 
    label: 'DeepSeek', 
    color: '#81b0ff',
    logo: 'logos/deepseek-logo-icon.png',
    logoScale: 0.82
  },
  perplexity: { 
    label: 'Perplexity', 
    color: '#c77dff',
    logo: 'logos/icons8-perplexité-ai-50.png'
  },
  copilot: { 
    label: 'Copilot', 
    color: '#90e0ef',
    logo: 'logos/icons8-microsoft-copilote-48.png'
  },
  poe: { 
    label: 'Poe', 
    color: '#ffb347',
    logo: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI2IiBmaWxsPSIjZmZiMzQ3Ii8+PHBhdGggZD0iTTYgOEMNiA2LjkgNi45IDYgOCA2SDIwQzIxLjEgNiAyMiA2LjkgMjIgOFYxNkMyMiAxNy4xIDIxLjEgMTggMjAgMThIMTJMNiAyMlY4WiIgZmlsbD0id2hpdGUiLz48L3N2Zz4='
  },
  other: { 
    label: 'Other', 
    color: '#adb5bd',
    logo: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI2IiBmaWxsPSIjYWRiNWJkIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iNyIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIi8+PGxpbmUgeDE9IjEyIiB5MT0iNSIgeDI9IjEyIiB5Mj0iMTkiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjxwYXRoIGQ9Ik01IDEySDE5IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4='
  },
};

// ============ SLM WORKER ============
// Xenova/flan-t5-small runs entirely in-browser via ONNX/Transformers.js.
// The worker is spawned once per popup session; the model stays cached in the browser.
let slmWorker = null;
let slmReady  = false;
let slmInitWatchdog = null;
let slmState = 'idle';
let slmGenerating = false;
let pendingSLMData = null;
const SLM_INIT_TIMEOUT_MS = 90000;

function showRuleFallbackTip(data) {
  if (data) {
    setSlmTip(getRuleTip(data));
    return;
  }
  setSlmTip('Using rule-based sustainability tips while the SLM is unavailable.');
}

function enterRuleFallbackState(data = window._latestData) {
  slmState = 'fallback';
  slmReady = false;
  slmGenerating = false;
  pendingSLMData = null;
  if (slmInitWatchdog) { clearTimeout(slmInitWatchdog); slmInitWatchdog = null; }
  setSlmStatus('Rule-based fallback');
  const costEl = document.getElementById('slmCost');
  if (costEl) costEl.style.display = 'none';
  showRuleFallbackTip(data);
}

function initSLMWorker() {
  try {
    slmWorker = new Worker(chrome.runtime.getURL('slm-worker.js'));
    slmState = 'loading';
    slmReady = false;
    slmGenerating = false;
    pendingSLMData = null;
    setSlmStatus('Loading…');
    setSlmTip('<span class="spinner"></span> Starting SLM worker…');

    slmWorker.onmessage = (e) => {
      const { type, text, inferenceMs, co2g, error, source, modelId, params, license } = e.data;

      if (type === 'progress') {
        if (slmState === 'fallback') return;
        const msg = e.data.message || 'Loading SLM…';
        setSlmStatus('Loading…');
        setSlmTip(`<span class="spinner"></span> ${msg}`);
      }

      else if (type === 'ready') {
        slmState = 'ready';
        slmReady = true;
        if (slmInitWatchdog) { clearTimeout(slmInitWatchdog); slmInitWatchdog = null; }
        const readyModel = modelId || 'Xenova/flan-t5-small';
        setSlmStatus(`${readyModel} ready`);
        if (window._latestData) {
          setSlmTip('<span class="spinner"></span> Generating personalised tip…');
          requestSLMTip(window._latestData);
        }
      }

      else if (type === 'result') {
        slmGenerating = false;
        const isLocal = source === 'local';
        slmState = isLocal ? 'ready' : 'fallback';
        const sourceLabel = isLocal ? 'SLM local' : 'Rule-based fallback';
        setSlmStatus(sourceLabel);
        setSlmTip(text);
        if (isLocal && inferenceMs !== undefined) {
          const costEl = document.getElementById('slmCost');
          if (costEl) {
            costEl.style.display = 'block';
            const modelLabel = modelId || 'Xenova/flan-t5-small';
            const modelParams = params || '80M';
            const modelLicense = license || 'Apache 2.0';
            costEl.textContent =
              `🔬 SLM inference: ${inferenceMs}ms · ~${co2g}g CO₂ · `
              + `${modelLabel} (${modelParams} params, ${modelLicense})`;
          }
        } else {
          const costEl = document.getElementById('slmCost');
          if (costEl) costEl.style.display = 'none';
        }

        if (pendingSLMData && slmReady && slmState !== 'fallback') {
          const queued = pendingSLMData;
          pendingSLMData = null;
          requestSLMTip(queued);
        }
      }

      else if (type === 'error') {
        slmGenerating = false;
        console.warn('🌱 SLM error:', error);
        enterRuleFallbackState(window._latestData);
      }
    };

    slmWorker.onerror = () => {
      enterRuleFallbackState(window._latestData);
    };

    // Explicit init handshake + watchdog fallback avoids indefinite "loading" state
    slmWorker.postMessage({ type: 'init' });
    slmInitWatchdog = setTimeout(() => {
      if (!slmReady) {
        enterRuleFallbackState(window._latestData);
      }
    }, SLM_INIT_TIMEOUT_MS);

  } catch (e) {
    // transformers.min.js not yet downloaded — show rule-based tip
    console.log('🌱 SLM worker failed to start:', e.message);
    enterRuleFallbackState(window._latestData);
  }
}

let _behaviorProfile = null;

function requestSLMTip(data) {
  if (!slmWorker || !slmReady || !data) return;
  if (slmGenerating) {
    pendingSLMData = data;
    return;
  }
  slmGenerating = true;
  if (slmState !== 'fallback') {
    setSlmTip('<span class="spinner"></span> Generating personalised tip…');
  }
  slmWorker.postMessage({ type: 'generate', profile: _behaviorProfile, todayData: data });
}

// ============ BEHAVIOR SUMMARY ============
// Builds a natural-language profile from stored behavior data for the SLM prompt.
function buildBehaviorSummary(profile) {
  if (!profile) return '';
  const hourly = profile.hourlyUsage || [];
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const peakLabel = peakHour < 12
    ? `${peakHour === 0 ? 12 : peakHour}am`
    : `${peakHour === 12 ? 12 : peakHour - 12}pm`;

  const topPlatEntries = Object.entries(profile.topPlatforms || {}).sort((a,b) => b[1]-a[1]);
  const topPlat = topPlatEntries[0]?.[0] || '';

  const parts = [];
  if (profile.totalPrompts > 0) parts.push(`${profile.totalPrompts} lifetime prompts`);
  if (peakHour >= 0 && Math.max(...hourly) > 0) parts.push(`peak usage at ${peakLabel}`);
  if (topPlat) parts.push(`mostly uses ${topPlat}`);
  if (profile.totalSessions > 0) parts.push(`${profile.totalSessions} active days tracked`);
  return parts.join(', ');
}

function buildPrompt(data, profile) {
  const tokens  = data.aiTokens || 0;
  const aiCO2   = (data.aiCO2  || 0).toFixed(3);
  const bhvr    = buildBehaviorSummary(profile);
  const context = bhvr ? ` User behaviour: ${bhvr}.` : '';
  return (
    `You are a sustainability coach.${context} ` +
    `Today: ${data.aiCalls} prompts, ${tokens} tokens, ${aiCO2}g CO2. ` +
    `Give one short, personalised, actionable tip to reduce AI carbon footprint (max 20 words):`
  );
}

// ============ DOM HELPERS ============
function setSlmTip(html) {
  const el = document.getElementById('slmTip');
  if (el) el.innerHTML = html;
}
function setSlmStatus(label) {
  const el = document.getElementById('slmStatus');
  if (el) el.textContent = label;
}
function setDebug(text) {
  const el = document.getElementById('debug');
  if (el) el.textContent = text;
}

// ============ MAIN ============
document.addEventListener('DOMContentLoaded', () => {
  console.log('🌱 Carbon Compass: Popup opened');

  initSLMWorker();
  loadData();

  document.getElementById('btnRefresh').addEventListener('click', () => {
    console.log('🌱 Carbon Compass: Manual refresh');
    loadData();
  });

  document.getElementById('btnDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });

  document.getElementById('btnReset').addEventListener('click', () => {
    if (!confirm("Reset today's carbon data? This cannot be undone.")) return;
    chrome.runtime.sendMessage({ type: 'RESET_DAY' }, () => {
      if (chrome.runtime.lastError) {
        setDebug('⚠️ Reset failed — try again.');
        return;
      }
      loadData();
    });
  });
});

// ============ DATA LOADING ============
function loadData() {
  setDebug('Loading…');

  chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (payload) => {
    if (chrome.runtime.lastError) {
      console.log('🌱 Runtime error:', chrome.runtime.lastError.message);
      setDebug('⚠️ Extension starting up — click Refresh in a moment.');
      return;
    }
    const data = payload?.today;
    const history = Array.isArray(payload?.history) ? payload.history : [];
    if (!data) {
      setDebug('⚠️ No data received — click Refresh.');
      return;
    }

    console.log('🌱 Data received:', data);
    renderData(data, history);
    window._latestData = data;

    // Fetch behavior profile for personalised SLM prompt
    chrome.runtime.sendMessage({ type: 'GET_BEHAVIOR' }, (profile) => {
      if (!chrome.runtime.lastError && profile) _behaviorProfile = profile;
      if (slmReady) requestSLMTip(data);
      else if (slmState === 'fallback' || !slmWorker) showRuleFallbackTip(data);
    });
  });
}

// ============ RENDER ============
function renderData(data, history = []) {
  const co2   = data.co2   ?? 0;
  const water = data.water ?? 0;

  // Use adaptive precision: show decimals when values are sub-gram/sub-litre
  document.getElementById('co2').textContent      = formatCO2(co2);
  document.getElementById('water').textContent    = `${formatWater(water)} water`;
  
  // Show usage + embodied breakdown (if AI usage exists)
  const usageCO2 = data.aiUsageCO2 || 0;
  const embodiedCO2 = data.aiEmbodiedCO2 || 0;
  const breakdownEl = document.getElementById('co2Breakdown');
  if (usageCO2 > 0 || embodiedCO2 > 0) {
    breakdownEl.textContent = `AI: ${formatCO2(usageCO2)} usage + ${formatCO2(embodiedCO2)} embodied`;
  } else {
    breakdownEl.textContent = '';
  }
  document.getElementById('aiCalls').textContent  = data.aiCalls ?? 0;
  // Total tokens — show sent/received split when available
  const totalTok = data.aiTokens || 0;
  const pTok = data.promptTokens || 0;
  const cTok = data.completionTokens || 0;
  const tokEl = document.getElementById('aiTokens');
  if (pTok > 0 || cTok > 0) {
    const fmt = n => n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);
    tokEl.textContent = `↑${fmt(pTok)} ↓${fmt(cTok)}`;
    tokEl.title = `Sent: ${pTok} tokens (prompt+history) | Received: ${cTok} tokens (response)`;
  } else {
    tokEl.textContent = totalTok >= 1000 ? `${(totalTok / 1000).toFixed(1)}K` : String(totalTok);
  }
  // Average CO₂ per prompt
  const calls = data.aiCalls || 0;
  const aiCO2 = data.aiCO2   || 0;
  document.getElementById('avgCO2').textContent   = calls > 0
    ? formatCO2(aiCO2 / calls) : '—';

  // Rolling weekly total even if fewer than 7 tracked days
  const rollingDays = [data, ...history].slice(0, 7);
  const trackedDays = Math.min(rollingDays.length, 7);
  const weeklyTotal = rollingDays.reduce((sum, day) => {
    const dayAi = day?.aiCO2;
    return sum + (typeof dayAi === 'number' ? dayAi : (day?.co2 || 0));
  }, 0);
  const weeklyEl = document.getElementById('weeklyTotal');
  const weekLabelEl = document.getElementById('weekLabel');
  if (weeklyEl) {
    weeklyEl.textContent = formatCO2(weeklyTotal);
    weeklyEl.title = `Rolling total across ${trackedDays} day${trackedDays === 1 ? '' : 's'}`;
  }
  if (weekLabelEl) {
    weekLabelEl.textContent = `${trackedDays}-Day Total`;
  }

  // Analogy: translate CO₂ into relatable comparison
  document.getElementById('analogy').textContent = buildAnalogy(co2, data.aiCO2 || 0);

  setDebug(
    `AI:${data.aiCalls} prompts | ` +
    `↑${data.promptTokens||0} ↓${data.completionTokens||0} tok | ` +
    `AI CO₂:${(data.aiCO2 || 0).toFixed(3)}g | ` +
    `H₂O:${water.toFixed(2)}L`
  );

  renderAILimit(data);
  renderPlatformBreakdown(data);
}

// ── Analogy builder (EcoLogits equivalences) ──
function buildAnalogy(totalCo2G, aiCo2G) {
  const energy_kwh = totalCo2G / CARBON_INTENSITY;
  const aiEnergy_kwh = aiCo2G / CARBON_INTENSITY;
  
  // Walking: energy_kWh × 3,600,000 ÷ 196
  const walking_m = aiEnergy_kwh * 3_600_000 / WALKING_KJ_PER_KM;
  
  // EV: energy_kWh ÷ 0.17
  const ev_m = aiEnergy_kwh / EV_KWH_PER_KM;
  
  // Streaming: GHG_kgCO₂eq × 15.6 × 3600
  const streaming_sec = (aiCo2G / 1000) * STREAMING_H_PER_KGCO2 * 3600;
  
  // Trees: CO₂ ÷ 21.77 kg/tree/year
  const trees = totalCo2G / (TREES_KG_PER_YEAR * 1000);
  
  if (walking_m >= 1000) return `≈ ${(walking_m / 1000).toFixed(1)} km walk`;
  if (walking_m >= 1) return `≈ ${walking_m.toFixed(0)} m walk`;
  if (ev_m >= 1000) return `≈ ${(ev_m / 1000).toFixed(1)} km in an EV`;
  if (ev_m >= 1) return `≈ ${ev_m.toFixed(0)} m in an EV`;
  if (streaming_sec >= 60) return `≈ ${(streaming_sec / 60).toFixed(1)} min streaming`;
  if (streaming_sec >= 1) return `≈ ${streaming_sec.toFixed(0)} sec streaming`;
  if (trees >= 0.001) return `≈ ${(trees * 1000).toFixed(1)} tree-millis/year`;
  return '~negligible carbon';
}

// ── Adaptive number formatting ──
function formatCO2(g) {
  if (g === 0)    return '0';
  if (g < 0.001)  return `${(g * 1000).toFixed(2)} mg`;   // micro-gram range → show mg
  if (g < 1)      return `${g.toFixed(3)} g`;              // sub-gram → 3 dp
  if (g < 10)     return `${g.toFixed(2)} g`;              // 1–10 g → 2 dp
  return `${Math.round(g)} g`;                             // 10+ g → whole number
}

function formatWater(L) {
  if (L === 0)   return '0 L';
  if (L < 0.001) return `${(L * 1000).toFixed(2)} mL`;
  if (L < 1)     return `${L.toFixed(3)} L`;
  return `${L.toFixed(1)} L`;
}

function formatMB(mb) {
  if (mb === 0)  return '0';
  if (mb < 1)    return `${(mb * 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

// ============ AI DAILY LIMIT BAR ============
function renderAILimit(data) {
  const aiCO2 = data.aiCO2 || 0;
  const pct   = Math.min((aiCO2 / AI_DAILY_LIMIT_G) * 100, 100);
  const visiblePct = aiCO2 > 0 ? Math.max(pct, 2) : 0; // keep tiny usage visible

  const bar   = document.getElementById('limitBar');
  const label = document.getElementById('limitLabel');
  if (!bar || !label) return;

  bar.style.width = visiblePct.toFixed(1) + '%';
  bar.title = `Daily AI CO₂ usage: ${pct.toFixed(3)}% of ${AI_DAILY_LIMIT_G}g limit`;
  bar.className   = 'limit-bar-fill' +
    (pct >= 100 ? ' over' : pct >= 70 ? ' warn' : '');

  const aiStr  = aiCO2 < 1 ? aiCO2.toFixed(3) + 'g' : aiCO2.toFixed(1) + 'g';
  label.textContent = `${aiStr} / ${AI_DAILY_LIMIT_G}g limit`;

  if (pct >= 100) label.style.color = '#ef5350';
  else if (pct >= 70) label.style.color = '#ffb74d';
  else label.style.color = '';
}

// ============ PER-PLATFORM BREAKDOWN ============
function renderPlatformBreakdown(data) {
  const stats   = data.platformStats || {};
  const section = document.getElementById('platformSection');
  const list    = document.getElementById('platformList');
  if (!section || !list) return;

  const entries = Object.entries(stats).filter(([, s]) => s.calls > 0);
  if (entries.length === 0) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  list.innerHTML = '';

  // Sort by CO₂ descending
  entries.sort((a, b) => b[1].co2 - a[1].co2);
  const maxCO2 = entries[0][1].co2 || 1;

  entries.forEach(([key, s]) => {
    const meta  = PLATFORM_META[key] || PLATFORM_META['other'];
    const pct   = (s.co2 / maxCO2 * 100).toFixed(0);
    const logoScale = meta.logoScale || 1;
    const co2Str = s.co2 < 0.001 ? (s.co2 * 1000).toFixed(2) + 'mg'
                 : s.co2 < 1     ? s.co2.toFixed(3) + 'g'
                 :                  s.co2.toFixed(1) + 'g';
    
    const pTok = s.promptTokens || 0;
    const cTok = s.completionTokens || 0;
    const pTokStr = pTok >= 1000 ? `${(pTok/1000).toFixed(1)}K` : String(pTok);
    const cTokStr = cTok >= 1000 ? `${(cTok/1000).toFixed(1)}K` : String(cTok);

    const row  = document.createElement('div');
    row.className = 'platform-row';
    row.innerHTML = `
      <div class="platform-logo">
        <img src="${meta.logo}" alt="${meta.label}" title="${meta.label}" style="transform:scale(${logoScale});transform-origin:center;">
      </div>
      <div class="platform-bar-track">
        <div class="platform-bar-fill" style="width:${pct}%; background:${meta.color}"></div>
      </div>
      <span class="platform-stat">
        ${s.calls} · ${co2Str}<br>
        <span style="font-size:9px;opacity:0.7">↑${pTokStr} ↓${cTokStr}</span>
      </span>
    `;
    list.appendChild(row);
  });
}

// ============ RULE-BASED FALLBACK TIP ============
// Used when the SLM is unavailable (transformers.min.js not yet loaded)
function getRuleTip(data) {
  const calls  = data.aiCalls || 0;
  const tokens = data.aiTokens || 0;
  const aiCO2  = data.aiCO2   || 0;
  if (calls > 12)       return "You've sent 12+ AI prompts today. Consider batching similar questions — saves ~30% carbon per session.";
  if (calls > 6)        return "High AI usage today. Use local search or docs for simple lookups to avoid unnecessary inference.";
  if (tokens > 50000)   return `${(tokens/1000).toFixed(0)}K tokens — equivalent to ${((aiCO2 / 1000) * STREAMING_H_PER_KGCO2 * 60).toFixed(0)} minutes of HD streaming.`;
  if (aiCO2 > 0.6)      return "AI carbon is climbing. Try to consolidate follow-up questions into a single detailed prompt.";
  if (calls > 3)        return "Tip: Write complete, detailed prompts the first time — it often takes fewer back-and-forth exchanges.";
  if (calls === 0)      return "No AI usage yet today — great start! 🌱 Carbon Compass tracks each prompt's real cost.";
  return "Each AI prompt carries a real energy cost. Ask yourself: is a search engine enough for this one?";
}
