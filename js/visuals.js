/**
 * Three.js character work for the 3D volume arena.
 */
import * as THREE from "three";
import { GRID_SIZE } from "./engine.js";

/* ------------------------------------------------------------
   Geometry constants and helpers
   ------------------------------------------------------------ */

export const CELL_CENTER = (GRID_SIZE - 1) / 2;
export const ARENA_FLOOR = -GRID_SIZE / 2;
export const HEAD_COLOR = new THREE.Color("#78ff00");
export const TAIL_COLOR = new THREE.Color("#00e8d0");
export const LIME = 0xc9ff4d;
export const MINT = 0x58ffd0;
export const CORAL = 0xff7952;
export const CREAM = 0xfff1c7;

const FORWARD = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolate on a torus so a portal crossing travels to the near face. */
function wrappedLerp(from, to, t) {
  let delta = to - from;
  if (delta > GRID_SIZE / 2) delta -= GRID_SIZE;
  else if (delta < -GRID_SIZE / 2) delta += GRID_SIZE;
  return from + delta * t;
}

export function cellToWorld(cell) {
  return new THREE.Vector3(
    cell.x - CELL_CENTER,
    cell.y - CELL_CENTER,
    cell.z - CELL_CENTER
  );
}

export function directionQuaternion(x, y, z) {
  const q = new THREE.Quaternion();
  if (z === -1) q.setFromAxisAngle(Y_AXIS, Math.PI);
  else if (x === 1) q.setFromAxisAngle(Y_AXIS, Math.PI / 2);
  else if (x === -1) q.setFromAxisAngle(Y_AXIS, -Math.PI / 2);
  else if (y === 1) q.setFromAxisAngle(X_AXIS, -Math.PI / 2);
  else if (y === -1) q.setFromAxisAngle(X_AXIS, Math.PI / 2);
  return q;
}

export function createGlowTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.82)");
  gradient.addColorStop(0.46, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createSegmentGeometry({
  width = 0.68,
  height = 0.68,
  depth = 0.62,
  radius = 0.19,
  bevel = 0.05,
} = {}) {
  const w = width;
  const h = height;
  const r = Math.min(radius, w / 2, h / 2);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, depth - bevel * 2),
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 5,
  });
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A 3D coiled demo snake for the attract screen. Head first. */
function buildDemoSnake() {
  const path = [{ x: 3, y: 3, z: 3 }];
  const advance = (dx, dy, dz, count) => {
    for (let i = 0; i < count; i += 1) {
      const last = path[path.length - 1];
      path.push({ x: last.x + dx, y: last.y + dy, z: last.z + dz });
    }
  };
  advance(1, 0, 0, 4);
  advance(0, 0, 1, 4);
  advance(0, 1, 0, 3);
  advance(-1, 0, 0, 3);
  advance(0, 0, -1, 4);
  advance(0, 1, 0, 2);
  advance(1, 0, 0, 3);
  advance(0, 0, 1, 2);
  return path.slice(-24).reverse();
}

export const DEMO_SNAKE = Object.freeze(buildDemoSnake());
export const DEMO_FOOD = Object.freeze({ x: 3, y: 9, z: 8 });

/* ------------------------------------------------------------
   Snake
   ------------------------------------------------------------ */

export class SnakeView {
  constructor(scene, glowTexture) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.scene = scene;
    this.glowTexture = glowTexture;

    this.segmentGeometry = createSegmentGeometry();
    this.headGeometry = createSegmentGeometry({ width: 0.72, height: 0.72, depth: 0.66 });
    this.segmentMeshes = [];
    this.segmentMaterials = [];
    this.deathSeeds = [];

    this.auraMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0x72ff2a,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    for (let i = 0; i < 24; i += 1) {
      const t = i / 23;
      const color = new THREE.Color().lerpColors(HEAD_COLOR, TAIL_COLOR, t);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color.clone().multiplyScalar(0.78),
        emissiveIntensity: 1.18,
        roughness: 0.52,
        metalness: 0.0,
        toneMapped: false,
      });
      this.segmentMaterials.push(material);
    }

    this.headMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#8dff12"),
      emissive: new THREE.Color("#3dff00"),
      emissiveIntensity: 1.05,
      roughness: 0.48,
      metalness: 0.0,
      toneMapped: false,
    });

    this.buildHead(glowTexture);
    this.buildFloorProjection();
  }

  buildHead(glowTexture) {
    this.headGroup = new THREE.Group();
    this.headGroup.visible = false;
    this.group.add(this.headGroup);

    this.headMesh = new THREE.Mesh(this.headGeometry, this.headMaterial);
    this.headMesh.castShadow = true;
    this.headMesh.receiveShadow = true;
    this.headMesh.scale.setScalar(1.06);
    this.headGroup.add(this.headMesh);

    const eyeWhiteMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xfff8dd,
      emissive: 0xffedb0,
      emissiveIntensity: 0.7,
      roughness: 0.1,
      clearcoat: 1,
    });
    const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x06110a });
    const eyeGeometry = new THREE.SphereGeometry(0.078, 16, 12);
    const pupilGeometry = new THREE.SphereGeometry(0.041, 12, 10);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
      eye.position.set(side * 0.21, 0.405, 0.22);
      eye.scale.set(0.94, 1.1, 0.92);
      this.headGroup.add(eye);

      const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
      pupil.position.set(side * 0.222, 0.46, 0.268);
      pupil.scale.set(0.85, 1.1, 0.62);
      this.headGroup.add(pupil);
    }

    this.tongueMaterial = new THREE.MeshBasicMaterial({ color: 0xff6d55, toneMapped: false });
    this.tongue = new THREE.Group();
    const tongueGeometry = new THREE.BoxGeometry(0.022, 0.018, 0.21);
    const leftFork = new THREE.Mesh(tongueGeometry, this.tongueMaterial);
    leftFork.position.set(-0.046, 0, 0.1);
    leftFork.rotation.y = 0.25;
    const rightFork = new THREE.Mesh(tongueGeometry, this.tongueMaterial);
    rightFork.position.set(0.046, 0, 0.1);
    rightFork.rotation.y = -0.25;
    this.tongue.add(leftFork, rightFork);
    this.tongue.position.set(0, -0.06, 0.4);
    this.tongue.scale.z = 0.2;
    this.headGroup.add(this.tongue);

    this.headHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: LIME,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.headHalo.scale.set(2.1, 2.1, 1);
    this.headHalo.position.set(0, 0.04, 0);
    this.headGroup.add(this.headHalo);

    this.headLight = new THREE.PointLight(0xbfff55, 4.5, 4.6, 2);
    this.headLight.position.set(0, 0.38, 0.1);
    this.headGroup.add(this.headLight);
  }

  buildFloorProjection() {
    this.floorY = ARENA_FLOOR + 0.02;
    this.headProjection = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.43, 40),
      new THREE.MeshBasicMaterial({
        color: MINT,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.headProjection.rotation.x = -Math.PI / 2;
    this.headProjection.visible = false;
    this.scene.add(this.headProjection);

    this.headBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 1, 6),
      new THREE.MeshBasicMaterial({
        color: MINT,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.headBeam.visible = false;
    this.scene.add(this.headBeam);

    const half = GRID_SIZE / 2;
    const levelGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, 0, -half),
      new THREE.Vector3(half, 0, -half),
      new THREE.Vector3(half, 0, half),
      new THREE.Vector3(-half, 0, half),
    ]);
    this.levelSquare = new THREE.LineLoop(
      levelGeometry,
      new THREE.LineDashedMaterial({
        color: MINT,
        transparent: true,
        opacity: 0.16,
        dashSize: 0.18,
        gapSize: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.levelSquare.computeLineDistances();
    this.levelSquare.visible = false;
    this.scene.add(this.levelSquare);
  }

  ensureSegments(count) {
    while (this.segmentMeshes.length < count) {
      const index = this.segmentMeshes.length;
      const mesh = new THREE.Mesh(this.segmentGeometry, this.segmentMaterials[0]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.segmentMeshes.push(mesh);
      this.group.add(mesh);

      const aura = new THREE.Sprite(this.auraMaterial);
      aura.scale.set(1.25, 1.25, 1);
      aura.visible = false;
      this.group.add(aura);
      mesh.userData.aura = aura;
      this.deathSeeds[index] = this.makeDeathSeed();
    }
  }

  makeDeathSeed() {
    const angle = Math.random() * Math.PI * 2;
    return {
      x: Math.cos(angle) * (0.6 + Math.random() * 1.6),
      z: Math.sin(angle) * (0.6 + Math.random() * 1.6),
      y: 1.5 + Math.random() * 3.2,
      spin: (Math.random() - 0.5) * 5,
    };
  }

  revive(direction = { x: 0, y: 0, z: -1 }) {
    this.group.visible = true;
    this.headGroup.visible = true;
    this.segmentMeshes.forEach((mesh) => {
      mesh.visible = false;
      mesh.rotation.set(0, 0, 0);
      if (mesh.userData.aura) mesh.userData.aura.visible = false;
    });
    this.deathSeeds = [];
    this.headGroup.quaternion.copy(directionQuaternion(direction.x, direction.y, direction.z));
    this.headProjection.visible = false;
    this.headBeam.visible = false;
    this.levelSquare.visible = true;
  }

  update({ snake, prevSnake, progress, time, direction, dt, headPulse = 0, deathT = 0 }) {
    if (!snake || !snake.length) return;
    this.group.visible = true;
    this.headGroup.visible = true;

    const n = snake.length;
    this.ensureSegments(Math.max(0, n - 1));
    const count = this.segmentMaterials.length;

    for (let i = 1; i < n; i += 1) {
      const mesh = this.segmentMeshes[i - 1];
      const from = prevSnake[Math.min(i, prevSnake.length - 1)] || snake[i];
      const to = snake[i];
      const x = wrappedLerp(from.x, to.x, progress) - CELL_CENTER;
      const y = wrappedLerp(from.y, to.y, progress) - CELL_CENTER;
      const z = wrappedLerp(from.z, to.z, progress) - CELL_CENTER;
      const taper = 1 - 0.24 * (i / Math.max(1, n));
      const wave = 1 + Math.sin(time * 3.1 - i * 0.55) * 0.018;
      const materialIndex = Math.min(
        count - 1,
        Math.round((i / Math.max(1, n - 1)) * (count - 1))
      );

      mesh.material = this.segmentMaterials[materialIndex];
      mesh.position.set(
        x,
        y + Math.sin(time * 3.2 - i * 0.55) * 0.014,
        z
      );
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(taper * wave);

      const aura = mesh.userData.aura;
      if (aura) {
        aura.visible = true;
        aura.position.copy(mesh.position);
        const auraScale = 1.18 + taper * 0.28 + Math.sin(time * 2.6 - i * 0.4) * 0.05;
        aura.scale.set(auraScale, auraScale, 1);
      }

      if (deathT > 0) {
        const seed = this.deathSeeds[i - 1] || this.makeDeathSeed();
        const t = deathT;
        mesh.position.x += seed.x * t * 2.2;
        mesh.position.z += seed.z * t * 2.2;
        mesh.position.y += seed.y * t * 0.6 - 3.2 * t * t;
        mesh.rotation.x = seed.spin * t;
        mesh.rotation.z = seed.spin * 0.7 * t;
        mesh.scale.setScalar(taper * wave * (1 - t * 0.7));
      }

      mesh.visible = true;
      if (deathT > 0.1 && aura) aura.visible = false;
    }

    for (let i = Math.max(0, n - 1); i < this.segmentMeshes.length; i += 1) {
      this.segmentMeshes[i].visible = false;
      if (this.segmentMeshes[i].userData.aura) {
        this.segmentMeshes[i].userData.aura.visible = false;
      }
    }

    const headFrom = prevSnake[0] || snake[0];
    const headTo = snake[0];
    const hx = wrappedLerp(headFrom.x, headTo.x, progress) - CELL_CENTER;
    const hy = wrappedLerp(headFrom.y, headTo.y, progress) - CELL_CENTER;
    const hz = wrappedLerp(headFrom.z, headTo.z, progress) - CELL_CENTER;

    const targetQuaternion = directionQuaternion(direction.x, direction.y, direction.z);
    this.headGroup.quaternion.slerp(targetQuaternion, 1 - Math.exp(-16 * Math.min(dt, 0.05)));

    const flick = Math.sin(time * 1.65 + Math.sin(time * 0.4) * 2) > 0.72;
    const tongueTarget = flick ? 1 : 0.22;
    this.tongue.scale.z = lerp(this.tongue.scale.z, tongueTarget, Math.min(1, dt * 14));
    this.tongue.visible = deathT < 0.05;

    const headScale = 1 + headPulse * 0.22 + Math.sin(time * 3.4) * 0.009;
    const headY = hy + Math.sin(time * 3.4) * 0.018;
    this.headGroup.position.set(hx, headY, hz);
    this.headGroup.scale.setScalar(headScale);

    if (deathT > 0) {
      const seed = this.deathSeeds[0] || this.makeDeathSeed();
      const t = deathT;
      this.headGroup.position.x += seed.x * t * 2;
      this.headGroup.position.z += seed.z * t * 2;
      this.headGroup.position.y += seed.y * t * 0.55 - 3.2 * t * t;
      this.headGroup.scale.setScalar(Math.max(0.01, 1 - t * 0.55));
      this.headProjection.visible = false;
      this.headBeam.visible = false;
      this.levelSquare.visible = false;
    } else {
      this.floorY = ARENA_FLOOR + 0.025;
      this.headProjection.visible = true;
      this.headProjection.position.set(hx, this.floorY, hz);
      const projectionScale = 0.9 + Math.sin(time * 2.4) * 0.08;
      this.headProjection.scale.setScalar(projectionScale);
      this.headProjection.material.opacity = 0.2 + Math.max(0, hy + 4) * 0.02;
      this.levelSquare.visible = true;
      this.levelSquare.position.set(0, hy, 0);
      this.levelSquare.material.opacity = 0.1 + Math.max(0, hy + 4) * 0.012;

      const beamHeight = Math.max(0, headY - this.floorY);
      if (beamHeight > 0.08) {
        this.headBeam.visible = true;
        this.headBeam.position.set(hx, this.floorY + beamHeight / 2, hz);
        this.headBeam.scale.set(1, beamHeight, 1);
        this.headBeam.material.opacity = 0.1 + Math.min(0.1, beamHeight * 0.015);
      } else {
        this.headBeam.visible = false;
      }
    }

    this.headHalo.material.opacity = 0.24 + 0.1 * Math.sin(time * 2.8);
    this.headHalo.scale.setScalar(1.95 + Math.sin(time * 2.1) * 0.16);
  }

  hide() {
    this.group.visible = false;
    this.headProjection.visible = false;
    this.headBeam.visible = false;
    this.levelSquare.visible = false;
  }
}

/* ------------------------------------------------------------
   Food
   ------------------------------------------------------------ */

export class FoodView {
  constructor(scene, glowTexture) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.scene = scene;

    this.coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xff6b32,
      emissive: new THREE.Color(0xff2d00),
      emissiveIntensity: 2.8,
      roughness: 0.22,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.31, 1), this.coreMaterial);
    this.core.castShadow = true;
    this.group.add(this.core);

    const wireGeometry = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.44, 1));
    this.wireMaterial = new THREE.LineBasicMaterial({
      color: 0xffd5a1,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.wire = new THREE.LineSegments(wireGeometry, this.wireMaterial);
    this.group.add(this.wire);

    this.ringA = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.012, 6, 64),
      new THREE.MeshBasicMaterial({
        color: 0xff9d6e,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.ringA.rotation.x = Math.PI / 2;
    this.ringA.rotation.y = 0.4;
    this.group.add(this.ringA);

    this.ringB = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.008, 6, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffe0a1,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.ringB.rotation.set(Math.PI / 2.6, 0.2, 0.9);
    this.group.add(this.ringB);

    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff7d50,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.halo.scale.set(3.2, 3.2, 1);
    this.group.add(this.halo);

    this.aura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff4a17,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.aura.scale.set(5.2, 5.2, 1);
    this.group.add(this.aura);

    this.light = new THREE.PointLight(0xff5a29, 12, 8, 2);
    this.group.add(this.light);

    this.floorY = ARENA_FLOOR + 0.025;
    this.floorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.5, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff7b52,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.floorRing.rotation.x = -Math.PI / 2;
    scene.add(this.floorRing);

    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 1, 6),
      new THREE.MeshBasicMaterial({
        color: CORAL,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
    );
    this.beam.visible = false;
    scene.add(this.beam);

    this.cell = null;
    this.spawnAt = 0;
    this.visible = false;
  }

  setCell(cell, now, immediate = false) {
    if (!cell) {
      this.setVisible(false);
      return;
    }
    this.cell = { ...cell };
    this.x = cell.x - CELL_CENTER;
    this.y = cell.y - CELL_CENTER;
    this.z = cell.z - CELL_CENTER;
    this.spawnAt = immediate ? now - 10 : now;
    this.setVisible(true);
  }

  setVisible(visible) {
    this.visible = visible;
    this.group.visible = visible;
    this.floorRing.visible = visible;
    this.beam.visible = visible;
  }

  update(time, now, dt) {
    if (!this.visible) return;
    const age = Math.max(0, (now - this.spawnAt) / 1000);
    const pop = Math.min(1, age / 0.42);
    const overshoot = 1 + 0.18 * Math.sin(Math.min(1, pop) * Math.PI * 1.35);
    const scale = pop >= 1 ? 1 : pop * overshoot;
    const bobY = this.y + Math.sin(time * 2.4) * 0.1;

    this.group.position.set(this.x, bobY, this.z);
    this.group.scale.setScalar(Math.max(0.001, scale));

    this.core.rotation.y += dt * 0.9;
    this.core.rotation.x += dt * 0.35;
    this.wire.rotation.y -= dt * 0.7;
    this.wire.rotation.z += dt * 0.4;

    this.ringA.rotation.z += dt * 1.4;
    this.ringA.rotation.x = Math.PI / 2 + Math.sin(time * 1.3) * 0.24;
    this.ringB.rotation.z -= dt * 0.8;
    this.ringB.rotation.y += dt * 0.5;

    this.coreMaterial.emissiveIntensity = 1.8 + Math.sin(time * 4) * 0.45;
    this.light.intensity = 11 + Math.sin(time * 4.4) * 2.6;
    this.halo.material.opacity = 0.72 + Math.sin(time * 2.6) * 0.14;
    this.aura.material.opacity = 0.16 + Math.sin(time * 2.2) * 0.04;

    this.floorRing.position.set(this.x, this.floorY, this.z);
    const ringPulse = 0.9 + Math.sin(time * 2.7) * 0.13;
    this.floorRing.scale.setScalar(ringPulse * Math.max(0.2, scale));
    this.floorRing.material.opacity = 0.18 + 0.08 * Math.sin(time * 2.7);

    const beamHeight = Math.max(0.05, bobY - this.floorY);
    this.beam.position.set(this.x, this.floorY + beamHeight / 2, this.z);
    this.beam.scale.set(1, beamHeight, 1);
    this.beam.material.opacity = 0.1 + Math.min(0.08, beamHeight * 0.009);
  }
}

/* ------------------------------------------------------------
   Particle field (unchanged, 3D ready)
   ------------------------------------------------------------ */

export class ParticleField {
  constructor(scene, count = 280) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    this.sizes = new Float32Array(count);
    this.velocity = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.gravity = new Float32Array(count);
    this.cursor = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
      vertexShader: [
        "attribute vec3 aColor;",
        "attribute float aAlpha;",
        "attribute float aSize;",
        "uniform float uPixelRatio;",
        "varying vec3 vColor;",
        "varying float vAlpha;",
        "void main() {",
        "  vColor = aColor;",
        "  vAlpha = aAlpha;",
        "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
        "  gl_PointSize = aSize * uPixelRatio * (180.0 / max(1.0, -mvPosition.z));",
        "  gl_Position = projectionMatrix * mvPosition;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "varying vec3 vColor;",
        "varying float vAlpha;",
        "void main() {",
        "  float d = length(gl_PointCoord - vec2(0.5));",
        "  if (d > 0.5 || vAlpha < 0.01) discard;",
        "  float core = smoothstep(0.5, 0.06, d);",
        "  float glow = pow(1.0 - d * 2.0, 2.0);",
        "  gl_FragColor = vec4(vColor * (0.8 + glow), core * vAlpha);",
        "}",
      ].join("\n"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  setPixelRatio(ratio) {
    this.material.uniforms.uPixelRatio.value = Math.min(ratio, 2);
  }

  emit(origin, {
    count = 20,
    colors = [CORAL, CREAM, LIME],
    speed = 3.2,
    spread = 0.22,
    life = 0.72,
    size = 1.1,
    gravity = 4.2,
    upward = 1.8,
  } = {}) {
    for (let i = 0; i < count; i += 1) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const color = new THREE.Color(colors[i % colors.length]);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const magnitude = speed * (0.35 + Math.random() * 0.9);

      this.positions[index * 3] = origin.x + (Math.random() - 0.5) * spread;
      this.positions[index * 3 + 1] = origin.y + (Math.random() - 0.5) * spread;
      this.positions[index * 3 + 2] = origin.z + (Math.random() - 0.5) * spread;
      this.colors[index * 3] = color.r;
      this.colors[index * 3 + 1] = color.g;
      this.colors[index * 3 + 2] = color.b;
      this.velocity[index * 3] = Math.sin(phi) * Math.cos(theta) * magnitude;
      this.velocity[index * 3 + 1] = Math.cos(phi) * magnitude * 0.6 + upward * (0.45 + Math.random());
      this.velocity[index * 3 + 2] = Math.sin(phi) * Math.sin(theta) * magnitude;
      this.life[index] = life * (0.65 + Math.random() * 0.65);
      this.maxLife[index] = this.life[index];
      this.gravity[index] = gravity;
      this.sizes[index] = size * (0.55 + Math.random() * 0.95);
      this.alphas[index] = 1;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aColor.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }

  update(dt) {
    const step = Math.min(dt, 0.05);
    for (let i = 0; i < this.count; i += 1) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.life[i] -= step;
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.velocity[i * 3 + 1] -= this.gravity[i] * step;
      const drag = Math.exp(-1.9 * step);
      this.velocity[i * 3] *= drag;
      this.velocity[i * 3 + 2] *= drag;
      this.positions[i * 3] += this.velocity[i * 3] * step;
      this.positions[i * 3 + 1] += this.velocity[i * 3 + 1] * step;
      this.positions[i * 3 + 2] += this.velocity[i * 3 + 2] * step;
      const t = this.life[i] / this.maxLife[i];
      this.alphas[i] = Math.min(1, t * 1.4) * (t > 0.75 ? 0.85 : 1);
    }
    const position = this.points.geometry.attributes.position;
    const alpha = this.points.geometry.attributes.aAlpha;
    position.needsUpdate = true;
    alpha.needsUpdate = true;
  }
}
