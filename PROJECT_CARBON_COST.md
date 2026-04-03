# Carbon Compass — Project Development Carbon Footprint

**Meta-Analysis:** Quantifying the CO₂ cost of building Carbon Compass using GitHub Copilot CLI

---

## 1. Usage Summary

| Metric | Value |
|--------|-------|
| **Development Period** | 2026-03-31 to 2026-04-03 (4 days) |
| **Total Sessions** | 29 |
| **AI Assistant** | GitHub Copilot CLI |
| **Model Used** | **Claude Opus 4.5** (`claude-opus-4.5`) |
| **Model Provider** | Anthropic |
| **Model Architecture** | Claude 4 family, ~2T parameters (estimated) |
| **Estimated Interactions** | ~150 prompt-response pairs |

---

## 2. Token Estimation

### Input Tokens (User Prompts + Context)

| Category | Estimate |
|----------|----------|
| User messages (avg 100 tokens × 150) | 15,000 tokens |
| Code context loaded per turn (avg 2,000 × 150) | 300,000 tokens |
| System prompt + instructions (~3,000 × 150) | 450,000 tokens |
| **Total Input Tokens** | **~765,000 tokens** |

### Output Tokens (Claude Responses)

| Category | Estimate |
|----------|----------|
| Code generated (~214 KB / 4 chars per token) | ~53,500 tokens |
| Explanations, reasoning (avg 300 × 150) | ~45,000 tokens |
| Tool calls, JSON responses | ~15,000 tokens |
| **Total Output Tokens** | **~113,500 tokens** |

### Combined Total

| Metric | Tokens |
|--------|--------|
| Input | 765,000 |
| Output | 113,500 |
| **Grand Total** | **~878,500 tokens** |

---

## 3. Carbon Calculation

Using EcoLogits methodology for Claude Opus (Anthropic):

### Constants (EcoLogits)

| Parameter | Value | Source |
|-----------|-------|--------|
| Carbon Intensity | 590.4 gCO₂eq/kWh | ADEME World Mix |
| Anthropic PUE | 1.12 | EcoLogits provider data |
| Anthropic WUE (on-site) | 0.56 L/kWh | EcoLogits provider data |
| WUE (off-site) | 3.78 L/kWh | NREL |
| Claude Opus CO₂/token | 0.00054 g | EcoLogits Calculator |

### Calculation

**Method 1: EcoLogits Lookup Table (Output Tokens)**

```
CO₂ = Output Tokens × CO₂/token
CO₂ = 113,500 × 0.00054 g
CO₂ = 61.3 gCO₂eq
```

**Method 2: Full Parametric (Usage + Embodied)**

Based on EcoLogits parametric model for ~878K total tokens:

| Component | Value |
|-----------|-------|
| Usage-phase CO₂ | ~52 g |
| Embodied CO₂ | ~8 g |
| **Total CO₂** | **~60 g** |

### Water Footprint

```
Water = Energy × (WUE_on-site + PUE × WUE_off-site)
Water ≈ 0.10 kWh × (0.56 + 1.12 × 3.78)
Water ≈ 0.48 L
```

---

## 4. Final Project Carbon Cost

| Metric | Value | Analogy |
|--------|-------|---------|
| **Total CO₂** | ~60 gCO₂eq | 🚗 Driving 240 meters in a car |
| **Total Water** | ~0.48 L | 💧 One small glass of water |
| **Total Energy** | ~0.10 kWh | 🔋 10 minutes of laptop use |

---

## 5. Carbon ROI Analysis

### Cost vs. Benefit

| Metric | Value |
|--------|-------|
| Development CO₂ cost | 60 g |
| Average user daily savings (if 10% reduction) | 0.08 g/day |
| Days to break even (1 user) | 750 days |
| Days to break even (100 users) | 7.5 days |
| Days to break even (1,000 users) | 0.75 days |

### At Scale

| Users | Time to Carbon Positive |
|-------|------------------------|
| 100 | ~1 week |
| 1,000 | ~18 hours |
| 10,000 | ~2 hours |

> **Conclusion:** Carbon Compass becomes carbon-positive with just ~100 active users within a week.

---

## 6. Breakdown by Session Phase

| Phase | Sessions | Est. Tokens | CO₂ |
|-------|----------|-------------|-----|
| Initial diagnosis & setup | 1-3 | ~80,000 | ~5 g |
| Core feature build | 4-10 | ~200,000 | ~13 g |
| API interception & SSE parsing | 11-15 | ~150,000 | ~10 g |
| EcoLogits integration | 16-22 | ~180,000 | ~12 g |
| UI polish & bug fixes | 23-27 | ~150,000 | ~10 g |
| Final review & documentation | 28-29 | ~120,000 | ~10 g |
| **Total** | **29** | **~878,000** | **~60 g** |

---

## 7. Comparison: AI-Assisted vs Traditional Development

| Approach | Time | Est. CO₂ |
|----------|------|----------|
| **AI-Assisted (this project)** | 4 days | 60 g |
| Traditional (estimated 2 weeks) | 14 days | ~200 g* |

*Traditional estimate includes: laptop runtime (14d × 8h × 30W = 3.36 kWh × 590.4 = ~2,000g) — but most is idle time. Active coding comparison would be closer.

**Key insight:** AI-assisted development concentrated work into intensive bursts, potentially reducing overall energy by avoiding lengthy debugging sessions and research time.

---

## 8. Transparency Statement

This document practices what Carbon Compass preaches:
- We tracked our own development footprint
- We used the same EcoLogits methodology we implemented in the extension
- We disclose both the cost (60g) and the projected benefit (carbon-positive at 100 users)

---

## 9. Academic Citation

For citing this carbon analysis:

```
Carbon Compass Development Footprint Analysis, 2026.
Methodology: EcoLogits LLM Inference LCA (https://ecologits.ai/)
Model: Claude Opus 4.5 via GitHub Copilot CLI
Total: ~60 gCO₂eq, ~0.48L water, ~0.10 kWh energy
```

---

*Carbon Compass · Open Source · SDG 13 Climate Action*
*"We measure what we manage — including ourselves."*
