const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

const team1Input = document.getElementById('team1Input');
const team2Input = document.getElementById('team2Input');
const densityInput = document.getElementById('density');
const sizeInput = document.getElementById('size');
const speedInput = document.getElementById('speed');
const depthInput = document.getElementById('depth');
const startAngleInput = document.getElementById('startAngle');
const team1ResetToggle = document.getElementById('team1ResetToggle');
const holdTimeInput = document.getElementById('holdTime');
const burstForceInput = document.getElementById('burstForce');
const startSequenceButton = document.getElementById('startSequence');
const burstButton = document.getElementById('burst');
const resetButton = document.getElementById('reset');

const offscreen = document.createElement('canvas');
const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

const particles = [];
let targets = [];
let glowTick = 0;
let logos = [null, null];
let activeLogoIndex = 0;
let sequenceTimer = null;
let logoSources = [null, null];

const CONTROLLER_STATE_KEY = 'logoParticleEngineStateV1';

let rotationY = 0;
let rotationX = 0.22;
let settleBlend = 0;


const CAMERA = {
  focalLength: 760,
  zOffset: 560
};

function getLogo1StartRotation() {
  const raw = Number(startAngleInput.value);
  const normalized = Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : 10;
  if (String(normalized) !== startAngleInput.value) {
    startAngleInput.value = String(normalized);
  }
  return (normalized * Math.PI) / 180;
}

function persistControllerState() {
  const state = {
    density: Number(densityInput.value),
    size: Number(sizeInput.value),
    speed: Number(speedInput.value),
    depth: Number(depthInput.value),
    startAngle: Number(startAngleInput.value),
    team1Reset: Boolean(team1ResetToggle.checked),
    holdTime: Number(holdTimeInput.value),
    burstForce: Number(burstForceInput.value),
    activeLogoIndex,
    logoSources
  };

  localStorage.setItem(CONTROLLER_STATE_KEY, JSON.stringify(state));
}


function parseRgba(color) {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 116, g: 244, b: 255, a: 0.9 };
  const parts = m[1].split(',').map((v) => Number(v.trim()));
  return {
    r: parts[0] ?? 116,
    g: parts[1] ?? 244,
    b: parts[2] ?? 255,
    a: parts[3] ?? 0.9
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

class Particle {
  constructor(mx, my, mz) {
    this.mx = mx;
    this.my = my;
    this.mz = mz;

    this.vx = (Math.random() - 0.5) * 22;
    this.vy = (Math.random() - 0.5) * 22;
    this.vz = (Math.random() - 0.5) * 22;

    this.baseSize = Number(sizeInput.value);
    this.targetX = mx;
    this.targetY = my;
    this.targetZ = mz;
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
    const settle = Number(speedInput.value) * dt * 60;
    const dx = this.targetX - this.mx;
    const dy = this.targetY - this.my;
    const dz = this.targetZ - this.mz;

    const spring = 0.06;
    const damping = 0.9;

    this.vx += dx * settle * spring;
    this.vy += dy * settle * spring;
    this.vz += dz * settle * spring;

    this.vx *= damping;
    this.vy *= damping;
    this.vz *= damping;

    this.mx += this.vx;
    this.my += this.vy;
    this.mz += this.vz;

    const colorLerp = Math.min(0.18, 0.03 + settle * 0.04);
    this.color.r = lerp(this.color.r, this.targetColor.r, colorLerp);
    this.color.g = lerp(this.color.g, this.targetColor.g, colorLerp);
    this.color.b = lerp(this.color.b, this.targetColor.b, colorLerp);
    this.color.a = lerp(this.color.a, this.targetColor.a, colorLerp);

    this.baseSize = Number(sizeInput.value);
  }

  distanceToTarget() {
    const dx = this.targetX - this.mx;
    const dy = this.targetY - this.my;
    const dz = this.targetZ - this.mz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  project(rotY, rotX) {
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);

    const xzX = this.mx * cosY + this.mz * sinY;
    const xzZ = -this.mx * sinY + this.mz * cosY;

    const yzY = this.my * cosX - xzZ * sinX;
    const yzZ = this.my * sinX + xzZ * cosX;

    const depth = yzZ + CAMERA.zOffset;
    const perspective = CAMERA.focalLength / Math.max(220, depth);

    return {
      x: canvas.width / 2 + xzX * perspective,
      y: canvas.height / 2 + yzY * perspective,
      depth,
      perspective
    };
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
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  offCtx.clearRect(0, 0, offscreen.width, offscreen.height);

  const margin = 120;
  const maxW = offscreen.width - margin * 2;
  const maxH = offscreen.height - margin * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const dx = (offscreen.width - drawW) / 2;
  const dy = (offscreen.height - drawH) / 2;

  offCtx.drawImage(image, dx, dy, drawW, drawH);
}

function makeTargetsFromImage(image) {
  fitDrawImage(image);
  const { width, height } = offscreen;
  const imageData = offCtx.getImageData(0, 0, width, height);
  const step = Number(densityInput.value);

  const nextTargets = [];

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const alpha = imageData.data[i + 3];
      if (alpha > 100) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];

        const centeredX = x - width / 2;
        const centeredY = y - height / 2;
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const waveDepth = Math.sin(centeredX * 0.016) * 10 + Math.cos(centeredY * 0.018) * 10;
        const depthScale = Number(depthInput.value);
        const zDepth = ((luminance - 0.5) * 70 + waveDepth) * depthScale;

        nextTargets.push({
          x: centeredX,
          y: centeredY,
          z: zDepth,
          color: `rgba(${r}, ${g}, ${b}, ${Math.max(alpha / 255, 0.45)})`
        });
      }
    }
  }

  targets = nextTargets;
  syncParticlesToTargets();
}

function syncParticlesToTargets() {
  while (particles.length < targets.length) {
    particles.push(new Particle(
      (Math.random() - 0.5) * 300,
      (Math.random() - 0.5) * 240,
      (Math.random() - 0.5) * 220
    ));
  }

  if (particles.length > targets.length) {
    particles.length = targets.length;
  }

  particles.forEach((particle, idx) => {
    particle.retarget(targets[idx]);
  });
}

function getBurstForce() {
  const raw = Number(burstForceInput.value);
  const force = Number.isFinite(raw) ? Math.min(2, Math.max(0, raw)) : 1;
  if (String(force) !== burstForceInput.value) {
    burstForceInput.value = String(force);
  }
  return force;
}

function burst() {
  settleBlend = 0;
  const force = getBurstForce();
  particles.forEach((p) => {
    const outward = 18 * force;
    const swirl = 10 * force;
    const radialX = p.targetX * 0.012 * force;
    const radialY = p.targetY * 0.012 * force;

    p.vx += radialX + (Math.random() - 0.5) * outward + (Math.random() - 0.5) * swirl;
    p.vy += radialY + (Math.random() - 0.5) * outward + (Math.random() - 0.5) * swirl;
    p.vz += (Math.random() - 0.5) * 12 * force;
  });
}

function drawBackdrop() {
  glowTick += 0.015;
  const pulse = (Math.sin(glowTick) + 1) / 2;

  const grad = ctx.createRadialGradient(
    canvas.width * (0.35 + pulse * 0.2),
    canvas.height * (0.4 + pulse * 0.1),
    40,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.75
  );

  grad.addColorStop(0, `rgba(116,244,255,${0.08 + pulse * 0.06})`);
  grad.addColorStop(0.5, `rgba(126,135,255,${0.1 + (1 - pulse) * 0.08})`);
  grad.addColorStop(1, 'rgba(3, 6, 16, 1)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

let lastTs = 0;
function animate(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.032);
  lastTs = ts;

  drawBackdrop();

  let avgDistance = 0;
  particles.forEach((particle) => {
    particle.update(dt);
    avgDistance += particle.distanceToTarget();
  });

  if (particles.length > 0) {
    avgDistance /= particles.length;
  }

  const settled = avgDistance < 8;
  settleBlend += ((settled ? 1 : 0) - settleBlend) * 0.04;
  rotationY += dt * (0.168 * settleBlend);

  const sorted = [...particles].sort((a, b) => {
    const da = a.project(rotationY, rotationX).depth;
    const db = b.project(rotationY, rotationX).depth;
    return db - da;
  });

  sorted.forEach((particle) => {
    particle.draw(rotationY, rotationX);
  });

  requestAnimationFrame(animate);
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function showLogo(index) {
  const image = logos[index];
  if (!image) return;

  if (index === 0 && team1ResetToggle.checked) {
    rotationY = getLogo1StartRotation();
  }

  activeLogoIndex = index;
  makeTargetsFromImage(image);
  burst();
  persistControllerState();
}

function nextLoadedLogoIndex(fromIndex) {
  for (let i = 1; i <= logos.length; i += 1) {
    const idx = (fromIndex + i) % logos.length;
    if (logos[idx]) return idx;
  }
  return fromIndex;
}

function getHoldTimeMs() {
  const secs = Number(holdTimeInput.value);
  const safeSecs = Number.isFinite(secs) ? Math.min(15, Math.max(2, secs)) : 6;
  if (String(safeSecs) !== holdTimeInput.value) {
    holdTimeInput.value = String(safeSecs);
  }
  return safeSecs * 1000;
}

function startSequence() {
  if (sequenceTimer) clearInterval(sequenceTimer);

  persistControllerState();
  showLogo(activeLogoIndex);
  sequenceTimer = setInterval(() => {
    const nextIndex = nextLoadedLogoIndex(activeLogoIndex);
    showLogo(nextIndex);
  }, getHoldTimeMs());
}

async function loadDefaultLogos() {
  const fallbackSVG1 = encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 240'>
      <defs>
        <linearGradient id='g' x1='0' x2='1'>
          <stop offset='0%' stop-color='#74f4ff' />
          <stop offset='100%' stop-color='#7e87ff' />
        </linearGradient>
      </defs>
      <rect width='100%' height='100%' fill='black' fill-opacity='0'/>
      <circle cx='120' cy='120' r='78' fill='url(#g)' />
      <path d='M220 63h180v114H220z' fill='url(#g)' opacity='0.95'/>
      <path d='M250 95h120v15H250zm0 35h95v15h-95z' fill='white' fill-opacity='0.85'/>
    </svg>
  `);

  const fallbackSVG2 = encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 240'>
      <defs>
        <linearGradient id='g2' x1='0' x2='1'>
          <stop offset='0%' stop-color='#ff9a5f' />
          <stop offset='100%' stop-color='#ff4f86' />
        </linearGradient>
      </defs>
      <rect width='100%' height='100%' fill='black' fill-opacity='0'/>
      <polygon points='120,35 205,205 35,205' fill='url(#g2)' />
      <path d='M240 66h170l-40 110H200z' fill='url(#g2)' opacity='0.95'/>
      <circle cx='308' cy='122' r='24' fill='white' fill-opacity='0.85'/>
    </svg>
  `);

  logoSources[0] = `data:image/svg+xml;charset=utf-8,${fallbackSVG1}`;
  logoSources[1] = `data:image/svg+xml;charset=utf-8,${fallbackSVG2}`;

  logos[0] = await loadImageFromUrl(logoSources[0]);
  logos[1] = await loadImageFromUrl(logoSources[1]);

  activeLogoIndex = 0;
  rotationY = getLogo1StartRotation();
  startSequence();
}

async function handleUpload(file, index) {
  if (!file) return;

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    logoSources[index] = dataUrl;
    logos[index] = await loadImageFromUrl(dataUrl);
    showLogo(index);
    startSequence();
    persistControllerState();
  } catch {
    alert('Unable to load this image. Try a PNG or JPG file.');
  }
}

team1Input.addEventListener('change', (event) => handleUpload(event.target.files[0], 0));
team2Input.addEventListener('change', (event) => handleUpload(event.target.files[0], 1));

densityInput.addEventListener('input', () => {
  if (logos[activeLogoIndex]) {
    makeTargetsFromImage(logos[activeLogoIndex]);
  }
  persistControllerState();
});

depthInput.addEventListener('input', () => {
  if (logos[activeLogoIndex]) {
    makeTargetsFromImage(logos[activeLogoIndex]);
  }
  persistControllerState();
});

startAngleInput.addEventListener('input', () => {
  getLogo1StartRotation();
  persistControllerState();
});

holdTimeInput.addEventListener('input', () => {
  persistControllerState();
  startSequence();
});

sizeInput.addEventListener('input', persistControllerState);
speedInput.addEventListener('input', persistControllerState);
burstForceInput.addEventListener('input', persistControllerState);
team1ResetToggle.addEventListener('change', persistControllerState);

startSequenceButton.addEventListener('click', startSequence);
burstButton.addEventListener('click', () => {
  burst();
  persistControllerState();
});
resetButton.addEventListener('click', loadDefaultLogos);

loadDefaultLogos().then(() => {
  persistControllerState();
  requestAnimationFrame(animate);
});
