// ============ DATA LOADING ============
let todayData       = null;
let weeklyHistory   = [];
let slmWorker       = null;
let behaviorProfile = null;
let currentDayRange = 7;  // Default to 7 days

function load() {
  chrome.storage.local.get(['todayData', 'weeklyHistory'], (result) => {
    todayData     = result.todayData     || freshData();
    weeklyHistory = result.weeklyHistory || [];
    renderAll();
    setupDateRangeSelector();  // Setup after render
    startSLM();
    loadBehavior();
  });
}

function freshData() {
  return { co2:0, water:0, aiCalls:0, aiCO2:0, aiTokens:0, platformStats:{}, modelStats:{}, lastUpdated: new Date().toISOString() };
}

// ============ RENDER ============
function renderAll() {
  renderToday();
  renderBreakdown();
  renderChart();
  renderModelExpenseChart();
  renderGoalTracking();
  renderAchievements();
}

function formatCO2Compact(g) {
  if (g < 0.001) return `${(g * 1000).toFixed(2)}mg`;
  if (g < 1) return `${g.toFixed(3)}g`;
  if (g < 10) return `${g.toFixed(2)}g`;
  return `${Math.round(g)}g`;
}

function humanizeModelKey(modelKey) {
  const m = (modelKey || 'unknown').toLowerCase();
  if (m === 'gpt-4o') return 'GPT-4o';
  if (m === 'gpt-4o-mini') return 'GPT-4o mini';
  if (m === 'gpt-4-turbo') return 'GPT-4 Turbo';
  if (m === 'gpt-4') return 'GPT-4';
  if (m === 'gpt-3.5-turbo') return 'GPT-3.5 Turbo';
  if (m === 'gpt-3.5') return 'GPT-3.5';
  if (m === 'claude-opus') return 'Claude Opus';
  if (m === 'claude-sonnet') return 'Claude Sonnet';
  if (m === 'claude-haiku') return 'Claude Haiku';
  if (m === 'gemini-pro') return 'Gemini Pro';
  if (m === 'gemini-flash') return 'Gemini Flash';
  if (m === 'gemini-2.0-flash') return 'Gemini 2.0 Flash';
  if (m === 'deepseek-r1') return 'DeepSeek R1';
  if (m === 'deepseek') return 'DeepSeek';
  if (m === 'o1') return 'OpenAI o1';
  if (m === 'o1-mini') return 'OpenAI o1-mini';
  if (m === 'o3') return 'OpenAI o3';
  return modelKey;
}

function activeWindowDays() {
  return [todayData, ...weeklyHistory].slice(0, currentDayRange);
}

function aggregateModelStats(days) {
  const totals = {};
  days.forEach((day) => {
    const ms = day?.modelStats || {};
    Object.entries(ms).forEach(([modelKey, s]) => {
      if (!totals[modelKey]) {
        totals[modelKey] = { calls: 0, co2: 0, tokens: 0 };
      }
      totals[modelKey].calls += s.calls || 0;
      totals[modelKey].co2 += s.co2 || 0;
      totals[modelKey].tokens += s.tokens || 0;
    });
  });
  return Object.entries(totals)
    .filter(([, s]) => s.calls > 0 && s.co2 > 0)
    .sort((a, b) => b[1].co2 - a[1].co2)
    .slice(0, 5);
}

function renderModelExpenseChart() {
  const chart = document.getElementById('modelExpenseChart');
  const title = document.getElementById('modelExpenseTitle');
  if (!chart) return;

  if (title) title.textContent = `🔥 Top 5 Models by Carbon (${currentDayRange}d)`;

  const entries = aggregateModelStats(activeWindowDays());
  if (entries.length === 0) {
    chart.innerHTML = '<div style="font-size:12px;color:#6b7280;padding:20px;text-align:center">No model usage yet.</div>';
    return;
  }

  const maxCO2 = Math.max(...entries.map(([, s]) => s.co2));
  const colors = ['#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2'];

  chart.innerHTML = entries.map(([modelKey, s], idx) => {
    const pct = maxCO2 > 0 ? (s.co2 / maxCO2 * 100) : 0;
    const tokens = s.tokens >= 1000 ? `${(s.tokens / 1000).toFixed(1)}K` : `${s.tokens}`;
    const color = colors[idx % colors.length];
    const label = humanizeModelKey(modelKey);
    
    return `
      <div class="model-bar-item">
        <div class="model-bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="model-bar-track">
          <div class="model-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${color},${color}cc)">
            ${formatCO2Compact(s.co2)}
          </div>
        </div>
        <div class="model-bar-stats">${s.calls} · ${tokens}</div>
      </div>
    `;
  }).join('');
}

function renderToday() {
  const d = todayData;
  const yesterday = weeklyHistory[0] || freshData();
  
  // CO₂ with trend
  const co2Val = d.co2 < 1 ? d.co2.toFixed(3) : Math.round(d.co2);
  const co2Trend = getTrend(d.co2, yesterday.co2);
  document.getElementById('todayCO2').innerHTML = `${co2Val}<span class="trend-${co2Trend.direction}" style="font-size:14px;margin-left:4px">${co2Trend.symbol}</span>`;
  
  // Water with trend
  const waterUnitEl = document.getElementById('todayWaterUnit');
  let waterVal;
  if (d.water === 0) {
    waterVal = '0';
    if (waterUnitEl) waterUnitEl.textContent = 'mL';
  } else if (d.water < 0.001) {
    waterVal = (d.water * 1000).toFixed(2);
    if (waterUnitEl) waterUnitEl.textContent = 'mL';
  } else if (d.water < 1) {
    waterVal = d.water.toFixed(3);
    if (waterUnitEl) waterUnitEl.textContent = 'L';
  } else {
    waterVal = d.water.toFixed(1);
    if (waterUnitEl) waterUnitEl.textContent = 'L';
  }
  const waterTrend = getTrend(d.water, yesterday.water);
  document.getElementById('todayWater').innerHTML = `${waterVal}<span class="trend-${waterTrend.direction}" style="font-size:14px;margin-left:4px">${waterTrend.symbol}</span>`;
  
  // AI Calls with trend
  const aiTrend = getTrend(d.aiCalls, yesterday.aiCalls);
  document.getElementById('todayAI').innerHTML = `${d.aiCalls}<span class="trend-${aiTrend.direction}" style="font-size:14px;margin-left:4px">${aiTrend.symbol}</span>`;
  
  // Tokens with breakdown
  const totalTok = d.aiTokens || 0;
  const pTok = d.promptTokens || 0;
  const cTok = d.completionTokens || 0;
  const totalTokStr = totalTok >= 1000 ? `${(totalTok/1000).toFixed(1)}K` : String(totalTok);
  const pTokStr = pTok >= 1000 ? `${(pTok/1000).toFixed(1)}K` : String(pTok);
  const cTokStr = cTok >= 1000 ? `${(cTok/1000).toFixed(1)}K` : String(cTok);
  const tokEl = document.getElementById('todayTokens');
  tokEl.innerHTML = `${totalTokStr}<div style="font-size:11px;opacity:0.7;margin-top:2px">↑${pTokStr} ↓${cTokStr}</div>`;
  
  // Show usage + embodied breakdown for average
  const aiCalls = d.aiCalls || 0;
  const usageCO2 = d.aiUsageCO2 || 0;
  const embodiedCO2 = d.aiEmbodiedCO2 || 0;
  const avgEl = document.getElementById('todayAvgCO2');
  if (aiCalls > 0) {
    const fallbackTotal = d.aiCO2 || 0;
    const totalForAvg = (usageCO2 + embodiedCO2) > 0 ? (usageCO2 + embodiedCO2) : fallbackTotal;
    const avgTotal = (totalForAvg / aiCalls).toFixed(4);
    const avgUsage = (usageCO2 / aiCalls).toFixed(4);
    const avgEmbodied = (embodiedCO2 / aiCalls).toFixed(4);
    avgEl.textContent = `${avgTotal}g`;
    avgEl.title = `Usage: ${avgUsage}g | Embodied: ${avgEmbodied}g`;
  } else {
    avgEl.textContent = '—';
  }
}

function getTrend(current, previous) {
  if (!previous || previous === 0) return { direction: 'same', symbol: '—' };
  const change = current - previous;
  const pct = ((change / previous) * 100).toFixed(0);
  if (Math.abs(change) < 0.001) return { direction: 'same', symbol: '—' };
  if (change > 0) return { direction: 'up', symbol: `↑${pct}%` };
  return { direction: 'down', symbol: `↓${Math.abs(pct)}%` };
}

// Platform display meta — using real logo files
const PLATFORM_META_DB = {
  chatgpt:    { label: 'ChatGPT',    color: '#74c69d', logo: 'logos/icons8-chatgpt-50.png' },
  claude:     { label: 'Claude',     color: '#a8dadc', logo: 'logos/icons8-claude-48.png' },
  gemini:     { label: 'Gemini',     color: '#ffd166', logo: 'logos/icons8-gemini-ai-48.png' },
  deepseek:   { label: 'DeepSeek',   color: '#81b0ff', logo: 'logos/deepseek-logo-icon.png', logoScale: 0.82 },
  perplexity: { label: 'Perplexity', color: '#c77dff', logo: 'logos/icons8-perplexité-ai-50.png' },
  copilot:    { label: 'Copilot',    color: '#90e0ef', logo: 'logos/icons8-microsoft-copilote-48.png' },
  poe:        { label: 'Poe',        color: '#ffb347', logo: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI2IiBmaWxsPSIjZmZiMzQ3Ii8+PHBhdGggZD0iTTYgOEMNiA2LjkgNi45IDYgOCA2SDIwQzIxLjEgNiAyMiA2LjkgMjIgOFYxNkMyMiAxNy4xIDIxLjEgMTggMjAgMThIMTJMNiAyMlY4WiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=' },
  other:      { label: 'Other',      color: '#adb5bd', logo: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI2IiBmaWxsPSIjYWRiNWJkIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iNyIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIi8+PGxpbmUgeDE9IjEyIiB5MT0iNSIgeDI9IjEyIiB5Mj0iMTkiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjxwYXRoIGQ9Ik01IDEySDE5IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=' },
};

function renderBreakdown() {
  const d = todayData;
  // Use tracked aiCO2 if available; fall back to estimate
  // Show AI CO₂ as 100% of the tracked bar (AI-only focus)
  document.getElementById('bk-ai').style.width  = '100%';
  document.getElementById('pct-ai').textContent = '100';

  // Render per-platform breakdown if we have data
  renderPlatformBreakdownDB(d.platformStats || {});
}

function renderPlatformBreakdownDB(stats) {
  const container = document.getElementById('platformBreakdown');
  if (!container) return;

  const entries = Object.entries(stats).filter(([, s]) => s.calls > 0);
  if (entries.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const list = document.getElementById('platformBreakdownList');
  if (!list) return;
  list.innerHTML = '';

  entries.sort((a, b) => b[1].co2 - a[1].co2);
  const maxCO2 = entries[0][1].co2 || 1;

  entries.forEach(([key, s]) => {
    const meta   = PLATFORM_META_DB[key] || PLATFORM_META_DB['other'];
    const pct    = (s.co2 / maxCO2 * 100).toFixed(0);
    const logoScale = meta.logoScale || 1;
    const co2Str = s.co2 < 0.001 ? (s.co2 * 1000).toFixed(2) + 'mg'
                 : s.co2 < 1     ? s.co2.toFixed(3) + 'g'
                 :                  s.co2.toFixed(1) + 'g';

    const pTokStr = s.promptTokens >= 1000 ? `${(s.promptTokens/1000).toFixed(1)}K` : String(s.promptTokens || 0);
    const cTokStr = s.completionTokens >= 1000 ? `${(s.completionTokens/1000).toFixed(1)}K` : String(s.completionTokens || 0);
    const hoverTip = `${meta.label}: ${s.calls} call${s.calls>1?'s':''} · ${co2Str} CO₂ · ↑${pTokStr} ↓${cTokStr} tokens`;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;font-size:13px;cursor:default;padding:8px;border-radius:8px;background:rgba(255,255,255,0.08);transition:all 0.2s ease';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;min-width:140px">
        <img src="${meta.logo}" alt="${meta.label}" style="width:32px;height:32px;object-fit:contain;background:rgba(255,255,255,0.95);border-radius:6px;padding:3px;border:1px solid rgba(255,255,255,0.2);transform:scale(${logoScale});transform-origin:center" />
        <span style="font-weight:600;color:#1a3c2c;font-size:12px">${meta.label}</span>
      </div>
      <div style="flex:1;background:rgba(255,255,255,0.2);border-radius:6px;height:12px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${meta.color};border-radius:6px;transition:width 0.3s ease"></div>
      </div>
      <span style="font-size:11px;color:#1a3c2c;font-weight:500;white-space:nowrap">
        ${s.calls} call${s.calls>1?'s':''} · ${co2Str}<br>
        <span style="font-size:10px;color:#6b7280">↑${pTokStr} ↓${cTokStr}</span>
      </span>
    `;
    row.addEventListener('mouseover', (e) => { 
      row.style.background = 'rgba(255,255,255,0.15)';
      row.style.transform = 'translateX(4px)';
      showTip(e, hoverTip);
    });
    row.addEventListener('mouseout', () => {
      row.style.background = 'rgba(255,255,255,0.08)';
      row.style.transform = 'translateX(0)';
      hideTip();
    });
    list.appendChild(row);
  });
}

function renderChart() {
  const days   = activeWindowDays();
  const maxCO2 = Math.max(...days.map(d => d.co2), 1);
  const labels = buildDateLabels(days);
  const chart  = document.getElementById('barChart');
  chart.innerHTML = '';

  days.forEach((day, i) => {
    const heightPct = Math.round((day.co2 / maxCO2) * 100);
    const col = document.createElement('div');
    col.className = 'bar-col';

    const bar = document.createElement('div');
    bar.className  = i === 0 ? 'bar bar-today' : 'bar bar-past';
    bar.style.height = Math.max(heightPct, 2) + '%';
    const co2Tip = day.co2 < 1 ? day.co2.toFixed(3) : Math.round(day.co2);
    const tokTip = (day.aiTokens || 0) > 0
      ? ` · ${day.aiTokens >= 1000 ? (day.aiTokens/1000).toFixed(1)+'K' : day.aiTokens} tok`
        + (day.promptTokens ? ` (↑${day.promptTokens >= 1000 ? (day.promptTokens/1000).toFixed(1)+'K' : day.promptTokens} ↓${(day.completionTokens||0) >= 1000 ? ((day.completionTokens||0)/1000).toFixed(1)+'K' : (day.completionTokens||0)})` : '')
      : '';
    bar.setAttribute('data-tip', `${co2Tip}g CO₂${tokTip}`);

    const lbl = document.createElement('div');
    lbl.className   = 'bar-label';
    lbl.textContent = labels[i];

    col.appendChild(bar);
    col.appendChild(lbl);
    chart.appendChild(col);
  });
}

function buildDateLabels(days) {
  return days.map((day, i) => {
    if (i === 0) return 'Today';
    try {
      const date = new Date(day.lastUpdated);
      if (currentDayRange <= 7) {
        return date.toLocaleDateString('en', { weekday: 'short' });
      } else if (currentDayRange <= 30) {
        return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      } else {
        return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      }
    } catch { return `Day -${i}`; }
  });
}

function setupDateRangeSelector() {
  const buttons = document.querySelectorAll('.range-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDayRange = parseInt(btn.dataset.days);
      renderChart();
      renderModelExpenseChart();
    });
  });
}

function renderGoalTracking() {
  const WEEKLY_TARGET = 7.0; // aligned with 1g/day behavior target
  const week7Days = [todayData, ...weeklyHistory].slice(0, 7);
  const weekTotal = week7Days.reduce((sum, d) => sum + (d.co2 || 0), 0);
  const pct = Math.min((weekTotal / WEEKLY_TARGET) * 100, 100);
  const remaining = Math.max(WEEKLY_TARGET - weekTotal, 0);
  
  document.getElementById('weekTotal').textContent = `${weekTotal.toFixed(2)}g CO₂`;
  document.getElementById('weekTarget').textContent = `${WEEKLY_TARGET.toFixed(1)}g CO₂`;
  document.getElementById('weekProgress').style.width = `${pct}%`;
  
  const msgEl = document.getElementById('goalMessage');
  if (weekTotal >= WEEKLY_TARGET) {
    msgEl.textContent = '⚠️ Weekly target exceeded';
    msgEl.style.color = '#dc2626';
    document.getElementById('weekProgress').style.background = 'linear-gradient(90deg, #dc2626, #ef4444)';
  } else if (remaining < 2) {
    msgEl.textContent = `🔥 Only ${remaining.toFixed(2)}g left this week!`;
    msgEl.style.color = '#f59e0b';
  } else {
    msgEl.textContent = `✅ ${remaining.toFixed(2)}g remaining — keep it up!`;
    msgEl.style.color = '#16a34a';
  }
}

function renderAchievements() {
  const grid = document.getElementById('achievementGrid');
  if (!grid) return;
  
  const week7Days = [todayData, ...weeklyHistory].slice(0, 7);
  const weekTotal = week7Days.reduce((sum, d) => sum + (d.co2 || 0), 0);
  const totalDays = weeklyHistory.length + 1;
  const avgDaily = weekTotal / Math.min(totalDays, 7);
  
  const achievements = [
    {
      id: 'first_track',
      name: 'First Steps',
      desc: 'Tracked your first day',
      icon: '🌱',
      unlocked: totalDays >= 1,
    },
    {
      id: 'week_streak',
      name: '7-Day Streak',
      desc: 'Used extension for 7 days',
      icon: '🔥',
      unlocked: totalDays >= 7,
    },
    {
      id: 'low_carbon',
      name: 'Eco Warrior',
      desc: 'Daily CO₂ under 1.0g',
      icon: '🌍',
      unlocked: todayData.co2 < 1.0 && todayData.co2 > 0,
    },
    {
      id: 'under_target',
      name: 'Goal Crusher',
      desc: 'Weekly total under 7g',
      icon: '🎯',
      unlocked: weekTotal < 7 && weekTotal > 0,
    },
    {
      id: 'efficient_user',
      name: 'Token Saver',
      desc: 'Average <200 tokens/call',
      icon: '⚡',
      unlocked: avgDaily > 0 && (todayData.aiTokens / Math.max(todayData.aiCalls, 1)) < 200,
    },
    {
      id: 'month_active',
      name: 'Committed',
      desc: 'Used extension 30 days',
      icon: '💎',
      unlocked: totalDays >= 30,
    },
  ];
  
  grid.innerHTML = achievements.map(a => `
    <div style="
      background:${a.unlocked ? 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,165,0,0.1))' : 'rgba(0,0,0,0.03)'};
      border:2px solid ${a.unlocked ? '#ffd700' : '#e0e0e0'};
      border-radius:12px;padding:14px;text-align:center;
      transition:all 0.3s ease;cursor:default;
      ${a.unlocked ? 'animation:pulse 2s infinite ease-in-out;' : 'opacity:0.5;filter:grayscale(1);'}
    ">
      <div style="font-size:32px;margin-bottom:6px">${a.icon}</div>
      <div style="font-size:12px;font-weight:700;color:#2d6a4f;margin-bottom:2px">${a.name}</div>
      <div style="font-size:10px;color:#888">${a.desc}</div>
      ${a.unlocked ? '<div style="font-size:9px;color:#16a34a;margin-top:4px;font-weight:600">✓ UNLOCKED</div>' : ''}
    </div>
  `).join('');
}

// ============ SLM INSIGHTS ============
function startSLM() {
  // Show rule-based insights immediately for instant feedback
  showRuleInsights();
  
  try {
    slmWorker = new Worker(chrome.runtime.getURL('slm-worker.js'));
  } catch (e) {
    return; // Rules already showing
  }

  slmWorker.onmessage = (e) => {
    if (e.data.type === 'progress') {
      document.getElementById('slmStatusText').textContent =
        e.data.message || 'SLM warming up…';
    }
    if (e.data.type === 'ready') {
      document.getElementById('slmDot').className = 'slm-dot ready';
      document.getElementById('slmStatusText').textContent =
        `${e.data.modelId || 'Xenova/flan-t5-small'} · ${e.data.params || '80M'} params · ${e.data.license || 'Apache 2.0'}`;
      requestInsights();
    }
    if (e.data.type === 'result') {
      appendInsight(e.data.text, e.data.inferenceMs, e.data.co2g);
    }
    if (e.data.type === 'error') {
      console.warn('🌱 SLM error:', e.data.error);
      document.getElementById('slmStatusText').textContent =
        'SLM error: ' + (e.data.error || 'unknown') + ' · showing rule-based insights';
      // Keep existing rule-based insights on error
    }
  };

  slmWorker.onerror = () => {}; // Rules already showing

  slmWorker.postMessage({ type: 'init' });
}

let insightCount = 0;
const INSIGHT_PROMPTS = [
  d => `User sent ${d.aiCalls} AI prompts using ${d.aiTokens||0} tokens, generating ${(d.aiCO2||0).toFixed(3)}g CO2 today`,
  d => `AI usage today: ${d.aiCalls} prompts, ${d.aiTokens||0} tokens total, average ${d.aiCalls>0?((d.aiCO2||0)/d.aiCalls).toFixed(4):0}g CO2 per prompt`,
  d => `${d.aiCalls} AI queries today with ${d.aiTokens||0} tokens — CO2 footprint ${(d.aiCO2||0).toFixed(3)}g from AI inference`
];

function requestInsights() {
  if (!slmWorker || !todayData) return;
  insightCount = 0;
  // Clear rule-based insights before generating SLM ones
  document.getElementById('insightsList').innerHTML = '';
  // Send 3 requests with staggered timing
  [0, 1, 2].forEach((i) => {
    setTimeout(() => {
      slmWorker.postMessage({ type: 'generate', profile: behaviorProfile, todayData });
    }, i * 500); // Reduced from 800ms to 500ms for faster generation
  });
}

function appendInsight(text, inferenceMs, co2g) {
  const icons = ['🌱', '💡', '🌍'];
  const item  = document.createElement('div');
  item.className = 'insight-item';

  const icon = document.createElement('div');
  icon.className   = 'insight-icon';
  icon.textContent = icons[insightCount % 3];

  const body = document.createElement('div');
  body.className = 'insight-text';
  body.textContent = text;

  const meta = document.createElement('div');
  meta.className   = 'insight-meta';
  meta.textContent = `🔬 SLM inference: ${inferenceMs}ms · ${co2g}g CO₂ · Xenova/flan-t5-small (80M params)`;

  body.appendChild(meta);
  item.appendChild(icon);
  item.appendChild(body);
  document.getElementById('insightsList').appendChild(item);
  insightCount++;
}

function showRuleInsights() {
  document.getElementById('slmDot').className = 'slm-dot';
  document.getElementById('slmStatusText').textContent =
    'Loading local SLM or using rule-based fallback';

  const d = todayData || freshData();
  const avgCO2 = d.aiCalls > 0 ? ((d.aiCO2||0)/d.aiCalls).toFixed(4) : '0';
  const insights = [
    `You sent ${d.aiCalls} AI prompts today (${d.aiTokens||0} tokens). Batching similar questions can cut carbon ~30%.`,
    `Average cost per prompt: ${avgCO2}g CO₂. Frontier models (GPT-4o, Claude Opus) cost up to 15× more than efficient ones.`,
    `${d.aiCalls} prompts ≈ ${(d.aiCO2||0).toFixed(3)}g CO₂ today. Ask yourself: "Could a web search answer this?" before each AI query.`
  ];
  const icons = ['🌱', '⚡', '🌍'];

  document.getElementById('insightsList').innerHTML = '';
  insights.forEach((text, i) => {
    const item = document.createElement('div');
    item.className = 'insight-item';

    const icon = document.createElement('div');
    icon.className   = 'insight-icon';
    icon.textContent = icons[i];

    const body = document.createElement('div');
    body.className = 'insight-text';
    body.textContent = text;

    const meta = document.createElement('div');
    meta.className   = 'insight-meta';
    meta.textContent = 'Rule-based (SLM not loaded)';

    body.appendChild(meta);
    item.appendChild(icon);
    item.appendChild(body);
    document.getElementById('insightsList').appendChild(item);
  });
}

// ============ EXPORT ============
function exportCSV() {
  const rows = [['Date','AI_CO2_g','Water_L','AI_Calls','AI_Tokens','Prompt_Tokens','Completion_Tokens','Top_Platform']];
  [todayData, ...weeklyHistory].filter(Boolean).forEach(d => {
    const topPlatform = Object.entries(d.platformStats || {}).sort((a,b) => b[1].calls - a[1].calls)[0];
    rows.push([
      new Date(d.lastUpdated || Date.now()).toLocaleDateString(),
      (d.aiCO2 || 0).toFixed(4),
      (d.water || 0).toFixed(3),
      d.aiCalls || 0,
      d.aiTokens || 0,
      d.promptTokens || 0,
      d.completionTokens || 0,
      topPlatform ? topPlatform[0] : 'none',
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'carbon-compass-export.csv', 'text/csv');
  showNotification('✅ CSV exported successfully', '#2d6a4f');
}

function exportJSON() {
  const data = {
    exportDate: new Date().toISOString(),
    today: todayData,
    history: weeklyHistory,
    behavior: behaviorProfile,
  };
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, 'carbon-compass-export.json', 'application/json');
  showNotification('✅ JSON exported successfully', '#2d6a4f');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function showNotification(message, color) {
  const notif = document.createElement('div');
  notif.textContent = message;
  notif.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:10000;
    background:${color};color:white;padding:12px 20px;border-radius:8px;
    font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.2);
    animation:slideIn 0.3s ease;
  `;
  document.body.appendChild(notif);
  setTimeout(() => {
    notif.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

// ============ RESET ============
function resetData() {
  if (!confirm("Reset today's data?")) return;
  chrome.runtime.sendMessage({ type: 'RESET_DAY' }, () => {
    if (chrome.runtime.lastError) { alert('Reset failed — try again.'); return; }
    load();
  });
}

// ============ UTILS ============
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============ BEHAVIOR PATTERNS ============
function loadBehavior() {
  chrome.runtime.sendMessage({ type: 'GET_BEHAVIOR' }, (profile) => {
    if (chrome.runtime.lastError || !profile) return;
    behaviorProfile = profile;
    renderBehavior(profile);
  });
}

function buildBehaviorPrompt(d, profile) {
  const hourly = profile.hourlyUsage || [];
  const peak   = hourly.indexOf(Math.max(...hourly));
  const peakLabel = peak < 12 ? `${peak===0?12:peak}am` : `${peak===12?12:peak-12}pm`;
  const topPlat = Object.entries(profile.topPlatforms||{}).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
  return `User has ${profile.totalPrompts||0} lifetime AI prompts, peaks at ${peakLabel}, mainly uses ${topPlat||'AI tools'}. Today: ${d.aiCalls} prompts, ${d.aiTokens||0} tokens, ${(d.aiCO2||0).toFixed(3)}g CO2`;
}

function renderBehavior(profile) {
  if (!profile) return;
  const section = document.getElementById('behaviorSection');
  if (!section) return;

  const hourly = profile.hourlyUsage || new Array(24).fill(0);
  const maxH   = Math.max(...hourly, 1);
  const peakH  = hourly.indexOf(Math.max(...hourly));
  const peakLabel = peakH < 12 ? `${peakH===0?12:peakH}am` : `${peakH===12?12:peakH-12}pm`;

  // Top platforms
  const topEntries = Object.entries(profile.topPlatforms||{}).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const topStr = topEntries.map(([k,v])=>`${k} (${v})`).join(', ') || '—';

  section.style.display = 'block';
  section.innerHTML = `
    <div class="section-title">🧠 Your AI Usage Patterns</div>
    <div style="font-size:12px;color:rgba(26,60,44,0.7);margin-bottom:14px">
      Based on ${profile.totalPrompts||0} lifetime prompts across ${profile.totalSessions||0} active days
    </div>
    
    <!-- Hourly Heatmap -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:#2d6a4f;margin-bottom:8px">⏰ 24-Hour Activity Heatmap</div>
      <div id="heatmapGrid" style="display:grid;grid-template-columns:repeat(24,1fr);gap:3px;margin-bottom:6px">
        ${hourly.map((v,i)=>{
          const intensity = v > 0 ? Math.min((v/maxH)*100, 100) : 0;
          const color = intensity === 0 ? '#f5f5f5' 
                      : intensity < 25 ? '#c7e9c0'
                      : intensity < 50 ? '#74c69d'
                      : intensity < 75 ? '#40916c'
                      : '#2d6a4f';
          return `
            <div data-hour="${i}" data-peak="${i===peakH}" title="${i}:00 — ${v} prompt${v!==1?'s':''}" class="heatmap-cell" style="
              aspect-ratio:1;background:${color};border-radius:4px;
              cursor:default;transition:all 0.3s ease;
              ${i===peakH?'box-shadow:0 0 0 2px #ffd700;transform:scale(1.1);':''}
            "></div>
          `;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#888;margin-bottom:4px">
        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:10px;color:#666;margin-top:8px">
        <span>Less</span>
        <div style="display:flex;gap:3px">
          <div style="width:14px;height:14px;background:#f5f5f5;border-radius:2px"></div>
          <div style="width:14px;height:14px;background:#c7e9c0;border-radius:2px"></div>
          <div style="width:14px;height:14px;background:#74c69d;border-radius:2px"></div>
          <div style="width:14px;height:14px;background:#40916c;border-radius:2px"></div>
          <div style="width:14px;height:14px;background:#2d6a4f;border-radius:2px"></div>
        </div>
        <span>More</span>
      </div>
    </div>

    <div style="font-size:12px;color:#2d6a4f;padding:10px;background:rgba(45,106,79,0.05);border-radius:8px;border-left:3px solid #2d6a4f">
      ⏰ Peak usage: <strong>${peakLabel}</strong> &nbsp;·&nbsp;
      🌐 Top platforms: <strong>${topStr}</strong>
    </div>
  `;
  
  // Attach hover listeners to heatmap cells (CSP-compliant)
  const grid = document.getElementById('heatmapGrid');
  if (grid) {
    grid.querySelectorAll('.heatmap-cell').forEach(cell => {
      const isPeak = cell.getAttribute('data-peak') === 'true';
      cell.addEventListener('mouseenter', () => {
        cell.style.transform = 'scale(1.2)';
      });
      cell.addEventListener('mouseleave', () => {
        cell.style.transform = isPeak ? 'scale(1.1)' : 'scale(1)';
      });
    });
  }
}

// ── Floating tooltip ──
const _tt = document.getElementById('cc-tooltip');
function showTip(e, text) {
  if (!_tt || !text) return;
  _tt.textContent = text;
  _tt.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  if (!_tt) return;
  _tt.style.left = (e.clientX + 14) + 'px';
  _tt.style.top  = (e.clientY - 28) + 'px';
}
function hideTip() { if (_tt) _tt.style.display = 'none'; }

// Attach tooltip to bar chart (event delegation on the chart container)
function attachChartTooltip() {
  const chart = document.getElementById('barChart');
  if (!chart) return;
  chart.addEventListener('mouseover', (e) => {
    const bar = e.target.closest('.bar');
    if (bar) showTip(e, bar.getAttribute('data-tip'));
  });
  chart.addEventListener('mousemove', moveTip);
  chart.addEventListener('mouseout',  (e) => {
    if (!e.target.closest('.bar')) hideTip();
  });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnExport').addEventListener('click', exportCSV);
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
  document.getElementById('btnReset').addEventListener('click', resetData);
  load();
  attachChartTooltip();
});
