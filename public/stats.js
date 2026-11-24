// Onglet « Statistiques » de l'écran d'accueil.
// Script classique chargé après game-client.js. Tout est encapsulé dans une IIFE
// pour ne créer aucune variable globale. Les pseudos viennent des joueurs :
// ils sont TOUJOURS insérés avec textContent, jamais innerHTML.
(function () {
  'use strict';

  const lobby = document.getElementById('lobby');
  const tabPlay = document.getElementById('lobby-tab-play');
  const tabStats = document.getElementById('lobby-tab-stats');
  const playPanel = lobby ? lobby.querySelector('.lobby-form') : null;
  const statsPanel = document.getElementById('stats-panel');
  if (!lobby || !tabPlay || !tabStats || !playPanel || !statsPanel) return;

  const searchInput = document.getElementById('stats-search');
  const refreshBtn = document.getElementById('btn-stats-refresh');
  const statusEl = document.getElementById('stats-status');
  const tableWrap = document.getElementById('stats-table-wrap');
  const tbody = document.getElementById('stats-tbody');
  const headers = Array.from(statsPanel.querySelectorAll('th[data-sort]'));
  const nameInput = document.getElementById('player-name');

  const STATS_HASH = '#stats';
  const SEARCH_DEBOUNCE_MS = 250;
  const DEFAULT_PLAYER_KEY = 'joueur';
  // Sens de tri au premier clic : décroissant pour les nombres, alphabétique pour le pseudo.
  const ASCENDING_FIRST = new Set(['name', 'rank']);

  const state = {
    tab: 'play',
    players: [],
    loaded: false,
    loading: false,
    error: false,
    query: '',
    sortKey: 'rank',
    sortDir: 'asc',
    updatedAt: null,
    controller: null,
    searchTimer: null
  };

  // Même normalisation que le serveur (lib/stats-store.js).
  function normalizeName(raw) {
    return String(raw || '')
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .normalize('NFC');
  }

  function myKey() {
    const key = normalizeName(nameInput ? nameInput.value : '');
    return key && key !== DEFAULT_PLAYER_KEY ? key : '';
  }

  // ---------------------------------------------------------------- onglets

  playPanel.id = playPanel.id || 'lobby-panel-play';
  playPanel.setAttribute('role', 'tabpanel');
  playPanel.setAttribute('aria-labelledby', tabPlay.id);
  tabPlay.setAttribute('aria-controls', playPanel.id);

  function setHash(tab) {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    const wanted = tab === 'stats' ? STATS_HASH : '';
    if (window.location.hash === wanted) return;
    const url = window.location.pathname + window.location.search + wanted;
    try {
      window.history.replaceState(window.history.state, '', url);
    } catch {
      /* rien */
    }
  }

  function selectTab(tab, { updateHash = true, focus = false } = {}) {
    const isStats = tab === 'stats';
    state.tab = isStats ? 'stats' : 'play';
    tabPlay.classList.toggle('is-active', !isStats);
    tabStats.classList.toggle('is-active', isStats);
    tabPlay.setAttribute('aria-selected', String(!isStats));
    tabStats.setAttribute('aria-selected', String(isStats));
    tabPlay.tabIndex = isStats ? -1 : 0;
    tabStats.tabIndex = isStats ? 0 : -1;
    playPanel.classList.toggle('hidden', isStats);
    statsPanel.classList.toggle('hidden', !isStats);
    if (focus) (isStats ? tabStats : tabPlay).focus();
    if (updateHash) setHash(state.tab);
    if (isStats) loadStats();
  }

  tabPlay.addEventListener('click', () => selectTab('play'));
  tabStats.addEventListener('click', () => selectTab('stats'));
  [tabPlay, tabStats].forEach((tab) => {
    tab.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) === -1) return;
      e.preventDefault();
      let next;
      if (e.key === 'Home') next = 'play';
      else if (e.key === 'End') next = 'stats';
      else next = state.tab === 'play' ? 'stats' : 'play';
      selectTab(next, { focus: true });
    });
  });

  window.addEventListener('hashchange', () => {
    const wanted = window.location.hash === STATS_HASH ? 'stats' : 'play';
    if (wanted !== state.tab) selectTab(wanted, { updateHash: false });
  });

  // Retour à l'accueil (fin de partie, salle quittée) : on rafraîchit le classement affiché.
  if (typeof MutationObserver === 'function') {
    let wasHidden = lobby.classList.contains('hidden');
    new MutationObserver(() => {
      const hidden = lobby.classList.contains('hidden');
      if (wasHidden && !hidden && state.tab === 'stats') loadStats();
      wasHidden = hidden;
    }).observe(lobby, { attributes: true, attributeFilter: ['class'] });
  }

  // ---------------------------------------------------------------- données

  async function loadStats() {
    if (state.controller) state.controller.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.controller = controller;
    state.loading = true;
    state.error = false;
    refreshBtn.disabled = true;
    renderStatus();

    const query = state.query;
    const url = '/api/stats' + (query ? '?q=' + encodeURIComponent(query) : '');
    try {
      const res = await fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (state.controller !== controller) return; // réponse périmée
      state.players = Array.isArray(data && data.players) ? data.players.filter(p => p && typeof p.name === 'string') : [];
      state.updatedAt = data && typeof data.updatedAt === 'string' ? data.updatedAt : null;
      state.loaded = true;
      state.loadedQuery = query;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (state.controller !== controller) return;
      state.error = true;
      console.error('[stats] chargement impossible :', err);
    } finally {
      if (state.controller === controller) {
        state.controller = null;
        state.loading = false;
        refreshBtn.disabled = false;
        render();
      }
    }
  }

  refreshBtn.addEventListener('click', () => loadStats());

  searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      const query = searchInput.value.replace(/\s+/g, ' ').trim().slice(0, 20);
      if (query === state.query && state.loaded) return;
      state.query = query;
      loadStats();
    }, SEARCH_DEBOUNCE_MS);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
    }
  });

  if (nameInput) nameInput.addEventListener('input', () => { if (state.loaded) renderRows(); });

  // ---------------------------------------------------------------- tri

  function compareValues(a, b, key) {
    if (key === 'name') return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    const va = typeof a[key] === 'number' ? a[key] : -1; // taux inconnu (null) en dernier
    const vb = typeof b[key] === 'number' ? b[key] : -1;
    return va - vb;
  }

  function sortedPlayers() {
    const { sortKey, sortDir } = state;
    const dir = sortDir === 'asc' ? 1 : -1;
    return state.players.slice().sort((a, b) =>
      dir * compareValues(a, b, sortKey) || (a.rank || 0) - (b.rank || 0));
  }

  headers.forEach((th) => {
    const btn = th.querySelector('button');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        // Troisième clic : retour au classement par défaut.
        const firstDir = ASCENDING_FIRST.has(key) ? 'asc' : 'desc';
        if (state.sortDir !== firstDir) {
          state.sortKey = 'rank';
          state.sortDir = 'asc';
        } else {
          state.sortDir = firstDir === 'asc' ? 'desc' : 'asc';
        }
      } else {
        state.sortKey = key;
        state.sortDir = ASCENDING_FIRST.has(key) ? 'asc' : 'desc';
      }
      renderRows();
    });
  });

  function renderHeaders() {
    headers.forEach((th) => {
      const active = th.dataset.sort === state.sortKey;
      th.classList.toggle('is-sorted', active);
      th.classList.toggle('is-asc', active && state.sortDir === 'asc');
      th.classList.toggle('is-desc', active && state.sortDir === 'desc');
      if (active) th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  // ---------------------------------------------------------------- rendu

  function formatPercent(rate) {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—';
    return Math.round(rate * 100) + ' %';
  }

  function formatTime(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    try {
      return new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function cell(text, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function rateCell(rate, total, label) {
    const td = document.createElement('td');
    td.className = 'stats-rate';
    const value = document.createElement('span');
    value.className = 'stats-rate-value';
    value.textContent = formatPercent(rate);
    td.appendChild(value);
    if (typeof rate === 'number') {
      td.classList.add(rate >= 0.5 ? 'is-good' : 'is-bad');
      const bar = document.createElement('span');
      bar.className = 'stats-rate-bar';
      bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.style.width = Math.max(0, Math.min(100, rate * 100)) + '%';
      bar.appendChild(fill);
      td.appendChild(bar);
      td.title = label + ' : ' + formatPercent(rate) + ' sur ' + total;
    }
    return td;
  }

  function buildRow(player, me) {
    const tr = document.createElement('tr');
    const isMe = !!me && normalizeName(player.name) === me;
    if (isMe) tr.classList.add('is-me');

    const nameTd = document.createElement('th');
    nameTd.scope = 'row';
    nameTd.className = 'stats-col-name';
    const rank = document.createElement('span');
    rank.className = 'stats-rank';
    if (player.rank >= 1 && player.rank <= 3) rank.classList.add('stats-rank-' + player.rank);
    rank.textContent = typeof player.rank === 'number' ? String(player.rank) : '';
    const name = document.createElement('span');
    name.className = 'stats-name';
    name.textContent = player.name; // pseudo : texte uniquement
    name.title = player.name;
    const inner = document.createElement('div');
    inner.className = 'stats-name-cell';
    inner.append(rank, name);
    if (isMe) {
      const badge = document.createElement('span');
      badge.className = 'stats-me-badge';
      badge.textContent = 'Toi';
      inner.appendChild(badge);
    }
    nameTd.appendChild(inner);
    tr.appendChild(nameTd);

    tr.appendChild(cell(String(player.gamesPlayed || 0), 'stats-num'));
    tr.appendChild(cell(String(player.gamesWon || 0), 'stats-num stats-win'));
    tr.appendChild(cell(String(player.gamesLost || 0), 'stats-num stats-loss'));
    tr.appendChild(rateCell(player.winRate, player.gamesPlayed || 0, 'Victoires'));
    tr.appendChild(cell(String(player.contractsMade || 0), 'stats-num stats-win'));
    tr.appendChild(cell(String(player.contractsFailed || 0), 'stats-num stats-loss'));
    tr.appendChild(rateCell(player.contractRate, (player.contractsMade || 0) + (player.contractsFailed || 0), 'Contrats réussis'));
    return tr;
  }

  function renderRows() {
    renderHeaders();
    const me = myKey();
    const frag = document.createDocumentFragment();
    sortedPlayers().forEach((p) => frag.appendChild(buildRow(p, me)));
    tbody.replaceChildren(frag);
    tableWrap.classList.toggle('hidden', state.players.length === 0);
  }

  function renderStatus() {
    statusEl.classList.remove('is-error', 'is-empty');
    if (state.loading && !state.loaded) {
      statusEl.textContent = 'Chargement…';
      return;
    }
    if (state.error) {
      statusEl.classList.add('is-error');
      statusEl.textContent = 'Impossible de charger les statistiques. Réessaie avec « Rafraîchir ».';
      return;
    }
    if (!state.loaded) {
      statusEl.textContent = '';
      return;
    }
    const count = state.players.length;
    if (count === 0) {
      statusEl.classList.add('is-empty');
      statusEl.textContent = state.loadedQuery
        ? 'Aucun joueur ne correspond à « ' + state.loadedQuery + ' ».'
        : 'Aucune partie terminée pour l\'instant';
      return;
    }
    let text = count + (count > 1 ? ' joueurs' : ' joueur');
    const when = formatTime(state.updatedAt);
    if (when) text += ' · dernière mise à jour le ' + when;
    statusEl.textContent = text;
  }

  function render() {
    renderStatus();
    if (state.loaded) renderRows();
    else tableWrap.classList.add('hidden');
  }

  // ---------------------------------------------------------------- démarrage

  tableWrap.classList.add('hidden');
  if (window.location.hash === STATS_HASH) selectTab('stats', { updateHash: false });
})();
