const SKELETON = [
  [0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]
];

const KEYPOINT_NAMES = [
  'nose','l_eye','r_eye','l_ear','r_ear','l_shoulder','r_shoulder',
  'l_elbow','r_elbow','l_wrist','r_wrist','l_hip','r_hip',
  'l_knee','r_knee','l_ankle','r_ankle'
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
  sourceLoaded: false,
  isVideo: false,
  predicting: false,
  predictionHistory: [],
  apiUrl: 'http://localhost:8000/predict',
  apiConnected: false,
  animFrameId: null
};

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const placeholder = document.getElementById('placeholder');
const fileInput = document.getElementById('fileInput');
const btnPredict = document.getElementById('btnPredict');
const btnReset = document.getElementById('btnReset');
const btnTestApi = document.getElementById('btnTestApi');
const apiUrlInput = document.getElementById('apiUrl');
const apiStatus = document.getElementById('apiStatus');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

window.addEventListener('resize', resizeCanvas);

function drawSkeleton(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!keypoints || keypoints.length === 0) return;

  const w = canvas.width;
  const h = canvas.height;
  const vw = state.isVideo ? video.videoWidth : video.naturalWidth || 640;
  const vh = state.isVideo ? video.videoHeight : video.naturalHeight || 480;
  const scaleX = w / vw;
  const scaleY = h / vh;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (w - vw * scale) / 2;
  const offsetY = (h - vh * scale) / 2;

  const kps = keypoints.map(kp => ({
    ...kp,
    sx: kp.x * scale + offsetX,
    sy: kp.y * scale + offsetY
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
    ctx.fillStyle = kp.confidence > 0.7
      ? '#22c55e'
      : kp.confidence > 0.4
        ? '#f59e0b'
        : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const avgConf = kps.reduce((s, k) => s + k.confidence, 0) / kps.length;
  document.getElementById('kpCount').textContent = kps.length;
  document.getElementById('kpConf').textContent = (avgConf * 100).toFixed(1) + '%';
}

function drawPlaceholder(visible) {
  placeholder.style.display = visible ? 'flex' : 'none';
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
      x: (baseX + dx + (Math.random() - 0.5) * 0.02) * (video.videoWidth || 640),
      y: (baseY + dy + (Math.random() - 0.5) * 0.02) * (video.videoHeight || 480),
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

function renderConfidenceBars(allActions) {
  const container = document.getElementById('confidenceBars');
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

function renderPrediction(action, confidence) {
  document.getElementById('predictionResult').innerHTML = `
    <span class="pred-label" style="color: ${ACTION_COLORS[action] || '#f1f5f9'}">${action}</span>
    <span class="pred-conf">${(confidence * 100).toFixed(1)}%</span>
  `;
}

function addHistory(action, confidence) {
  state.predictionHistory.unshift({
    action,
    confidence,
    time: new Date().toLocaleTimeString()
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
  renderPrediction(data.action, data.confidence);
  renderConfidenceBars(data.all_actions);
  addHistory(data.action, data.confidence);

  if (data.keypoints) {
    drawSkeleton(data.keypoints);
  }
}

async function callPredictAPI(imageData) {
  try {
    const resp = await fetch(state.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.warn('API call failed, using mock:', err.message);
    return null;
  }
}

function captureFrame() {
  if (state.isVideo && video.paused) return null;
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 640;
  c.height = video.videoHeight || 480;
  const cx = c.getContext('2d');
  cx.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

async function runPrediction() {
  if (state.predicting) return;
  state.predicting = true;
  btnPredict.disabled = true;
  btnPredict.textContent = '⏳ Predicting...';

  const imageData = captureFrame();
  if (!imageData) {
    state.predicting = false;
    btnPredict.disabled = false;
    btnPredict.textContent = '🔮 Predict';
    return;
  }

  let result = await callPredictAPI(imageData);

  if (!result) {
    result = generateMockPrediction();
  }

  displayPrediction(result);
  drawSkeleton(result.keypoints);

  state.predicting = false;
  btnPredict.disabled = false;
  btnPredict.textContent = '🔮 Predict';
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
    } else {
      throw new Error(`HTTP ${resp.status}`);
    }
  } catch {
    state.apiConnected = false;
    apiStatus.textContent = 'Disconnected (mock mode active)';
    apiStatus.className = 'api-status error';
  }
}

function handleFile(file) {
  if (state.animFrameId) {
    cancelAnimationFrame(state.animFrameId);
    state.animFrameId = null;
  }

  const url = URL.createObjectURL(file);
  state.isVideo = file.type.startsWith('video/');

  if (state.isVideo) {
    video.src = url;
    video.style.display = 'block';
    video.onloadeddata = () => {
      state.sourceLoaded = true;
      btnPredict.disabled = false;
      drawPlaceholder(false);
      resizeCanvas();
      video.play();
      animateFrame();
    };
  } else {
    video.src = url;
    video.style.display = 'block';
    video.onloadeddata = () => {
      state.sourceLoaded = true;
      btnPredict.disabled = false;
      drawPlaceholder(false);
      resizeCanvas();
      drawSkeleton(generateMockKeypoints());
    };
  }
}

function animateFrame() {
  if (!state.isVideo || video.paused || video.ended) return;
  if (state.sourceLoaded && !state.predicting) {
    const kps = generateMockKeypoints();
    drawSkeleton(kps);
  }
  state.animFrameId = requestAnimationFrame(animateFrame);
}

function resetAll() {
  if (state.animFrameId) {
    cancelAnimationFrame(state.animFrameId);
    state.animFrameId = null;
  }
  video.pause();
  video.src = '';
  video.style.display = 'none';
  state.sourceLoaded = false;
  state.isVideo = false;
  state.predicting = false;
  state.predictionHistory = [];
  btnPredict.disabled = true;
  drawPlaceholder(true);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('predictionResult').innerHTML = `
    <span class="pred-label">—</span>
    <span class="pred-conf">—</span>
  `;
  document.getElementById('confidenceBars').innerHTML = '';
  document.getElementById('kpCount').textContent = '0';
  document.getElementById('kpConf').textContent = '—';
  renderHistory();
}

fileInput.addEventListener('change', e => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('drop', e => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (files.length > 0 && (files[0].type.startsWith('video/') || files[0].type.startsWith('image/'))) {
    handleFile(files[0]);
  }
});

btnPredict.addEventListener('click', runPrediction);
btnReset.addEventListener('click', resetAll);
btnTestApi.addEventListener('click', testApiConnection);
apiUrlInput.addEventListener('change', () => {
  state.apiUrl = apiUrlInput.value.trim();
});

resizeCanvas();
drawPlaceholder(true);
