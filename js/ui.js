function renderBars(container, allActions) {
  container.innerHTML = '';
  for (const [action, conf] of Object.entries(allActions).sort((a, b) => b[1] - a[1])) {
    const row = document.createElement('div'); row.className = 'conf-bar-row';
    row.innerHTML = `
      <span class="conf-bar-label">${action}</span>
      <div class="conf-bar-track"><div class="conf-bar-fill" style="width:${conf*100}%;background:${ACTION_COLORS[action]||'#3b82f6'}"></div></div>
      <span class="conf-bar-value">${(conf*100).toFixed(0)}%</span>`;
    container.appendChild(row);
  }
}

function addStreamItem(action, confidence) {
  const time = new Date().toLocaleTimeString();
  streamItems.unshift({ action, confidence, time });
  if (streamItems.length > 20) streamItems.pop();
  feedbackStream.innerHTML = streamItems.map(item =>
    `<div class="stream-item">
      <span class="stream-time">${item.time}</span>
      <span class="stream-action" style="color:${ACTION_COLORS[item.action]||'#e2e8f0'}">${item.action}</span>
      <span class="stream-conf">${(item.confidence*100).toFixed(0)}%</span>
    </div>`
  ).join('');
}

function updateMatchDisplay(score) {
  const pct = Math.round(score * 100);
  matchPct.textContent = pct + '%';
  matchBarFill.style.width = pct + '%';
  if (pct >= 80) { matchPct.style.color = '#22c55e'; matchBarFill.style.background = '#22c55e'; }
  else if (pct >= 50) { matchPct.style.color = '#f59e0b'; matchBarFill.style.background = '#f59e0b'; }
  else { matchPct.style.color = '#ef4444'; matchBarFill.style.background = '#ef4444'; }
}

function renderFallbackSuggestion(data, matchScore, nextAction) {
  const pct = matchScore * 100;
  const tips = getTipsForRole(state.role);
  const transTips = getTransForRole(state.role);
  const actionTips = tips[data.action] || tips.stop;
  const tier = actionTips.find(t => pct >= t.min && pct < t.max) || actionTips[actionTips.length - 1];
  const transKey = data.action + '_' + nextAction;
  const transTip = transTips[transKey];

  let parts = `<div class="suggestion-icon">${tier.icon}</div>`;
  if (pct < 30) parts += `<div class="suggestion-text"><span class="match-bad">Needs work</span> — ${tier.text}`;
  else if (pct < 60) parts += `<div class="suggestion-text"><span class="match-ok">Getting there</span> — ${tier.text}`;
  else if (pct < 80) parts += `<div class="suggestion-text"><span class="match-ok">Almost!</span> — ${tier.text}`;
  else parts += `<div class="suggestion-text"><span class="match-good">Nailed it!</span> — ${tier.text}`;
  if (transTip) parts += `<br><br>🔄 <span style="opacity:0.7;font-size:12px;">${transTip}</span>`;
  parts += '</div>';
  return parts;
}

async function updateSuggestion(data, matchScore, nextAction) {
  const hasKey = !!getApiKey(state.llmModel);
  if (hasKey) {
    suggestionBody.innerHTML = '<div class="suggestion-icon">🤖</div><div class="suggestion-text" style="opacity:0.6">AI thinking...</div>';
    const tip = await callLLMAction(data.action, data.confidence, matchScore, nextAction, state.role, data.features);
    if (tip) {
      const pct = Math.round(matchScore * 100);
      let badge = pct < 30 ? '<span class="match-bad">Needs work</span>' : pct < 60 ? '<span class="match-ok">Getting there</span>' : pct < 80 ? '<span class="match-ok">Almost!</span>' : '<span class="match-good">Nailed it!</span>';
      suggestionBody.innerHTML = `<div class="suggestion-icon">🎯</div><div class="suggestion-text">${badge} — ${tip}</div>`;
      return;
    }
  }
  suggestionBody.innerHTML = renderFallbackSuggestion(data, matchScore, nextAction);
}

function displayPrediction(data, kps) {
  const nextAction = getNextAction(data.all_actions, data.action);
  state.targetAction = nextAction;
  state.targetKeypoints = generateTargetPose(kps, nextAction);

  feedbackStatus.textContent = '● Active';
  feedbackStatus.className = 'feedback-status analyzing';
  feedbackMain.innerHTML = `<span class="fb-label" style="color:${ACTION_COLORS[data.action]||'#f1f5f9'}">${ACTION_NAMES[data.action]||data.action}</span>
    <span class="fb-conf">${(data.confidence*100).toFixed(1)}%</span>`;
  feedbackNext.innerHTML = `<span class="fb-next-label" style="color:${ACTION_COLORS[nextAction]||'#fbbf24'}">${ACTION_NAMES[nextAction]||nextAction}</span>
    <span class="fb-next-icon">🎯</span>`;

  renderBars(feedbackBars, data.all_actions);
  addStreamItem(data.action, data.confidence);

  addHistory(data.action, data.confidence);
  state.prevAction = data.action;

  state.lastKeypoints = kps;
  $('predictionResult').innerHTML = `<span class="pred-label" style="color:${ACTION_COLORS[data.action]||'#f1f5f9'}">${ACTION_NAMES[data.action]||data.action}</span>
    <span class="pred-conf">${(data.confidence*100).toFixed(1)}%</span>`;
  renderBars($('confidenceBars'), data.all_actions);

  updateSuggestion(data, state.matchScore, nextAction);

  if (skeleton3D) skeleton3D.update(state.targetKeypoints, nextAction, kps);

  if (state.role === 'coach') addActionPosition(kps, data.action);
}

function addHistory(action, confidence) {
  state.predictionHistory.unshift({ action, confidence, time: new Date().toLocaleTimeString() });
  if (state.predictionHistory.length > 50) state.predictionHistory.pop();
  renderHistory();
}

function renderHistory() {
  const list = $('historyList');
  if (!state.predictionHistory.length) { list.innerHTML = '<span class="history-empty">No data yet</span>'; return; }
  list.innerHTML = state.predictionHistory.map(h =>
    `<div class="history-item">
      <span class="h-action" style="color:${ACTION_COLORS[h.action]||'#e2e8f0'}">${h.action}</span>
      <span class="h-conf">${(h.confidence*100).toFixed(1)}%</span>
      <span class="h-time">${h.time}</span>
    </div>`
  ).join('');
}

function buildLegend() {
  const names = { shoot: 'Shoot', pass: 'Pass', dribble: 'Dribble', run: 'Run', tackle: 'Tackle', stop: 'Stand' };
  pitchLegend.innerHTML = Object.entries(ACTION_COLORS).map(([k, v]) =>
    `<span class="legend-item"><span class="legend-dot" style="background:${v}"></span>${names[k]}</span>`
  ).join('');
}

function setRole(role) {
  state.role = role;
  roleBadge.innerHTML = role === 'coach' ? '🔵 Coach' : '🟢 Player';
  userDropdown.classList.remove('open');
  if (role === 'coach') {
    pitchCard.classList.add('visible');
    setTimeout(() => { resizePitchCanvas(); }, 50);
  } else {
    pitchCard.classList.remove('visible');
  }
}

function showApiKeyInput(model) {
  const cfg = LLM_CONFIGS[model];
  if (!cfg) return;
  $apiKeyGroup.style.display = 'block';
  $apiKeyInput.placeholder = 'Paste your ' + cfg.keyLabel + '...';
  const saved = getApiKey(model);
  if (saved) { $apiKeyInput.value = saved; $apiKeyStatus.textContent = '✓ Key saved'; $apiKeyStatus.className = 'api-key-status ok'; }
  else { $apiKeyInput.value = ''; $apiKeyStatus.textContent = ''; $apiKeyStatus.className = 'api-key-status'; }
}

function openSettings() {
  settingsPanel.classList.add('open');
  settingsOverlay.classList.add('open');
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsOverlay.classList.remove('open');
}

function openTips() { tipsPanel.classList.add('open'); tipsOverlay.classList.add('open'); }
function closeTips() { tipsPanel.classList.remove('open'); tipsOverlay.classList.remove('open'); }

function openAdvanced() { advancedPanel.classList.add('open'); advancedOverlay.classList.add('open'); }
function closeAdvanced() { advancedPanel.classList.remove('open'); advancedOverlay.classList.remove('open'); }
