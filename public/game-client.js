// ============================================================
// Coinche - Client-side
// ============================================================

const socket = io();

// State
let myPosition = null;
let myRoom = null;
let gameState = null;

// Trick collect animation (UX): wait 0.2s then slide cards to trick winner.
const TRICK_COLLECT_DELAY_MS = 200;
const TRICK_COLLECT_ANIM_MS = 500;

// Card play animation (hand -> center)
const PLAY_CARD_ANIM_MS = 350;

let playCardAnim = {
  running: false,
  pendingKey: null,
  timer: null,
  suppressEntranceKey: null
};

let trickCollect = {
  running: false,
  queuedState: null,
  lastAnimatedSig: null,
  timers: []
};

// DOM elements
const screens = {
  lobby: document.getElementById('lobby'),
  waiting: document.getElementById('waiting-room'),
  game: document.getElementById('game-table')
};

const chatElements = {
  container: document.getElementById('chat-messages'),
  input: document.getElementById('chat-input'),
  send: document.getElementById('btn-chat-send')
};

const chatUi = {
  panel: document.getElementById('chat-panel'),
  openBtn: document.getElementById('btn-chat-open'),
  closeBtn: document.getElementById('btn-chat-close')
};

const CHAT_MAX_MESSAGES = 120;
const PANEL_POS_STORAGE_PREFIX = 'coinche-panel-pos:';

function isMobilePortraitGameplay() {
  // Matches the CSS breakpoint used for portrait-phone gameplay overrides.
  return window.matchMedia && window.matchMedia('(max-width: 600px) and (orientation: portrait)').matches;
}

function isPhoneUi() {
  return window.matchMedia && window.matchMedia('(max-width: 600px)').matches;
}

function resetPanelsForPhoneUi() {
  if (!isPhoneUi()) return;

  const panels = [
    document.querySelector('.table-side-panel'),
    document.getElementById('chat-panel'),
    document.getElementById('bidding-panel')
  ].filter(Boolean);

  for (const panel of panels) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.transform = '';
  }
}

function initMobileChatToggle() {
  if (!chatUi.panel || !chatUi.openBtn || !chatUi.closeBtn) return;

  const openChat = () => {
    document.body.classList.add('chat-open');
    // Focus the input on mobile for quicker chatting.
    setTimeout(() => chatElements.input?.focus(), 0);
  };

  const closeChat = () => {
    document.body.classList.remove('chat-open');
  };

  chatUi.openBtn.addEventListener('click', openChat);
  chatUi.closeBtn.addEventListener('click', closeChat);

  // Prevent the close button from acting as a drag handle on desktop.
  chatUi.closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  // Default behavior: on phones, start with chat closed.
  let wasPhone = isPhoneUi();
  if (wasPhone) {
    closeChat();
    resetPanelsForPhoneUi();
  }

  // If the viewport changes (rotate / resize), only enforce the default closed state
  // when transitioning from non-phone -> phone layout.
  window.addEventListener('resize', () => {
    const nowPhone = isPhoneUi();
    if (nowPhone && !wasPhone) {
      closeChat();
      resetPanelsForPhoneUi();
    }
    wasPhone = nowPhone;
  });
}

initMobileChatToggle();

function initMobileHistoryToggle() {
  const title = document.querySelector('#round-history-panel .round-history-title');
  if (!title) return;

  const toggle = () => {
    document.body.classList.toggle('mobile-history-open');
  };

  title.addEventListener('click', () => {
    if (!isPhoneUi()) return;
    toggle();
  });

  // Default behavior: on phones, start with history collapsed.
  let wasPhone = isPhoneUi();
  if (wasPhone) document.body.classList.remove('mobile-history-open');

  window.addEventListener('resize', () => {
    const nowPhone = isPhoneUi();
    if (nowPhone && !wasPhone) {
      document.body.classList.remove('mobile-history-open');
    }
    wasPhone = nowPhone;
  });
}

initMobileHistoryToggle();

function initMobileLastTrickToggle() {
  const title = document.querySelector('#last-trick-panel .last-trick-title');
  if (!title) return;

  const toggle = () => {
    document.body.classList.toggle('mobile-lasttrick-collapsed');
  };

  title.addEventListener('click', () => {
    if (!isPhoneUi()) return;
    toggle();
  });

  // Default behavior: on phones, show "Dernier pli" (not collapsed).
  let wasPhone = isPhoneUi();
  if (wasPhone) document.body.classList.remove('mobile-lasttrick-collapsed');

  window.addEventListener('resize', () => {
    const nowPhone = isPhoneUi();
    if (nowPhone && !wasPhone) {
      document.body.classList.remove('mobile-lasttrick-collapsed');
    }
    wasPhone = nowPhone;
  });
}

initMobileLastTrickToggle();

// Position mapping relative to player's perspective
function getRelativePosition(pos) {
  // Maps absolute position to visual position on screen (always show "me" at bottom)
  const posMap = {
    sud: { sud: 'south', ouest: 'west', nord: 'north', est: 'east' },
    nord: { nord: 'south', est: 'west', sud: 'north', ouest: 'east' },
    est: { est: 'south', sud: 'west', ouest: 'north', nord: 'east' },
    ouest: { ouest: 'south', nord: 'west', est: 'north', sud: 'east' }
  };
  return posMap[myPosition] ? posMap[myPosition][pos] : pos;
}

// Visual position to CSS mapping
function getVisualDomIds(pos) {
  const map = {
    south: 'sud',
    north: 'nord',
    west: 'ouest',
    east: 'est'
  };
  return map[pos] || pos;
}

// Maps absolute positions to DOM element positions (based on player's orientation)
function getAbsToVisual() {
  const mapping = {};
  const positions = ['sud', 'ouest', 'nord', 'est'];
  for (const pos of positions) {
    const visual = getRelativePosition(pos);
    mapping[pos] = getVisualDomIds(visual);
  }
  return mapping;
}

// ---- Card rendering ----
// Optional: use your own card textures served from /public.
// Put images under: public/cards/
// - back: public/cards/back.png
// - faces: public/cards/<rank>_<suit>.png (example: as_pique.png)
// Then set enabled=true.
const CARD_TEXTURES = {
  enabled: true,
  baseUrl: '/cards',
  backFile: 'BACK.png',
  extension: 'png'
};

function getCardTextureUrl(card) {
  // Mapping for the current assets naming convention in public/cards/.
  // Example: AS_COEUR.png, SEPT_PIC.png, DIX_TREFLE.png
  const rankMap = {
    '7': 'SEPT',
    '8': 'HUIT',
    '9': 'NEUF',
    '10': 'DIX',
    valet: 'VALET',
    dame: 'DAME',
    roi: 'ROI',
    as: 'AS'
  };

  const suitMap = {
    coeur: 'COEUR',
    carreau: 'CARREAU',
    trefle: 'TREFLE',
    pique: 'PIC'
  };

  const rank = rankMap[card.rank] || String(card.rank).toUpperCase();
  const suit = suitMap[card.suit] || String(card.suit).toUpperCase();

  return `${CARD_TEXTURES.baseUrl}/${rank}_${suit}.${CARD_TEXTURES.extension}`;
}

function getBackTextureUrl() {
  return `${CARD_TEXTURES.baseUrl}/${CARD_TEXTURES.backFile}`;
}

function applyBackTextureCssVar() {
  if (!CARD_TEXTURES.enabled) return;
  document.documentElement.style.setProperty('--card-back-image', `url("${getBackTextureUrl()}")`);
}

function applyCardFaceTexture(el, card) {
  if (!CARD_TEXTURES.enabled) return;

  const url = getCardTextureUrl(card);
  el.classList.add('card--textured');
  el.style.setProperty('--card-face-image', `url("${url}")`);

  // If the image loads, hide the HTML markup to show only the texture.
  const img = new Image();
  img.onload = () => el.classList.add('card--texture-loaded');
  img.src = url;
}

applyBackTextureCssVar();

const SUIT_SYMBOLS = {
  coeur: '♥', carreau: '♦', trefle: '♣', pique: '♠'
};

const RANK_DISPLAY = {
  '7': '7', '8': '8', '9': '9', '10': '10',
  'valet': 'V', 'dame': 'D', 'roi': 'R', 'as': 'A'
};

function getSuitSymbol(suit) {
  return SUIT_SYMBOLS[suit] || suit;
}

function getCardColor(suit) {
  return (suit === 'coeur' || suit === 'carreau') ? 'red' : 'black';
}

function formatBidPoints(points) {
  if (points === 270) return 'Capot beloté (270)';
  if (points === 250) return 'Capot (250)';
  if (points === 500) return 'Générale (500)';
  return `${points}`;
}

function getFaceFigureMarkup(card) {
  const figureMap = {
    valet: {
      title: 'Valet',
      svg: `
        <svg viewBox="0 0 64 84" class="figure-portrait portrait-valet" aria-hidden="true">
          <path class="p-accent" d="M15 18 L28 8 L41 18 L35 24 L29 24 Z" />
          <circle class="p-skin" cx="32" cy="27" r="11" />
          <path class="p-line" d="M21 23 Q32 10 43 23" />
          <path class="p-cloth" d="M14 72 Q17 47 32 46 Q47 47 50 72 Z" />
          <path class="p-line" d="M24 58 L32 64 L40 58" />
        </svg>
      `
    },
    dame: {
      title: 'Dame',
      svg: `
        <svg viewBox="0 0 64 84" class="figure-portrait portrait-dame" aria-hidden="true">
          <path class="p-accent" d="M16 20 L22 11 L32 18 L42 11 L48 20 L41 25 L23 25 Z" />
          <circle class="p-skin" cx="32" cy="28" r="11" />
          <path class="p-line" d="M20 27 Q32 14 44 27" />
          <path class="p-cloth" d="M12 73 Q20 49 32 47 Q44 49 52 73 Z" />
          <path class="p-line" d="M20 66 Q32 58 44 66" />
        </svg>
      `
    },
    roi: {
      title: 'Roi',
      svg: `
        <svg viewBox="0 0 64 84" class="figure-portrait portrait-roi" aria-hidden="true">
          <path class="p-accent" d="M14 21 L20 10 L28 19 L36 10 L44 19 L50 10 L50 21 L14 21 Z" />
          <rect class="p-accent" x="27" y="7" width="10" height="3" rx="1" />
          <circle class="p-skin" cx="32" cy="30" r="11" />
          <path class="p-line" d="M20 29 Q32 16 44 29" />
          <path class="p-cloth" d="M11 73 Q17 48 32 46 Q47 48 53 73 Z" />
          <rect class="p-line" x="29" y="57" width="6" height="10" rx="1" />
        </svg>
      `
    }
  };

  const figure = figureMap[card.rank];
  if (!figure) return '';

  const suit = getSuitSymbol(card.suit);
  return `
    <div class="card-figure" aria-hidden="true">
      <div class="figure-crown">${suit}</div>
      ${figure.svg}
      <div class="figure-title">${figure.title}</div>
    </div>
  `;
}

function createCardElement(card, playable = false) {
  const div = document.createElement('div');
  const color = getCardColor(card.suit);
  const figureClass = ['valet', 'dame', 'roi'].includes(card.rank) ? ' figure-face' : '';
  div.className = `card ${color}${figureClass}${playable ? ' playable' : ''}`;
  div.dataset.cardKey = `${card.suit}-${card.rank}`;

  const rank = RANK_DISPLAY[card.rank] || card.rank;
  const suit = getSuitSymbol(card.suit);

  div.innerHTML = `
    <span class="card-corner">${rank}<br>${suit}</span>
    ${getFaceFigureMarkup(card)}
    <span class="card-suit-icon">${suit}</span>
    <span class="card-rank">${rank}</span>
    <span class="card-corner-bottom">${rank}<br>${suit}</span>
  `;

  if (playable) {
    div.addEventListener('click', () => {
      if (trickCollect.running) return;
      animatePlayedCardToTrick(div, card);
      socket.emit('play-card', { card });
    });
  }

  applyCardFaceTexture(div, card);

  return div;
}

function createTrickCard(card) {
  const div = document.createElement('div');
  const color = getCardColor(card.suit);
  const figureClass = ['valet', 'dame', 'roi'].includes(card.rank) ? ' figure-face' : '';
  div.className = `card trick-played ${color}${figureClass}`;
  div.dataset.cardKey = `${card.suit}-${card.rank}`;

  const rank = RANK_DISPLAY[card.rank] || card.rank;
  const suit = getSuitSymbol(card.suit);

  div.innerHTML = `
    <span class="card-corner">${rank}<br>${suit}</span>
    ${getFaceFigureMarkup(card)}
    <span class="card-suit-icon">${suit}</span>
    <span class="card-rank">${rank}</span>
    <span class="card-corner-bottom">${rank}<br>${suit}</span>
  `;

  applyCardFaceTexture(div, card);
  return div;
}

function createTrickCardNoEntrance(card) {
  const el = createTrickCard(card);
  el.classList.add('no-entrance');
  return el;
}

function setTrickSlotCard(slotEl, card, { suppressEntrance = false } = {}) {
  if (!slotEl) return;
  if (!card) {
    if (slotEl.firstChild) slotEl.innerHTML = '';
    return;
  }

  const key = `${card.suit}-${card.rank}`;
  const existing = slotEl.querySelector('.card');
  const existingKey = existing ? existing.dataset.cardKey : null;
  if (existing && existingKey === key) return;

  slotEl.innerHTML = '';
  slotEl.appendChild(suppressEntrance ? createTrickCardNoEntrance(card) : createTrickCard(card));
}

function getTrickSignature(trick) {
  if (!Array.isArray(trick) || trick.length === 0) return '';
  return trick
    .map(p => `${p.player}:${p.card?.suit ?? ''}:${p.card?.rank ?? ''}`)
    .join('|');
}

function clearTrickCollectTimers() {
  for (const t of trickCollect.timers) clearTimeout(t);
  trickCollect.timers = [];
}

function getOrCreateTrickAnimationLayer() {
  let layer = document.getElementById('trick-animation-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'trick-animation-layer';
    layer.className = 'trick-animation-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

function getMyTrickTargetElement() {
  try {
    if (myPosition) {
      const absToVisual = getAbsToVisual();
      const visualPos = absToVisual[myPosition] || 'sud';
      const el = document.getElementById(`trick-${visualPos}`);
      if (el) return el;
    }
  } catch {
    // ignore
  }
  return document.getElementById('trick-sud');
}

function measureTrickCardRectInTrickSlot(card, slotEl) {
  if (!slotEl || !card) return null;
  const placeholder = createTrickCardNoEntrance(card);
  placeholder.style.visibility = 'hidden';
  placeholder.style.pointerEvents = 'none';
  placeholder.style.animation = 'none';

  slotEl.appendChild(placeholder);
  const rect = placeholder.getBoundingClientRect();
  placeholder.remove();
  return rect;
}

function animatePlayedCardToTrick(cardEl, card) {
  if (!cardEl) return;
  if (cardEl.dataset.animating === '1') return;
  const targetSlot = getMyTrickTargetElement();
  if (!targetSlot) return;

  const pendingKey = cardEl.dataset.cardKey || null;
  playCardAnim.running = true;
  playCardAnim.pendingKey = pendingKey;
  if (playCardAnim.timer) clearTimeout(playCardAnim.timer);
  // Safety: clear the flag even if animation callbacks are skipped.
  playCardAnim.timer = setTimeout(() => {
    playCardAnim.running = false;
    playCardAnim.pendingKey = null;
    updateDisplay();
  }, PLAY_CARD_ANIM_MS + 120);

  const fromRect = cardEl.getBoundingClientRect();
  const toRect = measureTrickCardRectInTrickSlot(card, targetSlot) || targetSlot.getBoundingClientRect();

  // If the card is not visible, skip.
  if (fromRect.width === 0 || fromRect.height === 0) return;

  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;

  const layer = getOrCreateTrickAnimationLayer();

  // Use a trick-styled clone so size matches the card rendered in the center.
  const clone = createTrickCardNoEntrance(card);
  clone.classList.add('trick-collect-card');
  clone.style.position = 'fixed';
  clone.style.left = `${fromRect.left}px`;
  clone.style.top = `${fromRect.top}px`;
  clone.style.margin = '0';
  clone.style.zIndex = '9999';
  clone.style.pointerEvents = 'none';
  clone.style.opacity = '1';
  clone.style.transform = 'translate(0px, 0px) scale(1)';

  layer.appendChild(clone);

  // Hide original quickly to avoid visual duplication while waiting for server state.
  cardEl.dataset.animating = '1';
  cardEl.style.visibility = 'hidden';

  // If for any reason the server rejects the move and no re-render happens,
  // restore visibility after a short delay.
  setTimeout(() => {
    if (document.body.contains(cardEl)) {
      cardEl.style.visibility = '';
      delete cardEl.dataset.animating;
    }
  }, PLAY_CARD_ANIM_MS + 800);

  // Force layout before animating.
  void layer.offsetWidth;

  const animateFn = clone.animate;
  if (typeof animateFn === 'function') {
    const anim = clone.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 }
      ],
      {
        duration: PLAY_CARD_ANIM_MS,
        easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
        fill: 'forwards'
      }
    );

    anim.finished
      .catch(() => null)
      .then(() => {
        playCardAnim.suppressEntranceKey = pendingKey;
        if (playCardAnim.timer) clearTimeout(playCardAnim.timer);
        playCardAnim.running = false;
        playCardAnim.pendingKey = null;
        updateDisplay();
        requestAnimationFrame(() => clone.remove());
      });
  } else {
    clone.style.transition = `transform ${PLAY_CARD_ANIM_MS}ms cubic-bezier(0.2, 0.9, 0.2, 1)`;
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
    });
    setTimeout(() => {
      playCardAnim.suppressEntranceKey = pendingKey;
      if (playCardAnim.timer) clearTimeout(playCardAnim.timer);
      playCardAnim.running = false;
      playCardAnim.pendingKey = null;
      updateDisplay();
      requestAnimationFrame(() => clone.remove());
    }, PLAY_CARD_ANIM_MS + 30);
  }
}

function clearCenterTrickSlots() {
  for (const visualPos of ['sud', 'nord', 'est', 'ouest']) {
    const el = document.getElementById(`trick-${visualPos}`);
    if (el) el.innerHTML = '';
  }
}

function startTrickCollectAnimation(trick, winnerAbsPos) {
  if (!Array.isArray(trick) || trick.length !== 4) return;
  if (!winnerAbsPos) return;

  clearTrickCollectTimers();
  trickCollect.running = true;

  // Render the completed trick back into the center so we can animate the collection.
  const absToVisual = getAbsToVisual();
  clearCenterTrickSlots();

  for (const play of trick) {
    const visualPos = absToVisual[play.player];
    const slot = document.getElementById(`trick-${visualPos}`);
    if (!slot) continue;
    slot.innerHTML = '';
    slot.appendChild(createTrickCard(play.card));
  }

  const winnerVisualPos = absToVisual[winnerAbsPos];
  const targetEl = (winnerVisualPos === 'sud')
    ? (document.getElementById('my-hand') || document.getElementById('name-sud'))
    : (document.getElementById(`hand-${winnerVisualPos}`) || document.getElementById(`name-${winnerVisualPos}`));
  const targetRect = targetEl ? targetEl.getBoundingClientRect() : null;
  const targetX = targetRect ? targetRect.left + targetRect.width / 2 : window.innerWidth / 2;
  const targetY = targetRect ? targetRect.top + targetRect.height / 2 : window.innerHeight / 2;

  const delayTimer = setTimeout(() => {
    const layer = getOrCreateTrickAnimationLayer();
    const flyingCards = [];

    for (const visualPos of ['sud', 'nord', 'est', 'ouest']) {
      const slot = document.getElementById(`trick-${visualPos}`);
      const cardEl = slot ? slot.querySelector('.card') : null;
      if (!cardEl) continue;

      const rect = cardEl.getBoundingClientRect();
      const startX = rect.left;
      const startY = rect.top;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Clone the card into the fixed overlay layer.
      // Moving DOM nodes between containers can glitch (blink / skipped transition) depending on browser.
      const clone = cardEl.cloneNode(true);
      clone.classList.add('trick-collect-card');
      clone.style.position = 'fixed';
      clone.style.left = `${startX}px`;
      clone.style.top = `${startY}px`;
      clone.style.margin = '0';
      clone.style.zIndex = '9999';
      clone.style.pointerEvents = 'none';
      clone.style.opacity = '1';
      clone.style.transform = 'translate(0px, 0px) scale(1)';

      layer.appendChild(clone);

      flyingCards.push({
        el: clone,
        dx: targetX - centerX,
        dy: targetY - centerY
      });
    }

    // Remove center cards once the clones are placed.
    clearCenterTrickSlots();

    if (flyingCards.length === 0) {
      trickCollect.running = false;
      updateDisplay();
      return;
    }

    // Force layout so initial styles are committed.
    void layer.offsetWidth;

    const donePromises = [];
    if (typeof flyingCards[0].el.animate === 'function') {
      for (const c of flyingCards) {
        const anim = c.el.animate(
          [
            { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
            { transform: `translate(${c.dx}px, ${c.dy}px) scale(0.65)`, opacity: 0.25 }
          ],
          {
            duration: TRICK_COLLECT_ANIM_MS,
            easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
            fill: 'forwards'
          }
        );
        donePromises.push(anim.finished.catch(() => null));
      }
    } else {
      for (const c of flyingCards) {
        c.el.style.transition = `transform ${TRICK_COLLECT_ANIM_MS}ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity ${TRICK_COLLECT_ANIM_MS}ms ease`;
      }
      requestAnimationFrame(() => {
        for (const c of flyingCards) {
          c.el.style.transform = `translate(${c.dx}px, ${c.dy}px) scale(0.65)`;
          c.el.style.opacity = '0.25';
        }
      });
      donePromises.push(new Promise(resolve => setTimeout(resolve, TRICK_COLLECT_ANIM_MS + 30)));
    }

    Promise.allSettled(donePromises).then(() => {
      for (const c of flyingCards) c.el.remove();
      trickCollect.running = false;

      const queued = trickCollect.queuedState;
      trickCollect.queuedState = null;
      if (queued) {
        gameState = queued;
      }
      updateDisplay();
    });
  }, TRICK_COLLECT_DELAY_MS);

  trickCollect.timers.push(delayTimer);
}

function createCardBacks(count) {
  let html = '';
  const texturedClass = CARD_TEXTURES.enabled ? ' card-back--textured' : '';
  for (let i = 0; i < count; i++) {
    html += `<div class="card-back${texturedClass}"></div>`;
  }
  return html;
}

// ---- Draggable UI panels ----
function clampPanelToViewport(panel, left, top) {
  const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop)
  };
}

function savePanelPosition(storageKey, left, top) {
  if (storageKey === 'bidding-panel' && isMobilePortraitGameplay()) return;
  try {
    localStorage.setItem(`${PANEL_POS_STORAGE_PREFIX}${storageKey}`, JSON.stringify({ left, top }));
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

function loadPanelPosition(storageKey) {
  try {
    const raw = localStorage.getItem(`${PANEL_POS_STORAGE_PREFIX}${storageKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function applySavedPanelPosition(panel, storageKey) {
  if (!panel) return;
  if (window.getComputedStyle(panel).position === 'static') return;

  // On portrait phones, bidding panel must remain centered (avoid covering the player's hand).
  // Inline positions from saved draggable state would override the CSS layout.
  if (storageKey === 'bidding-panel' && isMobilePortraitGameplay()) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.transform = '';
    return;
  }

  const saved = loadPanelPosition(storageKey);
  if (!saved) return;

  panel.style.transform = 'none';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';

  const clamped = clampPanelToViewport(panel, saved.left, saved.top);
  panel.style.left = `${clamped.left}px`;
  panel.style.top = `${clamped.top}px`;
}

function makePanelDraggable(panel, handleSelector, storageKey) {
  if (!panel) return;

  const handles = panel.querySelectorAll(handleSelector);
  if (!handles || handles.length === 0) return;

  applySavedPanelPosition(panel, storageKey);

  const startDrag = (e) => {
    if (e.button !== 0) return;
    if (window.getComputedStyle(panel).position === 'static') return;

    const rect = panel.getBoundingClientRect();
    const dragOffsetX = e.clientX - rect.left;
    const dragOffsetY = e.clientY - rect.top;

    panel.style.transform = 'none';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.classList.add('dragging-panel');
    document.body.classList.add('panel-dragging');

    const onMove = (moveEvent) => {
      const nextLeft = moveEvent.clientX - dragOffsetX;
      const nextTop = moveEvent.clientY - dragOffsetY;
      const clamped = clampPanelToViewport(panel, nextLeft, nextTop);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
    };

    const onUp = () => {
      panel.classList.remove('dragging-panel');
      document.body.classList.remove('panel-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const left = parseFloat(panel.style.left);
      const top = parseFloat(panel.style.top);
      if (!Number.isNaN(left) && !Number.isNaN(top)) {
        savePanelPosition(storageKey, left, top);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  };

  handles.forEach((handle) => {
    handle.addEventListener('mousedown', startDrag);
  });

  window.addEventListener('resize', () => {
    if (window.getComputedStyle(panel).position === 'static') return;

    if (storageKey === 'bidding-panel' && isMobilePortraitGameplay()) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      panel.style.transform = '';
      return;
    }

    const currentLeft = parseFloat(panel.style.left);
    const currentTop = parseFloat(panel.style.top);
    if (Number.isNaN(currentLeft) || Number.isNaN(currentTop)) return;

    const clamped = clampPanelToViewport(panel, currentLeft, currentTop);
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
    savePanelPosition(storageKey, clamped.left, clamped.top);
  });
}

function initDraggablePanels() {
  // On phone UI we keep HUD/panels anchored by CSS.
  if (isPhoneUi()) return;

  makePanelDraggable(
    document.querySelector('.table-side-panel'),
    '.last-trick-title, .round-history-title',
    'info-panel'
  );
  makePanelDraggable(
    document.getElementById('chat-panel'),
    '.chat-header',
    'chat-panel'
  );
  makePanelDraggable(
    document.getElementById('bidding-panel'),
    'h3',
    'bidding-panel'
  );
}

initDraggablePanels();

// ---- Screen management ----
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ---- Lobby ----
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Joueur';
  const position = document.getElementById('create-position').value;
  socket.emit('create-room', { name, position });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Joueur';
  const roomId = document.getElementById('room-code').value.trim();
  const position = document.getElementById('join-position').value;

  if (!roomId) {
    showError('Entrez le code de la salle');
    return;
  }
  if (!position) {
    showError('Choisissez une position');
    return;
  }

  socket.emit('join-room', { name, roomId, position });
});

// Update available positions when typing room code
document.getElementById('room-code').addEventListener('input', (e) => {
  const code = e.target.value.trim();
  if (code.length === 6) {
    socket.emit('get-available-positions', { roomId: code });
  }
});

socket.on('available-positions', (data) => {
  const select = document.getElementById('join-position');
  // Reset options
  select.innerHTML = '<option value="" disabled selected>Position...</option>';
  const posNames = { sud: 'Sud', nord: 'Nord', est: 'Est', ouest: 'Ouest' };
  if (data.positions) {
    data.positions.forEach(pos => {
      const opt = document.createElement('option');
      opt.value = pos;
      opt.textContent = posNames[pos] || pos;
      select.appendChild(opt);
    });
  }
});

function showError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---- Socket events ----
socket.on('room-created', (data) => {
  myRoom = data.roomId;
  myPosition = data.position;
  document.getElementById('room-code-display').textContent = data.roomId;
  clearChat();
  showScreen('waiting');
});

socket.on('room-joined', (data) => {
  myRoom = data.roomId;
  myPosition = data.position;
  document.getElementById('room-code-display').textContent = data.roomId;
  clearChat();
  showScreen('waiting');
});

socket.on('error-msg', (data) => {
  showError(data.message);
});

socket.on('message', (data) => {
  addMessage(data.text, data.type);
});

socket.on('chat-message', (data) => {
  addChatMessage(data);
});

// game-state handled below with transition detection

// ---- Messages ----
function addMessage(text, type = 'info') {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = text;
  container.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function clearChat() {
  if (!chatElements.container) return;
  chatElements.container.innerHTML = '';
}

function addChatMessage(data) {
  if (!chatElements.container || !data) return;

  const row = document.createElement('div');
  const isMine = data.position && data.position === myPosition;
  row.className = `chat-msg${isMine ? ' mine' : ''}`;

  const author = document.createElement('div');
  author.className = 'chat-author';
  author.textContent = isMine ? 'Moi' : (data.from || 'Joueur');

  const body = document.createElement('div');
  body.className = 'chat-text';
  body.textContent = data.text || '';

  row.appendChild(author);
  row.appendChild(body);
  chatElements.container.appendChild(row);

  while (chatElements.container.children.length > CHAT_MAX_MESSAGES) {
    chatElements.container.removeChild(chatElements.container.firstChild);
  }

  chatElements.container.scrollTop = chatElements.container.scrollHeight;
}

function sendChatMessage() {
  if (!chatElements.input) return;
  const text = chatElements.input.value.replace(/\s+/g, ' ').trim();
  if (!text) return;

  socket.emit('chat-message', { text });
  chatElements.input.value = '';
}

// ---- Game Display ----
function updateDisplay() {
  if (!gameState) return;

  if (gameState.state === 'waiting') {
    showScreen('waiting');
    updateWaitingRoom();
    return;
  }

  showScreen('game');
  updateScoreboard();
  updatePlayers();
  updateTrick();
  updateHand();
  updateBidding();
  updateContract();
  updateRoundPoints();
  updateRoundHistory();
  updateTurnIndicator();
  updateRoundResult();
}

function updateWaitingRoom() {
  const posNames = { sud: 'Sud', nord: 'Nord', est: 'Est', ouest: 'Ouest' };
  for (const pos of ['sud', 'nord', 'est', 'ouest']) {
    const slot = document.getElementById(`slot-${pos}`);
    const nameEl = slot.querySelector('.slot-name');
    if (gameState.players[pos]) {
      nameEl.textContent = gameState.players[pos].name;
      slot.classList.add('occupied');
    } else {
      nameEl.textContent = 'En attente...';
      slot.classList.remove('occupied');
    }
  }
}

function updateScoreboard() {
  document.getElementById('score-ns').textContent = gameState.scores.ns;
  document.getElementById('score-eo').textContent = gameState.scores.eo;
}

function updatePlayers() {
  const absToVisual = getAbsToVisual();
  const positions = ['sud', 'ouest', 'nord', 'est'];

  for (const absPos of positions) {
    const visualPos = absToVisual[absPos];
    const nameEl = document.getElementById(`name-${visualPos}`);
    const cardsEl = document.getElementById(`cards-${visualPos}`);
    const handEl = document.getElementById(`hand-${visualPos}`);
    const infoEl = nameEl ? nameEl.parentElement : null;

    if (gameState.players[absPos]) {
      const name = absPos === myPosition
        ? `${gameState.players[absPos].name} (moi)`
        : gameState.players[absPos].name;
      if (nameEl) nameEl.textContent = name;
    }

    if (cardsEl) {
      cardsEl.textContent = gameState.cardsLeft[absPos] || 0;
    }

    // Card backs for other players
    if (handEl && absPos !== myPosition) {
      handEl.innerHTML = createCardBacks(gameState.cardsLeft[absPos] || 0);
    }

    // Active indicator
    if (infoEl) {
      infoEl.classList.toggle('active', gameState.currentPlayer === absPos);
      infoEl.classList.toggle('dealer', gameState.dealer === absPos);
    }
  }
}

function updateTrick() {
  const absToVisual = getAbsToVisual();

  // Build desired state for current trick per visual position.
  const desiredCurrent = { sud: null, nord: null, est: null, ouest: null };
  if (gameState.currentTrick && gameState.currentTrick.length > 0) {
    for (const play of gameState.currentTrick) {
      // If we are animating our played card hand->center, don't render it in the trick area yet.
      if (
        playCardAnim.running &&
        play.player === myPosition &&
        playCardAnim.pendingKey &&
        play.card &&
        playCardAnim.pendingKey === `${play.card.suit}-${play.card.rank}`
      ) {
        continue;
      }
      const visualPos = absToVisual[play.player];
      if (visualPos) desiredCurrent[visualPos] = play.card;
    }
  }

  for (const visualPos of ['sud', 'nord', 'est', 'ouest']) {
    const slot = document.getElementById(`trick-${visualPos}`);
    const card = desiredCurrent[visualPos];
    const key = card ? `${card.suit}-${card.rank}` : null;
    const suppress = key && playCardAnim.suppressEntranceKey === key;
    setTrickSlotCard(slot, card, { suppressEntrance: !!suppress });
    if (suppress) playCardAnim.suppressEntranceKey = null;
  }

  // Last trick (side panel): also update incrementally to avoid flicker.
  const desiredLast = { sud: null, nord: null, est: null, ouest: null };
  if (gameState.lastTrick && gameState.lastTrick.length === 4) {
    for (const play of gameState.lastTrick) {
      const visualPos = absToVisual[play.player];
      if (visualPos) desiredLast[visualPos] = play.card;
    }
  }

  for (const visualPos of ['sud', 'nord', 'est', 'ouest']) {
    const slot = document.getElementById(`last-trick-${visualPos}`);
    setTrickSlotCard(slot, desiredLast[visualPos], { suppressEntrance: true });
  }
}

function updateRoundHistory() {
  const historyList = document.getElementById('round-history-list');
  if (!historyList) return;

  const suitNames = {
    coeur: '♥', carreau: '♦', trefle: '♣', pique: '♠',
    'tout-atout': 'TA', 'sans-atout': 'SA'
  };

  historyList.innerHTML = '';

  if (!gameState.roundHistory || gameState.roundHistory.length === 0) {
    historyList.innerHTML = '<div class="round-history-empty">Aucune manche jouée</div>';
    return;
  }

  for (const entry of gameState.roundHistory) {
    const row = document.createElement('div');
    row.className = 'history-entry';
    const statusClass = entry.contractMet ? 'success' : 'fail';
    row.innerHTML = `
      <div class="history-entry-header">
        <span class="history-entry-title">Manche ${entry.roundNumber}</span>
        <span class="history-entry-status ${statusClass}">${entry.contractMet ? 'réussi' : 'chuté'}</span>
      </div>
      <div class="history-entry-details">
        Contrat: <strong>${formatBidPoints(entry.contract.points)} ${suitNames[entry.contract.suit] || entry.contract.suit}</strong><br>
        Manche: NS <strong>${entry.scoreNS}</strong> - EO <strong>${entry.scoreEO}</strong><br>
        Total: NS <strong>${entry.totalScores.ns}</strong> - EO <strong>${entry.totalScores.eo}</strong>
      </div>
    `;
    historyList.appendChild(row);
  }
}

function updateHand() {
  const myHand = document.getElementById('my-hand');
  myHand.innerHTML = '';

  if (!gameState.hand) return;

  const playableSet = new Set();
  if (gameState.playableCards) {
    gameState.playableCards.forEach(c => {
      playableSet.add(`${c.suit}-${c.rank}`);
    });
  }

  for (const card of gameState.hand) {
    const key = `${card.suit}-${card.rank}`;
    const isPlayable = gameState.state === 'playing' &&
      gameState.currentPlayer === myPosition &&
      playableSet.has(key);
    myHand.appendChild(createCardElement(card, isPlayable));
  }
}

function updateBidding() {
  const panel = document.getElementById('bidding-panel');

  if (gameState.state !== 'bidding') {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  // Bid history
  const history = document.getElementById('bid-history');
  history.innerHTML = '';
  const posNames = { sud: 'Sud', nord: 'Nord', est: 'Est', ouest: 'Ouest' };
  const suitNames = {
    coeur: '♥', carreau: '♦', trefle: '♣', pique: '♠',
    'tout-atout': 'TA', 'sans-atout': 'SA'
  };

  if (gameState.bids) {
    for (const bid of gameState.bids) {
      const div = document.createElement('div');
      const name = gameState.players[bid.player] ? gameState.players[bid.player].name : posNames[bid.player];
      if (bid.type === 'pass') {
        div.className = 'bid-entry';
        div.innerHTML = `<strong>${name}</strong> passe`;
      } else if (bid.type === 'coinche') {
        div.className = 'bid-entry coinche';
        div.innerHTML = `<strong>${name}</strong> COINCHE !`;
      } else if (bid.type === 'surcoinche') {
        div.className = 'bid-entry surcoinche';
        div.innerHTML = `<strong>${name}</strong> SURCOINCHE !`;
      } else if (bid.type === 'bid') {
        div.className = 'bid-entry';
        div.innerHTML = `<strong>${name}</strong> ${formatBidPoints(bid.points)} ${suitNames[bid.suit] || bid.suit}`;
      }
      history.appendChild(div);
    }
    history.scrollTop = history.scrollHeight;
  }

  // Enable/disable controls based on turn
  const isMyTurn = gameState.currentPlayer === myPosition;
  document.getElementById('btn-bid').disabled = !isMyTurn;
  document.getElementById('btn-pass').disabled = !isMyTurn;

  // Reset options state between rounds
  const pointsSelect = document.getElementById('bid-points');
  for (const opt of pointsSelect.options) {
    opt.disabled = false;
  }

  // Coinche: only if opponent bid and no coinche yet
  const canCoinche = isMyTurn && gameState.contract &&
    getTeamFromPos(gameState.contract.player) !== getTeamFromPos(myPosition) &&
    !gameState.bids.some(b => b.type === 'coinche');
  document.getElementById('btn-coinche').disabled = !canCoinche;

  // Surcoinche
  const canSurcoinche = isMyTurn &&
    gameState.bids.some(b => b.type === 'coinche') &&
    !gameState.bids.some(b => b.type === 'surcoinche') &&
    gameState.contract &&
    getTeamFromPos(gameState.contract.player) === getTeamFromPos(myPosition);
  document.getElementById('btn-surcoinche').disabled = !canSurcoinche;

  // Update minimum bid
  if (gameState.contract) {
    for (const opt of pointsSelect.options) {
      const val = parseInt(opt.value);
      opt.disabled = val <= gameState.contract.points;
    }
    if (pointsSelect.selectedOptions[0] && pointsSelect.selectedOptions[0].disabled) {
      const firstValid = Array.from(pointsSelect.options).find(o => !o.disabled);
      if (firstValid) pointsSelect.value = firstValid.value;
    }
    // If coinched, disable bid button
    if (gameState.bids.some(b => b.type === 'coinche')) {
      document.getElementById('btn-bid').disabled = true;
    }
  } else {
    pointsSelect.value = '80';
  }
}

function getTeamFromPos(pos) {
  return (pos === 'sud' || pos === 'nord') ? 'ns' : 'eo';
}

function updateContract() {
  const el = document.getElementById('contract-info');
  if (gameState.state === 'playing' && gameState.contract) {
    el.classList.remove('hidden');
    const suitNames = {
      coeur: '♥ Coeur', carreau: '♦ Carreau', trefle: '♣ Trèfle',
      pique: '♠ Pique', 'tout-atout': 'Tout Atout', 'sans-atout': 'Sans Atout'
    };
    let text = `Contrat: ${formatBidPoints(gameState.contract.points)} ${suitNames[gameState.contract.suit]}`;
    if (gameState.contract.coinched) text += ' (COINCHÉ)';
    if (gameState.contract.surcoinched) text += ' (SURCOINCÉ)';
    el.querySelector('#contract-text').textContent = text;
  } else {
    el.classList.add('hidden');
  }
}

function updateRoundPoints() {
  if (gameState.roundPoints) {
    document.getElementById('round-ns').textContent = gameState.roundPoints.ns;
    document.getElementById('round-eo').textContent = gameState.roundPoints.eo;
  }
}

function updateTurnIndicator() {
  const el = document.getElementById('turn-indicator');
  if (!gameState.currentPlayer) {
    el.textContent = '';
    return;
  }

  if (gameState.currentPlayer === myPosition) {
    el.textContent = gameState.state === 'bidding' ? '🎯 À vous d\'enchérir !' : '🎯 À vous de jouer !';
  } else {
    const name = gameState.players[gameState.currentPlayer]
      ? gameState.players[gameState.currentPlayer].name
      : gameState.currentPlayer;
    el.textContent = `En attente de ${name}...`;
  }
}

function updateRoundResult() {
  const panel = document.getElementById('round-result');

  if (gameState.state === 'scoring' || gameState.state === 'finished') {
    showRoundResult(gameState);
  } else {
    panel.classList.add('hidden');
  }
}

// Bidding buttons
document.getElementById('btn-bid').addEventListener('click', () => {
  const points = parseInt(document.getElementById('bid-points').value);
  const suit = document.getElementById('bid-suit').value;
  socket.emit('bid', { type: 'bid', points, suit });
});

document.getElementById('btn-pass').addEventListener('click', () => {
  socket.emit('bid', { type: 'pass' });
});

document.getElementById('btn-coinche').addEventListener('click', () => {
  socket.emit('bid', { type: 'coinche' });
});

document.getElementById('btn-surcoinche').addEventListener('click', () => {
  socket.emit('bid', { type: 'surcoinche' });
});

// Next round / New game
document.getElementById('btn-next-round').addEventListener('click', () => {
  socket.emit('next-round');
  document.getElementById('round-result').classList.add('hidden');
});

document.getElementById('btn-new-game').addEventListener('click', () => {
  socket.emit('new-game');
  document.getElementById('round-result').classList.add('hidden');
});

if (chatElements.send) {
  chatElements.send.addEventListener('click', sendChatMessage);
}

if (chatElements.input) {
  chatElements.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  });
}

// Main game-state listener
socket.on('game-state', (state) => {
  if (trickCollect.running) {
    trickCollect.queuedState = state;
    return;
  }

  const prevSig = getTrickSignature(gameState ? gameState.lastTrick : null);
  const nextSig = getTrickSignature(state.lastTrick);
  const shouldAnimate =
    gameState &&
    state &&
    state.state === 'playing' &&
    Array.isArray(state.lastTrick) &&
    state.lastTrick.length === 4 &&
    nextSig &&
    nextSig !== prevSig &&
    nextSig !== trickCollect.lastAnimatedSig;

  gameState = state;
  updateDisplay();

  if (shouldAnimate) {
    trickCollect.lastAnimatedSig = nextSig;
    startTrickCollectAnimation(state.lastTrick, state.lastTrickWinner || state.currentPlayer);
  }
});

function showRoundResult(state) {
  const panel = document.getElementById('round-result');
  const title = document.getElementById('result-title');
  const details = document.getElementById('result-details');
  const btnNext = document.getElementById('btn-next-round');
  const btnNew = document.getElementById('btn-new-game');

  panel.classList.remove('hidden');

  const targetScore = state.targetScore || 2000;

  if (state.state === 'finished') {
    const winner = state.scores.ns >= targetScore ? 'Nord-Sud' : 'Est-Ouest';
    const isMyTeam = (state.scores.ns >= targetScore && getTeamFromPos(myPosition) === 'ns') ||
      (state.scores.eo >= targetScore && getTeamFromPos(myPosition) === 'eo');
    title.textContent = isMyTeam ? '🎉 Victoire !' : '😢 Défaite...';
    title.className = isMyTeam ? 'success' : 'danger';
    details.innerHTML = `
      <strong>${winner}</strong> remporte la partie !<br>
      Score final: NS <strong>${state.scores.ns}</strong> - EO <strong>${state.scores.eo}</strong><br>
      Objectif: <strong>${targetScore}</strong>
    `;
    btnNext.classList.add('hidden');
    btnNew.classList.remove('hidden');
  } else {
    title.textContent = 'Fin de manche';
    title.className = '';
    details.innerHTML = `
      Score: NS <strong>${state.scores.ns}</strong> - EO <strong>${state.scores.eo}</strong><br>
      Points manche: NS <strong>${state.roundPoints.ns}</strong> - EO <strong>${state.roundPoints.eo}</strong>
    `;
    btnNext.classList.remove('hidden');
    btnNew.classList.add('hidden');
  }
}

// Enter key for inputs
document.getElementById('player-name').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});

document.getElementById('room-code').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});
