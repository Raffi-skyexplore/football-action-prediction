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
  header: '#ec4899',
  turnover: '#f97316'
};

const state = {
  isCamera: false,
  predicting: false,
  predictionHistory: [],
  apiUrl: 'http://localhost:8000/predict',
  apiConnected: false,
  animFrameId: null,
  mediaStream: null,
  detectInterval: null,
  lastResult: null
};

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const placeholder = document.getElementById('placeholder');
const btnCamera = document.getElementById('btnCamera');
const btnReset = document.getElementById('btnReset');
const camIndicator = document.getElementById('camIndicator');
const feedbackSection = document.getElementById('feedbackSection');
const feedbackStatus = document.getElementById('feedbackStatus');
const feedbackMain = document.getElementById('feedbackMain');
const feedbackBars = document.getElementById('feedbackBars');
const feedbackStream = document.getElementById('feedbackStream');
const btnTestApi = document.getElementById('btnTestApi');
const apiUrlInput = document.getElementById('apiUrl');
const apiStatus = document.getElementById('apiStatus');

let streamItems = [];

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

window.addEventListener('resize', resizeCanvas);

function drawSkeleton(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!keypoints || keypoints.length === 0) return;

  const w = canvas.width, h = canvas.height;
  const vw = state.isCamera ? (video.videoWidth || 1280) : 640;
  const vh = state.isCamera ? (video.videoHeight || 720) : 480;
  const scale = Math.min(w / vw, h / vh);
  const ox = (w - vw * scale) / 2;
  const oy = (h - vh * scale) / 2;

  const kps = keypoints.map(kp => ({
    ...kp, sx: kp.x * scale + ox, sy: kp.y * scale + oy
  }));

  for (const [i, j] of SKELETON) {
    if (i >= kps.length || j >= kps.length) continue;
    const a = kps[i], b = kps[j];
    if (a.confidence < 0.3 || b.confidence < 0.3) continue;
    const conf = (a.confidence + b.confidence) / 2;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.strokeStyle = conf > 0.7 ? '#22c55e' : conf > 0.4 ? '#f59e0b' : '#ef4444';
    ctx.lineWidth = 2 + conf * 2;
    ctx.stroke();
  }

  for (const kp of kps) {
    const r = 3 + kp.confidence * 3;
    ctx.beginPath();
    ctx.arc(kp.sx, kp.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = kp.confidence > 0.7 ? '#22c55e' : kp.confidence > 0.4 ? '#f59e0b' : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const avgConf = kps.reduce((s, k) => s + k.confidence, 0) / kps.length;
  document.getElementById('kpCount').textContent = kps.length;
  document.getElementById('kpConf').textContent = (avgConf * 100).toFixed(1) + '%';
}

function generateMockKeypoints() {
  const kps = [];
  const baseX = 0.3 + Math.random() * 0.4;
  const baseY = 0.25 + Math.random() * 0.3;
  const offsets = [
    [0, -0.15], [-0.04, -0.16], [0.04, -0.16], [-0.08, -0.14], [0.08, -0.14],
    [-0.08, -0.08], [0.08, -0.08], [-0.14, -0.02], [0.14, -0.02],
    [-0.16, 0.04], [0.16, 0.04], [-0.06, 0.02], [0.06, 0.02],
    [-0.08, 0.10], [0.08, 0.10], [-0.08, 0.18], [0.08, 0.18]
  ];
  for (const [dx, dy] of offsets) {
    kps.push({
      x: (baseX + dx + (Math.random() - 0.5) * 0.02) * 640,
      y: (baseY + dy + (Math.random() - 0.5) * 0.02) * 480,
      confidence: 0.6 + Math.random() * 0.4
    });
  }
  return kps;
}

const ACTIONS = ['shoot', 'pass', 'dribble', 'run', 'tackle'];

function generateMockPrediction() {
  const confs = ACTIONS.map(() => Math.random());
  const total = confs.reduce((a, b) => a + b, 0);
  const normalized = confs.map(c => c / total);
  const maxIdx = normalized.indexOf(Math.max(...normalized));
  const allActions = {};
  ACTIONS.forEach((a, i) => { allActions[a] = normalized[i]; });
  return {
    action: ACTIONS[maxIdx],
    confidence: normalized[maxIdx],
    all_actions: allActions,
    keypoints: generateMockKeypoints()
  };
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

function displayPrediction(data) {
  updateFeedback(data);
  addHistory(data.action, data.confidence);
  state.lastResult = data;
}

async function callPredictAPI(imageData) {
  try {
    const resp = await fetch(state.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData }),
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.warn('API call failed, using mock:', err.message);
    return null;
  }
}

function captureAndPredict() {
  if (state.predicting || !state.isCamera) return;
  state.predicting = true;
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 640;
  c.height = video.videoHeight || 480;
  const cx = c.getContext('2d');
  cx.drawImage(video, 0, 0, c.width, c.height);
  const imageData = c.toDataURL('image/jpeg', 0.7);

  callPredictAPI(imageData).then(result => {
    if (!result) result = generateMockPrediction();
    displayPrediction(result);
    if (result.keypoints) drawSkeleton(result.keypoints);
    state.predicting = false;
  });
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
      state.detectInterval = setInterval(captureAndPredict, 1500);
      captureAndPredict();
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

async function testApiConnection() {
  const url = apiUrlInput.value.trim();
  state.apiUrl = url;
  apiStatus.textContent = 'Testing...';
  apiStatus.className = 'api-status';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: '' }),
      signal: AbortSignal.timeout(5000)
    });
    if (resp.ok) {
      state.apiConnected = true;
      apiStatus.textContent = 'Connected';
      apiStatus.className = 'api-status connected';
    } else throw new Error(`HTTP ${resp.status}`);
  } catch {
    state.apiConnected = false;
    apiStatus.textContent = 'Disconnected (mock mode active)';
    apiStatus.className = 'api-status error';
  }
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
btnTestApi.addEventListener('click', testApiConnection);
apiUrlInput.addEventListener('change', () => {
  state.apiUrl = apiUrlInput.value.trim();
});

resizeCanvas();
