function getApiKey(model) { return localStorage.getItem('pck_' + model); }
function setApiKey(model, key) { localStorage.setItem('pck_' + model, key); }

async function callLLMAction(action, conf, match, nextAction, role, features) {
  const cfg = LLM_CONFIGS[state.llmModel];
  const key = getApiKey(state.llmModel);
  if (!key) return null;
  const pct = Math.round(match * 100);
  const roleHint = role === 'coach' ? 'You are a professional football coach. Give tactical coaching advice.' : 'You are a personal trainer. Give technique advice.';

  let featureStr = '';
  if (features) {
    const f = [];
    if (features.legLift != null) f.push('leg lift ' + features.legLift.toFixed(2));
    if (features.armReach != null) f.push('arm reach ' + features.armReach.toFixed(2));
    if (features.crouch != null) f.push('crouch ' + features.crouch.toFixed(2));
    if (features.lean != null) f.push('lean ' + features.lean.toFixed(2));
    if (features.legExt != null) f.push('leg extension ' + features.legExt.toFixed(2));
    if (f.length) featureStr = ' Body features: ' + f.join(', ') + '.';
  }

  const prompt = `${roleHint} The player is performing "${action}" (${Math.round(conf*100)}% confidence, form match ${pct}%).${featureStr} Next recommended action: "${nextAction}". Reply with a VERY short tip (1 sentence, one emoji, under 40 words). Reference the 3D pose data for accuracy.`;
  const temp = advState.temperature;
  const tokens = advState.maxTokens;

  try {
    if (cfg.isGemini) {
      const res = await fetch(cfg.endpoint + '?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: tokens, temperature: temp } })
      });
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } else {
      const res = await fetch(cfg.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: cfg.apiModel, messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'Give a quick coaching tip.' }], max_tokens: tokens, temperature: temp })
      });
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    }
  } catch (e) { return null; }
}
