const SKELETON = [
  [0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]
];

const ACTION_COLORS = {
  shoot: '#ef4444', pass: '#3b82f6', dribble: '#22c55e',
  run: '#f59e0b', tackle: '#8b5cf6', stop: '#64748b'
};

const ACTION_KEYS = ['shoot', 'pass', 'dribble', 'run', 'tackle', 'stop'];
const ACTION_NAMES = { shoot: 'Shoot', pass: 'Pass', dribble: 'Dribble', run: 'Run', tackle: 'Tackle', stop: 'Stand' };

const state = {
  isCamera: false, predicting: false, predictionHistory: [],
  detector: null, modelReady: false,
  animFrameId: null, mediaStream: null, detectInterval: null,
  lastKeypoints: null, targetKeypoints: null, targetAction: null,
  matchScore: 0, prevAction: null
};

const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const placeholder = $('placeholder'), modelLoading = $('modelLoading');
const btnCamera = $('btnCamera'), btnReset = $('btnReset'), camIndicator = $('camIndicator');
const feedbackSection = $('feedbackSection'), feedbackStatus = $('feedbackStatus');
const feedbackMain = $('feedbackMain'), feedbackNext = $('feedbackNext');
const feedbackBars = $('feedbackBars'), feedbackStream = $('feedbackStream');
const matchPct = $('matchPct'), matchBarFill = $('matchBarFill');

let streamItems = [];

function resizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
}
window.addEventListener('resize', resizeCanvas);

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

class ActionClassifier {
  classify(kps) {
    if (!kps || kps.length < 17) return this._fallback();
    const confs = kps.map(k => k.score != null ? k.score : (k.confidence || 0));
    const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
    if (avg < 0.3) return this._fallback();

    const p = {};
    for (let i = 0; i < 17; i++) p[i] = { x: kps[i].x, y: kps[i].y, c: confs[i] };

    const sm = mid(p[5], p[6]), hm = mid(p[11], p[12]);
    const bh = dist(sm, hm);
    if (bh < 1) return this._fallback();

    const legLift = Math.max(
      this._legLift(p[11], p[13], p[15], bh),
      this._legLift(p[12], p[14], p[16], bh)
    );
    const armReach = Math.max(
      this._armReach(p[5], p[7], p[9], bh),
      this._armReach(p[6], p[8], p[10], bh)
    );
    const crouch = this._crouch(sm, hm, bh);
    const lean = this._lean(sm, hm, bh);
    const legExt = Math.max(
      this._legExtension(p[11], p[13], p[15], bh),
      this._legExtension(p[12], p[14], p[16], bh)
    );

    let s = { shoot: 0, pass: 0, dribble: 0, run: 0, tackle: 0, stop: 0 };
    s.shoot = Math.min(1, legLift * 2.5);
    s.pass = Math.min(1, armReach * 2.0) * (1 - s.shoot * 0.5);
    s.dribble = Math.min(1, crouch * 2.5) * (1 - s.shoot * 0.3);
    s.run = Math.min(1, lean * 2.0) * (1 - s.shoot * 0.4) * (1 - crouch * 0.3);
    s.tackle = Math.min(1, (crouch * 1.5 + legExt * 1.5) * 0.6) * (1 - armReach * 0.3);
    s.stop = Math.max(0, 1 - (s.shoot + s.pass + s.dribble + s.run + s.tackle) * 0.6);

    const raw = [s.shoot, s.pass, s.dribble, s.run, s.tackle, s.stop];
    const total = raw.reduce((a, b) => a + b, 0) || 1;
    const norm = raw.map(v => v / total);
    const maxIdx = norm.indexOf(Math.max(...norm));
    const all = {};
    ACTION_KEYS.forEach((a, i) => { all[a] = norm[i]; });

    return { action: ACTION_KEYS[maxIdx], confidence: norm[maxIdx], all_actions: all, features: { legLift, armReach, crouch, lean, legExt } };
  }
  _legLift(hip, knee, ankle, bh) { return Math.max(0, (dist(hip, knee) - dist(hip, ankle)) / bh); }
  _armReach(shoulder, elbow, wrist, bh) { return dist(shoulder, wrist) / bh; }
  _crouch(shoulder, hip, bh) { return Math.max(0, Math.min(1, (hip.y - shoulder.y) / bh / 1.8)); }
  _lean(shoulder, hip, bh) { return Math.min(1, Math.abs(shoulder.x - hip.x) / bh * 2); }
  _legExtension(hip, knee, ankle, bh) { const s = dist(hip, ankle), f = dist(hip, knee) + dist(knee, ankle); return Math.max(0, (s - f * 0.5) / bh); }
  _fallback() { const all = {}; ACTION_KEYS.forEach(a => { all[a] = a === 'stop' ? 1 : 0; }); return { action: 'stop', confidence: 1, all_actions: all, features: {} }; }
}

const classifier = new ActionClassifier();

function generateTargetPose(kps, nextAction) {
  if (!kps || kps.length < 17) return null;
  const t = kps.map(k => ({ x: k.x, y: k.y, confidence: 1 }));
  const sm = mid(t[5], t[6]), hm = mid(t[11], t[12]);
  const bh = dist(sm, hm);
  if (bh < 1) return null;

  switch (nextAction) {
    case 'shoot': {
      const side = t[16].y < t[15].y ? 1 : -1;
      const knee = side > 0 ? 14 : 13, ankle = side > 0 ? 16 : 15;
      const hip = side > 0 ? 12 : 11, shoulder = side > 0 ? 6 : 5;
      const oppShoulder = side > 0 ? 5 : 6, oppElbow = side > 0 ? 7 : 8, oppWrist = side > 0 ? 9 : 10;
      const baseKnee = side > 0 ? 13 : 14, baseAnkle = side > 0 ? 15 : 16;
      t[knee].x = t[hip].x + (t[hip].x - t[baseKnee].x) * 0.15;
      t[knee].y = t[hip].y - bh * 0.35;
      t[ankle].x = t[hip].x + (t[hip].x - t[baseAnkle].x) * 0.3;
      t[ankle].y = t[hip].y - bh * 0.1;
      t[oppElbow].x = t[oppShoulder].x - (t[oppShoulder].x - hm.x) * 0.6;
      t[oppElbow].y = t[oppShoulder].y + bh * 0.05;
      t[oppWrist].x = t[oppShoulder].x - (t[oppShoulder].x - hm.x) * 1.1;
      t[oppWrist].y = t[oppShoulder].y + bh * 0.15;
      break;
    }
    case 'pass': {
      for (const side of [-1, 1]) {
        const s = side > 0 ? 6 : 5, e = side > 0 ? 8 : 7, w = side > 0 ? 10 : 9;
        t[e].x = t[s].x + (t[s].x - hm.x) * 0.5;
        t[e].y = t[s].y - bh * 0.05;
        t[w].x = t[s].x + (t[s].x - hm.x) * 1.2;
        t[w].y = t[s].y - bh * 0.02;
      }
      break;
    }
    case 'dribble': {
      const off = bh * 0.2;
      for (let i = 5; i <= 16; i++) t[i].y += off;
      t[7].y = t[5].y + bh * 0.25; t[9].y = t[5].y + bh * 0.5;
      t[8].y = t[6].y + bh * 0.25; t[10].y = t[6].y + bh * 0.5;
      t[13].y += bh * 0.1; t[14].y += bh * 0.1;
      break;
    }
    case 'run': {
      const leanX = (sm.x - hm.x) * 1.5;
      const offY = bh * 0.05;
      for (let i = 0; i < 17; i++) { t[i].x += leanX * (1 - t[i].y / (hm.y + bh)); t[i].y += offY; }
      t[7].x -= bh * 0.15; t[9].x -= bh * 0.3; t[7].y -= bh * 0.1; t[9].y -= bh * 0.1;
      t[8].x += bh * 0.15; t[10].x += bh * 0.3; t[8].y += bh * 0.05; t[10].y += bh * 0.1;
      t[13].x -= bh * 0.1; t[14].x += bh * 0.1;
      break;
    }
    case 'tackle': {
      const side2 = t[16].x < t[15].x ? 1 : -1;
      const extLeg = side2 > 0 ? 14 : 13, extAnkle = side2 > 0 ? 16 : 15;
      const baseLeg = side2 > 0 ? 13 : 14, baseAnkle = side2 > 0 ? 15 : 16;
      const extHip = side2 > 0 ? 12 : 11, baseHip = side2 > 0 ? 11 : 12;
      const off2 = bh * 0.35;
      for (let i = 5; i <= 16; i++) t[i].y += off2;
      t[extLeg].x = t[extHip].x + (t[extHip].x - t[baseHip].x) * 1.2;
      t[extLeg].y = t[extHip].y + bh * 0.3;
      t[extAnkle].x = t[extHip].x + (t[extHip].x - t[baseHip].x) * 2.0;
      t[extAnkle].y = t[extHip].y + bh * 0.7;
      t[baseLeg].x = t[baseHip].x;
      t[baseLeg].y = t[baseHip].y + bh * 0.4;
      t[baseAnkle].x = t[baseHip].x;
      t[baseAnkle].y = t[baseHip].y + bh * 0.8;
      break;
    }
    default: break;
  }
  return t;
}

function computeMatch(detected, target) {
  if (!detected || !target || detected.length < 17 || target.length < 17) return 0;
  let totalW = 0, totalSim = 0;
  for (let i = 0; i < 17; i++) {
    const w = detected[i].confidence || detected[i].score || 0.5;
    const d = dist(detected[i], target[i]);
    const maxD = 60;
    const sim = Math.max(0, 1 - d / maxD);
    totalSim += sim * w;
    totalW += w;
  }
  return totalW > 0 ? totalSim / totalW : 0;
}

function drawAll(detectedKps, targetKps) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const w = canvas.width, h = canvas.height;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const scale = Math.min(w / vw, h / vh);
  const ox = (w - vw * scale) / 2, oy = (h - vh * scale) / 2;

  if (targetKps) {
    const tk = targetKps.map(k => ({ sx: k.x * scale + ox, sy: k.y * scale + oy, c: 1 }));
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2.5;
    for (const [i, j] of SKELETON) {
      ctx.beginPath(); ctx.moveTo(tk[i].sx, tk[i].sy); ctx.lineTo(tk[j].sx, tk[j].sy);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.stroke();
    }
    for (const k of tk) {
      ctx.beginPath(); ctx.arc(k.sx, k.sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.fill();
    }
    ctx.setLineDash([]);
  }

  if (detectedKps) {
    const dk = detectedKps.map(k => ({
      x: k.x, y: k.y,
      c: k.confidence != null ? k.confidence : (k.score || 0),
      sx: k.x * scale + ox, sy: k.y * scale + oy
    }));
    for (const [i, j] of SKELETON) {
      if (dk[i].c < 0.3 || dk[j].c < 0.3) continue;
      const conf = (dk[i].c + dk[j].c) / 2;
      ctx.beginPath(); ctx.moveTo(dk[i].sx, dk[i].sy); ctx.lineTo(dk[j].sx, dk[j].sy);
      ctx.strokeStyle = conf > 0.7 ? '#22c55e' : conf > 0.4 ? '#f59e0b' : '#ef4444';
      ctx.lineWidth = 2 + conf * 2; ctx.stroke();
    }
    for (const k of dk) {
      if (k.c < 0.3) continue;
      const r = 3 + k.c * 3;
      ctx.beginPath(); ctx.arc(k.sx, k.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = k.c > 0.7 ? '#22c55e' : k.c > 0.4 ? '#f59e0b' : '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const valid = dk.filter(k => k.c > 0.3);
    const avg = valid.length ? valid.reduce((s, k) => s + k.c, 0) / valid.length : 0;
    $('kpCount').textContent = valid.length;
    $('kpConf').textContent = (avg * 100).toFixed(1) + '%';
  }
}

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

function getNextAction(allActions, currentAction) {
  const sorted = Object.entries(allActions).sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2) return sorted[0][0];
  return sorted[0][0] === currentAction ? sorted[1][0] : sorted[0][0];
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

async function detectPose() {
  if (state.predicting || !state.isCamera || !state.modelReady || !state.detector) return;
  state.predicting = true;
  try {
    const poses = await state.detector.estimatePoses(video, { flipHorizontal: false, maxPoses: 1 });
    if (poses && poses.length > 0) {
      const kps = poses[0].keypoints;
      const result = classifier.classify(kps);
      displayPrediction(result, kps);

      if (state.targetKeypoints) {
        state.matchScore = computeMatch(kps, state.targetKeypoints);
        updateMatchDisplay(state.matchScore);
      }

      drawAll(kps, state.targetKeypoints);
    }
  } catch (err) { console.warn('Detection error:', err); }
  state.predicting = false;
}

async function loadModel() {
  modelLoading.classList.add('visible');
  try {
    state.detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    state.modelReady = true;
  } catch (err) { console.error('Model load failed:', err); }
  modelLoading.classList.remove('visible');
}

async function startCamera() {
  if (state.mediaStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    state.mediaStream = stream; state.isCamera = true;
    video.srcObject = stream; video.style.display = 'block';
    video.onloadedmetadata = () => {
      video.play(); placeholder.style.display = 'none'; resizeCanvas();
      feedbackSection.classList.add('visible');
      feedbackStatus.textContent = '● Active'; feedbackStatus.className = 'feedback-status analyzing';
      animateFrame();
      state.detectInterval = setInterval(detectPose, 1000);
      detectPose();
    };
    btnCamera.textContent = '⏹ Stop'; btnCamera.classList.add('btn-camera-active');
    camIndicator.style.display = 'flex';
  } catch (err) { alert('Camera access denied.'); }
}

function stopCamera() {
  if (state.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
  if (state.detectInterval) { clearInterval(state.detectInterval); state.detectInterval = null; }
  if (state.mediaStream) { state.mediaStream.getTracks().forEach(t => t.stop()); state.mediaStream = null; }
  state.isCamera = false; state.predicting = false; video.srcObject = null;
  btnCamera.textContent = '📷 Camera'; btnCamera.classList.remove('btn-camera-active');
  camIndicator.style.display = 'none';
}

function animateFrame() {
  if (!state.isCamera || !video.srcObject) return;
  state.animFrameId = requestAnimationFrame(animateFrame);
}

function resetAll() {
  stopCamera(); video.style.display = 'none'; video.src = '';
  state.predictionHistory = []; streamItems = []; state.lastKeypoints = null;
  state.targetKeypoints = null; state.targetAction = null; state.matchScore = 0;
  feedbackSection.classList.remove('visible');
  feedbackStatus.textContent = '⏳ Waiting...'; feedbackStatus.className = 'feedback-status';
  feedbackMain.innerHTML = '<span class="fb-label">—</span><span class="fb-conf">—</span>';
  feedbackNext.innerHTML = '<span class="fb-next-label">—</span><span class="fb-next-icon">🎯</span>';
  feedbackBars.innerHTML = ''; matchPct.textContent = '0%'; matchBarFill.style.width = '0%';
  matchPct.style.color = '#94a3b8'; matchBarFill.style.background = '#3b82f6';
  feedbackStream.innerHTML = '<span class="stream-empty">Real-time analysis will appear here...</span>';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('kpCount').textContent = '0'; $('kpConf').textContent = '—';
  $('predictionResult').innerHTML = '<span class="pred-label">—</span><span class="pred-conf">—</span>';
  $('confidenceBars').innerHTML = ''; renderHistory();
  placeholder.style.display = 'flex';
}

btnCamera.addEventListener('click', () => { state.isCamera ? resetAll() : startCamera(); });
btnReset.addEventListener('click', resetAll);
resizeCanvas();
loadModel();
