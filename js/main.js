const state = {
  isCamera: false, predicting: false, predictionHistory: [],
  detector: null, modelReady: false,
  animFrameId: null, mediaStream: null, detectInterval: null,
  lastKeypoints: null, targetKeypoints: null, targetAction: null,
  matchScore: 0, prevAction: null,
  role: 'player',
  llmModel: 'gemini',
  actionPositions: []
};

const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const placeholder = $('placeholder'), modelLoading = $('modelLoading');
const btnCamera = $('btnCamera'), btnReset = $('btnReset'), camIndicator = $('camIndicator');
const feedbackSection = $('feedbackSection'), feedbackStatus = $('feedbackStatus');
const feedbackMain = $('feedbackMain'), feedbackNext = $('feedbackNext');
const feedbackBars = $('feedbackBars'), feedbackStream = $('feedbackStream');
const matchPct = $('matchPct'), matchBarFill = $('matchBarFill');
const suggestionBody = $('suggestionBody');
const skeletonContainer = $('skeletonContainer');
const skeletonLabel = $('skeletonLabel');
const pitchCanvas = $('pitchCanvas');
const pitchCtx = pitchCanvas.getContext('2d');
const pitchCard = $('pitchCard');
const pitchLegend = $('pitchLegend');
const roleBadge = $('roleBadge');
const userDropdown = $('userDropdown');
const settingsPanel = $('settingsPanel');
const settingsOverlay = $('settingsOverlay');
const tipsPanel = $('tipsPanel');
const tipsOverlay = $('tipsOverlay');
const advancedPanel = $('advancedPanel');
const advancedOverlay = $('advancedOverlay');
const $apiKeyGroup = $('apiKeyGroup');
const $apiKeyInput = $('apiKeyInput');
const $apiKeyStatus = $('apiKeyStatus');

let streamItems = [];

async function loadModel() {
  modelLoading.classList.add('visible');
  try {
    state.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, POSE_MODEL.config);
    state.modelReady = true;
  } catch (err) { console.error('Model load failed:', err); }
  modelLoading.classList.remove('visible');
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
      state.detectInterval = setInterval(detectPose, advState.interval);
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
  feedbackStream.innerHTML = '<span class="stream-empty">Awaiting Champions League action...</span>';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('kpCount').textContent = '0'; $('kpConf').textContent = '—';
  $('predictionResult').innerHTML = '<span class="pred-label">—</span><span class="pred-conf">—</span>';
  $('confidenceBars').innerHTML = ''; renderHistory();
  suggestionBody.innerHTML = '<div class="suggestion-icon">🧘</div><div class="suggestion-text" id="suggestionText">Stand in frame to receive coaching tips</div>';
  if (skeleton3D) { skeleton3D.clear(); skeletonLabel.textContent = 'Waiting...'; }
  state.actionPositions = [];
  pitchCtx.clearRect(0, 0, pitchCanvas.width, pitchCanvas.height);
  placeholder.style.display = 'flex';
}

window.addEventListener('beforeunload', () => {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
  }
  if (state.detectInterval) clearInterval(state.detectInterval);
  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
});

// Event handlers
document.querySelectorAll('.dropdown-item').forEach(el => {
  el.addEventListener('click', () => setRole(el.dataset.role));
});

$('btnUser').addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown.classList.toggle('open');
});

document.addEventListener('click', () => userDropdown.classList.remove('open'));

$('btnSettings').addEventListener('click', openSettings);
$('settingsClose').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

$('btnTips').addEventListener('click', openTips);
$('tipsClose').addEventListener('click', closeTips);
tipsOverlay.addEventListener('click', closeTips);

$('btnAdvanced').addEventListener('click', openAdvanced);
$('advancedClose').addEventListener('click', closeAdvanced);
advancedOverlay.addEventListener('click', closeAdvanced);

btnCamera.addEventListener('click', () => { state.isCamera ? resetAll() : startCamera(); });
btnReset.addEventListener('click', resetAll);

document.querySelectorAll('.setting-option').forEach(el => {
  el.addEventListener('click', () => {
    const model = el.dataset.model;
    if (model === state.llmModel) return;
    state.llmModel = model;
    document.querySelectorAll('.setting-option').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    showApiKeyInput(model);
  });
});

$('btnSaveKey').addEventListener('click', () => {
  const key = $apiKeyInput.value.trim();
  if (!key) { $apiKeyStatus.textContent = 'Please enter an API key'; $apiKeyStatus.className = 'api-key-status err'; return; }
  setApiKey(state.llmModel, key);
  $apiKeyStatus.textContent = '✓ Key saved'; $apiKeyStatus.className = 'api-key-status ok';
});

document.querySelectorAll('.tips-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tips-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tips-page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const page = $('tipsPage' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
    if (page) page.classList.add('active');
  });
});

const advState = { interval: 1000, rotateSpeed: 0.008, animSpeed: 0.003, temperature: 0.7, maxTokens: 80, threshold: 0.5 };

$('advInterval').addEventListener('input', function() {
  advState.interval = +this.value;
  $('advIntervalVal').textContent = this.value + 'ms';
  if (state.detectInterval) { clearInterval(state.detectInterval); state.detectInterval = setInterval(detectPose, advState.interval); }
});
$('advRotate').addEventListener('input', function() {
  advState.rotateSpeed = +this.value;
  $('advRotateVal').textContent = this.value;
  if (skeleton3D) skeleton3D.setRotateSpeed(advState.rotateSpeed);
});
$('advAnim').addEventListener('input', function() {
  advState.animSpeed = +this.value;
  $('advAnimVal').textContent = this.value;
  if (skeleton3D) skeleton3D.setAnimSpeed(advState.animSpeed);
});
$('advTemp').addEventListener('input', function() {
  advState.temperature = +this.value;
  $('advTempVal').textContent = this.value;
});
$('advTokens').addEventListener('input', function() {
  advState.maxTokens = +this.value;
  $('advTokensVal').textContent = this.value;
});
$('advThresh').addEventListener('input', function() {
  advState.threshold = +this.value;
  $('advThreshVal').textContent = (+this.value).toFixed(2);
});

// Init
resizeCanvas();
initSkeleton3D();
resizePitchCanvas();
buildLegend();
loadModel();

const initModel = document.querySelector(`.setting-option[data-model="${state.llmModel}"]`);
if (initModel) { initModel.classList.add('active'); showApiKeyInput(state.llmModel); }
