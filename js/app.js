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

  let heroList = [];
  let heroesByName = new Map();

  const defaultState = () => ({
    team1: { ban: '' },
    team2: { ban: '' },
    scoreboard: {
      team1: { name: '', nameDisplayMode: 'text', nameImageUrl: '', nameScale: 0, logo: '', logoScale: 0, score: 0, nameColor: '#e9eefc', bevelColor: '#7dd3fc', nameFont: 'varsity' },
      team2: { name: '', nameDisplayMode: 'text', nameImageUrl: '', nameScale: 0, logo: '', logoScale: 0, score: 0, nameColor: '#e9eefc', bevelColor: '#7dd3fc', nameFont: 'varsity' }
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


  const sanitizeNameDisplayMode = (value) => String(value || '').trim().toLowerCase() === 'image' ? 'image' : 'text';

  const sanitizeImageUrl = (value) => String(value || '').trim();
  const sanitizeNameScale = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(-50, Math.min(50, Math.round(numeric)));
  };

  const sanitizeLogoScale = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(-50, Math.min(50, Math.round(numeric)));
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
          nameDisplayMode: sanitizeNameDisplayMode(payload?.scoreboard?.team1?.nameDisplayMode),
          nameImageUrl: sanitizeImageUrl(payload?.scoreboard?.team1?.nameImageUrl),
          nameScale: sanitizeNameScale(payload?.scoreboard?.team1?.nameScale),
          logo: payload?.scoreboard?.team1?.logo || '',
          logoScale: sanitizeLogoScale(payload?.scoreboard?.team1?.logoScale),
          score: sanitizeScore(payload?.scoreboard?.team1?.score),
          nameColor: sanitizeNameColor(payload?.scoreboard?.team1?.nameColor),
          bevelColor: sanitizeBevelColor(payload?.scoreboard?.team1?.bevelColor),
          nameFont: sanitizeNameFont(payload?.scoreboard?.team1?.nameFont)
        },
        team2: {
          name: payload?.scoreboard?.team2?.name || '',
          nameDisplayMode: sanitizeNameDisplayMode(payload?.scoreboard?.team2?.nameDisplayMode),
          nameImageUrl: sanitizeImageUrl(payload?.scoreboard?.team2?.nameImageUrl),
          nameScale: sanitizeNameScale(payload?.scoreboard?.team2?.nameScale),
          logo: payload?.scoreboard?.team2?.logo || '',
          logoScale: sanitizeLogoScale(payload?.scoreboard?.team2?.logoScale),
          score: sanitizeScore(payload?.scoreboard?.team2?.score),
          nameColor: sanitizeNameColor(payload?.scoreboard?.team2?.nameColor),
          bevelColor: sanitizeBevelColor(payload?.scoreboard?.team2?.bevelColor),
          nameFont: sanitizeNameFont(payload?.scoreboard?.team2?.nameFont)
        }
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

  async function readBridgeState() {
    try {
      const response = await fetch(BRIDGE_STATE_URL, { cache: 'no-store' });
      if (!response.ok) return null;
      const payload = await response.json();
      return {
        state: sanitizeState(payload),
        hasScoreboard: bridgeHasScoreboard(payload)
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
        const nameMode = sanitizeNameDisplayMode(scoreboardTeam.nameDisplayMode);
        const imageUrl = sanitizeImageUrl(scoreboardTeam.nameImageUrl);
        const useImage = nameMode === 'image' && Boolean(imageUrl);
        const nameScaleAmount = sanitizeNameScale(scoreboardTeam.nameScale);
        valueNode.style.setProperty('--scoreboard-name-scale', String((100 + nameScaleAmount) / 100));

        valueNode.classList.remove('is-font-varsity', 'is-font-block', 'is-font-classic', 'is-font-custom', 'is-image');
        valueNode.style.removeProperty('--scoreboard-custom-font-family');

        if (useImage) {
          valueNode.textContent = '';
          const imageNode = document.createElement('img');
          imageNode.className = 'scoreboard-name-image';
          imageNode.alt = scoreboardTeam.name || 'Team name image';
          imageNode.src = imageUrl;
          valueNode.appendChild(imageNode);
          valueNode.classList.add('is-image');
        } else {
          valueNode.textContent = scoreboardTeam.name || 'TEAM';
          valueNode.style.setProperty('--scoreboard-name-color', sanitizeNameColor(scoreboardTeam.nameColor));
          valueNode.style.setProperty('--scoreboard-name-bevel-color', sanitizeBevelColor(scoreboardTeam.bevelColor));

          const fontToken = sanitizeNameFont(scoreboardTeam.nameFont);
          if (BUILTIN_FONT_VALUES.has(fontToken)) {
            valueNode.classList.add(`is-font-${fontToken}`);
          } else if (fontToken.startsWith('file:')) {
            const family = await ensureCustomFontLoaded(fontToken);
            if (family) {
              valueNode.classList.add('is-font-custom');
              valueNode.style.setProperty('--scoreboard-custom-font-family', `${family}, "Impact", "Arial Black", sans-serif`);
            } else {
              valueNode.classList.add('is-font-varsity');
            }
          } else {
            valueNode.classList.add('is-font-varsity');
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
      const scoreboardTeam = state?.scoreboard?.[team] || { name: '', nameDisplayMode: 'text', nameImageUrl: '', nameScale: 0, logo: '', logoScale: 0, score: 0, nameColor: '#e9eefc', bevelColor: '#7dd3fc', nameFont: 'varsity' };
      const signature = `${scoreboardTeam.name}|${scoreboardTeam.nameDisplayMode}|${scoreboardTeam.nameImageUrl}|${scoreboardTeam.nameScale}|${scoreboardTeam.logo}|${scoreboardTeam.logoScale}|${scoreboardTeam.score}|${scoreboardTeam.nameColor}|${scoreboardTeam.bevelColor}|${scoreboardTeam.nameFont}|${state.updatedAt}`;
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

  async function initScoreboardControl(pendingState, syncInputs) {
    const fieldMap = {
      team1: {
        name: document.getElementById('score-team1-name'),
        nameUseImage: document.getElementById('score-team1-name-use-image'),
        nameScale: document.getElementById('score-team1-name-scale'),
        nameScaleValue: document.getElementById('score-team1-name-scale-value'),
        logo: document.getElementById('score-team1-logo'),
        logoScale: document.getElementById('score-team1-logo-scale'),
        logoScaleValue: document.getElementById('score-team1-logo-scale-value'),
        nameColor: document.getElementById('score-team1-name-color'),
        bevelColor: document.getElementById('score-team1-bevel-color'),
        nameFont: document.getElementById('score-team1-font')
      },
      team2: {
        name: document.getElementById('score-team2-name'),
        nameUseImage: document.getElementById('score-team2-name-use-image'),
        nameScale: document.getElementById('score-team2-name-scale'),
        nameScaleValue: document.getElementById('score-team2-name-scale-value'),
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

    if (!fieldMap.team1.name || !fieldMap.team2.name || !fieldMap.team1.nameUseImage || !fieldMap.team2.nameUseImage || !fieldMap.team1.nameScale || !fieldMap.team2.nameScale || !updateButton || !swapButton || !fieldMap.team1.logoScale || !fieldMap.team2.logoScale || !fieldMap.team1.nameColor || !fieldMap.team2.nameColor || !fieldMap.team1.bevelColor || !fieldMap.team2.bevelColor || !fieldMap.team1.nameFont || !fieldMap.team2.nameFont) return;

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
      } else if (key === 'nameDisplayMode') {
        pendingState.scoreboard[teamId][key] = sanitizeNameDisplayMode(value);
      } else if (key === 'nameImageUrl') {
        pendingState.scoreboard[teamId][key] = sanitizeImageUrl(value);
      } else if (key === 'nameScale') {
        pendingState.scoreboard[teamId][key] = sanitizeNameScale(value);
        if (fieldMap[teamId].nameScaleValue) {
          fieldMap[teamId].nameScaleValue.textContent = String(pendingState.scoreboard[teamId][key]);
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
        const isImageMode = fieldMap[teamId].nameUseImage.checked;
        handleInput(teamId, isImageMode ? 'nameImageUrl' : 'name', event.target.value);
      });
      fieldMap[teamId].nameUseImage.addEventListener('change', (event) => {
        const nextMode = event.target.checked ? 'image' : 'text';
        handleInput(teamId, 'nameDisplayMode', nextMode);
        syncInputs();
      });
      const onNameScaleChange = (event) => {
        handleInput(teamId, 'nameScale', event.target.value);
      };
      fieldMap[teamId].nameScale.addEventListener('input', onNameScaleChange);
      fieldMap[teamId].nameScale.addEventListener('change', onNameScaleChange);
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
        const nameUseImageInput = document.getElementById(`${teamPrefix}-name-use-image`);
        const logoInput = document.getElementById(`${teamPrefix}-logo`);
        const nameScaleInput = document.getElementById(`${teamPrefix}-name-scale`);
        const nameScaleValue = document.getElementById(`${teamPrefix}-name-scale-value`);
        const logoScaleInput = document.getElementById(`${teamPrefix}-logo-scale`);
        const logoScaleValue = document.getElementById(`${teamPrefix}-logo-scale-value`);
        const scoreInput = document.getElementById(`ticker-${teamId}-score`);
        const colorInput = document.getElementById(`${teamPrefix}-name-color`);
        const bevelColorInput = document.getElementById(`${teamPrefix}-bevel-color`);
        const fontInput = document.getElementById(`${teamPrefix}-font`);
        const nameMode = sanitizeNameDisplayMode(pendingState.scoreboard[teamId].nameDisplayMode);
        const imageMode = nameMode === 'image';
        if (nameInput) {
          nameInput.value = imageMode ? sanitizeImageUrl(pendingState.scoreboard[teamId].nameImageUrl) : (pendingState.scoreboard[teamId].name || '');
          nameInput.placeholder = imageMode ? 'https://.../team-name.png' : `Enter ${teamId === 'team1' ? 'Team 1' : 'Team 2'} name`;
        }
        if (nameUseImageInput) nameUseImageInput.checked = imageMode;
        const cleanNameScale = sanitizeNameScale(pendingState.scoreboard[teamId].nameScale);
        if (nameScaleInput) nameScaleInput.value = String(cleanNameScale);
        if (nameScaleValue) nameScaleValue.textContent = String(cleanNameScale);
        if (logoInput) logoInput.value = pendingState.scoreboard[teamId].logo || '';
        const cleanLogoScale = sanitizeLogoScale(pendingState.scoreboard[teamId].logoScale);
        if (logoScaleInput) logoScaleInput.value = String(cleanLogoScale);
        if (logoScaleValue) logoScaleValue.textContent = String(cleanLogoScale);
        if (scoreInput) scoreInput.value = String(sanitizeScore(pendingState.scoreboard[teamId].score));
        if (colorInput) colorInput.value = sanitizeNameColor(pendingState.scoreboard[teamId].nameColor);
        if (bevelColorInput) bevelColorInput.value = sanitizeBevelColor(pendingState.scoreboard[teamId].bevelColor);
        if (fontInput) fontInput.value = sanitizeNameFont(pendingState.scoreboard[teamId].nameFont);
      });
    };

    initTabs();
    installSearchForTeam('team1', { pendingState, syncInputs });
    installSearchForTeam('team2', { pendingState, syncInputs });
    await initScoreboardControl(pendingState, syncInputs);
    initScoreTickerControl(pendingState, syncInputs);

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
        pendingState.team1.ban = empty.team1.ban;
        pendingState.team2.ban = empty.team2.ban;
        pendingState.scoreboard.team1 = { ...empty.scoreboard.team1 };
        pendingState.scoreboard.team2 = { ...empty.scoreboard.team2 };
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
      syncInputs();
    });
  }

  async function init() {
    await loadHeroes();

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
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
