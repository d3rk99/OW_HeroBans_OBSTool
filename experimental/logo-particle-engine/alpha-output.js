const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

const CONTROLLER_STATE_KEY = 'logoParticleEngineStateV1';

const offscreen = document.createElement('canvas');
const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

const CAMERA = { focalLength: 760, zOffset: 560 };
const particles = [];
let targets = [];
let logos = [null, null];
let logoSources = [null, null];
let activeLogoIndex = 0;
let sequenceTimer = null;

let rotationY = 0;
const rotationX = 0.22;
let settleBlend = 0;

const settings = {
  density: 6,
  size: 2,
  speed: 0.08,
  depth: 0.55,
  startAngle: 10,
  team1Reset: true,
  holdTime: 6,
  burstForce: 1
};

let lastStateSignature = '';

function clamp(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseRgba(color) {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 116, g: 244, b: 255, a: 0.9 };
  const parts = m[1].split(',').map((v) => Number(v.trim()));
  return { r: parts[0] ?? 116, g: parts[1] ?? 244, b: parts[2] ?? 255, a: parts[3] ?? 0.9 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getLogo1StartRotation() {
  const normalized = ((settings.startAngle % 360) + 360) % 360;
  return (normalized * Math.PI) / 180;
}

class Particle {
  constructor(mx, my, mz) {
    this.mx = mx; this.my = my; this.mz = mz;
    this.vx = (Math.random() - 0.5) * 22;
    this.vy = (Math.random() - 0.5) * 22;
    this.vz = (Math.random() - 0.5) * 22;
    this.baseSize = settings.size;
    this.targetX = mx; this.targetY = my; this.targetZ = mz;
    this.color = { r: 116, g: 244, b: 255, a: 0.9 };
    this.targetColor = { r: 116, g: 244, b: 255, a: 0.9 };
  }

  retarget(target) {
    this.targetX = target.x;
    this.targetY = target.y;
    this.targetZ = target.z;
    this.targetColor = parseRgba(target.color);
  }

  update(dt) {
    const settle = settings.speed * dt * 60;
    const dx = this.targetX - this.mx;
    const dy = this.targetY - this.my;
    const dz = this.targetZ - this.mz;

    this.vx += dx * settle * 0.06;
    this.vy += dy * settle * 0.06;
    this.vz += dz * settle * 0.06;

    this.vx *= 0.9; this.vy *= 0.9; this.vz *= 0.9;
    this.mx += this.vx; this.my += this.vy; this.mz += this.vz;

    const colorLerp = Math.min(0.18, 0.03 + settle * 0.04);
    this.color.r = lerp(this.color.r, this.targetColor.r, colorLerp);
    this.color.g = lerp(this.color.g, this.targetColor.g, colorLerp);
    this.color.b = lerp(this.color.b, this.targetColor.b, colorLerp);
    this.color.a = lerp(this.color.a, this.targetColor.a, colorLerp);
    this.baseSize = settings.size;
  }

  distanceToTarget() {
    const dx = this.targetX - this.mx;
    const dy = this.targetY - this.my;
    const dz = this.targetZ - this.mz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  project(rotY, rotX) {
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    const xzX = this.mx * cosY + this.mz * sinY;
    const xzZ = -this.mx * sinY + this.mz * cosY;
    const yzY = this.my * cosX - xzZ * sinX;
    const yzZ = this.my * sinX + xzZ * cosX;
    const depth = yzZ + CAMERA.zOffset;
    const perspective = CAMERA.focalLength / Math.max(220, depth);
    return { x: canvas.width / 2 + xzX * perspective, y: canvas.height / 2 + yzY * perspective, depth, perspective };
  }

  draw(rotY, rotX) {
    const p = this.project(rotY, rotX);
    const radius = Math.max(0.5, this.baseSize * p.perspective);
    ctx.beginPath();
    ctx.fillStyle = `rgba(${Math.round(this.color.r)}, ${Math.round(this.color.g)}, ${Math.round(this.color.b)}, ${this.color.a.toFixed(3)})`;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fitDrawImage(image) {
  offscreen.width = canvas.width; offscreen.height = canvas.height;
  offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
  const margin = 120;
  const maxW = offscreen.width - margin * 2;
  const maxH = offscreen.height - margin * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  offCtx.drawImage(image, (offscreen.width - drawW) / 2, (offscreen.height - drawH) / 2, drawW, drawH);
}

function makeTargetsFromImage(image) {
  fitDrawImage(image);
  const { width, height } = offscreen;
  const imageData = offCtx.getImageData(0, 0, width, height);
  const nextTargets = [];

  for (let y = 0; y < height; y += settings.density) {
    for (let x = 0; x < width; x += settings.density) {
      const i = (y * width + x) * 4;
      const alpha = imageData.data[i + 3];
      if (alpha > 100) {
        const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
        const centeredX = x - width / 2;
        const centeredY = y - height / 2;
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const waveDepth = Math.sin(centeredX * 0.016) * 10 + Math.cos(centeredY * 0.018) * 10;
        const zDepth = ((luminance - 0.5) * 70 + waveDepth) * settings.depth;
        nextTargets.push({ x: centeredX, y: centeredY, z: zDepth, color: `rgba(${r}, ${g}, ${b}, ${Math.max(alpha / 255, 0.45)})` });
      }
    }
  }

  targets = nextTargets;
  while (particles.length < targets.length) {
    particles.push(new Particle((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 220));
  }
  if (particles.length > targets.length) particles.length = targets.length;
  particles.forEach((p, i) => p.retarget(targets[i]));
}

function burst() {
  settleBlend = 0;
  const force = settings.burstForce;
  particles.forEach((p) => {
    const outward = 18 * force;
    const swirl = 10 * force;
    p.vx += p.targetX * 0.012 * force + (Math.random() - 0.5) * outward + (Math.random() - 0.5) * swirl;
    p.vy += p.targetY * 0.012 * force + (Math.random() - 0.5) * outward + (Math.random() - 0.5) * swirl;
    p.vz += (Math.random() - 0.5) * 12 * force;
  });
}

function showLogo(index) {
  const image = logos[index];
  if (!image) return;
  if (index === 0 && settings.team1Reset) rotationY = getLogo1StartRotation();
  activeLogoIndex = index;
  makeTargetsFromImage(image);
  burst();
}

function startSequence() {
  if (sequenceTimer) clearInterval(sequenceTimer);
  showLogo(activeLogoIndex);
  sequenceTimer = setInterval(() => {
    activeLogoIndex = (activeLogoIndex + 1) % 2;
    if (!logos[activeLogoIndex]) activeLogoIndex = (activeLogoIndex + 1) % 2;
    showLogo(activeLogoIndex);
  }, settings.holdTime * 1000);
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function applyStateObject(state) {
  settings.density = Math.round(clamp(state.density, 3, 12, settings.density));
  settings.size = clamp(state.size, 1, 5, settings.size);
  settings.speed = clamp(state.speed, 0.03, 0.2, settings.speed);
  settings.depth = clamp(state.depth, 0, 1, settings.depth);
  settings.startAngle = clamp(state.startAngle, 0, 359, settings.startAngle);
  settings.team1Reset = Boolean(state.team1Reset);
  settings.holdTime = clamp(state.holdTime, 2, 15, settings.holdTime);
  settings.burstForce = clamp(state.burstForce, 0, 2, settings.burstForce);

  activeLogoIndex = Number.isFinite(state.activeLogoIndex) ? state.activeLogoIndex : activeLogoIndex;

  const nextSources = Array.isArray(state.logoSources) ? state.logoSources : logoSources;
  if (JSON.stringify(nextSources) !== JSON.stringify(logoSources)) {
    logoSources = nextSources;
    logos = [null, null];
    for (let i = 0; i < 2; i += 1) {
      if (logoSources[i]) {
        try { logos[i] = await loadImageFromUrl(logoSources[i]); } catch { logos[i] = null; }
      }
    }
  }

  if (logos[activeLogoIndex]) makeTargetsFromImage(logos[activeLogoIndex]);
  startSequence();
}

async function applyControllerState() {
  const raw = localStorage.getItem(CONTROLLER_STATE_KEY);
  if (!raw || raw === lastStateSignature) return;

  let state;
  try { state = JSON.parse(raw); } catch { return; }

  lastStateSignature = raw;
  await applyStateObject(state);
}

let lastTs = 0;
function animate(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.032);
  lastTs = ts;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let avgDistance = 0;
  particles.forEach((p) => { p.update(dt); avgDistance += p.distanceToTarget(); });
  if (particles.length > 0) avgDistance /= particles.length;

  settleBlend += ((avgDistance < 8 ? 1 : 0) - settleBlend) * 0.04;
  rotationY += dt * (0.168 * settleBlend);

  const sorted = [...particles].sort((a, b) => b.project(rotationY, rotationX).depth - a.project(rotationY, rotationX).depth);
  sorted.forEach((p) => p.draw(rotationY, rotationX));

  requestAnimationFrame(animate);
}

window.addEventListener('message', async (event) => {
  if (!event.data || event.data.type !== 'logo-particle-state') return;
  const state = event.data.payload;
  if (!state) return;

  const signature = JSON.stringify(state);
  if (signature === lastStateSignature) return;

  lastStateSignature = signature;
  await applyStateObject(state);
});

window.addEventListener('storage', (event) => {
  if (event.key === CONTROLLER_STATE_KEY) applyControllerState();
});

setInterval(applyControllerState, 1000);
applyControllerState().then(() => requestAnimationFrame(animate));
