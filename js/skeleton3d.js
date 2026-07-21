const ANIM_MAP = {
  idle: 'Idle', walk: 'Walk', run: 'Run',
  shoot: 'Punch', pass: 'Dagger_Attack', dribble: 'Walk',
  tackle: 'RecieveHit_Attacking', stop: 'Idle'
};

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

    this.mixer = null;
    this.animClips = {};
    this.currentAnim = null;

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

      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of gltf.animations) {
        const name = clip.name.replace('CharacterArmature|', '');
        this.animClips[name] = clip;
      }
      this._playAnim('Idle');
    }, undefined, (e) => console.error('Model load error:', e));
  }

  _playAnim(name) {
    if (!this.mixer || !this.animClips[name] || this.currentAnim === name) return;
    if (this.currentAction) this.currentAction.stop();
    const clip = this.animClips[name];
    this.currentAction = this.mixer.clipAction(clip);
    this.currentAction.loop = THREE.LoopRepeat;
    this.currentAction.play();
    this.currentAnim = name;
  }

  update(targetKps, actionName, sourceKps) {
    if (typeof skeletonLabel !== 'undefined') {
      skeletonLabel.textContent = actionName ? ACTION_NAMES[actionName] || actionName : '—';
    }
    const anim = actionName ? ANIM_MAP[actionName] : 'Idle';
    this._playAnim(anim || 'Idle');
  }

  clear() {}
  setRotateSpeed(s) { this._rotateSpeed = s; }
  setAnimSpeed(s) { this._animSpeed = s; }

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (this.mixer) this.mixer.update(0.016);
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
