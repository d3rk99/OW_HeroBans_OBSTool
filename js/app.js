(() => {
  const STATE_KEY = 'ow2_bans_state';
  const STATE_ENDPOINT = './state';
  const HEROES_PATH = './data/heroes.json';
  const HERO_IMAGE_BASE = './assets/';
  const OVERLAY_POLL_MS = 500;
  const FADE_TRANSITION_MS = 260;

  let heroList = [];
  let heroesByName = new Map();

  const defaultState = () => ({
    team1: { ban: '' },
    team2: { ban: '' },
    updatedAt: Date.now()
  });

  const normalize = (value) => (value || '').trim().toLowerCase();

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

  const storageMode = (() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('server') === '1') return 'server';
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      return 'server';
    }
    return 'local';
  })();

  function normalizeState(parsed) {
    return {
      team1: { ban: parsed?.team1?.ban || '' },
      team2: { ban: parsed?.team2?.ban || '' },
      updatedAt: Number(parsed?.updatedAt) || Date.now()
    };
  }

  function readLocalState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return defaultState();

    try {
      return normalizeState(JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  function writeLocalState(nextState) {
    const payload = normalizeState({ ...nextState, updatedAt: Date.now() });
    localStorage.setItem(STATE_KEY, JSON.stringify(payload));
    return payload;
  }

  async function readServerState() {
    try {
      const response = await fetch(STATE_ENDPOINT, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to load state (${response.status})`);
      }
      const data = await response.json();
      return normalizeState(data);
    } catch (error) {
      console.warn('Server state unavailable, falling back to local.', error);
      return readLocalState();
    }
  }

  async function writeServerState(nextState) {
    const payload = normalizeState({ ...nextState, updatedAt: Date.now() });
    try {
      const response = await fetch(STATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Failed to save state (${response.status})`);
      }
      return payload;
    } catch (error) {
      console.warn('Server state save failed, writing local.', error);
      return writeLocalState(payload);
    }
  }

  function readState() {
    return storageMode === 'server' ? readServerState() : Promise.resolve(readLocalState());
  }

  function writeState(nextState) {
    return storageMode === 'server' ? writeServerState(nextState) : Promise.resolve(writeLocalState(nextState));
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
      const state = await readState();
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

    if (storageMode === 'local') {
      window.addEventListener('storage', (event) => {
        if (event.key === STATE_KEY) applyState();
      });
    }
    setInterval(applyState, OVERLAY_POLL_MS);
  }

  async function initControlPage() {
    const pendingState = await readState();

    const syncInputs = () => {
      ['team1', 'team2'].forEach((teamId) => {
        const input = document.getElementById(`${teamId}-search`);
        const preview = document.getElementById(`${teamId}-preview`);
        if (input) input.value = pendingState[teamId].ban || '';
        if (preview) setPreviewCard(preview, pendingState[teamId].ban || '');
      });
    };

    installSearchForTeam('team1', { pendingState, syncInputs });
    installSearchForTeam('team2', { pendingState, syncInputs });

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
        syncInputs();
        writeState(pendingState);
      });
    }

    if (storageMode === 'local') {
      window.addEventListener('storage', async (event) => {
        if (event.key !== STATE_KEY) return;
        const next = await readState();
        pendingState.team1.ban = next.team1.ban;
        pendingState.team2.ban = next.team2.ban;
        syncInputs();
      });
    }

    if (storageMode === 'server') {
      setInterval(async () => {
        const next = await readState();
        if (
          next.team1.ban !== pendingState.team1.ban ||
          next.team2.ban !== pendingState.team2.ban
        ) {
          pendingState.team1.ban = next.team1.ban;
          pendingState.team2.ban = next.team2.ban;
          syncInputs();
        }
      }, OVERLAY_POLL_MS);
    }
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
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
