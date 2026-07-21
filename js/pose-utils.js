let _heatCanvas = null;
let _heatCtx = null;
let _heatW = 0;
let _heatH = 0;

function _getHeatCanvas(w, h) {
  if (!_heatCanvas || _heatW !== w || _heatH !== h) {
    _heatCanvas = document.createElement('canvas');
    _heatCanvas.width = w;
    _heatCanvas.height = h;
    _heatCtx = _heatCanvas.getContext('2d');
    _heatW = w;
    _heatH = h;
  } else {
    _heatCtx.clearRect(0, 0, w, h);
  }
  return { canvas: _heatCanvas, ctx: _heatCtx };
}

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
      const oppS = kickSide > 0 ? 5 : 6, oppE = kickSide > 0 ? 7 : 8, oppW = kickSide > 0 ? 9 : 10;
      const thighLen = kickSide > 0 ? b.rThigh : b.lThigh;
      const shinLen = kickSide > 0 ? b.rShin : b.lShin;

      const hipPos = t[hIdx];
      const liftAngle = -1.0 * faceDir;
      t[kIdx] = add(hipPos, { x: Math.cos(liftAngle) * thighLen * 0.85, y: Math.sin(liftAngle) * thighLen * 0.7 });
      const kneeDir = norm(sub(t[kIdx], hipPos));
      const shinAngle = Math.atan2(kneeDir.y, kneeDir.x) + 0.4 * faceDir;
      t[aIdx] = add(t[kIdx], { x: Math.cos(shinAngle) * shinLen * 0.8, y: Math.sin(shinAngle) * shinLen * 0.6 });

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
      const bThigh = extSide > 0 ? b.lThigh : b.rThigh;
      const bShinVal = extSide > 0 ? b.lShin : b.rShin;
      const drop = b.torsoH * 0.35;

      for (let i = 5; i <= 12; i++) t[i].y += drop;
      t[11].y += drop * 0.5; t[12].y += drop * 0.5;
      t[5].y += drop * 0.3; t[6].y += drop * 0.3;

      const extendAngle = 0.6 * faceDir;
      t[eKnee] = add(t[eHip], { x: Math.cos(extendAngle) * eThigh, y: Math.sin(extendAngle) * eThigh * 0.3 });
      const extDir = norm(sub(t[eKnee], t[eHip]));
      const extShinAngle = Math.atan2(extDir.y, extDir.x) + 0.2;
      t[eAnkle] = add(t[eKnee], { x: Math.cos(extShinAngle) * eShin * 1.0, y: Math.sin(extShinAngle) * eShin * 0.3 });

      t[bKnee] = add(t[bHip], { x: -faceDir * bThigh * 0.1, y: bThigh * 0.7 });
      t[bAnkle] = add(t[bKnee], { x: 0, y: bShinVal * 0.6 });

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

function drawMocapLines(kps, isGhost) {
  if (!kps || kps.length < 17) return;
  const valid = kps.map(k => k.c || k.score || 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const lineColor = isGhost ? 'rgba(255,255,255,0.35)' : '#4ae0ff';
  const dotColor = isGhost ? 'rgba(255,255,255,0.3)' : '#4ae0ff';
  const alpha = isGhost ? 0.35 : 1;

  ctx.globalAlpha = alpha;

  const torso = [kps[5], kps[6], kps[12], kps[11]];
  if (torso.every(p => p)) {
    ctx.beginPath();
    ctx.moveTo(kps[5].x, kps[5].y);
    ctx.lineTo(kps[6].x, kps[6].y);
    ctx.lineTo(kps[12].x, kps[12].y);
    ctx.lineTo(kps[11].x, kps[11].y);
    ctx.closePath();
    if (isGhost) {
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(74, 224, 255, 0.06)';
      ctx.fill();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  for (const limb of LIMB_PAIRS) {
    const a = kps[limb.a], b = kps[limb.b];
    if (!a || !b) continue;
    if (valid[limb.a] < 0.3 || valid[limb.b] < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = isGhost ? 1.5 : 2.5;
    if (isGhost) ctx.setLineDash([4, 5]);
    ctx.stroke();
    if (isGhost) ctx.setLineDash([]);
  }

  for (let i = 0; i < 17; i++) {
    if (!kps[i] || valid[i] < 0.3) continue;
    if (i === 0) continue;
    ctx.beginPath();
    ctx.arc(kps[i].x, kps[i].y, isGhost ? 2 : 3, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
  }

  if (kps[0] && valid[0] >= 0.3) {
    const bh = dist(mid(kps[5], kps[6]), mid(kps[11], kps[12]));
    const headR = Math.max(6, bh * 0.12);
    ctx.beginPath();
    ctx.arc(kps[0].x, kps[0].y, headR, 0, Math.PI * 2);
    if (isGhost) {
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(74, 224, 255, 0.08)';
      ctx.fill();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;

  if (!isGhost) {
    const validKps = kps.filter((_, i) => valid[i] > 0.3);
    const avg = validKps.length ? validKps.reduce((s, k) => s + (k.c || k.score || 0), 0) / validKps.length : 0;
    $('kpCount').textContent = validKps.length;
    $('kpConf').textContent = (avg * 100).toFixed(1) + '%';
  }
}

function drawAll(detectedKps, targetKps) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const w = canvas.width, h = canvas.height;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const scale = Math.min(w / vw, h / vh);
  const ox = (w - vw * scale) / 2, oy = (h - vh * scale) / 2;

  if (targetKps) {
    const tk = targetKps.map(k => ({ x: k.x * scale + ox, y: k.y * scale + oy, score: 1, confidence: 1 }));
    drawMocapLines(tk, true);
  }

  if (detectedKps) {
    const dk = detectedKps.map(k => ({
      x: k.x * scale + ox, y: k.y * scale + oy,
      score: k.confidence != null ? k.confidence : (k.score || 0),
      confidence: k.confidence != null ? k.confidence : (k.score || 0)
    }));
    drawMocapLines(dk, false);
  }
}

function getPitchPosition(kps) {
  if (!kps || kps.length < 17) return null;
  const hip = mid(kps[11], kps[12]);
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  return { x: hip.x / vw, y: hip.y / vh };
}

function drawPitch() {
  const c = pitchCanvas, cx = pitchCtx;
  if (c.width < 10 || c.height < 10) return;
  const w = c.width, h = c.height;
  cx.clearRect(0, 0, w, h);

  const pad = 16;
  const pw = w - pad * 2, ph = h - pad * 2;

  function fx(v) { return pad + v * pw; }
  function fy(v) { return pad + v * ph; }

  cx.fillStyle = '#2d7d3f';
  cx.fillRect(0, 0, w, h);

  const alt = '#3a8a4a';
  for (let r = 0; r < ph; r += 12) {
    cx.fillStyle = (Math.floor(r / 12) % 4 < 2) ? alt : '#2d7d3f';
    cx.fillRect(pad, pad + r, pw, 12);
  }

  cx.strokeStyle = 'rgba(255,255,255,0.6)';
  cx.lineWidth = 2;
  cx.strokeRect(pad, pad, pw, ph);

  const cx0 = fx(0.5);
  cx.beginPath(); cx.moveTo(cx0, pad); cx.lineTo(cx0, pad + ph); cx.stroke();
  cx.beginPath(); cx.arc(cx0, pad + ph * 0.5, ph * 0.15, 0, Math.PI * 2); cx.stroke();

  const paTop = pad + ph * 0.12, paBot = pad + ph * 0.88;
  const paW = pw * 0.18;
  cx.strokeRect(fx(0) - paW, paTop, paW, paBot - paTop);
  cx.strokeRect(fx(1), paTop, paW, paBot - paTop);

  cx.lineWidth = 1.5;
  const gW = pw * 0.06;
  cx.strokeRect(fx(0) - gW, pad + ph * 0.35, gW, ph * 0.3);
  cx.strokeRect(fx(1), pad + ph * 0.35, gW, ph * 0.3);

  const actions = state.actionPositions;
  if (actions.length < 2) return;

  const edgeCount = Math.min(actions.length - 1, 80);
  const edgeStart = actions.length - 1 - edgeCount;
  for (let i = edgeStart; i < actions.length - 1; i++) {
    const a = actions[i], b = actions[i + 1];
    const age = (Date.now() - b.time) / 1000;
    const alpha = Math.max(0.08, 1 - age / 90);
    const x1 = fx(a.x), y1 = fy(a.y), x2 = fx(b.x), y2 = fy(b.y);
    const ca = ACTION_COLORS[a.action] || '#64748b';
    const cb = ACTION_COLORS[b.action] || '#64748b';

    const grad = cx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, ca + Math.round(alpha * 160).toString(16).padStart(2, '0'));
    grad.addColorStop(1, cb + Math.round(alpha * 160).toString(16).padStart(2, '0'));

    cx.beginPath();
    cx.moveTo(x1, y1);
    cx.lineTo(x2, y2);
    cx.strokeStyle = grad;
    cx.lineWidth = Math.max(1.5, 3 * alpha);
    cx.stroke();
  }

  const heatScale = 4;
  const hw = Math.ceil(w / heatScale), hh = Math.ceil(h / heatScale);
  const { canvas: offCanvas, ctx: offCtx } = _getHeatCanvas(hw, hh);

  for (const a of actions) {
    const age = (Date.now() - a.time) / 1000;
    if (age > 120) continue;
    const alpha = 1 - age / 120;
    const px = (a.x * pw + pad) / heatScale;
    const py = (a.y * ph + pad) / heatScale;
    const r = Math.max(4, 14 * alpha);
    const grad = offCtx.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.6})`);
    grad.addColorStop(0.4, `rgba(255,200,50,${alpha * 0.35})`);
    grad.addColorStop(1, `rgba(0,0,0,0)`);
    offCtx.fillStyle = grad;
    offCtx.beginPath();
    offCtx.arc(px, py, r, 0, Math.PI * 2);
    offCtx.fill();
  }

  const imgData = offCtx.getImageData(0, 0, hw, hh);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] / 255;
    if (v < 0.02) { d[i + 3] = 0; continue; }
    if (v < 0.3) {
      const t = v / 0.3;
      d[i] = 0; d[i + 1] = Math.round(80 + t * 120); d[i + 2] = Math.round(180 - t * 100);
    } else if (v < 0.55) {
      const t = (v - 0.3) / 0.25;
      d[i] = Math.round(t * 180); d[i + 1] = 200; d[i + 2] = Math.round(80 - t * 60);
    } else if (v < 0.75) {
      const t = (v - 0.55) / 0.2;
      d[i] = Math.round(180 + t * 75); d[i + 1] = Math.round(200 - t * 100); d[i + 2] = Math.round(20 - t * 10);
    } else {
      const t = Math.min(1, (v - 0.75) / 0.25);
      d[i] = Math.round(255 - t * 40); d[i + 1] = Math.round(100 - t * 60); d[i + 2] = Math.round(10 - t * 5);
    }
    d[i + 3] = Math.round(Math.min(v * 200, 200));
  }
  offCtx.putImageData(imgData, 0, 0);

  cx.save();
  cx.globalAlpha = 0.55;
  cx.imageSmoothingEnabled = true;
  cx.drawImage(offCanvas, 0, 0, w, h);
  cx.restore();

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const age = (Date.now() - a.time) / 1000;
    if (age > 120) continue;
    const alpha = Math.max(0.1, 1 - age / 120);
    const r = Math.max(3, 6 * (1 - age / 180));
    const color = ACTION_COLORS[a.action] || '#64748b';

    cx.beginPath();
    cx.arc(fx(a.x), fy(a.y), r, 0, Math.PI * 2);
    cx.fillStyle = color;
    cx.globalAlpha = alpha * 0.85;
    cx.fill();
    cx.strokeStyle = 'rgba(255,255,255,0.5)';
    cx.lineWidth = 1.2;
    cx.stroke();
  }
  cx.globalAlpha = 1;
}

function addActionPosition(kps, action) {
  const pos = getPitchPosition(kps);
  if (!pos) return;
  state.actionPositions.push({ x: pos.x, y: pos.y, action, time: Date.now() });
  if (state.actionPositions.length > 300) state.actionPositions.splice(0, 50);
  drawPitch();
}

function resizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
}

function resizePitchCanvas() {
  const rect = pitchCanvas.getBoundingClientRect();
  pitchCanvas.width = rect.width;
  pitchCanvas.height = rect.height;
  drawPitch();
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('resize', () => { if (skeleton3D) skeleton3D.resize(); });
window.addEventListener('resize', resizePitchCanvas);

function getNextAction(allActions, currentAction) {
  const entries = Object.entries(allActions);
  if (entries.length === 0) return 'stop';
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  if (sorted.length < 2 || sorted[0][0] !== currentAction) return sorted[0][0];
  return sorted[1][0];
}
