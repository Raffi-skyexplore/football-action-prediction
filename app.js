const SKELETON = [
  [0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]
];

const ACTION_COLORS = {
  shoot: '#ef4444',
  pass: '#3b82f6',
  dribble: '#22c55e',
  run: '#f59e0b',
  tackle: '#8b5cf6',
  stop: '#64748b',
  header: '#ec4899'
};

const state = {
  isCamera: false,
  predicting: false,
  predictionHistory: [],
  detector: null,
  modelReady: false,
  animFrameId: null,
  mediaStream: null,
  detectInterval: null,
  lastResult: null
};

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const placeholder = document.getElementById('placeholder');
const modelLoading = document.getElementById('modelLoading');
const btnCamera = document.getElementById('btnCamera');
const btnReset = document.getElementById('btnReset');
const camIndicator = document.getElementById('camIndicator');
const feedbackSection = document.getElementById('feedbackSection');
const feedbackStatus = document.getElementById('feedbackStatus');
const feedbackMain = document.getElementById('feedbackMain');
const feedbackBars = document.getElementById('feedbackBars');
const feedbackStream = document.getElementById('feedbackStream');

let streamItems = [];
const ACTION_KEYS = ['shoot', 'pass', 'dribble', 'run', 'tackle', 'stop'];

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener('resize', resizeCanvas);

class ActionClassifier {
  classify(kps) {
    if (!kps || kps.length < 17) return this._fallback();
    const confs = kps.map(k => k.confidence != null ? k.confidence : k.score);
    const avgConf = confs.reduce((a, b) => a + b, 0) / confs.length;
    if (avgConf < 0.3) return this._fallback();

    const p = {};
    for (let i = 0; i < 17; i++) {
      p[i] = { x: kps[i].x, y: kps[i].y, c: confs[i] };
    }

    const shoulderMid = this._mid(p[5], p[6]);
    const hipMid = this._mid(p[11], p[12]);
    const bodyH = this._dist(shoulderMid, hipMid);
    if (bodyH < 1) return this._fallback();

    const leftLegLift = this._legLift(p[11], p[13], p[15], bodyH);
    const rightLegLift = this._legLift(p[12], p[14], p[16], bodyH);
    const legLift = Math.max(leftLegLift, rightLegLift);

    const leftArm = this._armReach(p[5], p[7], p[9], bodyH);
    const rightArm = this._armReach(p[6], p[8], p[10], bodyH);
    const armReach = Math.max(leftArm, rightArm);

    const crouch = this._crouch(shoulderMid, hipMid, bodyH);
    const lean = this._lean(shoulderMid, hipMid, bodyH);
    const stance = this._stance(p[15], p[16], hipMid, bodyH);

    const leftLegExt = this._legExtension(p[11], p[13], p[15], bodyH);
    const rightLegExt = this._legExtension(p[12], p[14], p[16], bodyH);
    const legExt = Math.max(leftLegExt, rightLegExt);

    let shootScore = Math.min(1, legLift * 2.5);
    let passScore = Math.min(1, armReach * 2.0) * (1 - shootScore * 0.5);
    let dribbleScore = Math.min(1, crouch * 2.5) * (1 - shootScore * 0.3);
    let runScore = Math.min(1, lean * 2.0) * (1 - shootScore * 0.4) * (1 - crouch * 0.3);
    let tackleScore = Math.min(1, (crouch * 1.5 + legExt * 1.5) * 0.6) * (1 - armReach * 0.3);
    let stopScore = Math.max(0, 1 - (shootScore + passScore + dribbleScore + runScore + tackleScore) * 0.6);

    const raw = [shootScore, passScore, dribbleScore, runScore, tackleScore, stopScore];
    const total = raw.reduce((a, b) => a + b, 0) || 1;
    const normalized = raw.map(v => v / total);
    const maxIdx = normalized.indexOf(Math.max(...normalized));

    const allActions = {};
    ACTION_KEYS.forEach((a, i) => { allActions[a] = normalized[i]; });

    return {
      action: ACTION_KEYS[maxIdx],
      confidence: normalized[maxIdx],
      all_actions: allActions,
      features: { legLift, armReach, crouch, lean, stance, legExt }
    };
  }

  _mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
  _legLift(hip, knee, ankle, bodyH) {
    const hipToAnkle = this._dist(hip, ankle);
    const hipToKnee = this._dist(hip, knee);
    return Math.max(0, (hipToKnee - hipToAnkle) / bodyH);
  }
  _armReach(shoulder, elbow, wrist, bodyH) {
    return this._dist(shoulder, wrist) / bodyH;
  }
  _crouch(shoulder, hip, bodyH) {
    const ratio = (hip.y - shoulder.y) / bodyH;
    return Math.max(0, Math.min(1, ratio / 1.8));
  }
  _lean(shoulder, hip, bodyH) {
    const dx = Math.abs(shoulder.x - hip.x);
    return Math.min(1, dx / bodyH * 2);
  }
  _stance(a, b, hip, bodyH) {
    return this._dist(a, b) / bodyH;
  }
  _legExtension(hip, knee, ankle, bodyH) {
    const fullLen = this._dist(hip, knee) + this._dist(knee, ankle);
    const straight = this._dist(hip, ankle);
    return Math.max(0, (straight - fullLen * 0.5) / bodyH);
  }
  _fallback() {
    const all = {};
    ACTION_KEYS.forEach(a => { all[a] = a === 'stop' ? 1 : 0; });
    return { action: 'stop', confidence: 1, all_actions: all, features: {} };
  }
}

const classifier = new ActionClassifier();

async function loadModel() {
  modelLoading.classList.add('visible');
  try {
    state.detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    state.modelReady = true;
  } catch (err) {
    console.error('Model load failed:', err);
  }
  modelLoading.classList.remove('visible');
}

function drawSkeleton(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!keypoints || keypoints.length === 0) return;

  const w = canvas.width, h = canvas.height;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const scale = Math.min(w / vw, h / vh);
  const ox = (w - vw * scale) / 2, oy = (h - vh * scale) / 2;

  const kps = keypoints.map(kp => ({
    x: kp.x, y: kp.y,
    c: kp.confidence != null ? kp.confidence : (kp.score || 0),
    sx: kp.x * scale + ox, sy: kp.y * scale + oy
  }));

  for (const [i, j] of SKELETON) {
    if (i >= kps.length || j >= kps.length) continue;
    const a = kps[i], b = kps[j];
    if (a.c < 0.3 || b.c < 0.3) continue;
    const conf = (a.c + b.c) / 2;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.strokeStyle = conf > 0.7 ? '#22c55e' : conf > 0.4 ? '#f59e0b' : '#ef4444';
    ctx.lineWidth = 2 + conf * 2;
    ctx.stroke();
  }

  for (const kp of kps) {
    if (kp.c < 0.3) continue;
    const r = 3 + kp.c * 3;
    ctx.beginPath();
    ctx.arc(kp.sx, kp.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = kp.c > 0.7 ? '#22c55e' : kp.c > 0.4 ? '#f59e0b' : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const valid = kps.filter(k => k.c > 0.3);
  const avg = valid.length ? valid.reduce((s, k) => s + k.c, 0) / valid.length : 0;
  document.getElementById('kpCount').textContent = valid.length;
  document.getElementById('kpConf').textContent = (avg * 100).toFixed(1) + '%';
}

function renderBars(container, allActions) {
  container.innerHTML = '';
  const sorted = Object.entries(allActions).sort((a, b) => b[1] - a[1]);
  for (const [action, conf] of sorted) {
    const row = document.createElement('div');
    row.className = 'conf-bar-row';
    const label = document.createElement('span');
    label.className = 'conf-bar-label';
    label.textContent = action;
    const track = document.createElement('div');
    track.className = 'conf-bar-track';
    const fill = document.createElement('div');
    fill.className = 'conf-bar-fill';
    fill.style.width = (conf * 100) + '%';
    fill.style.background = ACTION_COLORS[action] || '#3b82f6';
    track.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'conf-bar-value';
    value.textContent = (conf * 100).toFixed(0) + '%';
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);
    container.appendChild(row);
  }
}

function addStreamItem(action, confidence) {
  const time = new Date().toLocaleTimeString();
  streamItems.unshift({ action, confidence, time });
  if (streamItems.length > 20) streamItems.pop();
  feedbackStream.innerHTML = streamItems.map(item => `
    <div class="stream-item">
      <span class="stream-time">${item.time}</span>
      <span class="stream-action" style="color: ${ACTION_COLORS[item.action] || '#e2e8f0'}">${item.action}</span>
      <span class="stream-conf">${(item.confidence * 100).toFixed(0)}%</span>
    </div>
  `).join('');
}

function updateFeedback(data) {
  feedbackStatus.textContent = '● Analyzing';
  feedbackStatus.className = 'feedback-status analyzing';
  feedbackMain.innerHTML = `
    <span class="fb-label" style="color: ${ACTION_COLORS[data.action] || '#f1f5f9'}">${data.action}</span>
    <span class="fb-conf">${(data.confidence * 100).toFixed(1)}%</span>
  `;
  renderBars(feedbackBars, data.all_actions);
  addStreamItem(data.action, data.confidence);
}

function addHistory(action, confidence) {
  state.predictionHistory.unshift({
    action, confidence, time: new Date().toLocaleTimeString()
  });
  if (state.predictionHistory.length > 50) state.predictionHistory.pop();
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (state.predictionHistory.length === 0) {
    list.innerHTML = '<span class="history-empty">No predictions yet</span>';
    return;
  }
  list.innerHTML = state.predictionHistory.map(h => `
    <div class="history-item">
      <span class="h-action" style="color: ${ACTION_COLORS[h.action] || '#e2e8f0'}">${h.action}</span>
      <span class="h-conf">${(h.confidence * 100).toFixed(1)}%</span>
      <span class="h-time">${h.time}</span>
    </div>
  `).join('');
}

function displayPrediction(data, keypoints) {
  updateFeedback(data);
  addHistory(data.action, data.confidence);
  state.lastResult = data;
  drawSkeleton(keypoints);

  document.getElementById('predictionResult').innerHTML = `
    <span class="pred-label" style="color: ${ACTION_COLORS[data.action] || '#f1f5f9'}">${data.action}</span>
    <span class="pred-conf">${(data.confidence * 100).toFixed(1)}%</span>
  `;
  renderBars(document.getElementById('confidenceBars'), data.all_actions);
}

async function detectPose() {
  if (state.predicting || !state.isCamera || !state.modelReady || !state.detector) return;
  state.predicting = true;
  try {
    const poses = await state.detector.estimatePoses(video, {
      flipHorizontal: false, maxPoses: 1
    });
    if (poses && poses.length > 0) {
      const kps = poses[0].keypoints;
      const skps = kps.map(k => ({ x: k.x, y: k.y, confidence: k.score }));
      const result = classifier.classify(kps);
      displayPrediction(result, skps);
    }
  } catch (err) {
    console.warn('Detection error:', err);
  }
  state.predicting = false;
}

async function startCamera() {
  if (state.mediaStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    state.mediaStream = stream;
    state.isCamera = true;

    video.srcObject = stream;
    video.style.display = 'block';
    video.onloadedmetadata = () => {
      video.play();
      placeholder.style.display = 'none';
      resizeCanvas();
      feedbackSection.classList.add('visible');
      feedbackStatus.textContent = '● Analyzing';
      feedbackStatus.className = 'feedback-status analyzing';
      animateFrame();
      state.detectInterval = setInterval(detectPose, 1000);
      detectPose();
    };

    btnCamera.textContent = '⏹ Stop';
    btnCamera.classList.add('btn-camera-active');
    camIndicator.style.display = 'flex';
  } catch (err) {
    alert('Camera access denied. Please allow camera permissions.');
  }
}

function stopCamera() {
  if (state.animFrameId) {
    cancelAnimationFrame(state.animFrameId);
    state.animFrameId = null;
  }
  if (state.detectInterval) {
    clearInterval(state.detectInterval);
    state.detectInterval = null;
  }
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }
  state.isCamera = false;
  state.predicting = false;
  video.srcObject = null;
  btnCamera.textContent = '📷 Camera';
  btnCamera.classList.remove('btn-camera-active');
  camIndicator.style.display = 'none';
}

function animateFrame() {
  if (!state.isCamera || !video.srcObject) return;
  state.animFrameId = requestAnimationFrame(animateFrame);
}

function resetAll() {
  stopCamera();
  video.style.display = 'none';
  video.src = '';
  state.predictionHistory = [];
  streamItems = [];
  state.lastResult = null;

  feedbackSection.classList.remove('visible');
  feedbackStatus.textContent = '⏳ Waiting...';
  feedbackStatus.className = 'feedback-status';
  feedbackMain.innerHTML = '<span class="fb-label">—</span><span class="fb-conf">—</span>';
  feedbackBars.innerHTML = '';
  feedbackStream.innerHTML = '<span class="stream-empty">Real-time analysis will appear here...</span>';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('kpCount').textContent = '0';
  document.getElementById('kpConf').textContent = '—';
  document.getElementById('predictionResult').innerHTML = `
    <span class="pred-label">—</span>
    <span class="pred-conf">—</span>
  `;
  document.getElementById('confidenceBars').innerHTML = '';
  renderHistory();
  placeholder.style.display = 'flex';
}

btnCamera.addEventListener('click', () => {
  if (state.isCamera) resetAll();
  else startCamera();
});

btnReset.addEventListener('click', resetAll);

resizeCanvas();
loadModel();
