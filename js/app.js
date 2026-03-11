(() => {
  const STATE_KEY = 'ow2_bans_state';
  const HEROES_PATH = './data/heroes.json';
  const HERO_IMAGE_BASE = './assets/';
  const OVERLAY_POLL_MS = 500;
  const FADE_TRANSITION_MS = 260;
  const BRIDGE_STATE_URL = 'http://127.0.0.1:8765/api/state';
  const BRIDGE_FONTS_URL = 'http://127.0.0.1:8765/api/fonts';
  const BUILTIN_NAME_FONTS = [
    { value: 'varsity', label: 'Varsity / Jersey' },
    { value: 'block', label: 'Block Bold' },
    { value: 'classic', label: 'Classic Sans' }
  ];
  const BUILTIN_FONT_VALUES = new Set(BUILTIN_NAME_FONTS.map((font) => font.value));
  const VALORANT_MAPS_PATH = './assets/valorant/maps.json';
  const VETO_FIELD_IDS = ['ban1', 'ban2', 'pick1', 'pick2', 'ban3', 'ban4', 'pick3'];
  const VALORANT_PICK_IDS = ['pick1', 'pick2', 'pick3'];

  const PARTICLE_LOGO_MAX_LEN = 4 * 1024 * 1024;
  const PARTICLE_COMMAND_TYPES = new Set(['start-sequence', 'burst']);

  let heroList = [];
  let heroesByName = new Map();
  let valorantMaps = [];
  let valorantMapsByUuid = new Map();
  let valorantMapUuidByName = new Map();
  let refreshValorantMapPoolOptions = null;
  let syncLogoParticleControls = () => {};

  const clampRange = (value, min, max, fallback) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  };

  const sanitizeParticleLogoSource = (value) => {
    const raw = String(value || '');
    if (!raw) return '';
    if (!raw.startsWith('data:image/')) return '';
    if (raw.length > PARTICLE_LOGO_MAX_LEN) return '';
    return raw;
  };

  const sanitizeParticleCommand = (value) => {
    if (!value || typeof value !== 'object') return null;
    const type = String(value.type || '').trim();
    if (!PARTICLE_COMMAND_TYPES.has(type)) return null;
    const nonce = Number(value.nonce);
    const ts = Number(value.ts);
    return {
      type,
      nonce: Number.isFinite(nonce) ? nonce : 0,
      ts: Number.isFinite(ts) ? ts : Date.now()
    };
  };

  const defaultLogoParticleState = () => ({
    density: 6,
    size: 2,
    speed: 0.08,
    depth: 0.55,
    startAngle: 10,
    team1Reset: true,
    holdTime: 6,
    burstForce: 1,
    cameraDistance: 700,
    activeLogoIndex: 0,
    logoSources: ['', ''],
    command: null
  });

  const sanitizeLogoParticleState = (value) => {
    const fallback = defaultLogoParticleState();
    const source = value && typeof value === 'object' ? value : {};
    const rawLogos = Array.isArray(source.logoSources) ? source.logoSources : fallback.logoSources;
    const logoSources = [
      sanitizeParticleLogoSource(rawLogos[0]),
      sanitizeParticleLogoSource(rawLogos[1])
    ];

    return {
      density: Math.round(clampRange(source.density, 3, 12, fallback.density)),
      size: clampRange(source.size, 1, 5, fallback.size),
      speed: clampRange(source.speed, 0.03, 0.2, fallback.speed),
      depth: clampRange(source.depth, 0, 1, fallback.depth),
      startAngle: Math.round(clampRange(source.startAngle, 0, 359, fallback.startAngle)),
      team1Reset: typeof source.team1Reset === 'boolean' ? source.team1Reset : fallback.team1Reset,
      holdTime: Math.round(clampRange(source.holdTime, 2, 15, fallback.holdTime)),
      burstForce: clampRange(source.burstForce, 0, 2, fallback.burstForce),
      cameraDistance: Math.round(clampRange(source.cameraDistance, 420, 1100, fallback.cameraDistance)),
      activeLogoIndex: clampRange(source.activeLogoIndex, 0, 1, fallback.activeLogoIndex),
      logoSources,
      command: sanitizeParticleCommand(source.command)
    };
  };

  const defaultState = () => ({
    team1: { ban: '' },
    team2: { ban: '' },
    scoreboard: {
      team1: { name: '', nameUsePng: false, namePng: '', namePngScale: 0, logo: '', logoScale: 0, score: 0, nameColor: '#e9eefc', bevelColor: '#7dd3fc', nameFont: 'varsity' },
      team2: { name: '', nameUsePng: false, namePng: '', namePngScale: 0, logo: '', logoScale: 0, score: 0, nameColor: '#e9eefc', bevelColor: '#7dd3fc', nameFont: 'varsity' }
    },
    valorantMapVeto: {
      ban1: '',
      ban2: '',
      pick1: '',
      pick2: '',
      ban3: '',
      ban4: '',
      pick3: ''
    },
    valorantPickSides: {
      pick1: { defenders: 'team1', attackers: 'team2' },
      pick2: { defenders: 'team1', attackers: 'team2' },
      pick3: { defenders: 'team1', attackers: 'team2' }
    },
    valorantGameScore: {
      pick1: { winner: '', team1Score: 0, team2Score: 0 },
      pick2: { winner: '', team1Score: 0, team2Score: 0 },
      pick3: { winner: '', team1Score: 0, team2Score: 0 }
    },
    valorantMapPool: valorantMaps.map((map) => map.uuid),
    logoParticle: defaultLogoParticleState(),
    updatedAt: Date.now()
  });

  const normalize = (value) => (value || '').trim().toLowerCase();

  const sanitizeScore = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
  };

  const sanitizeNameColor = (value) => {
    const raw = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    return '#e9eefc';
  };

  const sanitizeBevelColor = (value) => {
    const raw = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    return '#7dd3fc';
  };

  const sanitizeNameFont = (value) => {
    const raw = String(value || '').trim();
    if (BUILTIN_FONT_VALUES.has(raw)) return raw;
    if (/^file:[a-zA-Z0-9_./ %\\-]+\.(ttf|otf|woff2?)$/i.test(raw)) return raw;
    return 'varsity';
  };

  const sanitizeLogoScale = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(-50, Math.min(50, Math.round(numeric)));
  };

  const sanitizeNamePngToggle = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    return Boolean(value);
  };

  const sanitizeNamePngScale = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(-50, Math.min(50, Math.round(numeric)));
  };

  const sanitizeValorantMapSelection = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!valorantMapsByUuid.size) return raw;
    if (valorantMapsByUuid.has(raw)) return raw;
    return valorantMapUuidByName.get(raw.toLowerCase()) || '';
  };

  const sanitizeValorantMapPool = (value) => {
    const source = Array.isArray(value) ? value : valorantMaps.map((map) => map.uuid);
    const seen = new Set();
    return source
      .map((entry) => sanitizeValorantMapSelection(entry))
      .filter((uuid) => {
        if (!uuid || seen.has(uuid)) return false;
        seen.add(uuid);
        return true;
      });
  };


  const sanitizeValorantPickTeam = (value) => (String(value || '').trim() === 'team2' ? 'team2' : 'team1');

  const sanitizeValorantPickSides = (value) => {
    const base = { defenders: 'team1', attackers: 'team2' };
    const defenders = sanitizeValorantPickTeam(value?.defenders || base.defenders);
    let attackers = sanitizeValorantPickTeam(value?.attackers || base.attackers);
    if (attackers === defenders) attackers = defenders === 'team1' ? 'team2' : 'team1';
    return { defenders, attackers };
  };

  const sanitizeValorantWinner = (value) => {
    const raw = String(value || '').trim();
    return raw === 'team1' || raw === 'team2' ? raw : '';
  };

  const sanitizeValorantGameScore = (value) => ({
    winner: sanitizeValorantWinner(value?.winner),
    team1Score: sanitizeScore(value?.team1Score),
    team2Score: sanitizeScore(value?.team2Score)
  });
  const getValorantPoolMaps = (pool) => {
    const allowed = new Set(sanitizeValorantMapPool(pool));
    return valorantMaps.filter((map) => allowed.has(map.uuid));
  };

  const slugifyFontToken = (value) => sanitizeNameFont(value)
    .replace(/^file:/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'custom-font';

  const customFontCache = new Map();

  const humanizeFontName = (path) => {
    const fileName = String(path || '').split('/').pop() || '';
    const stem = fileName.replace(/\.[^.]+$/, '');
    return stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Custom Font';
  };

  async function readBridgeFonts() {
    try {
      const response = await fetch(BRIDGE_FONTS_URL, { cache: 'no-store' });
      if (!response.ok) return [];
      const payload = await response.json();
      const fonts = Array.isArray(payload?.fonts) ? payload.fonts : [];
      return fonts
        .map((font) => {
          const token = sanitizeNameFont(font?.id || `file:${font?.path || ''}`);
          if (!token.startsWith('file:')) return null;
          const path = String(font?.path || token.replace(/^file:/, '')).replace(/^\/+/, '');
          return {
            value: token,
            path,
            label: String(font?.label || humanizeFontName(path))
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function ensureCustomFontLoaded(token) {
    const cleanToken = sanitizeNameFont(token);
    if (!cleanToken.startsWith('file:')) return '';
    if (customFontCache.has(cleanToken)) return customFontCache.get(cleanToken);

    const path = cleanToken.replace(/^file:/, '').replace(/^\/+/, '');
    const family = `OW2Custom-${slugifyFontToken(cleanToken)}`;
    const source = path.startsWith('.') ? path : `./${path}`;

    if (typeof FontFace !== 'function') {
      customFontCache.set(cleanToken, `"${humanizeFontName(path)}"`);
      return customFontCache.get(cleanToken);
    }

    try {
      const face = new FontFace(family, `url(${JSON.stringify(source)})`);
      await face.load();
      document.fonts.add(face);
      const quoted = `"${family}"`;
      customFontCache.set(cleanToken, quoted);
      return quoted;
    } catch {
      const fallback = `"${humanizeFontName(path)}"`;
      customFontCache.set(cleanToken, fallback);
      return fallback;
    }
  }

  async function hydrateFontSelectors(selectNodes, selectedTokens = []) {
    const discovered = await readBridgeFonts();
    const customOptions = discovered.map((font) => ({ value: font.value, label: font.label }));

    const merged = [...BUILTIN_NAME_FONTS, ...customOptions];
    const ensureOption = (collection, token) => {
      const cleanToken = sanitizeNameFont(token);
      if (collection.some((item) => item.value === cleanToken)) return;
      if (!cleanToken.startsWith('file:')) return;
      collection.push({ value: cleanToken, label: humanizeFontName(cleanToken.replace(/^file:/, '')) });
    };

    selectedTokens.forEach((token) => ensureOption(merged, token));

    selectNodes.forEach((selectNode, index) => {
      if (!selectNode) return;
      const current = sanitizeNameFont(selectedTokens[index] || selectNode.value);
      ensureOption(merged, current);
      selectNode.innerHTML = '';
      merged.forEach((font) => {
        const option = document.createElement('option');
        option.value = font.value;
        option.textContent = font.label;
        selectNode.appendChild(option);
      });
      selectNode.value = merged.some((font) => font.value === current) ? current : 'varsity';
    });
  }

  function sanitizeState(payload) {
    return {
      team1: { ban: payload?.team1?.ban || '' },
      team2: { ban: payload?.team2?.ban || '' },
      scoreboard: {
        team1: {
          name: payload?.scoreboard?.team1?.name || '',
          nameUsePng: sanitizeNamePngToggle(payload?.scoreboard?.team1?.nameUsePng),
          namePng: payload?.scoreboard?.team1?.namePng || '',
          namePngScale: sanitizeNamePngScale(payload?.scoreboard?.team1?.namePngScale),
          logo: payload?.scoreboard?.team1?.logo || '',
          logoScale: sanitizeLogoScale(payload?.scoreboard?.team1?.logoScale),
          score: sanitizeScore(payload?.scoreboard?.team1?.score),
          nameColor: sanitizeNameColor(payload?.scoreboard?.team1?.nameColor),
          bevelColor: sanitizeBevelColor(payload?.scoreboard?.team1?.bevelColor),
          nameFont: sanitizeNameFont(payload?.scoreboard?.team1?.nameFont)
        },
        team2: {
          name: payload?.scoreboard?.team2?.name || '',
          nameUsePng: sanitizeNamePngToggle(payload?.scoreboard?.team2?.nameUsePng),
          namePng: payload?.scoreboard?.team2?.namePng || '',
          namePngScale: sanitizeNamePngScale(payload?.scoreboard?.team2?.namePngScale),
          logo: payload?.scoreboard?.team2?.logo || '',
          logoScale: sanitizeLogoScale(payload?.scoreboard?.team2?.logoScale),
          score: sanitizeScore(payload?.scoreboard?.team2?.score),
          nameColor: sanitizeNameColor(payload?.scoreboard?.team2?.nameColor),
          bevelColor: sanitizeBevelColor(payload?.scoreboard?.team2?.bevelColor),
          nameFont: sanitizeNameFont(payload?.scoreboard?.team2?.nameFont)
        }
      },
      valorantMapVeto: {
        ban1: sanitizeValorantMapSelection(payload?.valorantMapVeto?.ban1),
        ban2: sanitizeValorantMapSelection(payload?.valorantMapVeto?.ban2),
        pick1: sanitizeValorantMapSelection(payload?.valorantMapVeto?.pick1),
        pick2: sanitizeValorantMapSelection(payload?.valorantMapVeto?.pick2),
        ban3: sanitizeValorantMapSelection(payload?.valorantMapVeto?.ban3),
        ban4: sanitizeValorantMapSelection(payload?.valorantMapVeto?.ban4),
        pick3: sanitizeValorantMapSelection(payload?.valorantMapVeto?.pick3)
      },
      valorantMapPool: sanitizeValorantMapPool(payload?.valorantMapPool),
      valorantPickSides: {
        pick1: sanitizeValorantPickSides(payload?.valorantPickSides?.pick1),
        pick2: sanitizeValorantPickSides(payload?.valorantPickSides?.pick2),
        pick3: sanitizeValorantPickSides(payload?.valorantPickSides?.pick3)
      },
      valorantGameScore: {
        pick1: sanitizeValorantGameScore(payload?.valorantGameScore?.pick1),
        pick2: sanitizeValorantGameScore(payload?.valorantGameScore?.pick2),
        pick3: sanitizeValorantGameScore(payload?.valorantGameScore?.pick3)
      },
      logoParticle: sanitizeLogoParticleState(payload?.logoParticle),
      updatedAt: Number(payload?.updatedAt) || Date.now()
    };
  }

  function setHeroes(data) {
    heroList = Array.isArray(data?.heroes) ? data.heroes : [];
    heroesByName = new Map(heroList.map((hero) => [normalize(hero.name), hero]));
  }

  async function loadHeroes() {
    const embeddedData = globalThis.OW2_HEROES_DATA;
    if (Array.isArray(embeddedData?.heroes) && embeddedData.heroes.length) {
      setHeroes(embeddedData);
      return;
    }

    try {
      const response = await fetch(HEROES_PATH, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to load heroes.json (${response.status})`);
      }
      const data = await response.json();
      setHeroes(data);
    } catch (error) {
      console.warn('Heroes data unavailable, using fallback behavior.', error);
      heroList = [];
      heroesByName = new Map();
    }
  }

  function toMapAssetSlug(displayName) {
    return String(displayName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normalizeValorantMap(record) {
    if (!record || typeof record !== 'object') return null;
    const uuid = String(record.uuid || '').trim();
    const displayName = String(record.displayName || '').trim();
    if (!uuid || !displayName) return null;

    const imageAsset = typeof record.imageAsset === 'string' && record.imageAsset.trim()
      ? record.imageAsset.trim()
      : `./assets/valorant/maps/${toMapAssetSlug(displayName)}.png`;

    return { uuid, displayName, imageAsset };
  }

  async function loadValorantMaps() {
    try {
      const response = await fetch(VALORANT_MAPS_PATH, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Failed to load maps.json (${response.status})`);
      const payload = await response.json();
      const maps = Array.isArray(payload?.maps) ? payload.maps.map(normalizeValorantMap).filter(Boolean) : [];
      valorantMaps = maps;
      valorantMapsByUuid = new Map(maps.map((map) => [map.uuid, map]));
      valorantMapUuidByName = new Map(maps.map((map) => [map.displayName.toLowerCase(), map.uuid]));
    } catch (error) {
      console.warn('Valorant map cache unavailable.', error);
      valorantMaps = [];
      valorantMapsByUuid = new Map();
      valorantMapUuidByName = new Map();
    }
  }

  function getValorantMapByUuid(uuid) {
    return valorantMapsByUuid.get(sanitizeValorantMapSelection(uuid)) || null;
  }

  function getValorantMapImages(map) {
    if (!map) return [];
    const localAsset = String(map.imageAsset || '').trim();
    return localAsset ? [localAsset] : [];
  }

  function preload(url) {
    if (!url) return;
    const img = new Image();
    img.src = url;
  }

  function readLocalState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return defaultState();

    try {
      return sanitizeState(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  function bridgeHasScoreboard(payload) {
    return Boolean(
      payload?.scoreboard &&
      (payload.scoreboard.team1 || payload.scoreboard.team2)
    );
  }

  function bridgeHasValorantMapVeto(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const veto = payload.valorantMapVeto;
    if (!veto || typeof veto !== 'object') return false;
    return ['ban1', 'ban2', 'pick1', 'pick2', 'ban3', 'ban4', 'pick3'].some((key) => Object.prototype.hasOwnProperty.call(veto, key));
  }

  function bridgeHasValorantMapPool(payload) {
    if (!payload || typeof payload !== 'object') return false;
    return Array.isArray(payload.valorantMapPool);
  }

  function bridgeHasValorantPickSides(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const sides = payload.valorantPickSides;
    if (!sides || typeof sides !== 'object') return false;
    return ['pick1', 'pick2', 'pick3'].some((key) => Object.prototype.hasOwnProperty.call(sides, key));
  }

  function bridgeHasValorantGameScore(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const gameScore = payload.valorantGameScore;
    if (!gameScore || typeof gameScore !== 'object') return false;
    return ['pick1', 'pick2', 'pick3'].some((key) => Object.prototype.hasOwnProperty.call(gameScore, key));
  }

  function bridgeHasLogoParticle(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const particle = payload.logoParticle;
    return Boolean(particle && typeof particle === 'object');
  }

  async function readBridgeState() {
    try {
      const response = await fetch(BRIDGE_STATE_URL, { cache: 'no-store' });
      if (!response.ok) return null;
      const payload = await response.json();
      return {
        state: sanitizeState(payload),
        hasScoreboard: bridgeHasScoreboard(payload),
        hasValorantMapVeto: bridgeHasValorantMapVeto(payload),
        hasValorantMapPool: bridgeHasValorantMapPool(payload),
        hasValorantPickSides: bridgeHasValorantPickSides(payload),
        hasValorantGameScore: bridgeHasValorantGameScore(payload),
        hasLogoParticle: bridgeHasLogoParticle(payload)
      };
    } catch {
      return null;
    }
  }

  async function readSharedState() {
    const localState = readLocalState();
    const bridgePayload = await readBridgeState();
    if (!bridgePayload) return localState;

    const bridgeState = bridgePayload.state;

    return sanitizeState({
      ...localState,
      ...bridgeState,
      scoreboard: bridgePayload.hasScoreboard ? bridgeState.scoreboard : localState.scoreboard,
      valorantMapVeto: bridgePayload.hasValorantMapVeto ? bridgeState.valorantMapVeto : localState.valorantMapVeto,
      valorantMapPool: bridgePayload.hasValorantMapPool ? bridgeState.valorantMapPool : localState.valorantMapPool,
      valorantPickSides: bridgePayload.hasValorantPickSides ? bridgeState.valorantPickSides : localState.valorantPickSides,
      valorantGameScore: bridgePayload.hasValorantGameScore ? bridgeState.valorantGameScore : localState.valorantGameScore,
      logoParticle: bridgePayload.hasLogoParticle ? bridgeState.logoParticle : localState.logoParticle,
      updatedAt: Math.max(Number(localState.updatedAt) || 0, Number(bridgeState.updatedAt) || 0)
    });
  }

  function writeState(nextState) {
    const payload = sanitizeState({ ...nextState, updatedAt: Date.now() });

    localStorage.setItem(STATE_KEY, JSON.stringify(payload));

    fetch(BRIDGE_STATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {
      // GUI bridge is optional; keep localStorage as the baseline transport.
    });

    return payload;
  }

  function findHeroByName(name) {
    return heroesByName.get(normalize(name)) || null;
  }

  function resolveHeroImage(hero) {
    if (!hero?.image) return '';
    const normalizedPath = hero.image.replace(/^\.\.\//, '');
    const safePath = normalizedPath.replace(/%/g, '%25');
    return `${HERO_IMAGE_BASE}${safePath}`;
  }

  function getQueryHero() {
    const params = new URLSearchParams(window.location.search);
    return params.get('hero') || '';
  }

  function setPreviewCard(previewNode, heroName) {
    if (!previewNode) return;

    const nameNode = previewNode.querySelector('[data-name]');
    const thumbNode = previewNode.querySelector('[data-thumb]');
    const hero = findHeroByName(heroName);

    nameNode.textContent = heroName || 'None';

    if (hero?.image) {
      thumbNode.style.backgroundImage = `url('${resolveHeroImage(hero)}')`;
    } else {
      thumbNode.style.backgroundImage = 'none';
    }
  }

  function buildFilteredHeroes(term) {
    const cleaned = normalize(term);
    if (!cleaned) return heroList.slice(0, 20);

    const starts = [];
    const includes = [];
    for (const hero of heroList) {
      const name = normalize(hero.name);
      if (name.startsWith(cleaned)) {
        starts.push(hero);
      } else if (name.includes(cleaned)) {
        includes.push(hero);
      }
    }
    return [...starts, ...includes].slice(0, 20);
  }

  function installSearchForTeam(teamId, options) {
    const { pendingState, syncInputs } = options;
    const input = document.getElementById(`${teamId}-search`);
    const list = document.getElementById(`${teamId}-results`);
    const preview = document.getElementById(`${teamId}-preview`);
    if (!input || !list || !preview) return;

    let activeIndex = -1;

    const closeList = () => {
      list.classList.remove('visible');
      activeIndex = -1;
    };

    const setPendingHero = (heroName) => {
      pendingState[teamId].ban = heroName || '';
      syncInputs();
      closeList();
    };

    const renderList = () => {
      const term = input.value;
      const filtered = buildFilteredHeroes(term);
      list.innerHTML = '';
      if (!filtered.length) {
        closeList();
        return;
      }

      filtered.forEach((hero, index) => {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');

        const icon = document.createElement('img');
        icon.className = 'result-icon';
        icon.alt = '';
        icon.loading = 'lazy';
        icon.src = resolveHeroImage(hero);

        const label = document.createElement('span');
        label.className = 'result-name';
        label.textContent = hero.name;

        item.append(icon, label);
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          setPendingHero(hero.name);
        });

        if (index === activeIndex) item.classList.add('active');
        list.appendChild(item);
      });

      list.classList.add('visible');
    };

    input.addEventListener('focus', renderList);
    input.addEventListener('input', () => {
      activeIndex = -1;
      renderList();
    });

    input.addEventListener('keydown', (event) => {
      const visibleItems = list.querySelectorAll('li');
      if (!visibleItems.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % visibleItems.length;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = (activeIndex - 1 + visibleItems.length) % visibleItems.length;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIndex >= 0) {
          setPendingHero(visibleItems[activeIndex].querySelector('.result-name')?.textContent || '');
          return;
        }
      } else if (event.key === 'Escape') {
        closeList();
        return;
      } else {
        return;
      }

      visibleItems.forEach((item, idx) => item.classList.toggle('active', idx === activeIndex));
    });

    document.addEventListener('click', (event) => {
      if (!list.contains(event.target) && event.target !== input) {
        closeList();
      }
    });

    const clearButton = document.getElementById(`${teamId}-clear`);
    if (clearButton) {
      clearButton.addEventListener('click', () => {
        setPendingHero('');
      });
    }

    syncInputs();
  }

  function renderOverlay(teamId) {
    const stage = document.querySelector(`[data-overlay-team='${teamId}']`);
    if (!stage) return;

    const image = stage.querySelector('[data-hero-image]');
    const placeholder = stage.querySelector('[data-hero-placeholder]');
    const name = stage.querySelector('[data-hero-name]');

    let lastSignature = '';
    let fadeTimer = null;

    const paintOverlay = (selectedName) => {
      const hero = findHeroByName(selectedName);
      name.textContent = selectedName || 'NO BAN';

      if (hero?.image) {
        image.src = resolveHeroImage(hero);
        image.style.display = 'block';
        placeholder.style.display = 'none';
      } else {
        image.removeAttribute('src');
        image.style.display = 'none';
        placeholder.style.display = 'grid';
      }

      image.onerror = () => {
        image.style.display = 'none';
        placeholder.style.display = 'grid';
      };

      image.onload = () => {
        placeholder.style.display = 'none';
      };
    };

    const applyState = async () => {
      const queryHero = getQueryHero();
      const state = await readSharedState();
      const selectedName = (queryHero || state?.[teamId]?.ban || '').trim();
      const signature = `${selectedName}:${state.updatedAt}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
      }

      stage.classList.add('is-fading');
      fadeTimer = setTimeout(() => {
        paintOverlay(selectedName);
        stage.classList.remove('is-fading');
      }, FADE_TRANSITION_MS);
    };

    applyState();

    window.addEventListener('storage', (event) => {
      if (event.key === STATE_KEY) applyState();
    });
    setInterval(applyState, OVERLAY_POLL_MS);
  }

  function renderScoreboardOverlay() {
    const stage = document.querySelector('[data-scoreboard-role]');
    if (!stage) return;

    const role = stage.dataset.scoreboardRole;
    const team = stage.dataset.scoreboardTeam;
    const valueNode = stage.querySelector('[data-scoreboard-value]');
    if (!role || !team || !valueNode) return;

    let lastSignature = '';

    const paint = async (scoreboardTeam) => {
      if (role === 'name') {
        const textNode = valueNode.dataset.scoreboardNameText === 'true' ? valueNode : stage.querySelector('[data-scoreboard-name-text]');
        const imageNode = stage.querySelector('[data-scoreboard-name-image]');
        const usePng = sanitizeNamePngToggle(scoreboardTeam.nameUsePng) && Boolean((scoreboardTeam.namePng || '').trim());

        if (textNode) {
          textNode.textContent = scoreboardTeam.name || 'TEAM';
          textNode.style.setProperty('--scoreboard-name-color', sanitizeNameColor(scoreboardTeam.nameColor));
          textNode.style.setProperty('--scoreboard-name-bevel-color', sanitizeBevelColor(scoreboardTeam.bevelColor));

          const fontToken = sanitizeNameFont(scoreboardTeam.nameFont);
          textNode.classList.remove('is-font-varsity', 'is-font-block', 'is-font-classic', 'is-font-custom');
          textNode.style.removeProperty('--scoreboard-custom-font-family');

          if (BUILTIN_FONT_VALUES.has(fontToken)) {
            textNode.classList.add(`is-font-${fontToken}`);
          } else if (fontToken.startsWith('file:')) {
            const family = await ensureCustomFontLoaded(fontToken);
            if (family) {
              textNode.classList.add('is-font-custom');
              textNode.style.setProperty('--scoreboard-custom-font-family', `${family}, "Impact", "Arial Black", sans-serif`);
            } else {
              textNode.classList.add('is-font-varsity');
            }
          } else {
            textNode.classList.add('is-font-varsity');
          }

          textNode.style.display = usePng ? 'none' : '';
        }

        if (imageNode) {
          const pngScale = sanitizeNamePngScale(scoreboardTeam.namePngScale);
          const sizePercent = 100 + pngScale;
          imageNode.style.width = `${sizePercent}%`;
          imageNode.style.height = `${sizePercent}%`;
          if (usePng) {
            imageNode.src = scoreboardTeam.namePng;
            imageNode.style.display = 'block';
          } else {
            imageNode.removeAttribute('src');
            imageNode.style.display = 'none';
          }
        }

      } else if (role === 'logo') {
        const scaleAmount = sanitizeLogoScale(scoreboardTeam.logoScale);
        const logoSizePercent = 100 + scaleAmount;
        valueNode.style.width = `${logoSizePercent}%`;
        valueNode.style.height = `${logoSizePercent}%`;

        if (scoreboardTeam.logo) {
          valueNode.src = scoreboardTeam.logo;
          valueNode.style.display = 'block';
        } else {
          valueNode.removeAttribute('src');
          valueNode.style.display = 'none';
        }
      } else if (role === 'score') {
        valueNode.textContent = String(sanitizeScore(scoreboardTeam.score));
      }
    };

    const applyState = async () => {
      const state = await readSharedState();
      const scoreboardTeam = state?.scoreboard?.[team] || { name: '', nameUsePng: false, namePng: '', namePngScale: 0, logo: '', logoScale: 0, score: 0, nameColor: '#e9eefc', bevelColor: '#7dd3fc', nameFont: 'varsity' };
      const signature = `${scoreboardTeam.name}|${scoreboardTeam.nameUsePng}|${scoreboardTeam.namePng}|${scoreboardTeam.namePngScale}|${scoreboardTeam.logo}|${scoreboardTeam.logoScale}|${scoreboardTeam.score}|${scoreboardTeam.nameColor}|${scoreboardTeam.bevelColor}|${scoreboardTeam.nameFont}|${state.updatedAt}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      await paint(scoreboardTeam);
    };

    applyState();
    window.addEventListener('storage', (event) => {
      if (event.key === STATE_KEY) applyState();
    });
    setInterval(applyState, OVERLAY_POLL_MS);
  }

  function initTabs() {
    const tabButtons = document.querySelectorAll('[data-tab-target]');
    if (!tabButtons.length) return;

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const targetId = button.dataset.tabTarget;
        const targetPanel = document.getElementById(targetId);
        if (!targetPanel) return;

        tabButtons.forEach((btn) => btn.classList.toggle('is-active', btn === button));
        document.querySelectorAll('.tab-panel').forEach((panel) => {
          panel.classList.toggle('is-active', panel === targetPanel);
        });
      });
    });
  }

  function initSubtabs() {
    const subtabButtons = Array.from(document.querySelectorAll('[data-subtab-target]'));
    if (!subtabButtons.length) return;

    subtabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const targetId = button.dataset.subtabTarget;
        if (!targetId) return;

        subtabButtons.forEach((btn) => btn.classList.toggle('is-active', btn === button));
        document.querySelectorAll('.subtab-panel').forEach((panel) => {
          panel.classList.toggle('is-active', panel.id === targetId);
        });
      });
    });
  }

  function getActiveTabId() {
    const activePanel = document.querySelector('.tab-panel.is-active');
    return activePanel?.id || '';
  }

  async function initScoreboardControl(pendingState, syncInputs) {
    const fieldMap = {
      team1: {
        name: document.getElementById('score-team1-name'),
        nameUsePng: document.getElementById('score-team1-name-use-png'),
        namePng: document.getElementById('score-team1-name-png'),
        namePngScale: document.getElementById('score-team1-name-png-scale'),
        namePngScaleValue: document.getElementById('score-team1-name-png-scale-value'),
        logo: document.getElementById('score-team1-logo'),
        logoScale: document.getElementById('score-team1-logo-scale'),
        logoScaleValue: document.getElementById('score-team1-logo-scale-value'),
        nameColor: document.getElementById('score-team1-name-color'),
        bevelColor: document.getElementById('score-team1-bevel-color'),
        nameFont: document.getElementById('score-team1-font')
      },
      team2: {
        name: document.getElementById('score-team2-name'),
        nameUsePng: document.getElementById('score-team2-name-use-png'),
        namePng: document.getElementById('score-team2-name-png'),
        namePngScale: document.getElementById('score-team2-name-png-scale'),
        namePngScaleValue: document.getElementById('score-team2-name-png-scale-value'),
        logo: document.getElementById('score-team2-logo'),
        logoScale: document.getElementById('score-team2-logo-scale'),
        logoScaleValue: document.getElementById('score-team2-logo-scale-value'),
        nameColor: document.getElementById('score-team2-name-color'),
        bevelColor: document.getElementById('score-team2-bevel-color'),
        nameFont: document.getElementById('score-team2-font')
      }
    };

    const updateButton = document.getElementById('scoreboard-update');
    const swapButton = document.getElementById('scoreboard-swap');

    if (!fieldMap.team1.name || !fieldMap.team2.name || !updateButton || !swapButton || !fieldMap.team1.logoScale || !fieldMap.team2.logoScale || !fieldMap.team1.nameUsePng || !fieldMap.team2.nameUsePng || !fieldMap.team1.namePng || !fieldMap.team2.namePng || !fieldMap.team1.namePngScale || !fieldMap.team2.namePngScale || !fieldMap.team1.nameColor || !fieldMap.team2.nameColor || !fieldMap.team1.bevelColor || !fieldMap.team2.bevelColor || !fieldMap.team1.nameFont || !fieldMap.team2.nameFont) return;

    await hydrateFontSelectors(
      [fieldMap.team1.nameFont, fieldMap.team2.nameFont],
      [pendingState.scoreboard.team1.nameFont, pendingState.scoreboard.team2.nameFont]
    );

    const handleInput = (teamId, key, value) => {
      if (key === 'nameColor') {
        pendingState.scoreboard[teamId][key] = sanitizeNameColor(value);
      } else if (key === 'bevelColor') {
        pendingState.scoreboard[teamId][key] = sanitizeBevelColor(value);
      } else if (key === 'nameFont') {
        pendingState.scoreboard[teamId][key] = sanitizeNameFont(value);
      } else if (key === 'nameUsePng') {
        pendingState.scoreboard[teamId][key] = sanitizeNamePngToggle(value);
      } else if (key === 'namePngScale') {
        pendingState.scoreboard[teamId][key] = sanitizeNamePngScale(value);
        if (fieldMap[teamId].namePngScaleValue) {
          fieldMap[teamId].namePngScaleValue.textContent = String(pendingState.scoreboard[teamId][key]);
        }
      } else if (key === 'logoScale') {
        pendingState.scoreboard[teamId][key] = sanitizeLogoScale(value);
        if (fieldMap[teamId].logoScaleValue) {
          fieldMap[teamId].logoScaleValue.textContent = String(pendingState.scoreboard[teamId][key]);
        }
      } else {
        pendingState.scoreboard[teamId][key] = value.trim();
      }
    };

    ['team1', 'team2'].forEach((teamId) => {
      fieldMap[teamId].name.addEventListener('input', (event) => {
        handleInput(teamId, 'name', event.target.value);
        updateScoreTickerHeading(teamId, event.target.value);
      });
      fieldMap[teamId].nameUsePng.addEventListener('change', (event) => {
        handleInput(teamId, 'nameUsePng', event.target.checked);
      });
      fieldMap[teamId].namePng.addEventListener('input', (event) => {
        handleInput(teamId, 'namePng', event.target.value);
      });
      const onNamePngScaleChange = (event) => {
        handleInput(teamId, 'namePngScale', event.target.value);
      };
      fieldMap[teamId].namePngScale.addEventListener('input', onNamePngScaleChange);
      fieldMap[teamId].namePngScale.addEventListener('change', onNamePngScaleChange);
      fieldMap[teamId].logo.addEventListener('input', (event) => {
        handleInput(teamId, 'logo', event.target.value);
      });
      const onLogoScaleChange = (event) => {
        handleInput(teamId, 'logoScale', event.target.value);
      };
      fieldMap[teamId].logoScale.addEventListener('input', onLogoScaleChange);
      fieldMap[teamId].logoScale.addEventListener('change', onLogoScaleChange);
      fieldMap[teamId].nameColor.addEventListener('input', (event) => {
        handleInput(teamId, 'nameColor', event.target.value);
      });
      fieldMap[teamId].bevelColor.addEventListener('input', (event) => {
        handleInput(teamId, 'bevelColor', event.target.value);
      });
      fieldMap[teamId].nameFont.addEventListener('change', (event) => {
        handleInput(teamId, 'nameFont', event.target.value);
      });
    });

    updateButton.addEventListener('click', () => {
      writeState(pendingState);
    });

    swapButton.addEventListener('click', () => {
      const currentTeam1 = { ...pendingState.scoreboard.team1 };
      pendingState.scoreboard.team1 = { ...pendingState.scoreboard.team2 };
      pendingState.scoreboard.team2 = currentTeam1;
      syncInputs();
      writeState(pendingState);
    });
  }

  function initScoreTickerControl(pendingState, syncInputs) {
    const controls = {
      team1: {
        score: document.getElementById('ticker-team1-score'),
        minus: document.getElementById('ticker-team1-minus'),
        plus: document.getElementById('ticker-team1-plus')
      },
      team2: {
        score: document.getElementById('ticker-team2-score'),
        minus: document.getElementById('ticker-team2-minus'),
        plus: document.getElementById('ticker-team2-plus')
      }
    };

    if (!controls.team1.score || !controls.team2.score || !controls.team1.minus || !controls.team1.plus || !controls.team2.minus || !controls.team2.plus) return;

    const persistScore = (teamId, nextScore) => {
      pendingState.scoreboard[teamId].score = sanitizeScore(nextScore);
      syncInputs();
      writeState(pendingState);
    };

    ['team1', 'team2'].forEach((teamId) => {
      controls[teamId].score.addEventListener('input', (event) => {
        persistScore(teamId, event.target.value);
      });
      controls[teamId].minus.addEventListener('click', () => {
        persistScore(teamId, sanitizeScore(pendingState.scoreboard[teamId].score) - 1);
      });
      controls[teamId].plus.addEventListener('click', () => {
        persistScore(teamId, sanitizeScore(pendingState.scoreboard[teamId].score) + 1);
      });
    });
  }

  function updateScoreTickerHeading(teamId, teamName) {
    const heading = document.getElementById(`ticker-${teamId}-heading`);
    if (!heading) return;

    const fallback = teamId === 'team1' ? 'Team 1 Score' : 'Team 2 Score';
    heading.textContent = teamName && teamName.trim() ? `${teamName.trim()} Score` : fallback;
  }

  function updateValorantGameScoreLabels(team1Name, team2Name) {
    const leftName = (team1Name || '').trim() || 'Team 1';
    const rightName = (team2Name || '').trim() || 'Team 2';

    ['pick1', 'pick2', 'pick3'].forEach((pickId) => {
      const team1Label = document.getElementById(`valorant-${pickId}-team1-score-label`);
      const team2Label = document.getElementById(`valorant-${pickId}-team2-score-label`);
      const winnerSelect = document.getElementById(`valorant-${pickId}-winner`);

      if (team1Label) team1Label.textContent = `${leftName} Score`;
      if (team2Label) team2Label.textContent = `${rightName} Score`;

      if (winnerSelect) {
        const team1Option = winnerSelect.querySelector("option[value='team1']");
        const team2Option = winnerSelect.querySelector("option[value='team2']");
        if (team1Option) team1Option.textContent = leftName;
        if (team2Option) team2Option.textContent = rightName;
      }

      ['defenders', 'attackers'].forEach((side) => {
        const sideSelect = document.getElementById(`valorant-${pickId}-${side}`);
        if (!sideSelect) return;
        const team1Option = sideSelect.querySelector("option[value='team1']");
        const team2Option = sideSelect.querySelector("option[value='team2']");
        if (team1Option) team1Option.textContent = leftName;
        if (team2Option) team2Option.textContent = rightName;
      });
    });
  }

  function initValorantMapVetoControl(pendingState, syncInputs) {
    const fields = VETO_FIELD_IDS.reduce((collection, fieldId) => {
      collection[fieldId] = document.getElementById(`valorant-${fieldId}`);
      return collection;
    }, {});
    const sideFields = {
      pick1: {
        defenders: document.getElementById('valorant-pick1-defenders'),
        attackers: document.getElementById('valorant-pick1-attackers')
      },
      pick2: {
        defenders: document.getElementById('valorant-pick2-defenders'),
        attackers: document.getElementById('valorant-pick2-attackers')
      },
      pick3: {
        defenders: document.getElementById('valorant-pick3-defenders'),
        attackers: document.getElementById('valorant-pick3-attackers')
      }
    };
    const mapPoolList = document.getElementById('valorant-map-pool-list');
    const gameScoreFields = {
      pick1: {
        winner: document.getElementById('valorant-pick1-winner'),
        team1Score: document.getElementById('valorant-pick1-team1-score'),
        team2Score: document.getElementById('valorant-pick1-team2-score')
      },
      pick2: {
        winner: document.getElementById('valorant-pick2-winner'),
        team1Score: document.getElementById('valorant-pick2-team1-score'),
        team2Score: document.getElementById('valorant-pick2-team2-score')
      },
      pick3: {
        winner: document.getElementById('valorant-pick3-winner'),
        team1Score: document.getElementById('valorant-pick3-team1-score'),
        team2Score: document.getElementById('valorant-pick3-team2-score')
      }
    };

    if (VETO_FIELD_IDS.some((fieldId) => !fields[fieldId])) return;

    const getAvailableMaps = () => getValorantPoolMaps(pendingState.valorantMapPool);

    const renderOptions = (selectNode, options, selectedValue = '') => {
      const cleanSelectedValue = sanitizeValorantMapSelection(selectedValue);
      selectNode.innerHTML = '';
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '—';
      selectNode.appendChild(emptyOption);

      options.forEach((map) => {
        const option = document.createElement('option');
        option.value = map.uuid;
        option.textContent = map.displayName;
        selectNode.appendChild(option);
      });

      selectNode.value = options.some((map) => map.uuid === cleanSelectedValue) ? cleanSelectedValue : '';
    };

    const syncMapPoolFromCheckboxes = () => {
      if (!mapPoolList) return;
      const checked = Array.from(mapPoolList.querySelectorAll('input[type="checkbox"][data-map-uuid]:checked'));
      pendingState.valorantMapPool = sanitizeValorantMapPool(checked.map((node) => node.dataset.mapUuid));
    };

    const rebuildFieldOptions = () => {
      const availableMaps = getAvailableMaps();
      const availableUuids = new Set(availableMaps.map((map) => map.uuid));

      VETO_FIELD_IDS.forEach((fieldId) => {
        const currentValue = sanitizeValorantMapSelection(pendingState.valorantMapVeto[fieldId]);
        if (currentValue && !availableUuids.has(currentValue)) {
          pendingState.valorantMapVeto[fieldId] = '';
        }
      });

      const seenSelections = new Set();
      VETO_FIELD_IDS.forEach((fieldId) => {
        const currentValue = sanitizeValorantMapSelection(pendingState.valorantMapVeto[fieldId]);
        if (!currentValue) return;
        if (seenSelections.has(currentValue)) {
          pendingState.valorantMapVeto[fieldId] = '';
          return;
        }
        seenSelections.add(currentValue);
      });

      VETO_FIELD_IDS.forEach((fieldId) => {
        const currentValue = sanitizeValorantMapSelection(pendingState.valorantMapVeto[fieldId]);
        const selectedInOtherFields = new Set(
          VETO_FIELD_IDS
            .filter((otherFieldId) => otherFieldId !== fieldId)
            .map((otherFieldId) => sanitizeValorantMapSelection(pendingState.valorantMapVeto[otherFieldId]))
            .filter(Boolean)
        );

        const optionsForField = availableMaps.filter(
          (map) => !selectedInOtherFields.has(map.uuid) || map.uuid === currentValue
        );

        renderOptions(fields[fieldId], optionsForField, currentValue);
      });
    };

    const buildMapPoolList = () => {
      if (!mapPoolList) return;
      mapPoolList.innerHTML = '';

      valorantMaps.forEach((map) => {
        const item = document.createElement('label');
        item.className = 'valorant-map-pool-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.mapUuid = map.uuid;

        const text = document.createElement('span');
        text.textContent = map.displayName;

        item.appendChild(checkbox);
        item.appendChild(text);
        mapPoolList.appendChild(item);
      });

      mapPoolList.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
        syncMapPoolFromCheckboxes();
        rebuildFieldOptions();
        syncInputs();
        writeState(pendingState);
      });
    };

    pendingState.valorantMapPool = sanitizeValorantMapPool(pendingState.valorantMapPool);
    pendingState.valorantPickSides = {
      pick1: sanitizeValorantPickSides(pendingState?.valorantPickSides?.pick1),
      pick2: sanitizeValorantPickSides(pendingState?.valorantPickSides?.pick2),
      pick3: sanitizeValorantPickSides(pendingState?.valorantPickSides?.pick3)
    };
    pendingState.valorantGameScore = {
      pick1: sanitizeValorantGameScore(pendingState?.valorantGameScore?.pick1),
      pick2: sanitizeValorantGameScore(pendingState?.valorantGameScore?.pick2),
      pick3: sanitizeValorantGameScore(pendingState?.valorantGameScore?.pick3)
    };

    buildMapPoolList();
    refreshValorantMapPoolOptions = rebuildFieldOptions;
    rebuildFieldOptions();
    syncInputs();

    VETO_FIELD_IDS.forEach((fieldId) => {
      fields[fieldId].addEventListener('change', (event) => {
        pendingState.valorantMapVeto[fieldId] = sanitizeValorantMapSelection(event.target.value);
        syncInputs();
        writeState(pendingState);
      });
    });

    ['pick1', 'pick2', 'pick3'].forEach((pickId) => {
      const sideControl = sideFields[pickId];
      if (!sideControl?.defenders || !sideControl?.attackers) return;

      const persistSides = (sideKey, value) => {
        const cleanTeam = sanitizeValorantPickTeam(value);
        const nextSides = sideKey === 'defenders'
          ? { defenders: cleanTeam, attackers: cleanTeam === 'team1' ? 'team2' : 'team1' }
          : { attackers: cleanTeam, defenders: cleanTeam === 'team1' ? 'team2' : 'team1' };
        pendingState.valorantPickSides[pickId] = nextSides;
        syncInputs();
        writeState(pendingState);
      };

      ['change', 'input'].forEach((eventName) => {
        sideControl.defenders.addEventListener(eventName, (event) => {
          persistSides('defenders', event.target.value);
        });
        sideControl.attackers.addEventListener(eventName, (event) => {
          persistSides('attackers', event.target.value);
        });
      });
    });

    VALORANT_PICK_IDS.forEach((pickId) => {
      const fieldsForPick = gameScoreFields[pickId];
      if (!fieldsForPick?.winner || !fieldsForPick?.team1Score || !fieldsForPick?.team2Score) return;

      fieldsForPick.winner.addEventListener('change', (event) => {
        pendingState.valorantGameScore[pickId].winner = sanitizeValorantWinner(event.target.value);
        syncInputs();
        writeState(pendingState);
      });

      fieldsForPick.team1Score.addEventListener('input', (event) => {
        pendingState.valorantGameScore[pickId].team1Score = sanitizeScore(event.target.value);
        syncInputs();
        writeState(pendingState);
      });

      fieldsForPick.team2Score.addEventListener('input', (event) => {
        pendingState.valorantGameScore[pickId].team2Score = sanitizeScore(event.target.value);
        syncInputs();
        writeState(pendingState);
      });
    });

    const clearButton = document.getElementById('valorant-reset');
    if (clearButton) {
      clearButton.addEventListener('click', () => {
        VETO_FIELD_IDS.forEach((fieldId) => {
          pendingState.valorantMapVeto[fieldId] = '';
        });
        pendingState.valorantPickSides = {
          pick1: { defenders: 'team1', attackers: 'team2' },
          pick2: { defenders: 'team1', attackers: 'team2' },
          pick3: { defenders: 'team1', attackers: 'team2' }
        };
        pendingState.valorantGameScore = {
          pick1: { winner: '', team1Score: 0, team2Score: 0 },
          pick2: { winner: '', team1Score: 0, team2Score: 0 },
          pick3: { winner: '', team1Score: 0, team2Score: 0 }
        };
        syncInputs();
        writeState(pendingState);
      });
    }
  }

  function initLogoParticleControl(pendingState, syncInputs) {
    const fields = {
      team1Logo: document.getElementById('particle-team1-logo'),
      team2Logo: document.getElementById('particle-team2-logo'),
      density: document.getElementById('particle-density'),
      size: document.getElementById('particle-size'),
      speed: document.getElementById('particle-speed'),
      depth: document.getElementById('particle-depth'),
      burstForce: document.getElementById('particle-burst-force'),
      cameraDistance: document.getElementById('particle-camera-distance'),
      startAngle: document.getElementById('particle-start-angle'),
      team1Reset: document.getElementById('particle-team1-reset'),
      holdTime: document.getElementById('particle-hold-time'),
      startSequence: document.getElementById('particle-start-sequence'),
      burst: document.getElementById('particle-burst'),
      reset: document.getElementById('particle-reset-defaults')
    };

    if (!fields.density) return;

    const toDataUrl = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const syncLocalControls = () => {
      const particle = sanitizeLogoParticleState(pendingState.logoParticle);
      fields.density.value = String(particle.density);
      fields.size.value = String(particle.size);
      fields.speed.value = String(particle.speed);
      fields.depth.value = String(particle.depth);
      fields.burstForce.value = String(particle.burstForce);
      fields.cameraDistance.value = String(particle.cameraDistance);
      fields.startAngle.value = String(particle.startAngle);
      fields.team1Reset.checked = Boolean(particle.team1Reset);
      fields.holdTime.value = String(particle.holdTime);
    };

    syncLogoParticleControls = syncLocalControls;

    const mutateParticle = (commandType = null) => {
      const next = {
        ...sanitizeLogoParticleState(pendingState.logoParticle),
        density: Math.round(clampRange(fields.density.value, 3, 12, 6)),
        size: clampRange(fields.size.value, 1, 5, 2),
        speed: clampRange(fields.speed.value, 0.03, 0.2, 0.08),
        depth: clampRange(fields.depth.value, 0, 1, 0.55),
        burstForce: clampRange(fields.burstForce.value, 0, 2, 1),
        cameraDistance: Math.round(clampRange(fields.cameraDistance.value, 420, 1100, 700)),
        startAngle: Math.round(clampRange(fields.startAngle.value, 0, 359, 10)),
        team1Reset: Boolean(fields.team1Reset.checked),
        holdTime: Math.round(clampRange(fields.holdTime.value, 2, 15, 6))
      };

      if (commandType) {
        const previousNonce = Number(next?.command?.nonce) || 0;
        next.command = { type: commandType, nonce: previousNonce + 1, ts: Date.now() };
      }

      pendingState.logoParticle = sanitizeLogoParticleState(next);
      syncInputs();
      writeState(pendingState);
    };

    const bindRange = (node) => {
      if (!node) return;
      node.addEventListener('input', () => mutateParticle());
      node.addEventListener('change', () => mutateParticle());
    };

    [fields.density, fields.size, fields.speed, fields.depth, fields.burstForce, fields.cameraDistance, fields.startAngle, fields.holdTime].forEach(bindRange);
    fields.team1Reset.addEventListener('change', () => mutateParticle());

    fields.startSequence.addEventListener('click', () => mutateParticle('start-sequence'));
    fields.burst.addEventListener('click', () => mutateParticle('burst'));
    fields.reset.addEventListener('click', () => {
      pendingState.logoParticle = defaultLogoParticleState();
      syncInputs();
      writeState(pendingState);
    });

    const handleUpload = async (file, index) => {
      if (!file) return;
      try {
        const src = sanitizeParticleLogoSource(await toDataUrl(file));
        const next = sanitizeLogoParticleState(pendingState.logoParticle);
        const logos = Array.isArray(next.logoSources) ? [...next.logoSources] : ['', ''];
        logos[index] = src;
        next.logoSources = logos;
        next.activeLogoIndex = index;
        const nonce = Number(next?.command?.nonce) || 0;
        next.command = { type: 'start-sequence', nonce: nonce + 1, ts: Date.now() };
        pendingState.logoParticle = sanitizeLogoParticleState(next);
        syncInputs();
        writeState(pendingState);
      } catch {
        window.alert('Unable to read logo file. Please use PNG/JPG/SVG images.');
      }
    };

    fields.team1Logo.addEventListener('change', (event) => handleUpload(event.target.files?.[0], 0));
    fields.team2Logo.addEventListener('change', (event) => handleUpload(event.target.files?.[0], 1));

    syncLocalControls();
  }

  function renderLogoParticleOverlay() {
    const canvas = document.querySelector('[data-logo-particle-overlay]');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const offscreen = document.createElement('canvas');
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    const CAMERA = { focalLength: 760 };
    const particles = [];
    let targets = [];
    let logos = [null, null];
    let logoSources = ['', ''];
    let activeLogoIndex = 0;
    let sequenceTimer = null;
    let lastSignature = '';
    let lastCommandNonce = -1;
    let rotationY = 0;
    const rotationX = 0.22;

    const settings = {
      density: 6, size: 2, speed: 0.08, depth: 0.55,
      startAngle: 10, team1Reset: true, holdTime: 6, burstForce: 1, cameraDistance: 700
    };

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

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
        this.targetColor = target.color;
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
        this.color.r += (this.targetColor.r - this.color.r) * colorLerp;
        this.color.g += (this.targetColor.g - this.color.g) * colorLerp;
        this.color.b += (this.targetColor.b - this.color.b) * colorLerp;
        this.color.a += (this.targetColor.a - this.color.a) * colorLerp;
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
        const depth = yzZ + settings.cameraDistance;
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

    const parseColor = (r, g, b, a) => ({ r, g, b, a });

    const fitDrawImage = (image) => {
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
      const margin = 120;
      const maxW = offscreen.width - margin * 2;
      const maxH = offscreen.height - margin * 2;
      const scale = Math.min(maxW / image.width, maxH / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      offCtx.drawImage(image, (offscreen.width - drawW) / 2, (offscreen.height - drawH) / 2, drawW, drawH);
    };

    const makeTargetsFromImage = (image) => {
      fitDrawImage(image);
      const { width, height } = offscreen;
      const imageData = offCtx.getImageData(0, 0, width, height);
      const nextTargets = [];
      for (let y = 0; y < height; y += settings.density) {
        for (let x = 0; x < width; x += settings.density) {
          const i = (y * width + x) * 4;
          const alpha = imageData.data[i + 3];
          if (alpha <= 100) continue;
          const r = imageData.data[i], g = imageData.data[i + 1], b = imageData.data[i + 2];
          const centeredX = x - width / 2;
          const centeredY = y - height / 2;
          const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const waveDepth = Math.sin(centeredX * 0.016) * 10 + Math.cos(centeredY * 0.018) * 10;
          const zDepth = ((luminance - 0.5) * 70 + waveDepth) * settings.depth;
          nextTargets.push({ x: centeredX, y: centeredY, z: zDepth, color: parseColor(r, g, b, Math.max(alpha / 255, 0.45)) });
        }
      }
      targets = nextTargets;
      while (particles.length < targets.length) {
        particles.push(new Particle((Math.random() - 0.5) * 300, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 220));
      }
      if (particles.length > targets.length) particles.length = targets.length;
      particles.forEach((particle, index) => particle.retarget(targets[index]));
    };

    const burst = () => {
      const force = settings.burstForce;
      particles.forEach((particle) => {
        const outward = 18 * force;
        const swirl = 10 * force;
        particle.vx += particle.targetX * 0.012 * force + (Math.random() - 0.5) * outward + (Math.random() - 0.5) * swirl;
        particle.vy += particle.targetY * 0.012 * force + (Math.random() - 0.5) * outward + (Math.random() - 0.5) * swirl;
        particle.vz += (Math.random() - 0.5) * 12 * force;
      });
    };

    const showLogo = (index) => {
      const image = logos[index];
      if (!image) return;
      if (index === 0 && settings.team1Reset) {
        const normalized = ((settings.startAngle % 360) + 360) % 360;
        rotationY = (normalized * Math.PI) / 180;
      }
      activeLogoIndex = index;
      makeTargetsFromImage(image);
      burst();
    };

    const startSequence = () => {
      if (sequenceTimer) clearInterval(sequenceTimer);
      showLogo(activeLogoIndex);
      sequenceTimer = setInterval(() => {
        activeLogoIndex = (activeLogoIndex + 1) % 2;
        if (!logos[activeLogoIndex]) activeLogoIndex = (activeLogoIndex + 1) % 2;
        showLogo(activeLogoIndex);
      }, settings.holdTime * 1000);
    };

    const loadImage = (url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });

    const applyParticleState = async (state) => {
      const config = sanitizeLogoParticleState(state?.logoParticle);
      settings.density = config.density;
      settings.size = config.size;
      settings.speed = config.speed;
      settings.depth = config.depth;
      settings.startAngle = config.startAngle;
      settings.team1Reset = config.team1Reset;
      settings.holdTime = config.holdTime;
      settings.burstForce = config.burstForce;
      settings.cameraDistance = config.cameraDistance;
      activeLogoIndex = config.activeLogoIndex;

      if (JSON.stringify(config.logoSources) !== JSON.stringify(logoSources)) {
        logoSources = config.logoSources;
        logos = [null, null];
        for (let i = 0; i < 2; i += 1) {
          if (!logoSources[i]) continue;
          try { logos[i] = await loadImage(logoSources[i]); } catch { logos[i] = null; }
        }
      }

      if (logos[activeLogoIndex]) {
        makeTargetsFromImage(logos[activeLogoIndex]);
        startSequence();
      }

      const command = sanitizeParticleCommand(config.command);
      if (!command) return;
      if (command.nonce === lastCommandNonce) return;
      lastCommandNonce = command.nonce;
      if (command.type === 'burst') burst();
      if (command.type === 'start-sequence') startSequence();
    };

    const applyState = async () => {
      const state = await readSharedState();
      const signature = JSON.stringify(state?.logoParticle || {});
      if (!signature || signature === lastSignature) return;
      lastSignature = signature;
      await applyParticleState(state);
    };

    let lastTs = 0;
    const animate = (ts) => {
      const dt = Math.min((ts - lastTs) / 1000, 0.032);
      lastTs = ts;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => { p.update(dt); });
      rotationY += dt * 0.168;
      const sorted = [...particles].sort((a, b) => b.project(rotationY, rotationX).depth - a.project(rotationY, rotationX).depth);
      sorted.forEach((p) => p.draw(rotationY, rotationX));
      requestAnimationFrame(animate);
    };

    window.addEventListener('resize', () => {
      resizeCanvas();
      if (logos[activeLogoIndex]) makeTargetsFromImage(logos[activeLogoIndex]);
    });
    window.addEventListener('storage', (event) => {
      if (event.key === STATE_KEY) applyState();
    });

    resizeCanvas();
    applyState();
    setInterval(applyState, OVERLAY_POLL_MS);
    requestAnimationFrame(animate);
  }

  function renderValorantMapVetoOverlay() {
    const overlay = document.querySelector('[data-valorant-map-veto-overlay]');
    if (!overlay) return;

    let lastSignature = '';

    const pickSlots = ['pick1', 'pick2', 'pick3'];
    const banSlots = ['ban1', 'ban2', 'ban3', 'ban4'];

    const setTeamLogo = (node, logoPath) => {
      if (!node) return;
      const hasLogo = Boolean((logoPath || '').trim());
      node.classList.toggle('is-empty', !hasLogo);
      node.style.backgroundImage = hasLogo ? `url("${logoPath}")` : 'none';
    };

    const applyBackground = (node, type, imageUrls) => {
      if (!node) return;
      const base = type === 'ban'
        ? 'linear-gradient(to bottom, rgba(255, 45, 61, 0.5) 0%, rgba(255, 45, 61, 0) 25%), linear-gradient(to top, rgba(255, 45, 61, 0.5) 0%, rgba(255, 45, 61, 0) 25%), linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.90))'
        : 'linear-gradient(to bottom, rgba(54, 203, 121, 0.5) 0%, rgba(54, 203, 121, 0) 25%), linear-gradient(to top, rgba(54, 203, 121, 0.5) 0%, rgba(54, 203, 121, 0) 25%)';

      if (Array.isArray(imageUrls) && imageUrls.length) {
        const layers = imageUrls.map((url) => `url("${url}")`).join(', ');
        node.style.backgroundImage = `${base}, ${layers}`;
      } else {
        node.style.backgroundImage = '';
      }
      node.style.backgroundColor = '#0b0f16';
      node.style.backgroundSize = 'cover';
      node.style.backgroundPosition = 'center';
      node.style.backgroundRepeat = 'no-repeat';
    };

    const updateCardContent = (state) => {
      banSlots.forEach((fieldId) => {
        const node = overlay.querySelector(`[data-ban-value='${fieldId}']`);
        const half = overlay.querySelector(`[data-ban-slot='${fieldId}']`);
        const map = getValorantMapByUuid(state.valorantMapVeto[fieldId]);
        const displayName = map?.displayName || 'MAP';
        if (node) node.textContent = displayName;
        const imageUrls = getValorantMapImages(map);
        applyBackground(half, 'ban', imageUrls);
      });

      pickSlots.forEach((fieldId) => {
        const node = overlay.querySelector(`[data-pick-value='${fieldId}']`);
        const card = node?.closest('.valorant-pick-card');
        const recapNode = overlay.querySelector(`[data-pick-recap='${fieldId}']`);
        const recapLogoNode = overlay.querySelector(`[data-pick-winner-logo='${fieldId}']`);
        const recapScoreNode = overlay.querySelector(`[data-pick-scoreline='${fieldId}']`);
        const map = getValorantMapByUuid(state.valorantMapVeto[fieldId]);
        const displayName = map?.displayName || '';
        const sideState = sanitizeValorantPickSides(state?.valorantPickSides?.[fieldId]);
        const gameScore = sanitizeValorantGameScore(state?.valorantGameScore?.[fieldId]);
        const hasRecap = Boolean(gameScore.winner && recapNode);
        if (node) {
          node.textContent = displayName;
          node.classList.toggle('is-visible', Boolean(displayName));
        }
        const defendersNode = overlay.querySelector(`[data-pick-team-logo='${fieldId}-defenders']`);
        const attackersNode = overlay.querySelector(`[data-pick-team-logo='${fieldId}-attackers']`);
        const defendersLogo = state?.scoreboard?.[sideState.defenders]?.logo || '';
        const attackersLogo = state?.scoreboard?.[sideState.attackers]?.logo || '';
        setTeamLogo(defendersNode, defendersLogo);
        setTeamLogo(attackersNode, attackersLogo);

        if (card) {
          card.classList.toggle('is-recap', hasRecap);
        }

        if (recapLogoNode) {
          const winnerLogo = gameScore.winner ? (state?.scoreboard?.[gameScore.winner]?.logo || '') : '';
          setTeamLogo(recapLogoNode, winnerLogo);
        }

        if (recapScoreNode) {
          const team1Score = sanitizeScore(gameScore.team1Score);
          const team2Score = sanitizeScore(gameScore.team2Score);
          const leftScore = gameScore.winner === 'team1' ? `<strong>${team1Score}</strong>` : String(team1Score);
          const rightScore = gameScore.winner === 'team2' ? `<strong>${team2Score}</strong>` : String(team2Score);
          recapScoreNode.innerHTML = `<span class="pick-recap-score-left">${leftScore}</span><span class="pick-recap-score-dash">-</span><span class="pick-recap-score-right">${rightScore}</span>`;
        }

        const imageUrls = getValorantMapImages(map);
        applyBackground(card, 'pick', imageUrls);
      });
    };

    const preloadSelected = (vetoState) => {
      VETO_FIELD_IDS.forEach((fieldId) => {
        const map = getValorantMapByUuid(vetoState[fieldId]);
        getValorantMapImages(map).forEach(preload);
      });
    };

    const applyState = async () => {
      const state = await readSharedState();
      const vetoState = state?.valorantMapVeto || defaultState().valorantMapVeto;
      const sideState = state?.valorantPickSides || {};
      const gameScoreState = state?.valorantGameScore || {};
      const signature = `${vetoState.ban1}|${vetoState.ban2}|${vetoState.pick1}|${vetoState.pick2}|${vetoState.ban3}|${vetoState.ban4}|${vetoState.pick3}|${JSON.stringify(sideState)}|${JSON.stringify(gameScoreState)}|${state?.scoreboard?.team1?.logo || ''}|${state?.scoreboard?.team2?.logo || ''}|${state.updatedAt}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      preloadSelected(vetoState);
      updateCardContent(state);
    };

    setTimeout(() => {
      document.body.classList.add('animate-in');
    }, 500);

    applyState();
    window.addEventListener('storage', (event) => {
      if (event.key === STATE_KEY) applyState();
    });
    setInterval(applyState, OVERLAY_POLL_MS);
  }

  async function initControlPage() {
    const pendingState = await readSharedState();

    const syncInputs = () => {
      ['team1', 'team2'].forEach((teamId) => {
        const input = document.getElementById(`${teamId}-search`);
        const preview = document.getElementById(`${teamId}-preview`);
        if (input) input.value = pendingState[teamId].ban || '';
        if (preview) setPreviewCard(preview, pendingState[teamId].ban || '');

        const teamPrefix = teamId === 'team1' ? 'score-team1' : 'score-team2';
        const nameInput = document.getElementById(`${teamPrefix}-name`);
        const nameUsePngInput = document.getElementById(`${teamPrefix}-name-use-png`);
        const namePngInput = document.getElementById(`${teamPrefix}-name-png`);
        const namePngScaleInput = document.getElementById(`${teamPrefix}-name-png-scale`);
        const namePngScaleValue = document.getElementById(`${teamPrefix}-name-png-scale-value`);
        const logoInput = document.getElementById(`${teamPrefix}-logo`);
        const logoScaleInput = document.getElementById(`${teamPrefix}-logo-scale`);
        const logoScaleValue = document.getElementById(`${teamPrefix}-logo-scale-value`);
        const scoreInput = document.getElementById(`ticker-${teamId}-score`);
        const colorInput = document.getElementById(`${teamPrefix}-name-color`);
        const bevelColorInput = document.getElementById(`${teamPrefix}-bevel-color`);
        const fontInput = document.getElementById(`${teamPrefix}-font`);
        if (nameInput) nameInput.value = pendingState.scoreboard[teamId].name || '';
        updateScoreTickerHeading(teamId, pendingState.scoreboard[teamId].name || '');
        if (nameUsePngInput) nameUsePngInput.checked = sanitizeNamePngToggle(pendingState.scoreboard[teamId].nameUsePng);
        if (namePngInput) namePngInput.value = pendingState.scoreboard[teamId].namePng || '';
        const cleanNamePngScale = sanitizeNamePngScale(pendingState.scoreboard[teamId].namePngScale);
        if (namePngScaleInput) namePngScaleInput.value = String(cleanNamePngScale);
        if (namePngScaleValue) namePngScaleValue.textContent = String(cleanNamePngScale);
        if (logoInput) logoInput.value = pendingState.scoreboard[teamId].logo || '';
        const cleanLogoScale = sanitizeLogoScale(pendingState.scoreboard[teamId].logoScale);
        if (logoScaleInput) logoScaleInput.value = String(cleanLogoScale);
        if (logoScaleValue) logoScaleValue.textContent = String(cleanLogoScale);
        if (scoreInput) scoreInput.value = String(sanitizeScore(pendingState.scoreboard[teamId].score));
        if (colorInput) colorInput.value = sanitizeNameColor(pendingState.scoreboard[teamId].nameColor);
        if (bevelColorInput) bevelColorInput.value = sanitizeBevelColor(pendingState.scoreboard[teamId].bevelColor);
        if (fontInput) fontInput.value = sanitizeNameFont(pendingState.scoreboard[teamId].nameFont);
      });

      updateValorantGameScoreLabels(
        pendingState.scoreboard.team1.name || '',
        pendingState.scoreboard.team2.name || ''
      );

      if (typeof refreshValorantMapPoolOptions === 'function') {
        refreshValorantMapPoolOptions();
      }

      VETO_FIELD_IDS.forEach((fieldId) => {
        const selectNode = document.getElementById(`valorant-${fieldId}`);
        if (!selectNode) return;
        selectNode.value = sanitizeValorantMapSelection(pendingState.valorantMapVeto[fieldId]);
      });

      ['pick1', 'pick2', 'pick3'].forEach((pickId) => {
        const sideState = sanitizeValorantPickSides(pendingState?.valorantPickSides?.[pickId]);
        const gameScore = sanitizeValorantGameScore(pendingState?.valorantGameScore?.[pickId]);
        const defendersNode = document.getElementById(`valorant-${pickId}-defenders`);
        const attackersNode = document.getElementById(`valorant-${pickId}-attackers`);
        const winnerNode = document.getElementById(`valorant-${pickId}-winner`);
        const team1ScoreNode = document.getElementById(`valorant-${pickId}-team1-score`);
        const team2ScoreNode = document.getElementById(`valorant-${pickId}-team2-score`);
        if (defendersNode) defendersNode.value = sideState.defenders;
        if (attackersNode) attackersNode.value = sideState.attackers;
        if (winnerNode) winnerNode.value = gameScore.winner;
        if (team1ScoreNode) team1ScoreNode.value = String(gameScore.team1Score);
        if (team2ScoreNode) team2ScoreNode.value = String(gameScore.team2Score);
      });

      const mapPoolList = document.getElementById('valorant-map-pool-list');
      if (mapPoolList) {
        const selected = new Set(sanitizeValorantMapPool(pendingState.valorantMapPool));
        mapPoolList.querySelectorAll('input[type="checkbox"][data-map-uuid]').forEach((checkbox) => {
          checkbox.checked = selected.has(checkbox.dataset.mapUuid || '');
        });
      }

      syncLogoParticleControls();
    };

    initTabs();
    initSubtabs();
    installSearchForTeam('team1', { pendingState, syncInputs });
    installSearchForTeam('team2', { pendingState, syncInputs });
    await initScoreboardControl(pendingState, syncInputs);
    initScoreTickerControl(pendingState, syncInputs);
    initValorantMapVetoControl(pendingState, syncInputs);
    initLogoParticleControl(pendingState, syncInputs);

    const swapTeams = document.getElementById('swap-teams');
    if (swapTeams) {
      swapTeams.addEventListener('click', () => {
        const team1Ban = pendingState.team1.ban;
        pendingState.team1.ban = pendingState.team2.ban;
        pendingState.team2.ban = team1Ban;
        syncInputs();
        writeState(pendingState);
      });
    }

    const updateButton = document.getElementById('apply-update');
    if (updateButton) {
      updateButton.addEventListener('click', () => {
        writeState(pendingState);
      });
    }

    const reset = document.getElementById('reset-all');
    if (reset) {
      reset.addEventListener('click', () => {
        const empty = defaultState();

        const activeTabId = getActiveTabId();
        if (activeTabId === 'hero-bans-tab') {
          pendingState.team1.ban = empty.team1.ban;
          pendingState.team2.ban = empty.team2.ban;
        } else if (activeTabId === 'scoreboard-tab') {
          pendingState.scoreboard.team1.name = empty.scoreboard.team1.name;
          pendingState.scoreboard.team1.nameUsePng = empty.scoreboard.team1.nameUsePng;
          pendingState.scoreboard.team1.namePng = empty.scoreboard.team1.namePng;
          pendingState.scoreboard.team1.namePngScale = empty.scoreboard.team1.namePngScale;
          pendingState.scoreboard.team1.logo = empty.scoreboard.team1.logo;
          pendingState.scoreboard.team1.logoScale = empty.scoreboard.team1.logoScale;
          pendingState.scoreboard.team1.nameColor = empty.scoreboard.team1.nameColor;
          pendingState.scoreboard.team1.bevelColor = empty.scoreboard.team1.bevelColor;
          pendingState.scoreboard.team1.nameFont = empty.scoreboard.team1.nameFont;

          pendingState.scoreboard.team2.name = empty.scoreboard.team2.name;
          pendingState.scoreboard.team2.nameUsePng = empty.scoreboard.team2.nameUsePng;
          pendingState.scoreboard.team2.namePng = empty.scoreboard.team2.namePng;
          pendingState.scoreboard.team2.namePngScale = empty.scoreboard.team2.namePngScale;
          pendingState.scoreboard.team2.logo = empty.scoreboard.team2.logo;
          pendingState.scoreboard.team2.logoScale = empty.scoreboard.team2.logoScale;
          pendingState.scoreboard.team2.nameColor = empty.scoreboard.team2.nameColor;
          pendingState.scoreboard.team2.bevelColor = empty.scoreboard.team2.bevelColor;
          pendingState.scoreboard.team2.nameFont = empty.scoreboard.team2.nameFont;
        } else if (activeTabId === 'score-tab') {
          pendingState.scoreboard.team1.score = empty.scoreboard.team1.score;
          pendingState.scoreboard.team2.score = empty.scoreboard.team2.score;
        } else if (activeTabId === 'logo-particle-tab') {
          pendingState.logoParticle = defaultLogoParticleState();
        } else if (activeTabId === 'valorant-map-veto-tab') {
          pendingState.valorantMapVeto = { ...empty.valorantMapVeto };
          pendingState.valorantMapPool = [...empty.valorantMapPool];
          pendingState.valorantPickSides = {
            pick1: { ...empty.valorantPickSides.pick1 },
            pick2: { ...empty.valorantPickSides.pick2 },
            pick3: { ...empty.valorantPickSides.pick3 }
          };
          pendingState.valorantGameScore = {
            pick1: { ...empty.valorantGameScore.pick1 },
            pick2: { ...empty.valorantGameScore.pick2 },
            pick3: { ...empty.valorantGameScore.pick3 }
          };
        }

        syncInputs();
        writeState(pendingState);
      });
    }

    syncInputs();

    window.addEventListener('storage', (event) => {
      if (event.key !== STATE_KEY) return;
      const next = readLocalState();
      pendingState.team1.ban = next.team1.ban;
      pendingState.team2.ban = next.team2.ban;
      pendingState.scoreboard.team1 = { ...next.scoreboard.team1 };
      pendingState.scoreboard.team2 = { ...next.scoreboard.team2 };
      pendingState.valorantMapVeto = { ...next.valorantMapVeto };
      pendingState.valorantMapPool = [...sanitizeValorantMapPool(next.valorantMapPool)];
      pendingState.valorantPickSides = {
        pick1: sanitizeValorantPickSides(next?.valorantPickSides?.pick1),
        pick2: sanitizeValorantPickSides(next?.valorantPickSides?.pick2),
        pick3: sanitizeValorantPickSides(next?.valorantPickSides?.pick3)
      };
      pendingState.valorantGameScore = {
        pick1: sanitizeValorantGameScore(next?.valorantGameScore?.pick1),
        pick2: sanitizeValorantGameScore(next?.valorantGameScore?.pick2),
        pick3: sanitizeValorantGameScore(next?.valorantGameScore?.pick3)
      };
      pendingState.logoParticle = sanitizeLogoParticleState(next?.logoParticle);
      syncInputs();
    });
  }

  async function init() {
    await Promise.all([loadHeroes(), loadValorantMaps()]);

    if (document.body.classList.contains('control-page')) {
      initControlPage();
    }

    if (document.body.classList.contains('overlay-page')) {
      const stage = document.querySelector('[data-overlay-team]');
      const teamId = stage?.dataset.overlayTeam;
      if (teamId) renderOverlay(teamId);

      if (document.querySelector('[data-scoreboard-role]')) {
        renderScoreboardOverlay();
      }

      if (document.querySelector('[data-valorant-map-veto-overlay]')) {
        renderValorantMapVetoOverlay();
      }

      if (document.querySelector('[data-logo-particle-overlay]')) {
        renderLogoParticleOverlay();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
