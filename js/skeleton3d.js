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

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1 });
    this.jointMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.05 });

    this._animate();
  }

  _addLimb(a, b, radius) {
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.005) return;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, len, 8), this.bodyMat);
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    this.group.add(mesh);
    const j1 = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.8, 8, 8), this.jointMat);
    j1.position.set(a.x, a.y, a.z);
    this.group.add(j1);
    const j2 = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.7, 8, 8), this.jointMat);
    j2.position.set(b.x, b.y, b.z);
    this.group.add(j2);
  }

  update(targetKps, actionName, sourceKps) {
    this._clearGroup();
    if (typeof skeletonLabel !== 'undefined') {
      skeletonLabel.textContent = actionName ? ACTION_NAMES[actionName] || actionName : '—';
    }
    if (!targetKps || targetKps.length < 17) return;

    const info = this._normInfo(targetKps);
    const target = this._normApply(targetKps, info);
    let pts = target;

    if (sourceKps && sourceKps.length >= 17 && actionName) {
      const source = this._normApply(sourceKps, info);
      const t = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(Date.now() * ((typeof advState !== 'undefined' ? advState.animSpeed : 0) || 0.003)));
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

    const shMid = this._mid(pts[5], pts[6]);
    const hpMid = this._mid(pts[11], pts[12]);

    if (pts[0]) {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), this.bodyMat);
      head.position.set(pts[0].x, pts[0].y, pts[0].z);
      head.scale.y = 1.12;
      this.group.add(head);
    }

    if (pts[0] && shMid) this._addLimb(pts[0], shMid, 0.03);

    if (shMid && hpMid) {
      const tw = (this._dist(pts[5], pts[6]) * 0.55 || 0.16);
      const th = this._dist(shMid, hpMid) * 0.55 || 0.26;
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(tw * 0.55, tw * 0.65, th, 10), this.bodyMat);
      torso.position.set((shMid.x + hpMid.x) / 2, (shMid.y + hpMid.y) / 2, (shMid.z + hpMid.z) / 2);
      const sdx = shMid.x - hpMid.x, sdy = shMid.y - hpMid.y, sdz = shMid.z - hpMid.z;
      if (Math.hypot(sdx, sdy, sdz) > 0.01)
        torso.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(sdx, sdy, sdz).normalize());
      this.group.add(torso);
    }

    this._addLimb(pts[5], pts[7], 0.035);
    this._addLimb(pts[7], pts[9], 0.028);
    this._addLimb(pts[6], pts[8], 0.035);
    this._addLimb(pts[8], pts[10], 0.028);
    this._addLimb(pts[11], pts[13], 0.045);
    this._addLimb(pts[13], pts[15], 0.035);
    this._addLimb(pts[12], pts[14], 0.045);
    this._addLimb(pts[14], pts[16], 0.035);
  }

  _mid(a, b) { if (!a || !b) return null; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
  _dist(a, b) { if (!a || !b) return 0; return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  _clearGroup() { while (this.group.children.length) { const c = this.group.children[0]; if (c.geometry) c.geometry.dispose(); this.group.remove(c); } }
  _normInfo(kps) { let mx = 0, my = 0, n = 0; for (const k of kps) { if (k.x != null && k.y != null) { mx += k.x; my += k.y; n++; } } mx /= n; my /= n; let maxD = 0; for (const k of kps) { if (k.x != null && k.y != null) maxD = Math.max(maxD, Math.hypot(k.x - mx, k.y - my)); } return { mx, my, scale: maxD > 0 ? 1.2 / maxD : 1 }; }
  _normApply(kps, info) { const zMap = [0, -0.15, 0.15, -0.2, 0.2, -0.25, 0.25, -0.3, 0.3, -0.35, 0.35, -0.2, 0.2, -0.3, 0.3, -0.35, 0.35]; return kps.map((k, i) => { if (!k || k.x == null) return null; return { x: (k.x - info.mx) * info.scale, y: -(k.y - info.my) * info.scale, z: zMap[i] || 0 }; }); }
  clear() { this._clearGroup(); }
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

let skeleton3D = null;

function initSkeleton3D() {
  if (!skeleton3D) {
    skeleton3D = new Skeleton3DRenderer(skeletonContainer);
  } else {
    skeleton3D.resize();
  }
}
