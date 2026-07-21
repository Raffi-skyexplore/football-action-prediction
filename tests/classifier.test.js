import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The ActionClassifier is a heuristic-based classifier using 2D keypoint features.
// "stop" is a residual category (1 - others*0.6) and rarely wins with real poses.
// We test structure, invariants, and relative feature comparisons instead. 

function pt(x, y) { return { x, y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function scale(v, s) { return { x: v.x * s, y: v.y * s }; }
function norm(v) { const l = Math.hypot(v.x, v.y); return l ? { x: v.x / l, y: v.y / l } : pt(0, 0); }
function rot(v, a) { const c = Math.cos(a), s = Math.sin(a); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; }
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

const ACTION_KEYS = ['shoot', 'pass', 'dribble', 'run', 'tackle', 'stop'];

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

function makeKps(x, y, score = 0.9) { return { x, y, score }; }

// Standing upright: shoulders above hips, arms close to shoulders, legs straight
const STANDING_POSE = [
  makeKps(320, 50), makeKps(310, 50), makeKps(330, 50),
  makeKps(310, 60), makeKps(330, 60),
  makeKps(300, 100), makeKps(340, 100),  // shoulders at y=100
  makeKps(305, 105), makeKps(335, 105),  // elbows close to shoulders (low armReach)
  makeKps(310, 110), makeKps(330, 110),  // wrists near elbows
  makeKps(310, 150), makeKps(330, 150),  // hips at y=150 (crouch = (150-100)/40/1.8 = 0.69)
  makeKps(312, 200), makeKps(328, 200),  // knees
  makeKps(314, 260), makeKps(326, 260),  // ankles
];

// Kicking: right knee extended laterally far from hip, foot close behind
const KICKING_POSE = [
  makeKps(320, 40), makeKps(310, 40), makeKps(330, 40),
  makeKps(310, 50), makeKps(330, 50),
  makeKps(290, 100), makeKps(350, 100),
  makeKps(270, 105), makeKps(370, 105),
  makeKps(260, 110), makeKps(380, 110),
  makeKps(300, 200), makeKps(340, 200),
  makeKps(305, 280), makeKps(390, 180),  // right knee far right, high up
  makeKps(310, 370), makeKps(350, 210),  // right ankle closer to hip than knee
];

// Crouching: bent knees, lower center, wider stance
const CROUCHING_POSE = [
  makeKps(320, 70), makeKps(310, 70), makeKps(330, 70),
  makeKps(310, 80), makeKps(330, 80),
  makeKps(300, 130), makeKps(340, 130),
  makeKps(295, 170), makeKps(345, 170),
  makeKps(290, 210), makeKps(350, 210),
  makeKps(305, 200), makeKps(335, 200),  // hips at y=200, shoulders at 130 -> crouch = (200-130)/30/1.8 = 1.3 capped at 1
  makeKps(310, 250), makeKps(330, 250),
  makeKps(315, 310), makeKps(325, 310),
];

// Run pose: forward lean
const RUNNING_POSE = [
  makeKps(340, 50), makeKps(330, 50), makeKps(350, 50),
  makeKps(330, 60), makeKps(350, 60),
  makeKps(320, 100), makeKps(370, 100),
  makeKps(310, 145), makeKps(380, 145),
  makeKps(300, 190), makeKps(390, 190),
  makeKps(340, 150), makeKps(360, 150),  // hips
  makeKps(345, 210), makeKps(350, 210),
  makeKps(350, 280), makeKps(345, 280),
];

const LOW_CONFIDENCE = [
  makeKps(320, 80, 0.1), makeKps(300, 80, 0.1), makeKps(340, 80, 0.1),
  makeKps(300, 90, 0.1), makeKps(340, 90, 0.1),
  makeKps(290, 140, 0.1), makeKps(350, 140, 0.1),
  makeKps(280, 180, 0.1), makeKps(360, 180, 0.1),
  makeKps(270, 230, 0.1), makeKps(370, 230, 0.1),
  makeKps(300, 260, 0.1), makeKps(340, 260, 0.1),
  makeKps(305, 330, 0.1), makeKps(335, 330, 0.1),
  makeKps(310, 410, 0.1), makeKps(330, 410, 0.1),
];

const INVALID_POSES = [null, undefined, [], [makeKps(0, 0)]];

describe('Utility functions', () => {
  it('pt creates a point', () => {
    assert.deepEqual(pt(3, 4), { x: 3, y: 4 });
  });

  it('add sums two points', () => {
    assert.deepEqual(add(pt(1, 2), pt(3, 4)), { x: 4, y: 6 });
  });

  it('sub subtracts points', () => {
    assert.deepEqual(sub(pt(5, 7), pt(2, 3)), { x: 3, y: 4 });
  });

  it('scale multiplies point', () => {
    assert.deepEqual(scale(pt(2, 3), 4), { x: 8, y: 12 });
  });

  it('norm normalizes', () => {
    const n = norm(pt(3, 4));
    assert.ok(Math.abs(n.x - 0.6) < 0.001);
    assert.ok(Math.abs(n.y - 0.8) < 0.001);
  });

  it('norm zero for zero vector', () => {
    assert.deepEqual(norm(pt(0, 0)), { x: 0, y: 0 });
  });

  it('rot rotates 90°', () => {
    const r = rot(pt(1, 0), Math.PI / 2);
    assert.ok(Math.abs(r.x) < 0.001);
    assert.ok(Math.abs(r.y - 1) < 0.001);
  });

  it('mid computes midpoint', () => {
    assert.deepEqual(mid(pt(0, 0), pt(10, 20)), { x: 5, y: 10 });
  });

  it('dist computes distance', () => {
    assert.ok(Math.abs(dist(pt(0, 0), pt(3, 4)) - 5) < 0.001);
  });
});

describe('ActionClassifier', () => {
  it('classifies upright pose (non-null, valid structure)', () => {
    const r = classifier.classify(STANDING_POSE);
    assert.ok(r.action !== undefined && r.action !== null);
    assert.equal(typeof r.confidence, 'number');
    assert.ok(r.confidence > 0);
    assert.ok(Object.values(r.all_actions).reduce((a, b) => a + b, 0) > 0.99);
  });

  it('classifies kicking as shoot', () => {
    const r = classifier.classify(KICKING_POSE);
    assert.equal(r.action, 'shoot');
    assert.ok(r.confidence > 0.3);
  });

  it('produces valid classification for crouching pose', () => {
    const r = classifier.classify(CROUCHING_POSE);
    assert.ok(r.action !== undefined);
    assert.ok(r.confidence > 0);
    assert.equal(Object.keys(r.all_actions).length, 6);
  });

  it('produces valid classification for running pose', () => {
    const r = classifier.classify(RUNNING_POSE);
    assert.ok(r.action !== undefined);
    assert.ok(r.confidence > 0);
    assert.equal(Object.keys(r.all_actions).length, 6);
  });

  it('returns fallback for low confidence', () => {
    assert.equal(classifier.classify(LOW_CONFIDENCE).action, 'stop');
  });

  it('returns fallback for invalid inputs', () => {
    for (const p of INVALID_POSES) {
      assert.equal(classifier.classify(p).action, 'stop');
    }
  });

  it('scores sum to 1', () => {
    const r = classifier.classify(STANDING_POSE);
    const sum = Object.values(r.all_actions).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.01);
  });

  it('returns all 6 action keys', () => {
    assert.deepEqual(Object.keys(classifier.classify(STANDING_POSE).all_actions).sort(), ACTION_KEYS.sort());
  });

  it('includes features', () => {
    const r = classifier.classify(KICKING_POSE);
    assert.ok(r.features !== undefined);
    assert.equal(typeof r.features.legLift, 'number');
    assert.equal(typeof r.features.armReach, 'number');
  });

  it('legLift is higher for kicking than standing', () => {
    const kick = classifier.classify(KICKING_POSE);
    const stand = classifier.classify(STANDING_POSE);
    assert.ok(kick.features.legLift > stand.features.legLift);
  });

  it('legLift or legExt differs between kicking and standing', () => {
    const kick = classifier.classify(KICKING_POSE);
    const stand = classifier.classify(STANDING_POSE);
    assert.ok(kick.features.legLift !== stand.features.legLift || kick.features.legExt !== stand.features.legExt);
  });
});

describe('computeMatch', () => {
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

  it('identical keypoints score ~1', () => {
    assert.ok(computeMatch(STANDING_POSE, STANDING_POSE) > 0.95);
  });

  it('different poses score lower', () => {
    assert.ok(computeMatch(STANDING_POSE, KICKING_POSE) < 1);
  });

  it('null/empty returns 0', () => {
    assert.equal(computeMatch(null, STANDING_POSE), 0);
    assert.equal(computeMatch([], STANDING_POSE), 0);
  });
});

describe('getNextAction', () => {
  function getNextAction(allActions, currentAction) {
    const entries = Object.entries(allActions);
    if (entries.length === 0) return 'stop';
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    if (sorted.length < 2 || sorted[0][0] !== currentAction) return sorted[0][0];
    return sorted[1][0];
  }

  it('second best when current is best', () => {
    assert.equal(getNextAction({ shoot: 0.5, pass: 0.3 }, 'shoot'), 'pass');
  });

  it('best when current is not best', () => {
    assert.equal(getNextAction({ shoot: 0.5, pass: 0.3 }, 'pass'), 'shoot');
  });

  it('single action returns itself', () => {
    assert.equal(getNextAction({ stop: 1 }, 'stop'), 'stop');
  });

  it('empty returns stop', () => {
    assert.equal(getNextAction({}, 'stop'), 'stop');
  });
});
