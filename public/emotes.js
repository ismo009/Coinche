// Cari'Coinche — emotes en image.
// Script classique chargé après game-client.js : utilise les globales socket, gameState,
// getAbsToVisual(), isPhoneUi() et uiHooks.afterUpdate.
(function () {
  'use strict';

  const EMOTE_LIFETIME_MS = 2500;
  const EMOTE_LEAVE_MS = 280;
  const SEND_COOLDOWN_MS = 1500;
  const EMOTE_ID_REGEX = /^[a-z0-9_-]{1,40}$/;
  const VIEW_MARGIN = 8;

  let emoteList = null; // [{ id, label, url }] (dernière liste reçue du serveur)
  let fetchPromise = null;
  let panel = null;
  let grid = null;
  let panelAnchor = null;
  let lastSentAt = 0;
  let cooldownTimer = null;
  const buttons = [];
  const shown = new Map(); // position absolue -> { el, timers }

  // ---------------------------------------------------------------- liste des emotes

  function sanitizeList(data) {
    const raw = Array.isArray(data?.emotes) ? data.emotes : [];
    return raw.filter(e => e && EMOTE_ID_REGEX.test(e.id) && typeof e.url === 'string')
      .map(e => ({ id: e.id, label: typeof e.label === 'string' && e.label ? e.label : e.id, url: e.url }));
  }

  function fetchEmotes() {
    if (fetchPromise) return fetchPromise;
    fetchPromise = fetch('/api/emotes', { cache: 'no-cache' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => {
        emoteList = sanitizeList(data);
        return emoteList;
      })
      .catch(err => {
        console.warn('[emotes] liste indisponible :', err);
        return emoteList || [];
      })
      .finally(() => {
        fetchPromise = null;
      });
    return fetchPromise;
  }

  function emoteUrl(id) {
    const known = emoteList && emoteList.find(e => e.id === id);
    return known ? known.url : `/emotes/${id}.png`;
  }

  function emoteLabel(id) {
    const known = emoteList && emoteList.find(e => e.id === id);
    return known ? known.label : id;
  }

  // ---------------------------------------------------------------- boutons

  function createButton(id, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = `btn btn-secondary btn-sm emote-btn ${extraClass}`.trim();
    btn.textContent = 'Emotes';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'emote-panel');
    btn.setAttribute('aria-label', 'Envoyer une emote');
    btn.addEventListener('click', () => togglePanel(btn));
    buttons.push(btn);
    return btn;
  }

  function installButtons() {
    // Table de jeu : dans la barre du haut sur téléphone (avant "Chat"), bouton fixe sur desktop.
    const hud = document.getElementById('hud-actions');
    if (hud) {
      const btn = createButton('btn-emotes', 'hud-btn');
      const chatBtn = document.getElementById('btn-chat-open');
      hud.insertBefore(btn, chatBtn && chatBtn.parentElement === hud ? chatBtn : null);
    }

    // Salle d'attente : sous la grille des sièges.
    const waiting = document.querySelector('#waiting-room .waiting-container');
    if (waiting) {
      const row = document.createElement('div');
      row.className = 'emote-waiting-row';
      row.appendChild(createButton('btn-emotes-waiting', ''));
      const teamInfo = waiting.querySelector('.team-info');
      waiting.insertBefore(row, teamInfo ? teamInfo.nextSibling : null);
    }
  }

  function setCooling(active) {
    for (const btn of buttons) btn.classList.toggle('is-cooling', active);
    if (grid) grid.classList.toggle('is-cooling', active);
  }

  // ---------------------------------------------------------------- panneau

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'emote-panel';
    panel.className = 'emote-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Choisir une emote');

    const title = document.createElement('div');
    title.className = 'emote-panel-title';
    title.textContent = 'Emotes';
    panel.appendChild(title);

    grid = document.createElement('div');
    grid.className = 'emote-grid';
    panel.appendChild(grid);
    document.body.appendChild(panel);
  }

  function renderGrid(list) {
    grid.replaceChildren();
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'emote-empty';
      empty.textContent = emoteList ? 'Aucune emote disponible.' : 'Chargement...';
      grid.appendChild(empty);
      return;
    }
    for (const emote of list) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'emote-item';
      item.title = emote.label;
      item.setAttribute('aria-label', `Emote ${emote.label}`);
      const img = document.createElement('img');
      img.src = emote.url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.width = 256;
      img.height = 256;
      const label = document.createElement('span');
      label.className = 'emote-item-label';
      label.textContent = emote.label;
      item.append(img, label);
      item.addEventListener('click', () => sendEmote(emote.id));
      grid.appendChild(item);
    }
  }

  function isVisible(el) {
    return !!el && el.getClientRects().length > 0;
  }

  function placePanel() {
    if (!panel || panel.hidden || !panelAnchor) return;
    const anchor = panelAnchor.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    // Ouvre vers le bas si le bouton est dans la moitié haute de l'écran, sinon vers le haut.
    let top = anchor.top + anchor.height / 2 < vh / 2 ? anchor.bottom + 10 : anchor.top - h - 10;
    top = Math.max(VIEW_MARGIN, Math.min(top, vh - h - VIEW_MARGIN));
    let left = anchor.left + anchor.width / 2 - w / 2;
    left = Math.max(VIEW_MARGIN, Math.min(left, vw - w - VIEW_MARGIN));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function openPanel(btn) {
    if (!panel) buildPanel();
    panelAnchor = btn;
    const before = JSON.stringify(emoteList);
    renderGrid(emoteList || []);
    panel.hidden = false;
    for (const b of buttons) b.setAttribute('aria-expanded', b === btn ? 'true' : 'false');
    placePanel();
    // La liste est relue à chaque ouverture (le serveur rescanne le dossier quand il change).
    fetchEmotes().then(list => {
      if (panel.hidden || panelAnchor !== btn) return;
      if (JSON.stringify(list) !== before) {
        renderGrid(list);
        placePanel();
      }
      const first = grid.querySelector('.emote-item');
      if (first && document.activeElement === btn) first.focus({ preventScroll: true });
    });
  }

  function closePanel({ restoreFocus = false } = {}) {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    for (const b of buttons) b.setAttribute('aria-expanded', 'false');
    if (restoreFocus && panelAnchor && isVisible(panelAnchor)) panelAnchor.focus({ preventScroll: true });
    panelAnchor = null;
  }

  function togglePanel(btn) {
    if (panel && !panel.hidden && panelAnchor === btn) closePanel();
    else openPanel(btn);
  }

  function sendEmote(id) {
    closePanel({ restoreFocus: true });
    const now = Date.now();
    if (now - lastSentAt < SEND_COOLDOWN_MS) return;
    lastSentAt = now;
    socket.emit('emote', { id });
    setCooling(true);
    clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(() => setCooling(false), SEND_COOLDOWN_MS);
  }

  document.addEventListener('pointerdown', (e) => {
    if (!panel || panel.hidden) return;
    if (panel.contains(e.target)) return;
    if (buttons.some(b => b.contains(e.target))) return; // le bouton gère lui-même l'ouverture/fermeture
    closePanel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && !panel.hidden) {
      e.preventDefault();
      closePanel({ restoreFocus: true });
    }
  });

  // ---------------------------------------------------------------- affichage au-dessus des sièges

  function isScreenVisible(id) {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains('hidden');
  }

  function getSeatElement(position) {
    if (isScreenVisible('waiting-room')) return document.getElementById(`slot-${position}`);
    if (isScreenVisible('game-table')) {
      const visual = getAbsToVisual()[position];
      const name = visual && document.getElementById(`name-${visual}`);
      return name ? name.parentElement : null;
    }
    return null;
  }

  function minTop() {
    // Sur téléphone, ne pas passer sous la barre du haut (HUD).
    if (!isPhoneUi() || !isScreenVisible('game-table')) return VIEW_MARGIN;
    const hud = document.getElementById('mobile-top-panel');
    const rect = hud && hud.getBoundingClientRect();
    return rect && rect.height ? rect.bottom + 4 : VIEW_MARGIN;
  }

  function overlaps(a, b) {
    return a.left < b.left + b.size && b.left < a.left + a.size && a.top < b.top + b.size && b.top < a.top + a.size;
  }

  // Place la bulle près du siège : au-dessus de préférence, sinon en dessous, à droite ou à gauche,
  // en restant dans l'écran et sans recouvrir l'emote d'un autre siège. Retourne la position retenue, ou null si le siège est introuvable.
  function placeBubble(position, el) {
    const seat = getSeatElement(position);
    if (!seat || !isVisible(seat)) return null;
    const rect = seat.getBoundingClientRect();
    const size = el.offsetWidth || (isPhoneUi() ? 96 : 120);
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const topLimit = minTop();
    const clampX = (x) => Math.max(VIEW_MARGIN, Math.min(x, vw - size - VIEW_MARGIN));
    const clampY = (y) => Math.max(topLimit, Math.min(y, vh - size - VIEW_MARGIN));
    const cx = rect.left + rect.width / 2 - size / 2;
    const cy = rect.top + rect.height / 2 - size / 2;

    const candidates = [
      { left: clampX(cx), top: rect.top - size - 4 },   // au-dessus
      { left: clampX(cx), top: rect.bottom + 4 },       // en dessous
      { left: rect.right + 6, top: clampY(cy) },        // à droite
      { left: rect.left - size - 6, top: clampY(cy) }   // à gauche
    ].map(c => ({ ...c, size }));
    const inView = candidates.filter(c => c.left >= VIEW_MARGIN && c.left + size <= vw - VIEW_MARGIN
      && c.top >= topLimit && c.top + size <= vh - VIEW_MARGIN);
    const others = [];
    for (const [pos, entry] of shown) {
      if (pos !== position && entry.el !== el && entry.box) others.push(entry.box);
    }
    const box = inView.find(c => !others.some(o => overlaps(c, o)))
      || inView[0]
      || { left: clampX(cx), top: clampY(candidates[0].top), size };

    el.style.left = `${Math.round(box.left)}px`;
    el.style.top = `${Math.round(box.top)}px`;
    return box;
  }

  function removeBubble(position) {
    const entry = shown.get(position);
    if (!entry) return;
    entry.timers.forEach(clearTimeout);
    entry.el.remove();
    shown.delete(position);
  }

  function showEmote(position, id) {
    if (!['sud', 'ouest', 'nord', 'est'].includes(position) || !EMOTE_ID_REGEX.test(id)) return;
    removeBubble(position); // une seule emote à la fois par siège

    const el = document.createElement('div');
    el.className = 'emote-bubble';
    el.setAttribute('role', 'img');
    const playerName = gameState?.players?.[position]?.name;
    el.setAttribute('aria-label', `${playerName || position} : ${emoteLabel(id)}`);
    const img = document.createElement('img');
    img.src = emoteUrl(id);
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    el.appendChild(img);
    document.body.appendChild(el);

    const box = placeBubble(position, el);
    if (!box) {
      el.remove();
      return;
    }

    const entry = { el, box, timers: [] };
    entry.timers.push(setTimeout(() => el.classList.add('is-leaving'), EMOTE_LIFETIME_MS - EMOTE_LEAVE_MS));
    entry.timers.push(setTimeout(() => {
      if (shown.get(position) === entry) shown.delete(position);
      el.remove();
    }, EMOTE_LIFETIME_MS));
    shown.set(position, entry);
  }

  function repositionAll() {
    for (const [position, entry] of shown) {
      const box = placeBubble(position, entry.el);
      if (box) entry.box = box;
      else removeBubble(position);
    }
    if (panel && !panel.hidden) {
      if (!panelAnchor || !isVisible(panelAnchor)) closePanel();
      else placePanel();
    }
  }

  // ---------------------------------------------------------------- branchements

  installButtons();
  socket.on('emote', (data) => {
    if (!data || typeof data !== 'object') return;
    showEmote(data.position, data.id);
  });
  uiHooks.afterUpdate.push(repositionAll);
  window.addEventListener('resize', repositionAll);
  // Précharge la liste (légère) pour connaître les libellés ; les images ne sont chargées qu'à l'ouverture.
  fetchEmotes();
})();
