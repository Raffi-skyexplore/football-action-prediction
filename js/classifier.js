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
