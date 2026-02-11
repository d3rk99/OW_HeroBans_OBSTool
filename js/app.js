(() => {
  const STATE_KEY = 'ow2_bans_state';
  const HEROES_PATH = './data/heroes.json';
  const HERO_IMAGE_BASE = './assets/';
  const OVERLAY_POLL_MS = 500;
  const FADE_TRANSITION_MS = 260;
  const BRIDGE_STATE_URL = 'http://127.0.0.1:8765/api/state';

  let heroList = [];
  let heroesByName = new Map();

  const defaultState = () => ({
    team1: { ban: '' },
    team2: { ban: '' },
    scoreboard: {
      team1: { name: '', logo: '', score: 0, nameColor: '#e9eefc', nameFont: 'varsity' },
      team2: { name: '', logo: '', score: 0, nameColor: '#e9eefc', nameFont: 'varsity' }
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

  const sanitizeNameFont = (value) => {
    const allowed = new Set(['varsity', 'block', 'classic']);
    return allowed.has(value) ? value : 'varsity';
  };

  function sanitizeState(payload) {
    return {
      team1: { ban: payload?.team1?.ban || '' },
      team2: { ban: payload?.team2?.ban || '' },
      scoreboard: {
        team1: {
          name: payload?.scoreboard?.team1?.name || '',
          logo: payload?.scoreboard?.team1?.logo || '',
          score: sanitizeScore(payload?.scoreboard?.team1?.score),
          nameColor: sanitizeNameColor(payload?.scoreboard?.team1?.nameColor),
          nameFont: sanitizeNameFont(payload?.scoreboard?.team1?.nameFont)
        },
        team2: {
          name: payload?.scoreboard?.team2?.name || '',
          logo: payload?.scoreboard?.team2?.logo || '',
          score: sanitizeScore(payload?.scoreboard?.team2?.score),
          nameColor: sanitizeNameColor(payload?.scoreboard?.team2?.nameColor),
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

    const paint = (scoreboardTeam) => {
      if (role === 'name') {
        valueNode.textContent = scoreboardTeam.name || 'TEAM';
        valueNode.style.setProperty('--scoreboard-name-color', sanitizeNameColor(scoreboardTeam.nameColor));
        valueNode.classList.remove('is-font-varsity', 'is-font-block', 'is-font-classic');
        valueNode.classList.add(`is-font-${sanitizeNameFont(scoreboardTeam.nameFont)}`);
      } else if (role === 'logo') {
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
      const scoreboardTeam = state?.scoreboard?.[team] || { name: '', logo: '', score: 0, nameColor: '#e9eefc', nameFont: 'varsity' };
      const signature = `${scoreboardTeam.name}|${scoreboardTeam.logo}|${scoreboardTeam.score}|${scoreboardTeam.nameColor}|${scoreboardTeam.nameFont}|${state.updatedAt}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      paint(scoreboardTeam);
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

  function initScoreboardControl(pendingState, syncInputs) {
    const fieldMap = {
      team1: {
        name: document.getElementById('score-team1-name'),
        logo: document.getElementById('score-team1-logo'),
        score: document.getElementById('score-team1-score'),
        nameColor: document.getElementById('score-team1-name-color'),
        nameFont: document.getElementById('score-team1-font')
      },
      team2: {
        name: document.getElementById('score-team2-name'),
        logo: document.getElementById('score-team2-logo'),
        score: document.getElementById('score-team2-score'),
        nameColor: document.getElementById('score-team2-name-color'),
        nameFont: document.getElementById('score-team2-font')
      }
    };

    const updateButton = document.getElementById('scoreboard-update');
    const swapButton = document.getElementById('scoreboard-swap');

    if (!fieldMap.team1.name || !fieldMap.team2.name || !updateButton || !swapButton || !fieldMap.team1.nameColor || !fieldMap.team2.nameColor || !fieldMap.team1.nameFont || !fieldMap.team2.nameFont) return;

    const handleInput = (teamId, key, value) => {
      if (key === 'score') {
        pendingState.scoreboard[teamId][key] = sanitizeScore(value);
      } else if (key === 'nameColor') {
        pendingState.scoreboard[teamId][key] = sanitizeNameColor(value);
      } else if (key === 'nameFont') {
        pendingState.scoreboard[teamId][key] = sanitizeNameFont(value);
      } else {
        pendingState.scoreboard[teamId][key] = value.trim();
      }
    };

    ['team1', 'team2'].forEach((teamId) => {
      fieldMap[teamId].name.addEventListener('input', (event) => {
        handleInput(teamId, 'name', event.target.value);
      });
      fieldMap[teamId].logo.addEventListener('input', (event) => {
        handleInput(teamId, 'logo', event.target.value);
      });
      fieldMap[teamId].score.addEventListener('input', (event) => {
        handleInput(teamId, 'score', event.target.value);
      });
      fieldMap[teamId].nameColor.addEventListener('input', (event) => {
        handleInput(teamId, 'nameColor', event.target.value);
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
        const logoInput = document.getElementById(`${teamPrefix}-logo`);
        const scoreInput = document.getElementById(`${teamPrefix}-score`);
        const colorInput = document.getElementById(`${teamPrefix}-name-color`);
        const fontInput = document.getElementById(`${teamPrefix}-font`);
        if (nameInput) nameInput.value = pendingState.scoreboard[teamId].name || '';
        if (logoInput) logoInput.value = pendingState.scoreboard[teamId].logo || '';
        if (scoreInput) scoreInput.value = String(sanitizeScore(pendingState.scoreboard[teamId].score));
        if (colorInput) colorInput.value = sanitizeNameColor(pendingState.scoreboard[teamId].nameColor);
        if (fontInput) fontInput.value = sanitizeNameFont(pendingState.scoreboard[teamId].nameFont);
      });
    };

    initTabs();
    installSearchForTeam('team1', { pendingState, syncInputs });
    installSearchForTeam('team2', { pendingState, syncInputs });
    initScoreboardControl(pendingState, syncInputs);

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
