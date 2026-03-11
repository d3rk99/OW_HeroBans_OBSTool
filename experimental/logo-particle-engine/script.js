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

const CONTROLLER_STATE_KEY = 'logoParticleEngineStateV1';

let logoSources = [null, null];
let activeLogoIndex = 0;
let commandNonce = 0;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function buildControllerState(commandType = null) {
  const state = {
    density: Math.round(clamp(densityInput.value, 3, 12, 6)),
    size: clamp(sizeInput.value, 1, 5, 2),
    speed: clamp(speedInput.value, 0.03, 0.2, 0.08),
    depth: clamp(depthInput.value, 0, 1, 0.55),
    startAngle: clamp(startAngleInput.value, 0, 359, 10),
    team1Reset: Boolean(team1ResetToggle.checked),
    holdTime: clamp(holdTimeInput.value, 2, 15, 6),
    burstForce: clamp(burstForceInput.value, 0, 2, 1),
    activeLogoIndex,
    logoSources
  };

  if (commandType) {
    commandNonce += 1;
    state.command = {
      type: commandType,
      nonce: commandNonce,
      ts: Date.now()
    };
  }

  return state;
}

function persistControllerState(commandType = null) {
  const state = buildControllerState(commandType);
  localStorage.setItem(CONTROLLER_STATE_KEY, JSON.stringify(state));
}

function applyStateToControls(state) {
  densityInput.value = String(Math.round(clamp(state.density, 3, 12, 6)));
  sizeInput.value = String(clamp(state.size, 1, 5, 2));
  speedInput.value = String(clamp(state.speed, 0.03, 0.2, 0.08));
  depthInput.value = String(clamp(state.depth, 0, 1, 0.55));
  startAngleInput.value = String(clamp(state.startAngle, 0, 359, 10));
  team1ResetToggle.checked = Boolean(state.team1Reset);
  holdTimeInput.value = String(clamp(state.holdTime, 2, 15, 6));
  burstForceInput.value = String(clamp(state.burstForce, 0, 2, 1));

  activeLogoIndex = Number.isFinite(state.activeLogoIndex) ? state.activeLogoIndex : 0;
  logoSources = Array.isArray(state.logoSources) ? state.logoSources : [null, null];
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleUpload(file, index) {
  if (!file) return;

  try {
    logoSources[index] = await fileToDataUrl(file);
    activeLogoIndex = index;
    persistControllerState('start-sequence');
  } catch {
    alert('Unable to load this image. Try a PNG or JPG file.');
  }
}

function loadDefaultSources() {
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

  logoSources = [
    `data:image/svg+xml;charset=utf-8,${fallbackSVG1}`,
    `data:image/svg+xml;charset=utf-8,${fallbackSVG2}`
  ];
  activeLogoIndex = 0;
}

function initializeFromStorage() {
  const raw = localStorage.getItem(CONTROLLER_STATE_KEY);
  if (!raw) {
    loadDefaultSources();
    persistControllerState('start-sequence');
    return;
  }

  try {
    const state = JSON.parse(raw);
    applyStateToControls(state);
  } catch {
    loadDefaultSources();
  }

  if (!logoSources[0] || !logoSources[1]) {
    loadDefaultSources();
  }

  persistControllerState('start-sequence');
}

team1Input.addEventListener('change', (event) => handleUpload(event.target.files[0], 0));
team2Input.addEventListener('change', (event) => handleUpload(event.target.files[0], 1));

[densityInput, sizeInput, speedInput, depthInput, startAngleInput, holdTimeInput, burstForceInput]
  .forEach((el) => el.addEventListener('input', () => persistControllerState()));

team1ResetToggle.addEventListener('change', () => persistControllerState());
startSequenceButton.addEventListener('click', () => persistControllerState('start-sequence'));
burstButton.addEventListener('click', () => persistControllerState('burst'));
resetButton.addEventListener('click', () => {
  loadDefaultSources();
  persistControllerState('start-sequence');
});

initializeFromStorage();
