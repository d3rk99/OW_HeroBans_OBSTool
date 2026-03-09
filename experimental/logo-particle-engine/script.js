const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

const team1Input = document.getElementById('team1Input');
const team2Input = document.getElementById('team2Input');
const densityInput = document.getElementById('density');
const sizeInput = document.getElementById('size');
const speedInput = document.getElementById('speed');
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

let rotationY = 0;
let rotationX = 0.22;
let settleBlend = 0;

const CAMERA = {
  focalLength: 760,
  zOffset: 560
};

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
    this.color = 'rgba(116, 244, 255, 0.9)';
  }

  retarget(target) {
    this.targetX = target.x;
    this.targetY = target.y;
    this.targetZ = target.z;
    this.color = target.color;
  }

  update(dt) {
    const settle = Number(speedInput.value) * dt * 60;
    const dx = this.targetX - this.mx;
    const dy = this.targetY - this.my;
    const dz = this.targetZ - this.mz;

    this.vx += dx * settle * 0.08;
    this.vy += dy * settle * 0.08;
    this.vz += dz * settle * 0.08;

    this.vx *= 0.86;
    this.vy *= 0.86;
    this.vz *= 0.86;

    this.mx += this.vx;
    this.my += this.vy;
    this.mz += this.vz;

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
    ctx.fillStyle = this.color;
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
        const zDepth = (luminance - 0.5) * 70 + waveDepth;

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

function burst() {
  settleBlend = 0;
  particles.forEach((p) => {
    p.vx += (Math.random() - 0.5) * 90;
    p.vy += (Math.random() - 0.5) * 90;
    p.vz += (Math.random() - 0.5) * 90;
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
  rotationY += dt * (0.16 * settleBlend);

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

  activeLogoIndex = index;
  makeTargetsFromImage(image);
  burst();
}

function nextLoadedLogoIndex(fromIndex) {
  for (let i = 1; i <= logos.length; i += 1) {
    const idx = (fromIndex + i) % logos.length;
    if (logos[idx]) return idx;
  }
  return fromIndex;
}

function startSequence() {
  if (sequenceTimer) clearInterval(sequenceTimer);

  showLogo(activeLogoIndex);
  sequenceTimer = setInterval(() => {
    const nextIndex = nextLoadedLogoIndex(activeLogoIndex);
    showLogo(nextIndex);
  }, 6000);
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

  logos[0] = await loadImageFromUrl(`data:image/svg+xml;charset=utf-8,${fallbackSVG1}`);
  logos[1] = await loadImageFromUrl(`data:image/svg+xml;charset=utf-8,${fallbackSVG2}`);

  activeLogoIndex = 0;
  rotationY = 0;
  startSequence();
}

async function handleUpload(file, index) {
  if (!file) return;

  const objectUrl = URL.createObjectURL(file);
  try {
    logos[index] = await loadImageFromUrl(objectUrl);
    showLogo(index);
    startSequence();
  } catch {
    alert('Unable to load this image. Try a PNG or JPG file.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

team1Input.addEventListener('change', (event) => handleUpload(event.target.files[0], 0));
team2Input.addEventListener('change', (event) => handleUpload(event.target.files[0], 1));

densityInput.addEventListener('input', () => {
  if (logos[activeLogoIndex]) {
    makeTargetsFromImage(logos[activeLogoIndex]);
  }
});

startSequenceButton.addEventListener('click', startSequence);
burstButton.addEventListener('click', burst);
resetButton.addEventListener('click', loadDefaultLogos);

loadDefaultLogos().then(() => requestAnimationFrame(animate));
