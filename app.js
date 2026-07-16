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
  matchScore: 0, prevAction: null,
  role: 'player',
  llmModel: 'gemini',
  actionPositions: []
};

const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const placeholder = $('placeholder'), modelLoading = $('modelLoading');
const btnCamera = $('btnCamera'), btnReset = $('btnReset'), camIndicator = $('camIndicator');
const feedbackSection = $('feedbackSection'), feedbackStatus = $('feedbackStatus');
const feedbackMain = $('feedbackMain'), feedbackNext = $('feedbackNext');
const feedbackBars = $('feedbackBars'), feedbackStream = $('feedbackStream');
const matchPct = $('matchPct'), matchBarFill = $('matchBarFill');
const suggestionText = $('suggestionText');
const suggestionBody = $('suggestionBody');
const skeletonContainer = $('skeletonContainer');
const skeletonLabel = $('skeletonLabel');
let skeleton3D = null;
const pitchCanvas = $('pitchCanvas');
const pitchCtx = pitchCanvas.getContext('2d');
const pitchCard = $('pitchCard');
const pitchLegend = $('pitchLegend');

let streamItems = [];

function resizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width; canvas.height = r.height;
}

class Skeleton3DRenderer {
  constructor(container) {
    this.container = container;
    const rect = container.getBoundingClientRect();
    this.width = rect.width || 300;
    this.height = Math.max(rect.height || 180, 180);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(40, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, 0.3, 3.5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);
    const main = new THREE.DirectionalLight(0xffffff, 1.2);
    main.position.set(2, 3, 4);
    this.scene.add(main);
    const fill = new THREE.DirectionalLight(0x4488ff, 0.4);
    fill.position.set(-2, 1, -3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0x88ccff, 0.3);
    rim.position.set(0, -2, -2);
    this.scene.add(rim);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this._animate();
  }

  update(targetKps, actionName, sourceKps) {
    this._clearGroup();
    skeletonLabel.textContent = actionName ? ACTION_NAMES[actionName] || actionName : '—';
    if (!targetKps || targetKps.length < 17) return;

    // Normalize both source and target using the same center/scale (from target)
    const info = this._normInfo(targetKps);
    const target = this._normApply(targetKps, info);
    let pts = target;

    if (sourceKps && sourceKps.length >= 17 && actionName) {
      const source = this._normApply(sourceKps, info);
      const t = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(Date.now() * (advState.animSpeed || 0.003)));
      pts = [];
      for (let i = 0; i < 17; i++) {
        if (!target[i] || !source[i]) { pts.push(target[i]); continue; }
        pts.push({
          x: source[i].x + (target[i].x - source[i].x) * t,
          y: source[i].y + (target[i].y - source[i].y) * t,
          z: source[i].z + (target[i].z - source[i].z) * t
        });
      }
    }

    const color = 0x4699e6;
    const mat = () => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.02, flatShading: false });

    const capsuleGeo = (radius, length) => {
      const half = length / 2;
      const segs = 6;
      const p = [];
      p.push(new THREE.Vector2(0, -half - radius));
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * (Math.PI / 2);
        p.push(new THREE.Vector2(radius * Math.sin(a), -half - radius * Math.cos(a)));
      }
      p.push(new THREE.Vector2(radius, half));
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * (Math.PI / 2);
        p.push(new THREE.Vector2(radius * Math.cos(a), half + radius * Math.sin(a)));
      }
      p.push(new THREE.Vector2(0, half + radius));
      return new THREE.LatheGeometry(p, 10);
    };

    const torsoProfile = (topW, botW, height) => {
      const half = height / 2;
      const segs = 4;
      const p = [];
      p.push(new THREE.Vector2(0, -half));
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const r = botW / 2 + (topW / 2 - botW / 2) * t;
        p.push(new THREE.Vector2(r, -half + t * height));
      }
      for (let i = 1; i <= segs; i++) {
        const a = (i / segs) * (Math.PI / 2);
        p.push(new THREE.Vector2(topW / 2 * Math.cos(a), half + (topW / 4) * Math.sin(a)));
      }
      p.push(new THREE.Vector2(0, half + topW / 4));
      return new THREE.LatheGeometry(p, 12);
    };

    const addCapsule = (a, b, radius) => {
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.005) return;
      const geo = capsuleGeo(radius, len);
      const mesh = new THREE.Mesh(geo, mat());
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      const up = new THREE.Vector3(0, 1, 0);
      mesh.quaternion.setFromUnitVectors(up, new THREE.Vector3(dx, dy, dz).normalize());
      this.group.add(mesh);
    };

    // --- Head ---
    if (pts[0]) {
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 14, 14),
        new THREE.MeshStandardMaterial({ color: 0x5aacff, roughness: 0.25, metalness: 0.02 })
      );
      head.position.set(pts[0].x, pts[0].y, pts[0].z);
      head.scale.y = 1.15;
      this.group.add(head);
    }

    // --- Neck ---
    const shMid = this._mid(pts[5], pts[6]);
    if (pts[0] && shMid) addCapsule(pts[0], shMid, 0.035);

    // --- Torso (tapered shoulders→hips) ---
    const hpMid = this._mid(pts[11], pts[12]);
    if (shMid && hpMid) {
      const topW = this._dist(pts[5], pts[6]) * 1.15 || 0.2;
      const botW = this._dist(pts[11], pts[12]) * 1.1 || 0.15;
      const th = this._dist(shMid, hpMid) * 1.05 || 0.28;
      const torso = new THREE.Mesh(torsoProfile(topW, botW, th), mat());
      torso.position.set(
        (shMid.x + hpMid.x) / 2, (shMid.y + hpMid.y) / 2, (shMid.z + hpMid.z) / 2
      );
      const sdx = shMid.x - hpMid.x, sdy = shMid.y - hpMid.y, sdz = shMid.z - hpMid.z;
      if (Math.hypot(sdx, sdy, sdz) > 0.01) {
        torso.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(sdx, sdy, sdz).normalize()
        );
      }
      this.group.add(torso);
    }

    // --- Limbs ---
    addCapsule(pts[5], pts[7], 0.045);
    addCapsule(pts[7], pts[9], 0.035);
    addCapsule(pts[6], pts[8], 0.045);
    addCapsule(pts[8], pts[10], 0.035);
    addCapsule(pts[11], pts[13], 0.055);
    addCapsule(pts[13], pts[15], 0.04);
    addCapsule(pts[12], pts[14], 0.055);
    addCapsule(pts[14], pts[16], 0.04);
  }

  _mid(a, b) {
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }

  _dist(a, b) {
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  _clearGroup() {
    while (this.group.children.length) {
      const c = this.group.children[0];
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
      this.group.remove(c);
    }
  }

  _normInfo(kps) {
    let mx = 0, my = 0, n = 0;
    for (const k of kps) {
      if (k.x != null && k.y != null) { mx += k.x; my += k.y; n++; }
    }
    mx /= n; my /= n;
    let maxD = 0;
    for (const k of kps) {
      if (k.x != null && k.y != null) maxD = Math.max(maxD, Math.hypot(k.x - mx, k.y - my));
    }
    return { mx, my, scale: maxD > 0 ? 1.2 / maxD : 1 };
  }

  _normApply(kps, info) {
    const zMap = [0, -0.15, 0.15, -0.2, 0.2, -0.25, 0.25, -0.3, 0.3, -0.35, 0.35, -0.2, 0.2, -0.3, 0.3, -0.35, 0.35];
    return kps.map((k, i) => {
      if (!k || k.x == null) return null;
      return { x: (k.x - info.mx) * info.scale, y: -(k.y - info.my) * info.scale, z: zMap[i] || 0 };
    });
  }

  clear() {
    this._clearGroup();
  }

  setRotateSpeed(s) { this._rotateSpeed = s; }
  setAnimSpeed(s) { this._animSpeed = s; }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.group.rotation.y += this._rotateSpeed || 0.008;
    this.group.rotation.x = Math.sin(Date.now() * (this._animSpeed || 0.003) * 0.13) * 0.04;
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width || 300;
    this.height = Math.max(rect.height || 180, 180);
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }
}

function initSkeleton3D() {
  if (!skeleton3D) {
    skeleton3D = new Skeleton3DRenderer(skeletonContainer);
  } else {
    skeleton3D.resize();
  }
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

function drawMocapLines(kps, isGhost) {
  if (!kps || kps.length < 17) return;
  const valid = kps.map(k => k.c || k.score || 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const lineColor = isGhost ? 'rgba(255,255,255,0.35)' : '#4ae0ff';
  const dotColor = isGhost ? 'rgba(255,255,255,0.3)' : '#4ae0ff';
  const alpha = isGhost ? 0.35 : 1;

  ctx.globalAlpha = alpha;

  // Torso outline
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

  // Bones as thin clean lines
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

  // Joints as small dots
  for (let i = 0; i < 17; i++) {
    if (!kps[i] || valid[i] < 0.3) continue;
    if (i === 0) continue; // skip head dot
    ctx.beginPath();
    ctx.arc(kps[i].x, kps[i].y, isGhost ? 2 : 3, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
  }

  // Head circle
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

  // --- Pitch base ---
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

  // --- GNN movement graph (trajectory edges) ---
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

  // --- Grad-CAM-style heatmap ---
  const heatScale = 4;
  const hw = Math.ceil(w / heatScale), hh = Math.ceil(h / heatScale);
  const off = document.createElement('canvas');
  off.width = hw; off.height = hh;
  const ox = off.getContext('2d');

  for (const a of actions) {
    const age = (Date.now() - a.time) / 1000;
    if (age > 120) continue;
    const alpha = 1 - age / 120;
    const px = (a.x * pw + pad) / heatScale;
    const py = (a.y * ph + pad) / heatScale;
    const r = Math.max(4, 14 * alpha);
    const grad = ox.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.6})`);
    grad.addColorStop(0.4, `rgba(255,200,50,${alpha * 0.35})`);
    grad.addColorStop(1, `rgba(0,0,0,0)`);
    ox.fillStyle = grad;
    ox.beginPath();
    ox.arc(px, py, r, 0, Math.PI * 2);
    ox.fill();
  }

  const imgData = ox.getImageData(0, 0, hw, hh);
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
  ox.putImageData(imgData, 0, 0);

  cx.save();
  cx.globalAlpha = 0.55;
  cx.imageSmoothingEnabled = true;
  cx.drawImage(off, 0, 0, w, h);
  cx.restore();

  // --- Action dots (on top) ---
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

const PLAYER_TIPS = {
  shoot: [
    { min: 0, max: 30, icon: '🦵', text: 'Lift your <span class="highlight">kicking leg</span> much higher — drive the knee up' },
    { min: 30, max: 60, icon: '⚖️', text: 'Extend your <span class="highlight">opposite arm</span> wider for balance' },
    { min: 60, max: 80, icon: '🦶', text: 'Point your toe and <span class="highlight">lock your ankle</span> for a clean strike' },
    { min: 80, max: 101, icon: '💥', text: 'Excellent shooting form! Follow through toward the target' }
  ],
  pass: [
    { min: 0, max: 30, icon: '🙌', text: 'Push both <span class="highlight">arms forward</span> — extend through the elbows' },
    { min: 30, max: 60, icon: '🔄', text: 'Rotate your <span class="highlight">shoulders square</span> to the target' },
    { min: 60, max: 80, icon: '🎯', text: 'Good arm shape — <span class="highlight">lead with your wrists</span> for accuracy' },
    { min: 80, max: 101, icon: '✅', text: 'Perfect passing stance! Weight on your front foot' }
  ],
  dribble: [
    { min: 0, max: 30, icon: '⬇️', text: '<span class="highlight">Lower your center</span> of gravity — bend knees much more' },
    { min: 30, max: 60, icon: '🙆', text: 'Keep the <span class="highlight">ball close</span> — arms relaxed at your sides' },
    { min: 60, max: 80, icon: '👀', text: 'Great crouch! Keep your <span class="highlight">head up</span> to scan the field' },
    { min: 80, max: 101, icon: '⚡', text: 'Excellent dribble posture! Ready to change direction' }
  ],
  run: [
    { min: 0, max: 30, icon: '🏃', text: '<span class="highlight">Lean forward</span> from your ankles — pump your arms' },
    { min: 30, max: 60, icon: '💪', text: 'Drive your <span class="highlight">elbows back</span> — opposite arm to leg' },
    { min: 60, max: 80, icon: '🦵', text: 'Good rhythm! Increase <span class="highlight">knee drive</span> for more power' },
    { min: 80, max: 101, icon: '🚀', text: 'Sprinting form looks sharp! Light on your feet' }
  ],
  tackle: [
    { min: 0, max: 30, icon: '⬇️', text: '<span class="highlight">Drop your hips</span> low — you need to be much lower' },
    { min: 30, max: 60, icon: '🦵', text: 'Extend your <span class="highlight">leading leg</span> further — win the ball' },
    { min: 60, max: 80, icon: '🛡️', text: 'Good reach! <span class="highlight">Keep your body side-on</span> to protect' },
    { min: 80, max: 101, icon: '💪', text: 'Textbook tackle! Strong and low — ball is yours' }
  ],
  stop: [
    { min: 0, max: 30, icon: '🧘', text: 'Stand in a relaxed <span class="highlight">athletic stance</span> — ready to move' },
    { min: 30, max: 60, icon: '👀', text: 'Stay on the <span class="highlight">balls of your feet</span> — scan the pitch' },
    { min: 60, max: 80, icon: '🔄', text: 'Good awareness! <span class="highlight">Check your shoulder</span> for pressure' },
    { min: 80, max: 101, icon: '🌟', text: 'Perfect ready position — you cover the space well' }
  ]
};

const COACH_TIPS = {
  shoot: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Knee up, toe down"</span> — focus on leg drive' },
    { min: 30, max: 60, icon: '👀', text: 'Observe <span class="highlight">arm opposition</span> — remind them to extend for balance' },
    { min: 60, max: 80, icon: '🔍', text: 'Watch the <span class="highlight">ankle lock</span> — this separates good from great' },
    { min: 80, max: 101, icon: '✅', text: 'Technique looks solid. Now work on <span class="highlight">decision-making</span> under pressure' }
  ],
  pass: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Push through, don\'t poke"</span> — full arm extension' },
    { min: 30, max: 60, icon: '👀', text: 'Check <span class="highlight">shoulder alignment</span> — square to target = accuracy' },
    { min: 60, max: 80, icon: '🔍', text: 'Good foundation. Introduce <span class="highlight">weight transfer</span> drills next' },
    { min: 80, max: 101, icon: '✅', text: 'Passing form is repeatable. Progress to <span class="highlight">moving targets</span>' }
  ],
  dribble: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Sit down, stay low"</span> — bend is not low enough' },
    { min: 30, max: 60, icon: '👀', text: 'Tell them to <span class="highlight">scan the field</span> while keeping low posture' },
    { min: 60, max: 80, icon: '🔍', text: 'Good crouch. Next: <span class="highlight">change of pace</span> while maintaining form' },
    { min: 80, max: 101, icon: '✅', text: 'Posture is pro-level. Introduce <span class="highlight">defender shadow</span> drills' }
  ],
  run: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Lean and drive"</span> — forward lean needs work' },
    { min: 30, max: 60, icon: '👀', text: 'Watch the <span class="highlight">arm-leg coordination</span> — opposite arm drive' },
    { min: 60, max: 80, icon: '🔍', text: 'Good rhythm. Drill: <span class="highlight">high-knee runs</span> to increase power' },
    { min: 80, max: 101, icon: '✅', text: 'Efficient sprint mechanics. Add <span class="highlight">resistance training</span> next phase' }
  ],
  tackle: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Get low, get big"</span> — hips need to drop much more' },
    { min: 30, max: 60, icon: '👀', text: 'Check <span class="highlight">lead leg extension</span> — they need more reach' },
    { min: 60, max: 80, icon: '🔍', text: 'Good body shape. Drill <span class="highlight">side-on tackling</span> with a partner' },
    { min: 80, max: 101, icon: '✅', text: 'Tackle technique is sound. Practice <span class="highlight">live 1v1</span> scenarios' }
  ],
  stop: [
    { min: 0, max: 30, icon: '📣', text: 'Cue: <span class="highlight">"Athletic stance"</span> — feet shoulder-width, knees bent' },
    { min: 30, max: 60, icon: '👀', text: 'Tell them to stay <span class="highlight">on the balls of their feet</span>, not flat' },
    { min: 60, max: 80, icon: '🔍', text: 'Good base. Now teach <span class="highlight">scanning habits</span> — left, right, behind' },
    { min: 80, max: 101, icon: '✅', text: 'Player reads the pitch well. Work on <span class="highlight">first touch</span> from this stance' }
  ]
};

const COACH_TRANSITION = {
  shoot_pass: 'After the shot, coach: <span class="highlight">"Land and find your next target"</span>',
  shoot_dribble: 'Teach: <span class="highlight">follow the shot</span> — prepare for rebound scenarios',
  pass_shoot: 'Progression: <span class="highlight">pass and move</span> — create space for a return',
  pass_dribble: 'Next drill: <span class="highlight">disguise the pass</span>, then dribble away',
  dribble_shoot: 'Cue from dribble: <span class="highlight">"Set your feet, then strike"</span>',
  dribble_pass: 'Coach point: <span class="highlight">lift the head</span> before releasing the pass',
  run_shoot: 'Drill: <span class="highlight">sprint → short stride → shoot</span> in one motion',
  run_tackle: 'Cue: <span class="highlight">"Drop the hips"</span> when transitioning from run to tackle'
};

const TRANSITION_TIPS = {
  shoot_pass: 'After the shot, <span class="highlight">land balanced</span> and scan for your next pass',
  shoot_dribble: 'Follow your shot and prepare to <span class="highlight">dribble</span> if it rebounds',
  pass_shoot: 'After passing, <span class="highlight">move into space</span> for a return pass or shot',
  pass_dribble: 'After passing, <span class="highlight">disguise your next move</span> — dribble or run',
  dribble_shoot: 'From dribble, <span class="highlight">set your feet</span> quickly and shoot',
  dribble_pass: 'From dribble, <span class="highlight">lift your head</span> and pick out the pass',
  run_shoot: 'From a run, <span class="highlight">shorten your stride</span> to set up the shot',
  run_tackle: '<span class="highlight">Lower your center</span> of gravity to transition into a tackle'
};

function getTipsForRole(role) {
  return role === 'coach' ? COACH_TIPS : PLAYER_TIPS;
}

function getTransForRole(role) {
  return role === 'coach' ? COACH_TRANSITION : TRANSITION_TIPS;
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

const POSE_MODEL = { model: 'MoveNet', config: { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING } };

async function loadModel() {
  modelLoading.classList.add('visible');
  try {
    state.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, POSE_MODEL.config);
    state.modelReady = true;
  } catch (err) { console.error('Model load failed:', err); }
  modelLoading.classList.remove('visible');
}

const LLM_CONFIGS = {
  gemini: { name: 'Gemini 2.0 Flash', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', apiModel: '', keyLabel: 'Google AI Studio API Key', isGemini: true },
  deepseek: { name: 'DeepSeek V4 Flash Free', endpoint: 'https://api.deepseek.com/v1/chat/completions', apiModel: 'deepseek-chat', keyLabel: 'DeepSeek API Key' },
  glm: { name: 'GLM-4.5', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', apiModel: 'glm-4', keyLabel: '智谱 API Key' }
};

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

const roleBadge = $('roleBadge');
const userDropdown = $('userDropdown');
const settingsPanel = $('settingsPanel');
const settingsOverlay = $('settingsOverlay');

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

document.querySelectorAll('.dropdown-item').forEach(el => {
  el.addEventListener('click', () => setRole(el.dataset.role));
});

$('btnUser').addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown.classList.toggle('open');
});

document.addEventListener('click', () => userDropdown.classList.remove('open'));

function openSettings() {
  settingsPanel.classList.add('open');
  settingsOverlay.classList.add('open');
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  settingsOverlay.classList.remove('open');
}

$('btnSettings').addEventListener('click', openSettings);
$('settingsClose').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

const tipsPanel = $('tipsPanel');
const tipsOverlay = $('tipsOverlay');

function openTips() { tipsPanel.classList.add('open'); tipsOverlay.classList.add('open'); }
function closeTips() { tipsPanel.classList.remove('open'); tipsOverlay.classList.remove('open'); }

$('btnTips').addEventListener('click', openTips);
$('tipsClose').addEventListener('click', closeTips);
tipsOverlay.addEventListener('click', closeTips);

const $apiKeyGroup = $('apiKeyGroup');
const $apiKeyInput = $('apiKeyInput');
const $apiKeyStatus = $('apiKeyStatus');

function showApiKeyInput(model) {
  const cfg = LLM_CONFIGS[model];
  if (!cfg) return;
  $apiKeyGroup.style.display = 'block';
  $apiKeyInput.placeholder = 'Paste your ' + cfg.keyLabel + '...';
  const saved = getApiKey(model);
  if (saved) { $apiKeyInput.value = saved; $apiKeyStatus.textContent = '✓ Key saved'; $apiKeyStatus.className = 'api-key-status ok'; }
  else { $apiKeyInput.value = ''; $apiKeyStatus.textContent = ''; $apiKeyStatus.className = 'api-key-status'; }
}

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

const initModel = document.querySelector(`.setting-option[data-model="${state.llmModel}"]`);
if (initModel) { initModel.classList.add('active'); showApiKeyInput(state.llmModel); }

// === Tips Tabs ===
document.querySelectorAll('.tips-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tips-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tips-page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const page = $('tipsPage' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
    if (page) page.classList.add('active');
  });
});

// === Advanced Settings ===
const advancedPanel = $('advancedPanel');
const advancedOverlay = $('advancedOverlay');

function openAdvanced() { advancedPanel.classList.add('open'); advancedOverlay.classList.add('open'); }
function closeAdvanced() { advancedPanel.classList.remove('open'); advancedOverlay.classList.remove('open'); }

$('btnAdvanced').addEventListener('click', openAdvanced);
$('advancedClose').addEventListener('click', closeAdvanced);
advancedOverlay.addEventListener('click', closeAdvanced);

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

btnCamera.addEventListener('click', () => { state.isCamera ? resetAll() : startCamera(); });
btnReset.addEventListener('click', resetAll);
resizeCanvas();
initSkeleton3D();
resizePitchCanvas();
buildLegend();
loadModel();
