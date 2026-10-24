/**
 * NEON SERPENT — scene, game loop, UI wiring and input.
 */
import * as THREE from "three";
import { SnakeEngine, DIFFICULTIES, GRID_SIZE } from "./engine.js";
import { AudioEngine } from "./audio.js";
import {
  SnakeView,
  FoodView,
  ParticleField,
  createGlowTexture,
  DEMO_SNAKE,
  DEMO_FOOD,
  CELL_CENTER,
  ARENA_FLOOR,
  HEAD_COLOR,
  TAIL_COLOR,
  LIME,
  MINT,
  CORAL,
  CREAM,
} from "./visuals.js";

const $ = (id) => document.getElementById(id);

const STORAGE = {
  best: "neonSerpent.best.v1",
  muted: "neonSerpent.muted.v1",
  difficulty: "neonSerpent.difficulty.v1",
};

const DIRECTION_KEYS = {
  ArrowUp: { x: 0, y: 0, z: -1 },
  KeyW: { x: 0, y: 0, z: -1 },
  ArrowDown: { x: 0, y: 0, z: 1 },
  KeyS: { x: 0, y: 0, z: 1 },
  ArrowLeft: { x: -1, y: 0, z: 0 },
  KeyA: { x: -1, y: 0, z: 0 },
  ArrowRight: { x: 1, y: 0, z: 0 },
  KeyD: { x: 1, y: 0, z: 0 },
  KeyQ: { x: 0, y: 1, z: 0 },
  KeyE: { x: 0, y: -1, z: 0 },
  up: { x: 0, y: 0, z: -1 },
  down: { x: 0, y: 0, z: 1 },
  left: { x: -1, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  rise: { x: 0, y: 1, z: 0 },
  fall: { x: 0, y: -1, z: 0 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const padded = (value, length = 4) =>
  String(Math.max(0, Math.floor(Number(value) || 0))).padStart(length, "0");

const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      /* Local storage can be unavailable in private modes. */
    }
  },
};

const GRID_FRAGMENT = [
  "uniform vec3 uColor;",
  "uniform float uTime;",
  "uniform float uGrid;",
  "uniform float uOpacity;",
  "varying vec2 vUv;",
  "void main() {",
  "  vec2 coord = vUv * uGrid;",
  "  vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);",
  "  float line = 1.0 - min(min(grid.x, grid.y), 1.0);",
  "  float edge = smoothstep(0.0, 0.035, vUv.x) * smoothstep(0.0, 0.035, 1.0 - vUv.x) *",
  "               smoothstep(0.0, 0.035, vUv.y) * smoothstep(0.0, 0.035, 1.0 - vUv.y);",
  "  float pulse = 0.78 + 0.22 * sin(uTime * 1.25 - vUv.y * 5.0);",
  "  float checker = mod(floor(vUv.x * uGrid) + floor(vUv.y * uGrid), 2.0);",
  "  float scan = smoothstep(0.032, 0.0, abs(vUv.y - fract(uTime * 0.045))) * 0.045;",
  "  float alpha = (line * uOpacity * pulse + 0.012 * checker + scan) * edge;",
  "  vec3 color = mix(uColor * 0.56, uColor, min(1.0, line + scan * 2.0));",
  "  gl_FragColor = vec4(color, alpha);",
  "}",
].join("\n");

class NeonSerpent {
  constructor() {
    this.dom = {
      app: $("app"),
      canvas: $("scene"),
      boot: $("boot"),
      fatal: $("fatal"),
      screen: $("screen"),
      startPanel: $("startPanel"),
      overPanel: $("overPanel"),
      pausePanel: $("pausePanel"),
      screenKicker: $("screenKicker"),
      score: $("score"),
      best: $("best"),
      combo: $("combo"),
      lengthStat: $("lengthStat"),
      speedStat: $("speedStat"),
      altStat: $("altStat"),
      signalBars: Array.from(document.querySelectorAll("#signalBars i")),
      toast: $("toast"),
      flash: $("flash"),
      startBtn: $("startBtn"),
      retryBtn: $("retryBtn"),
      menuBtn: $("menuBtn"),
      resumeBtn: $("resumeBtn"),
      pauseRestartBtn: $("pauseRestartBtn"),
      pauseMenuBtn: $("pauseMenuBtn"),
      pauseBtn: $("pauseBtn"),
      soundBtn: $("soundBtn"),
      difficultyButtons: Array.from(document.querySelectorAll("[data-difficulty]")),
      paceNote: $("paceNote"),
      overKicker: $("overKicker"),
      overTitle: $("overTitle"),
      overReason: $("overReason"),
      finalScore: $("finalScore"),
      finalBest: $("finalBest"),
      finalLength: $("finalLength"),
      newRecord: $("newRecord"),
      touchButtons: Array.from(document.querySelectorAll("[data-dir]")),
    };

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.best = Math.max(0, Number.parseInt(storage.get(STORAGE.best) || "0", 10) || 0);
    this.muted = storage.get(STORAGE.muted) === "1";
    const storedDifficulty = storage.get(STORAGE.difficulty);
    this.difficulty = DIFFICULTIES[storedDifficulty] ? storedDifficulty : "classic";

    this.engine = new SnakeEngine({ difficulty: this.difficulty });
    this.audio = new AudioEngine({ muted: this.muted });

    this.appState = "boot";
    this.time = 0;
    this.lastFrame = 0;
    this.running = false;
    this.progress = 0;
    this.pausedProgress = 0;
    this.nextTickAt = Infinity;
    this.headPulse = 0;
    this.fovPulse = 0;
    this.shake = 0;
    this.dangerFlash = 0;
    this.deathT = 0;
    this.deathStartedAt = 0;
    this.gameWon = false;
    this.gameOverData = null;
    this.overTimer = 0;
    this.toastTimer = 0;
    this.flashTimer = 0;
    this.numberAnimationToken = 0;
    this.comboActive = false;
    this.lastTickMs = this.engine.tickMs;
    this.baseFov = 44;
    this.frameDistance = 25;
    this.lookTarget = new THREE.Vector3(0, 0, 0);
    this.pointerStart = null;
    this.debugFreeze = false;
    this.loop = this.loop.bind(this);
  }

  /* ============================================================
     Boot
     ============================================================ */

  async init() {
    this.setupRenderer();
    this.setupScene();
    this.setupViews();
    this.setupUI();
    this.setupInput();
    this.resize();
    this.enterMenu(true);
    this.syncSoundUI();
    this.lastFrame = performance.now();
    this.running = true;
    this.setupDebugApi();
    requestAnimationFrame(this.loop);

    window.__NEON_READY__ = true;
    window.setTimeout(() => {
      this.dom.boot.classList.add("is-hidden");
      window.setTimeout(() => this.dom.boot.remove(), 800);
    }, 260);
  }

  setupDebugApi() {
    window.__NEON_SERPENT__ = {
      version: "1.0.0",
      app: this,
      state: () => ({
        ui: this.appState,
        engine: this.engine.getState(),
        best: this.best,
        muted: this.muted,
        screenVisible: !this.dom.screen.classList.contains("is-hidden"),
        scoreText: this.dom.score.textContent,
        comboActive: this.comboActive,
        foodVisible: this.foodView.visible,
        three: THREE.REVISION,
      }),
      start: () => this.startGame(),
      restart: () => this.startGame(),
      pause: () => this.pauseGame(),
      resume: () => this.resumeGame(),
      menu: () => this.enterMenu(),
      move: (x, y, z) => this.handleDirection({ x, y, z }),
      tick: () => this.forceTick(),
      setDifficulty: (key) => this.setDifficulty(key),
      freeze: (value) => {
        this.debugFreeze = Boolean(value);
      },
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
    };
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.dom.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x050c08, 0.015);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 240);
    this.camera.position.set(0, 19, 17);
    this.camera.lookAt(0, 0, 0);

    this.dom.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.running = false;
      window.__NEON_READY__ = false;
      this.dom.fatal.hidden = false;
      this.dom.fatal.querySelector("h2").textContent = "渲染信号暂时中断。";
    });
  }

  setupScene() {
    this.setupLights();
    this.glowTexture = createGlowTexture(128);
    this.setupBackdrop();
    this.setupBoard();
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0x7dffd0, 0x030604, 0.9);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff1d2, 1.7);
    key.position.set(8.5, 22, 11);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 55;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.035;
    key.target.position.set(0, 0, 0);
    this.scene.add(key);
    this.scene.add(key.target);

    const rim = new THREE.DirectionalLight(0x49ffd0, 1.05);
    rim.position.set(-11, 8, -12);
    this.scene.add(rim);

    const limeRim = new THREE.DirectionalLight(0xc9ff4d, 0.5);
    limeRim.position.set(12, 5, -9);
    this.scene.add(limeRim);

    const under = new THREE.PointLight(0x2effbd, 28, 22, 2);
    under.position.set(0, -4, 2);
    this.scene.add(under);

    const canopy = new THREE.PointLight(0xc9ffdf, 34, 30, 2);
    canopy.position.set(0, 11, 5);
    this.scene.add(canopy);
  }

  setupBackdrop() {
    const count = 460;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 18 + Math.random() * 54;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = -7 + Math.random() * 36;
      positions[i * 3 + 2] = Math.sin(angle) * radius - 8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x8acba9,
      map: this.glowTexture,
      size: 0.19,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: true,
    });
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);

    this.bokeh = [];
    const bokehData = [
      [-20, 9, -18, 0x58ffd0, 8],
      [22, 13, -24, 0x58ffd0, 11],
      [-27, 4, -8, 0xff7952, 7],
      [28, 6, -11, 0xc9ff4d, 6],
      [-14, 17, -30, 0x58ffd0, 12],
      [16, 2, -32, 0xff7952, 8],
    ];
    for (const [x, y, z, color, scale] of bokehData) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color,
          transparent: true,
          opacity: 0.11,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: true,
          toneMapped: false,
        })
      );
      sprite.position.set(x, y, z);
      sprite.scale.set(scale, scale, 1);
      this.scene.add(sprite);
      this.bokeh.push({ sprite, baseY: y, phase: Math.random() * Math.PI * 2 });
    }
  }

  setupBoard() {
    const half = GRID_SIZE / 2;
    const arena = new THREE.Group();
    this.board = arena;
    this.scene.add(arena);

    this.gridTimeUniform = { value: 0 };
    const makeGridMaterial = (opacity, color) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uTime: this.gridTimeUniform,
          uGrid: { value: GRID_SIZE },
          uOpacity: { value: opacity },
        },
        vertexShader: [
          "varying vec2 vUv;",
          "void main() {",
          "  vUv = uv;",
          "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "}",
        ].join("\n"),
        fragmentShader: GRID_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

    const faceGeometry = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);

    const floorBase = new THREE.Mesh(
      faceGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x081a12,
        roughness: 0.55,
        metalness: 0.4,
      })
    );
    floorBase.rotation.x = -Math.PI / 2;
    floorBase.position.y = ARENA_FLOOR - 0.002;
    floorBase.receiveShadow = true;
    arena.add(floorBase);

    const floorGrid = new THREE.Mesh(faceGeometry, makeGridMaterial(0.44, 0x58ffc9));
    floorGrid.rotation.x = -Math.PI / 2;
    floorGrid.position.y = ARENA_FLOOR + 0.018;
    arena.add(floorGrid);

    const backGrid = new THREE.Mesh(faceGeometry, makeGridMaterial(0.16, 0x58ffc9));
    backGrid.position.set(0, 0, -half);
    arena.add(backGrid);

    const leftGrid = new THREE.Mesh(faceGeometry, makeGridMaterial(0.065, 0x58ffc9));
    leftGrid.rotation.y = Math.PI / 2;
    leftGrid.position.set(-half, 0, 0);
    arena.add(leftGrid);

    const rightGrid = new THREE.Mesh(faceGeometry, makeGridMaterial(0.045, 0x58ffc9));
    rightGrid.rotation.y = -Math.PI / 2;
    rightGrid.position.set(half, 0, 0);
    arena.add(rightGrid);

    const railMain = new THREE.MeshBasicMaterial({ color: LIME, toneMapped: false });
    const railAccent = new THREE.MeshBasicMaterial({ color: MINT, toneMapped: false });
    this.railMaterials = [railMain, railAccent];

    const thickness = 0.045;
    const addBar = (geometry, x, y, z, material) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      arena.add(mesh);
      return mesh;
    };

    const edgeX = new THREE.BoxGeometry(GRID_SIZE + thickness, thickness, thickness);
    const edgeY = new THREE.BoxGeometry(thickness, GRID_SIZE + thickness, thickness);
    const edgeZ = new THREE.BoxGeometry(thickness, thickness, GRID_SIZE + thickness);

    for (const y of [-half, half]) {
      for (const z of [-half, half]) {
        // Leave the near-top edge open so gameplay is never crossed by a bright rail.
        if (y > 0 && z > 0) continue;
        addBar(edgeX, 0, y, z, y > 0 ? railMain : railAccent);
      }
    }
    for (const x of [-half, half]) {
      for (const z of [-half, half]) {
        addBar(edgeY, x, 0, z, railAccent);
      }
    }
    for (const x of [-half, half]) {
      for (const y of [-half, half]) {
        addBar(edgeZ, x, y, 0, y > 0 ? railMain : railAccent);
      }
    }

    const cornerMaterial = new THREE.MeshBasicMaterial({ color: 0xf3ffcf, toneMapped: false });
    this.cornerMaterial = cornerMaterial;
    const cornerGeometry = new THREE.BoxGeometry(0.17, 0.17, 0.17);
    for (const x of [-half, half]) {
      for (const y of [-half, half]) {
        for (const z of [-half, half]) {
          const corner = new THREE.Mesh(cornerGeometry, cornerMaterial);
          corner.position.set(x, y, z);
          arena.add(corner);
        }
      }
    }

    const underGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32),
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: 0x1affae,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: true,
      })
    );
    underGlow.rotation.x = -Math.PI / 2;
    underGlow.position.y = ARENA_FLOOR - 1.4;
    this.scene.add(underGlow);
    this.underGlow = underGlow;

    const platformMaterial = new THREE.MeshStandardMaterial({
      color: 0x06100b,
      roughness: 0.8,
      metalness: 0.28,
    });
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(8.0, 9.2, 1.15, 96),
      platformMaterial
    );
    platform.position.y = ARENA_FLOOR - 0.85;
    platform.receiveShadow = true;
    this.scene.add(platform);

    const platformLip = new THREE.Mesh(
      new THREE.CylinderGeometry(8.05, 8.05, 0.1, 96),
      new THREE.MeshStandardMaterial({
        color: 0x0b2418,
        roughness: 0.42,
        metalness: 0.55,
      })
    );
    platformLip.position.y = ARENA_FLOOR - 0.27;
    this.scene.add(platformLip);

    this.boardRings = [];
    const ringData = [
      [7.5, 0.55, 0.018, ARENA_FLOOR - 0.5],
      [8.9, 0.32, 0.014, ARENA_FLOOR - 0.8],
      [10.1, 0.16, 0.01, ARENA_FLOOR - 1.2],
    ];
    for (const [radius, opacity, tube, y] of ringData) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 6, 210),
        new THREE.MeshBasicMaterial({
          color: 0x46ffc8,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.scene.add(ring);
      this.boardRings.push(ring);
    }
  }

  setupViews() {
    this.snakeView = new SnakeView(this.scene, this.glowTexture);
    this.foodView = new FoodView(this.scene, this.glowTexture);
    this.particles = new ParticleField(this.scene);
  }

  /* ============================================================
     UI wiring
     ============================================================ */

  setupUI() {
    this.dom.startBtn.addEventListener("click", () => this.startGame());
    this.dom.retryBtn.addEventListener("click", () => this.startGame());
    this.dom.menuBtn.addEventListener("click", () => this.enterMenu());
    this.dom.resumeBtn.addEventListener("click", () => this.resumeGame());
    this.dom.pauseRestartBtn.addEventListener("click", () => this.startGame());
    this.dom.pauseMenuBtn.addEventListener("click", () => this.enterMenu());
    this.dom.pauseBtn.addEventListener("click", () => {
      if (this.appState === "playing") this.pauseGame();
      else if (this.appState === "paused") this.resumeGame();
    });
    this.dom.soundBtn.addEventListener("click", () => this.toggleSound());

    for (const button of this.dom.difficultyButtons) {
      button.addEventListener("click", () => {
        if (this.appState !== "menu") return;
        this.setDifficulty(button.dataset.difficulty);
        this.audio.click();
      });
    }

    for (const button of this.dom.touchButtons) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const direction = DIRECTION_KEYS[button.dataset.dir];
        if (direction) this.handleDirection(direction);
      });
    }

    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.appState === "playing") this.pauseGame(true);
    });

    this.updateDifficultyUI();
    this.updateBestDisplay();
    this.syncHud();
  }

  setupInput() {
    document.addEventListener("keydown", (event) => this.onKeyDown(event));

    this.dom.canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      this.pointerStart = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };
    });

    const finishPointer = (event) => {
      if (!this.pointerStart) return;
      const start = this.pointerStart;
      this.pointerStart = null;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        this.handleDirection({ x: dx > 0 ? 1 : -1, y: 0, z: 0 });
      } else {
        this.handleDirection({ x: 0, y: 0, z: dy > 0 ? 1 : -1 });
      }
    };
    this.dom.canvas.addEventListener("pointerup", finishPointer);
    this.dom.canvas.addEventListener("pointercancel", () => {
      this.pointerStart = null;
    });
  }

  toggleSound() {
    if (this.audio.muted) {
      this.audio.setMuted(false);
      this.audio.click();
    } else {
      this.audio.click();
      this.audio.setMuted(true);
    }
    this.muted = this.audio.muted;
    storage.set(STORAGE.muted, this.muted ? "1" : "0");
    this.syncSoundUI();
  }

  syncSoundUI() {
    this.dom.soundBtn.setAttribute("aria-pressed", String(!this.muted));
    this.dom.soundBtn.setAttribute("aria-label", this.muted ? "开启声音" : "关闭声音");
    this.dom.soundBtn.setAttribute("title", this.muted ? "声音已关闭 (M)" : "声音已开启 (M)");
  }

  setDifficulty(key) {
    if (!DIFFICULTIES[key] || this.appState !== "menu") return;
    this.difficulty = key;
    this.engine.setDifficulty(key);
    this.lastTickMs = this.engine.tickMs;
    storage.set(STORAGE.difficulty, key);
    this.updateDifficultyUI();
    this.syncHud();
  }

  updateDifficultyUI() {
    for (const button of this.dom.difficultyButtons) {
      const selected = button.dataset.difficulty === this.difficulty;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    this.dom.paceNote.textContent = DIFFICULTIES[this.difficulty].pace;
  }

  updateBestDisplay() {
    this.dom.best.textContent = padded(this.best);
  }

  syncHud() {
    const engine = this.engine;
    this.dom.score.textContent = padded(engine.score);
    this.dom.best.textContent = padded(this.best);
    this.dom.lengthStat.textContent = padded(engine.length, 2);
    this.dom.speedStat.innerHTML = engine.speedMultiplier.toFixed(1) + "<small>×</small>";
    if (this.dom.altStat) {
      this.dom.altStat.innerHTML =
        String(engine.head.y + 1).padStart(2, "0") + "<small>/" + GRID_SIZE + "</small>";
    }
    const activeBars = clamp(1 + Math.floor(engine.eaten / 3), 1, 5);
    this.dom.signalBars.forEach((bar, index) => {
      bar.classList.toggle("is-on", index < activeBars);
    });
    this.updateComboUI(true);
  }

  updateComboUI(force = false) {
    const engine = this.engine;
    const active = this.appState === "playing" && engine.combo > 1 && engine.comboTimer > 0;
    if (active) this.dom.combo.textContent = "×" + engine.combo;
    if (active !== this.comboActive || force) {
      this.comboActive = active;
      this.dom.combo.dataset.active = active ? "true" : "false";
    }
  }

  popScore() {
    const el = this.dom.score;
    el.classList.remove("is-pop");
    void el.offsetWidth;
    el.classList.add("is-pop");
  }

  flash(danger = false) {
    const el = this.dom.flash;
    window.clearTimeout(this.flashTimer);
    el.classList.remove("is-on", "is-danger");
    void el.offsetWidth;
    if (danger) el.classList.add("is-danger");
    el.classList.add("is-on");
    this.flashTimer = window.setTimeout(() => {
      el.classList.remove("is-on", "is-danger");
    }, 520);
  }

  showToast(text, duration = 1000, danger = false) {
    const el = this.dom.toast;
    window.clearTimeout(this.toastTimer);
    el.textContent = text;
    el.classList.toggle("is-danger", danger);
    el.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => el.classList.remove("is-visible"), duration);
  }

  /* ============================================================
     Screens & state transitions
     ============================================================ */

  showScreen(mode) {
    this.dom.screen.dataset.mode = mode;
    this.dom.screen.classList.remove("is-hidden");
    this.dom.screen.setAttribute("aria-hidden", "false");
    this.dom.startPanel.hidden = mode !== "menu";
    this.dom.overPanel.hidden = mode !== "gameover";
    this.dom.pausePanel.hidden = mode !== "paused";
  }

  hideScreen() {
    this.dom.screen.classList.add("is-hidden");
    this.dom.screen.setAttribute("aria-hidden", "true");
  }

  enterMenu(immediate = false) {
    window.clearTimeout(this.overTimer);
    this.overTimer = 0;
    this.numberAnimationToken += 1;
    this.dom.toast.classList.remove("is-visible");
    this.engine.reset();
    this.appState = "menu";
    this.dom.app.dataset.state = "menu";
    this.dom.screenKicker.textContent = "ARCADE PROTOCOL / 001";
    this.showScreen("menu");
    this.snakeView.revive({ x: 0, y: 0, z: 1 });
    this.snakeView.update({
      snake: DEMO_SNAKE,
      prevSnake: DEMO_SNAKE,
      progress: 1,
      time: this.time,
      direction: { x: 0, y: 0, z: 1 },
      dt: 0.016,
      deathT: 0,
    });
    this.foodView.setCell(DEMO_FOOD, performance.now(), true);
    this.foodView.setVisible(true);
    this.nextTickAt = Infinity;
    this.progress = 1;
    this.deathT = 0;
    this.deathStartedAt = 0;
    this.gameWon = false;
    this.gameOverData = null;
    this.headPulse = 0;
    this.fovPulse = 0;
    this.shake = 0;
    this.dangerFlash = 0;
    this.lastTickMs = this.engine.tickMs;
    this.dom.startPanel.hidden = false;
    this.dom.overPanel.hidden = true;
    this.dom.pausePanel.hidden = true;
    this.syncHud();
    this.updateBestDisplay();
    if (immediate) {
      this.updateCamera(0, performance.now(), true);
    }
  }

  startGame() {
    window.clearTimeout(this.overTimer);
    this.overTimer = 0;
    this.numberAnimationToken += 1;
    this.audio.ensure();
    this.audio.start();
    this.engine.start();
    this.appState = "playing";
    this.dom.app.dataset.state = "playing";
    this.hideScreen();
    this.snakeView.revive();
    this.foodView.setCell(this.engine.food, performance.now(), false);
    this.foodView.setVisible(true);
    this.nextTickAt = performance.now() + 1500;
    this.progress = 0;
    this.deathT = 0;
    this.deathStartedAt = 0;
    this.gameWon = false;
    this.gameOverData = null;
    this.headPulse = 0;
    this.fovPulse = 0;
    this.shake = 0;
    this.dangerFlash = 0;
    this.comboActive = false;
    this.dom.combo.dataset.active = "false";
    this.lastTickMs = this.engine.tickMs;
    this.debugFreeze = false;
    this.syncHud();
    this.flash(false);
    this.showToast("SIGNAL LOCKED // 方向键移动 · Q/E 升降", 1600);
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }

  pauseGame(auto = false) {
    if (this.appState !== "playing") return;
    this.pausedProgress = this.progress;
    this.engine.pause();
    this.appState = "paused";
    this.dom.app.dataset.state = "paused";
    this.dom.screenKicker.textContent = auto ? "AUTO PAUSE / 已自动暂停" : "PAUSE PROTOCOL / 002";
    this.showScreen("paused");
    this.dom.combo.dataset.active = "false";
    this.audio.pause();
  }

  resumeGame() {
    if (this.appState !== "paused") return;
    this.engine.resume();
    this.appState = "playing";
    this.dom.app.dataset.state = "playing";
    this.hideScreen();
    this.nextTickAt =
      performance.now() + Math.max(65, this.engine.tickMs * (1 - this.pausedProgress));
    this.audio.resume();
  }

  handleDirection(direction) {
    if (!direction) return;
    const { x = 0, y = 0, z = 0 } = direction;
    if (this.appState === "menu" || this.appState === "gameover") {
      this.startGame();
      if (this.engine.setDirection(x, y, z)) this.audio.turn();
      return;
    }
    if (this.appState === "playing") {
      if (this.engine.setDirection(x, y, z)) this.audio.turn();
      return;
    }
    if (this.appState === "paused") this.resumeGame();
  }

  forceTick() {
    if (this.appState !== "playing") return null;
    const event = this.engine.step();
    this.handleEngineEvent(event);
    if (this.engine.phase === "playing") {
      this.nextTickAt = performance.now() + this.engine.tickMs;
      this.progress = 0;
    } else {
      this.nextTickAt = Infinity;
    }
    return event;
  }

  onKeyDown(event) {
    const code = event.code;
    const direction = DIRECTION_KEYS[code];
    const isActivation = code === "Space" || code === "Enter";
    const focusedButton =
      document.activeElement && document.activeElement.tagName === "BUTTON";

    if (event.repeat) {
      if (direction || isActivation) event.preventDefault();
      return;
    }

    if (isActivation && focusedButton) return;

    if (direction) {
      event.preventDefault();
      this.handleDirection(direction);
      return;
    }

    if (isActivation) {
      event.preventDefault();
      if (this.appState === "menu" || this.appState === "gameover") this.startGame();
      else if (this.appState === "playing") this.pauseGame();
      else if (this.appState === "paused") this.resumeGame();
      else if (this.appState === "dead") this.showGameOver();
      return;
    }

    if (code === "KeyR") {
      if (this.appState !== "menu" && this.appState !== "boot") {
        event.preventDefault();
        this.startGame();
      }
      return;
    }

    if (code === "KeyM") {
      this.toggleSound();
      return;
    }

    if (code === "Escape" || code === "KeyP") {
      if (this.appState === "playing") {
        event.preventDefault();
        this.pauseGame();
      } else if (this.appState === "paused") {
        event.preventDefault();
        this.resumeGame();
      }
    }
  }

  /* ============================================================
     Game events
     ============================================================ */

  cellToWorld(cell, yOffset = 0) {
    return new THREE.Vector3(
      cell.x - CELL_CENTER,
      cell.y - CELL_CENTER + yOffset,
      cell.z - CELL_CENTER
    );
  }

  handleEngineEvent(event) {
    if (!event) return;
    if (event.type === "eat") {
      this.handleEat(event);
    } else if (event.type === "death" || event.type === "win") {
      this.handleEnd(event);
    }
  }

  handleEat(event) {
    const previousTick = this.lastTickMs;
    this.lastTickMs = this.engine.tickMs;
    const now = performance.now();

    this.headPulse = 1;
    this.fovPulse = 0.55;
    this.shake = Math.max(this.shake, 0.05);
    this.flash(false);
    this.audio.eat(event.combo);
    this.foodView.setCell(event.food, now, false);
    this.foodView.setVisible(true);

    const foodOrigin = this.cellToWorld(event.eatenFood, 0.58);
    this.particles.emit(foodOrigin, {
      count: 18,
      colors: [CORAL, CREAM, LIME],
      speed: 3.8,
      spread: 0.2,
      life: 0.7,
      size: 1.05,
      gravity: 4.8,
      upward: 2.2,
    });
    const headOrigin = this.cellToWorld(event.cell, 0.58);
    this.particles.emit(headOrigin, {
      count: 8,
      colors: [LIME, MINT],
      speed: 1.6,
      spread: 0.1,
      life: 0.45,
      size: 0.8,
      gravity: 2.4,
      upward: 1.1,
    });

    this.syncHud();
    this.popScore();
    this.updateComboUI(true);

    if (event.combo >= 3) {
      this.showToast("COMBO ×" + event.combo + "  +" + event.gained, 950);
    } else if (this.engine.eaten % 3 === 0 && this.engine.tickMs < previousTick) {
      this.showToast("VELOCITY UP // 速度提升", 950);
      this.audio.speedUp();
    }
  }

  handleEnd(event) {
    if (this.appState === "dead" || this.appState === "gameover") return;
    const now = performance.now();
    const won = event.type === "win";
    this.gameWon = won;
    this.appState = "dead";
    this.dom.app.dataset.state = "dead";
    this.deathStartedAt = now;
    this.deathT = 0;
    this.headPulse = 1;
    this.fovPulse = 1.1;
    this.shake = 0.52;
    this.dangerFlash = 1;
    this.flash(true);
    this.foodView.setVisible(false);
    this.dom.combo.dataset.active = "false";

    const isRecord = this.engine.score > this.best;
    if (isRecord) {
      this.best = this.engine.score;
      storage.set(STORAGE.best, this.best);
    }
    const cause = won ? "win" : event.cause || "wall";
    const reasons = {
      wall: "撞上了立体矩阵的边界。",
      self: "咬到了自己的身体。在三维空间里也要留后路。",
      win: "整张矩阵都亮了起来。你把它吃干净了。",
    };
    this.gameOverData = {
      won,
      cause,
      reason: reasons[cause] || reasons.wall,
      score: this.engine.score,
      length: this.engine.snake.length,
      isRecord,
    };

    const head = this.engine.snake[0];
    this.particles.emit(this.cellToWorld(head, 0.6), {
      count: 46,
      colors: [CORAL, CREAM, LIME, MINT],
      speed: 6,
      spread: 0.3,
      life: 1.15,
      size: 1.5,
      gravity: 6.5,
      upward: 3.2,
    });
    this.spawnSnakeBurst();

    this.syncHud();
    this.updateBestDisplay();

    if (won) this.audio.newRecord();
    else this.audio.death();

    window.clearTimeout(this.overTimer);
    this.overTimer = window.setTimeout(() => this.showGameOver(), 790);
  }

  spawnSnakeBurst() {
    const snake = this.engine.snake;
    const stride = Math.max(1, Math.ceil(snake.length / 22));
    for (let i = 0; i < snake.length; i += stride) {
      this.particles.emit(this.cellToWorld(snake[i], 0.46), {
        count: 3,
        colors: [HEAD_COLOR, TAIL_COLOR, CREAM],
        speed: 2.6,
        spread: 0.18,
        life: 0.85,
        size: 1.1,
        gravity: 5.5,
        upward: 2.1,
      });
    }
  }

  showGameOver() {
    if (!this.gameOverData || this.appState !== "dead") return;
    window.clearTimeout(this.overTimer);
    this.overTimer = 0;
    this.appState = "gameover";
    this.dom.app.dataset.state = "gameover";
    this.deathT = 1;
    if (!this.gameWon) this.snakeView.hide();
    this.showScreen("gameover");
    this.dom.screenKicker.textContent = "ARCADE PROTOCOL / 002";

    const data = this.gameOverData;
    this.dom.overKicker.textContent = data.won ? "PERFECT SIGNAL" : "SIGNAL LOST";
    this.dom.overTitle.innerHTML = data.won
      ? "MATRIX<br><span>CLEARED</span>"
      : "GAME<br><span>OVER</span>";
    this.dom.overReason.textContent = data.reason;
    this.dom.finalLength.textContent = padded(data.length, 2);
    this.dom.finalBest.textContent = padded(this.best);
    this.dom.newRecord.hidden = !data.isRecord;
    this.dom.finalScore.textContent = padded(0);
    this.animateNumber(this.dom.finalScore, 0, data.score, 620);

    if (data.isRecord) this.audio.newRecord();
    this.updateBestDisplay();
  }

  animateNumber(element, from, to, duration) {
    const token = ++this.numberAnimationToken;
    const started = performance.now();
    const tick = (now) => {
      if (token !== this.numberAnimationToken) return;
      const t = clamp((now - started) / duration, 0, 1);
      element.textContent = padded(from + (to - from) * easeOutCubic(t));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ============================================================
     Layout & camera
     ============================================================ */

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.frameDistance = this.computeFrameDistance();
    this.camera.updateProjectionMatrix();
    if (this.particles) this.particles.setPixelRatio(pixelRatio);
    this.updateCamera(0, performance.now(), true);
  }

  computeFrameDistance() {
    const halfSize = 9.2;
    const vTan = Math.tan((this.baseFov * Math.PI) / 360);
    const hTan = vTan * this.camera.aspect;
    return Math.max(halfSize / vTan, halfSize / Math.max(0.001, hTan));
  }

  updateCamera(dt, now, immediate = false) {
    const menuLike =
      this.appState === "menu" || this.appState === "boot" || this.appState === "gameover";
    const idle = menuLike && !this.reducedMotion;
    const az = 0.3 + (idle ? Math.sin(this.time * 0.09) * 0.035 : 0);
    const elevation = 0.68 + (idle ? Math.sin(this.time * 0.15) * 0.01 : 0);
    const distance =
      this.frameDistance * (idle ? 1 + Math.sin(this.time * 0.17) * 0.006 : 1);

    const target = new THREE.Vector3(0, 0, 0);
    if (this.appState === "playing" || this.appState === "paused" || this.appState === "dead") {
      const head = this.engine.snake[0] || { x: 4, y: 4, z: 4 };
      target.x = (head.x - CELL_CENTER) * 0.035;
      target.y = (head.y - CELL_CENTER) * 0.035;
      target.z = (head.z - CELL_CENTER) * 0.035;
    }

    const dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(az) * Math.cos(elevation)
    ).multiplyScalar(distance);
    dir.x += target.x;
    dir.y += target.y;
    dir.z += target.z;

    const follow = immediate ? 1 : 1 - Math.exp(-2.8 * Math.max(dt, 0.001));
    this.camera.position.lerp(dir, follow);
    const lookGoal = new THREE.Vector3(target.x * 0.5, target.y * 0.5, target.z * 0.5);
    this.lookTarget.lerp(lookGoal, immediate ? 1 : 1 - Math.exp(-4 * Math.max(dt, 0.001)));

    const fov = this.baseFov + this.fovPulse * 1.4;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    if (this.shake > 0.0005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.5;
    }

    this.camera.lookAt(this.lookTarget);
  }

  /* ============================================================
     Frame loop
     ============================================================ */

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);

    const rawDt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0.016;
    this.lastFrame = now;
    const dt = Math.min(0.05, Math.max(0, rawDt));
    this.time += dt;

    if (this.appState === "playing") {
      if (!this.debugFreeze) {
        this.engine.update(dt * 1000);
        if (now >= this.nextTickAt) {
          const event = this.engine.step();
          this.handleEngineEvent(event);
          if (this.engine.phase === "playing") {
            this.nextTickAt = now + this.engine.tickMs;
          } else {
            this.nextTickAt = Infinity;
          }
        }
        if (Number.isFinite(this.nextTickAt)) {
          this.progress = clamp(
            1 - (this.nextTickAt - now) / Math.max(1, this.engine.tickMs),
            0,
            1
          );
        }
      } else {
        this.progress = 1;
      }
      this.updateComboUI();
    } else if (this.appState === "dead" || this.appState === "gameover") {
      if (!this.gameWon && this.deathStartedAt) {
        this.deathT = clamp((now - this.deathStartedAt) / 900, 0, 1);
      } else {
        this.deathT = 0;
      }
    }

    this.headPulse = Math.max(0, this.headPulse - dt * 4.2);
    this.fovPulse = Math.max(0, this.fovPulse - dt * 3.1);
    this.shake *= Math.exp(-dt * 5);
    this.dangerFlash = Math.max(0, this.dangerFlash - dt * 1.7);

    this.updateWorld(dt, now);
    this.renderer.render(this.scene, this.camera);
  }

  updateWorld(dt, now) {
    this.gridTimeUniform.value = this.time;
    this.underGlow.material.opacity = 0.3 + Math.sin(this.time * 0.8) * 0.045;
    for (let i = 0; i < this.boardRings.length; i += 1) {
      this.boardRings[i].rotation.z += dt * (0.045 + i * 0.025);
    }
    if (this.stars) this.stars.rotation.y += dt * 0.006;
    for (const item of this.bokeh) {
      item.sprite.position.y = item.baseY + Math.sin(this.time * 0.35 + item.phase) * 0.55;
    }

    const danger = this.dangerFlash;
    if (this.railMaterials[0]) {
      this.railMaterials[0].color.set(LIME).lerp(new THREE.Color(CORAL), danger);
    }
    if (this.railMaterials[1]) {
      this.railMaterials[1].color.set(MINT).lerp(new THREE.Color(CORAL), danger);
    }
    if (this.cornerMaterial) {
      this.cornerMaterial.color.set(0xf3ffcf).lerp(new THREE.Color(CORAL), danger * 0.8);
    }

    this.foodView.update(this.time, now, dt);

    if (this.appState === "menu") {
      this.snakeView.update({
        snake: DEMO_SNAKE,
        prevSnake: DEMO_SNAKE,
        progress: 1,
        time: this.time,
        direction: { x: 0, y: 0, z: 1 },
        dt,
        headPulse: 0.15 + Math.sin(this.time * 1.3) * 0.1,
        deathT: 0,
      });
    } else if (this.appState === "playing" || this.appState === "paused") {
      this.snakeView.update({
        snake: this.engine.snake,
        prevSnake: this.engine.prevSnake,
        progress: this.progress,
        time: this.time,
        direction: this.engine.direction,
        dt,
        headPulse: this.headPulse,
        deathT: 0,
      });
    } else if (this.appState === "dead" || this.appState === "gameover") {
      if (!this.gameWon && this.deathT >= 1) {
        this.snakeView.hide();
      } else {
        this.snakeView.update({
          snake: this.engine.snake,
          prevSnake: this.engine.prevSnake,
          progress: 1,
          time: this.time,
          direction: this.engine.direction,
          dt,
          headPulse: this.headPulse,
          deathT: this.deathT,
        });
      }
    }

    this.particles.update(dt);
    this.updateCamera(dt, now);
  }

  /* ============================================================
     Failure
     ============================================================ */

  showFatal(error) {
    this.running = false;
    if (this.dom.boot) this.dom.boot.classList.add("is-hidden");
    if (this.dom.fatal) {
      this.dom.fatal.hidden = false;
      const heading = this.dom.fatal.querySelector("h2");
      if (heading) heading.textContent = "这台设备暂时无法点亮矩阵。";
    }
    console.error("[NEON SERPENT]", error);
  }
}

function canUseWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

if (!canUseWebGL()) {
  const fatal = document.getElementById("fatal");
  const boot = document.getElementById("boot");
  if (boot) boot.classList.add("is-hidden");
  if (fatal) fatal.hidden = false;
} else {
  const game = new NeonSerpent();
  game.init().catch((error) => game.showFatal(error));
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[NEON SERPENT] unhandled rejection", event.reason);
  });
}
