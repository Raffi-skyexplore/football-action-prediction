class Skeleton3DRenderer {
  constructor(container) {
    this.container = container;
    const rect = container.getBoundingClientRect();
    this.width = rect.width || 300;
    this.height = Math.max(rect.height || 180, 180);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(40, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, 0.5, 3.2);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    const ambient = new THREE.AmbientLight(0x8888cc, 0.5);
    this.scene.add(ambient);
    const main = new THREE.DirectionalLight(0xffffff, 1.5);
    main.position.set(3, 4, 5);
    this.scene.add(main);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
    fill.position.set(-3, 1, 2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, -2, -3);
    this.scene.add(rim);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0xf0f0f0,
      roughness: 0.3,
      metalness: 0.0,
      clearcoat: 0.1,
      clearcoatRoughness: 0.4
    });

    this._animate();
  }

  _cyl(a, b, r1, r2) {
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.008) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1 || r2 || 0.04, r2 || r1 || 0.04, len, 10), this.mat);
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    this.group.add(m);
  }

  _sph(p, r) {
    if (!p) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), this.mat);
    m.position.set(p.x, p.y, p.z);
    this.group.add(m);
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
    const bodyLen = shMid && hpMid ? this._dist(shMid, hpMid) : 0.3;

    if (pts[0]) {
      const hr = bodyLen * 0.12;
      const h = new THREE.Mesh(new THREE.SphereGeometry(hr, 12, 12), this.mat);
      h.position.set(pts[0].x, pts[0].y + hr * 0.1, pts[0].z);
      h.scale.set(1, 1.15, 0.9);
      this.group.add(h);
    }

    if (pts[0] && shMid) this._cyl(pts[0], shMid, bodyLen * 0.035, bodyLen * 0.04);

    if (shMid && hpMid) {
      const sw = this._dist(pts[5], pts[6]) * 0.5 || 0.16;
      const hw = this._dist(pts[11], pts[12]) * 0.55 || 0.14;
      const th = bodyLen * 0.55;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(sw, hw, th, 12), this.mat);
      t.position.set((shMid.x + hpMid.x) / 2, (shMid.y + hpMid.y) / 2, (shMid.z + hpMid.z) / 2);
      const sdx = shMid.x - hpMid.x, sdy = shMid.y - hpMid.y, sdz = shMid.z - hpMid.z;
      if (Math.hypot(sdx, sdy, sdz) > 0.01)
        t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(sdx, sdy, sdz).normalize());
      this.group.add(t);
    }

    this._cyl(pts[5], pts[7], bodyLen * 0.04, bodyLen * 0.035);
    this._cyl(pts[7], pts[9], bodyLen * 0.03, bodyLen * 0.025);
    this._cyl(pts[6], pts[8], bodyLen * 0.04, bodyLen * 0.035);
    this._cyl(pts[8], pts[10], bodyLen * 0.03, bodyLen * 0.025);
    this._cyl(pts[11], pts[13], bodyLen * 0.045, bodyLen * 0.04);
    this._cyl(pts[13], pts[15], bodyLen * 0.035, bodyLen * 0.03);
    this._cyl(pts[12], pts[14], bodyLen * 0.045, bodyLen * 0.04);
    this._cyl(pts[14], pts[16], bodyLen * 0.035, bodyLen * 0.03);
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
