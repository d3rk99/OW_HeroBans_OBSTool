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

  let heroList = [];
  let heroesByName = new Map();
  let valorantMaps = [];
  let valorantMapsByUuid = new Map();
  let valorantMapUuidByName = new Map();

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

  function normalizeValorantMap(record) {
    if (!record || typeof record !== 'object') return null;
    const uuid = String(record.uuid || '').trim();
    const displayName = String(record.displayName || '').trim();
    if (!uuid || !displayName) return null;

    const listViewIcon = typeof record.listViewIcon === 'string' && record.listViewIcon.trim() ? record.listViewIcon.trim() : '';
    const splash = typeof record.splash === 'string' && record.splash.trim() ? record.splash.trim() : '';
    const displayIcon = typeof record.displayIcon === 'string' && record.displayIcon.trim() ? record.displayIcon.trim() : '';

    return { uuid, displayName, listViewIcon, splash, displayIcon };
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

  function getValorantMapImage(map) {
    if (!map) return '';
    return map.splash || map.listViewIcon || map.displayIcon || '';
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

  async function readBridgeState() {
    try {
      const response = await fetch(BRIDGE_STATE_URL, { cache: 'no-store' });
      if (!response.ok) return null;
      const payload = await response.json();
      return {
        state: sanitizeState(payload),
        hasScoreboard: bridgeHasScoreboard(payload),
        hasValorantMapVeto: bridgeHasValorantMapVeto(payload)
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

  function initValorantMapVetoControl(pendingState, syncInputs) {
    const fields = VETO_FIELD_IDS.reduce((collection, fieldId) => {
      collection[fieldId] = document.getElementById(`valorant-${fieldId}`);
      return collection;
    }, {});

    if (VETO_FIELD_IDS.some((fieldId) => !fields[fieldId])) return;

    const renderOptions = (selectNode) => {
      selectNode.innerHTML = '';
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '—';
      selectNode.appendChild(emptyOption);

      valorantMaps.forEach((map) => {
        const option = document.createElement('option');
        option.value = map.uuid;
        option.textContent = map.displayName;
        selectNode.appendChild(option);
      });
    };

    VETO_FIELD_IDS.forEach((fieldId) => {
      renderOptions(fields[fieldId]);
      fields[fieldId].addEventListener('change', (event) => {
        pendingState.valorantMapVeto[fieldId] = sanitizeValorantMapSelection(event.target.value);
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
        syncInputs();
        writeState(pendingState);
      });
    }
  }

  function renderValorantMapVetoOverlay() {
    const overlay = document.querySelector('[data-valorant-map-veto-overlay]');
    if (!overlay) return;

    const cards = Array.from(overlay.querySelectorAll('[data-veto-card]'));
    let lastSignature = '';

    const pickSlots = ['pick1', 'pick2', 'pick3'];
    const banSlots = ['ban1', 'ban2', 'ban3', 'ban4'];

    const applyBackground = (node, type, imageUrl) => {
      if (!node) return;
      const base = type === 'ban'
        ? 'linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.90))'
        : 'linear-gradient(rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.85))';

      if (imageUrl) {
        node.style.backgroundImage = `${base}, url("${imageUrl}")`;
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
        const imageUrl = getValorantMapImage(map);
        applyBackground(half, 'ban', imageUrl);
      });

      pickSlots.forEach((fieldId) => {
        const node = overlay.querySelector(`[data-pick-value='${fieldId}']`);
        const card = node?.closest('.valorant-pick-card');
        const map = getValorantMapByUuid(state.valorantMapVeto[fieldId]);
        const displayName = map?.displayName || '';
        if (node) {
          node.textContent = displayName;
          node.classList.toggle('is-visible', Boolean(displayName));
        }
        const imageUrl = getValorantMapImage(map);
        applyBackground(card, 'pick', imageUrl);
      });
    };

    const preloadSelected = (vetoState) => {
      VETO_FIELD_IDS.forEach((fieldId) => {
        const map = getValorantMapByUuid(vetoState[fieldId]);
        preload(getValorantMapImage(map));
      });
    };

    const applyState = async () => {
      const state = await readSharedState();
      const vetoState = state?.valorantMapVeto || defaultState().valorantMapVeto;
      const signature = `${vetoState.ban1}|${vetoState.ban2}|${vetoState.pick1}|${vetoState.pick2}|${vetoState.ban3}|${vetoState.ban4}|${vetoState.pick3}|${state.updatedAt}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      preloadSelected(vetoState);
      updateCardContent(state);
    };

    setTimeout(() => {
      cards.forEach((card, index) => {
        setTimeout(() => {
          card.classList.add('is-visible');
        }, index * 120);
      });
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

      VETO_FIELD_IDS.forEach((fieldId) => {
        const selectNode = document.getElementById(`valorant-${fieldId}`);
        if (!selectNode) return;
        selectNode.value = sanitizeValorantMapSelection(pendingState.valorantMapVeto[fieldId]);
      });
    };

    initTabs();
    installSearchForTeam('team1', { pendingState, syncInputs });
    installSearchForTeam('team2', { pendingState, syncInputs });
    await initScoreboardControl(pendingState, syncInputs);
    initScoreTickerControl(pendingState, syncInputs);
    initValorantMapVetoControl(pendingState, syncInputs);

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
        } else if (activeTabId === 'valorant-map-veto-tab') {
          pendingState.valorantMapVeto = { ...empty.valorantMapVeto };
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
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
