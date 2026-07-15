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

function pt(x, y) { return { x, y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function scale(v, s) { return { x: v.x * s, y: v.y * s }; }
function norm(v) { const l = Math.hypot(v.x, v.y); return l ? { x: v.x / l, y: v.y / l } : pt(0, 0); }
function rot(v, a) { const c = Math.cos(a), s = Math.sin(a); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; }

function measureBody(kps) {
  return {
    torsoW: dist(kps[5], kps[6]),
    torsoH: dist(mid(kps[5], kps[6]), mid(kps[11], kps[12])),
    lUpperArm: dist(kps[5], kps[7]), lForearm: dist(kps[7], kps[9]),
    rUpperArm: dist(kps[6], kps[8]), rForearm: dist(kps[8], kps[10]),
    lThigh: dist(kps[11], kps[13]), lShin: dist(kps[13], kps[15]),
    rThigh: dist(kps[12], kps[14]), rShin: dist(kps[14], kps[16]),
    lHip: kps[11], rHip: kps[12], lFoot: kps[15], rFoot: kps[16],
    head: kps[0]
  };
}

function generateTargetPose(kps, nextAction) {
  if (!kps || kps.length < 17) return null;
  const t = kps.map(k => ({ x: k.x, y: k.y, confidence: 1 }));
  const b = measureBody(kps);
  if (b.torsoH < 1) return null;

  const sm = mid(t[5], t[6]), hm = mid(t[11], t[12]);
  const faceDir = t[0].x > hm.x ? 1 : -1;

  switch (nextAction) {
    case 'shoot': {
      const kickSide = (b.rFoot.y > b.lFoot.y) === (faceDir > 0) ? 1 : -1;
      const kIdx = kickSide > 0 ? 14 : 13, aIdx = kickSide > 0 ? 16 : 15;
      const hIdx = kickSide > 0 ? 12 : 11;
      const sIdx = kickSide > 0 ? 6 : 5, eIdx = kickSide > 0 ? 8 : 7, wIdx = kickSide > 0 ? 10 : 9;
      const oppS = kickSide > 0 ? 5 : 6, oppE = kickSide > 0 ? 7 : 8, oppW = kickSide > 0 ? 9 : 10;
      const thighLen = kickSide > 0 ? b.rThigh : b.lThigh;
      const shinLen = kickSide > 0 ? b.rShin : b.lShin;
      const oppThigh = kickSide > 0 ? b.lThigh : b.rThigh;
      const oppShin = kickSide > 0 ? b.lShin : b.rShin;

      const hipPos = t[hIdx];
      const liftAngle = -1.0 * faceDir;
      t[kIdx] = add(hipPos, { x: Math.cos(liftAngle) * thighLen * 0.85, y: Math.sin(liftAngle) * thighLen * 0.7 });
      const kneeDir = norm(sub(t[kIdx], hipPos));
      const shinAngle = Math.atan2(kneeDir.y, kneeDir.x) + 0.4 * faceDir;
      t[aIdx] = add(t[kIdx], { x: Math.cos(shinAngle) * shinLen * 0.8, y: Math.sin(shinAngle) * shinLen * 0.6 });

      const oppHip = kickSide > 0 ? t[11] : t[12];
      t[oppE] = add(t[oppS], rot(scale(norm(sub(t[oppS], hm)), b.lUpperArm), -0.3 * faceDir));
      const oppElbowDir = norm(sub(t[oppE], t[oppS]));
      const oppForeAngle = Math.atan2(oppElbowDir.y, oppElbowDir.x) - 0.5 * faceDir;
      t[oppW] = add(t[oppE], { x: Math.cos(oppForeAngle) * (kickSide > 0 ? b.lForearm : b.rForearm), y: Math.sin(oppForeAngle) * (kickSide > 0 ? b.lForearm : b.rForearm) * 0.7 });
      break;
    }
    case 'pass': {
      for (const sd of [-1, 1]) {
        const s = sd > 0 ? 6 : 5, e = sd > 0 ? 8 : 7, w = sd > 0 ? 10 : 9;
        const uaLen = sd > 0 ? b.rUpperArm : b.lUpperArm;
        const faLen = sd > 0 ? b.rForearm : b.lForearm;
        const dir = sd * faceDir;
        const shoulder = t[s];
        t[e] = add(shoulder, { x: Math.cos(dir * 0.3) * uaLen, y: Math.sin(dir * 0.3) * uaLen * 0.2 });
        t[w] = add(t[e], { x: Math.cos(dir * 0.15) * faLen, y: Math.sin(dir * 0.15) * faLen * 0.15 });
      }
      break;
    }
    case 'dribble': {
      const droop = b.torsoH * 0.3;
      for (let i = 5; i <= 12; i++) t[i].y += droop;
      t[5].y += droop * 0.3; t[6].y += droop * 0.3;
      t[11].y += droop * 0.9; t[12].y += droop * 0.9;
      t[13].y = t[11].y + b.lThigh * 0.5; t[14].y = t[12].y + b.rThigh * 0.5;
      t[15].y = t[13].y + b.lShin * 0.7; t[16].y = t[14].y + b.rShin * 0.7;
      t[15].x = t[11].x; t[16].x = t[12].x;
      t[7].y = t[5].y + b.lUpperArm * 0.4; t[8].y = t[6].y + b.rUpperArm * 0.4;
      t[9].y = t[7].y + b.lForearm * 0.5; t[10].y = t[8].y + b.rForearm * 0.5;
      t[9].x = t[7].x; t[10].x = t[8].x;
      break;
    }
    case 'run': {
      const fwd = pt(faceDir * b.torsoH * 0.15, b.torsoH * 0.08);
      for (let i = 0; i < 17; i++) t[i] = add(t[i], scale(fwd, 1 - i / 18));
      t[7] = sub(t[7], pt(b.lUpperArm * 0.3, b.lUpperArm * 0.2));
      t[9] = sub(t[9], pt(b.lForearm * 0.4, b.lForearm * 0.1));
      t[8] = add(t[8], pt(b.rUpperArm * 0.3, -b.rUpperArm * 0.1));
      t[10] = add(t[10], pt(b.rForearm * 0.4, -b.rForearm * 0.05));
      t[13] = sub(t[13], pt(b.lThigh * 0.15, 0));
      t[15] = sub(t[15], pt(b.lShin * 0.2, 0));
      t[14] = add(t[14], pt(b.rThigh * 0.15, 0));
      t[16] = add(t[16], pt(b.rShin * 0.2, 0));
      break;
    }
    case 'tackle': {
      const extSide = b.rFoot.x < b.lFoot.x ? 1 : -1;
      const eHip = extSide > 0 ? 12 : 11, eKnee = extSide > 0 ? 14 : 13, eAnkle = extSide > 0 ? 16 : 15;
      const bHip = extSide > 0 ? 11 : 12, bKnee = extSide > 0 ? 13 : 14, bAnkle = extSide > 0 ? 15 : 16;
      const eThigh = extSide > 0 ? b.rThigh : b.lThigh;
      const eShin = extSide > 0 ? b.rShin : b.lShin;
      const drop = b.torsoH * 0.35;

      for (let i = 5; i <= 12; i++) t[i].y += drop;
      t[11].y += drop * 0.5; t[12].y += drop * 0.5;
      t[5].y += drop * 0.3; t[6].y += drop * 0.3;

      const extendAngle = 0.6 * faceDir;
      t[eKnee] = add(t[eHip], { x: Math.cos(extendAngle) * eThigh, y: Math.sin(extendAngle) * eThigh * 0.3 });
      const extDir = norm(sub(t[eKnee], t[eHip]));
      const extShinAngle = Math.atan2(extDir.y, extDir.x) + 0.2;
      t[eAnkle] = add(t[eKnee], { x: Math.cos(extShinAngle) * eShin * 1.0, y: Math.sin(extShinAngle) * eShin * 0.3 });

      t[bKnee] = add(t[bHip], { x: -faceDir * b.lThigh * 0.1, y: b.lThigh * 0.7 });
      t[bAnkle] = add(t[bKnee], { x: 0, y: (extSide > 0 ? b.lShin : b.rShin) * 0.6 });

      t[7] = add(t[5], scale(sub(t[5], hm), 0.6));
      t[9] = add(t[7], scale(sub(t[7], t[5]), 0.8));
      t[8] = add(t[6], scale(sub(t[6], hm), 0.6));
      t[10] = add(t[8], scale(sub(t[8], t[6]), 0.8));
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

const LIMB_PAIRS = [
  { a: 5, b: 6, w: 1.0 }, { a: 5, b: 7, w: 0.55 }, { a: 7, b: 9, w: 0.4 },
  { a: 6, b: 8, w: 0.55 }, { a: 8, b: 10, w: 0.4 },
  { a: 11, b: 12, w: 0.8 }, { a: 11, b: 13, w: 0.65 }, { a: 13, b: 15, w: 0.45 },
  { a: 12, b: 14, w: 0.65 }, { a: 14, b: 16, w: 0.45 },
  { a: 5, b: 11, w: 0.9 }, { a: 6, b: 12, w: 0.9 },
  { a: 0, b: 5, w: 0.5 }, { a: 0, b: 6, w: 0.5 }
];

function drawRealBody(kps, isGhost) {
  if (!kps || kps.length < 17) return;

  const bh = dist(mid(kps[5], kps[6]), mid(kps[11], kps[12]));
  const refW = Math.max(20, bh * 0.22);
  const headR = Math.max(8, bh * 0.14);

  const valid = kps.map(k => k.c || k.score || 0);
  const avgC = valid.reduce((a, b) => a + b, 0) / valid.length;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (isGhost) {
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.35;

    const torsoPts = [kps[5], kps[6], kps[12], kps[11]];
    if (torsoPts.every((p, i) => torsoPts[i])) {
      ctx.beginPath();
      ctx.moveTo(kps[5].x, kps[5].y);
      ctx.lineTo(kps[6].x, kps[6].y);
      ctx.lineTo(kps[12].x, kps[12].y);
      ctx.lineTo(kps[11].x, kps[11].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const limb of LIMB_PAIRS) {
      const a = kps[limb.a], b = kps[limb.b];
      if (!a || !b) continue;
      if (valid[limb.a] < 0.3 || valid[limb.b] < 0.3) continue;
      const lw = refW * limb.w * 0.55;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(3, lw);
      ctx.setLineDash([4, 5]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(kps[0].x, kps[0].y, headR * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 1;
    return;
  }

  const color = avgC > 0.7 ? '#22c55e' : avgC > 0.4 ? '#f59e0b' : '#ef4444';

  const torsoPts = [kps[5], kps[6], kps[12], kps[11]];
  if (torsoPts.every(p => p)) {
    ctx.beginPath();
    ctx.moveTo(kps[5].x, kps[5].y);
    ctx.lineTo(kps[6].x, kps[6].y);
    ctx.lineTo(kps[12].x, kps[12].y);
    ctx.lineTo(kps[11].x, kps[11].y);
    ctx.closePath();
    const grad = ctx.createLinearGradient(kps[5].x, kps[5].y, kps[12].x, kps[12].y);
    grad.addColorStop(0, color + '80');
    grad.addColorStop(1, color + '30');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = color + '90';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  for (const limb of LIMB_PAIRS) {
    const a = kps[limb.a], b = kps[limb.b];
    if (!a || !b) continue;
    if (valid[limb.a] < 0.3 || valid[limb.b] < 0.3) continue;
    const conf = (valid[limb.a] + valid[limb.b]) / 2;
    const lw = refW * limb.w * (0.4 + conf * 0.4);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = conf > 0.7 ? color : conf > 0.4 ? '#f59e0b' : '#ef4444';
    ctx.lineWidth = Math.max(4, lw);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(kps[0].x, kps[0].y, headR, 0, Math.PI * 2);
  const hGrad = ctx.createRadialGradient(kps[0].x - headR * 0.3, kps[0].y - headR * 0.3, 1, kps[0].x, kps[0].y, headR);
  hGrad.addColorStop(0, color + 'cc');
  hGrad.addColorStop(1, color + '60');
  ctx.fillStyle = hGrad;
  ctx.fill();
  ctx.strokeStyle = color + '80';
  ctx.lineWidth = 2;
  ctx.stroke();

  const validKps = kps.filter((_, i) => valid[i] > 0.3);
  const avg = validKps.length ? validKps.reduce((s, k) => s + (k.c || k.score || 0), 0) / validKps.length : 0;
  $('kpCount').textContent = validKps.length;
  $('kpConf').textContent = (avg * 100).toFixed(1) + '%';
}

function drawAll(detectedKps, targetKps) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const w = canvas.width, h = canvas.height;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const scale = Math.min(w / vw, h / vh);
  const ox = (w - vw * scale) / 2, oy = (h - vh * scale) / 2;

  if (targetKps) {
    const tk = targetKps.map(k => ({ x: k.x * scale + ox, y: k.y * scale + oy, score: 1, confidence: 1 }));
    drawRealBody(tk, true);
  }

  if (detectedKps) {
    const dk = detectedKps.map(k => ({
      x: k.x * scale + ox, y: k.y * scale + oy,
      score: k.confidence != null ? k.confidence : (k.score || 0),
      confidence: k.confidence != null ? k.confidence : (k.score || 0)
    }));
    drawRealBody(dk, false);
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
  feedbackStream.innerHTML = '<span class="stream-empty">Awaiting Champions League action...</span>';
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
