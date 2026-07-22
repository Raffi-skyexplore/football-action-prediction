const BONE_KPS = {
  'UpperLeg.R': [12, 14], 'LowerLeg.R': [14, 16],
  'UpperLeg.L': [11, 13], 'LowerLeg.L': [13, 15],
  'UpperArm.R': [6, 8],   'LowerArm.R': [8, 10],
  'UpperArm.L': [5, 7],   'LowerArm.L': [7, 9],
};

const DEFAULT_DIR = new THREE.Vector3(0, 1, 0);

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

    this.modelGroup = new THREE.Group();
    this.group.add(this.modelGroup);

    this.bones = {};
    this.bindQ = {};
    this._pts = null;

    this._loadModel();
    this._animate();
  }

  _loadModel() {
    const loader = new THREE.GLTFLoader();
    loader.load('img/character.glb', (gltf) => {
      this.model = gltf.scene;
      const box = new THREE.Box3().setFromObject(this.model);
      const s = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const sc = 1.3 / Math.max(s.x, s.y, s.z);
      this.model.scale.set(sc, sc, sc);
      this.model.position.set(-c.x * sc, -c.y * sc, -c.z * sc);
      this.modelGroup.add(this.model);

      this.model.traverse((n) => {
        if (n.isBone) {
          this.bones[n.name] = n;
          this.bindQ[n.name] = n.quaternion.clone();
        }
      });
    }, undefined, (e) => console.error('Model load error:', e));
  }

  _normInfo(kps) { let mx = 0, my = 0, n = 0; for (const k of kps) { if (k.x != null && k.y != null) { mx += k.x; my += k.y; n++; } } mx /= n; my /= n; let maxD = 0; for (const k of kps) { if (k.x != null && k.y != null) maxD = Math.max(maxD, Math.hypot(k.x - mx, k.y - my)); } return { mx, my, scale: maxD > 0 ? 1.2 / maxD : 1 }; }
  _normApply(kps, info) { const zMap = [0, -0.15, 0.15, -0.2, 0.2, -0.25, 0.25, -0.3, 0.3, -0.35, 0.35, -0.2, 0.2, -0.3, 0.3, -0.35, 0.35]; return kps.map((k, i) => { if (!k || k.x == null) return null; return { x: (k.x - info.mx) * info.scale, y: -(k.y - info.my) * info.scale, z: zMap[i] || 0 }; }); }

  update(targetKps, actionName, sourceKps) {
    if (typeof skeletonLabel !== 'undefined') {
      skeletonLabel.textContent = actionName ? ACTION_NAMES[actionName] || actionName : '—';
    }
    if (!targetKps || targetKps.length < 17) return;
    if (!this.bones[Object.keys(BONE_KPS)[0]]) return;

    const info = this._normInfo(targetKps);
    this._pts = this._normApply(targetKps, info);
  }

  clear() {}
  setRotateSpeed(s) { this._rotateSpeed = s; }
  setAnimSpeed(s) { this._animSpeed = s; }

  _animate() {
    requestAnimationFrame(() => this._animate());

    if (this.model) {
      for (const [name, bone] of Object.entries(this.bones)) {
        if (this.bindQ[name]) bone.quaternion.copy(this.bindQ[name]);
      }
      this.model.updateMatrixWorld(true);

      if (this._pts && this._pts[12]) {
        const pts = this._pts;
        for (const [boneName, [kpa, kpb]] of Object.entries(BONE_KPS)) {
          const pa = pts[kpa], pb = pts[kpb];
          if (!pa || !pb) continue;
          const dir = new THREE.Vector3(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
          if (dir.length() < 0.01) continue;
          dir.normalize();
          const bone = this.bones[boneName];
          if (!bone || !bone.parent) continue;
          const inv = new THREE.Matrix4().copy(bone.parent.matrixWorld).invert();
          const local = dir.clone().applyMatrix4(inv).normalize();
          bone.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(DEFAULT_DIR, local));
        }
      }
    }

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
