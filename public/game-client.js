// ============================================================
// Coinche - Client-side
// ============================================================

const socket = io();

// State
let myPosition = null;
let myRoom = null;
let gameState = null;
let isRoomOwner = false;
let addBotWarningShown = false;
let pendingRoomLeave = false;
let currentTexturePack = 'Classic';
let availableTexturePacks = ['Classic','Balatro'];

// Trick collect animation (UX): highlight the winning card, then slide cards to the winner.
const TRICK_COLLECT_DELAY_MS = 420;
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

const publicRoomsUi = {
  list: document.getElementById('public-rooms-list'),
  refreshBtn: document.getElementById('btn-public-refresh')
};

const texturePickerUi = {
  button: document.getElementById('btn-texture-picker'),
  panel: document.getElementById('texture-picker-panel'),
  select: document.getElementById('texture-pack-select'),
  currentLabel: document.getElementById('texture-pack-current')
};

const CHAT_MAX_MESSAGES = 120;
const PANEL_POS_STORAGE_PREFIX = 'coinche-panel-pos:';
const PUBLIC_ROOMS_REFRESH_MS = 10000;
const LOBBY_SESSION_STORAGE_PREFIX = 'coinche:lobby-session:';
const LAST_LOBBY_STORAGE_KEY = 'coinche:last-lobby-room';
const LOBBY_PATH_REGEX = /^\/lobby\/([^/?#]+)/i;
const TEXTURE_PACK_STORAGE_KEY = 'coinche:texture-pack:selected';

function loadPreferredTexturePack() {
  try {
    return localStorage.getItem(TEXTURE_PACK_STORAGE_KEY);
  } catch {
    return null;
  }
}

function savePreferredTexturePack(packName) {
  try {
    localStorage.setItem(TEXTURE_PACK_STORAGE_KEY, packName);
  } catch {
    // Ignore storage failures.
  }
}

const savedTexturePack = loadPreferredTexturePack();
if (savedTexturePack) {
  currentTexturePack = savedTexturePack;
}

function isMobilePortraitGameplay() {
  // Matches the CSS breakpoint used for portrait-phone gameplay overrides.
  return window.matchMedia && window.matchMedia('(max-width: 600px) and (orientation: portrait)').matches;
}

const PHONE_UI_QUERY = '(max-width: 600px), (max-height: 500px) and (orientation: landscape)';

function isPhoneUi() {
  return window.matchMedia && window.matchMedia(PHONE_UI_QUERY).matches;
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

  chatUi.openBtn.addEventListener('click', () => {
    if (isPhoneUi() && document.body.classList.contains('chat-open')) {
      closeChat();
      return;
    }
    closeMobilePopovers();
    openChat();
  });
  chatUi.closeBtn.addEventListener('click', closeChat);

  // Prevent the close button from acting as a drag handle on desktop.
  chatUi.closeBtn.addEventListener('mousedown', (e) => {

function initDesktopChatCollapse() {
  if (!chatUi.panel || !chatUi.openBtn || !chatUi.closeBtn) return;

  const setCollapsed = (collapsed) => {
    document.body.classList.toggle('chat-collapsed', !!collapsed);
    try {
      localStorage.setItem('coinche:chat-collapsed', collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  };

  // Only apply on desktop/tablet layouts.
  if (isPhoneUi()) {
    setCollapsed(false);
    return;
  }

  // Restore
  try {
    const saved = localStorage.getItem('coinche:chat-collapsed');
    if (saved === '1') setCollapsed(true);
  } catch {
    // ignore
  }

  chatUi.closeBtn.addEventListener('click', () => {
    if (isPhoneUi()) return;
    setCollapsed(true);
  });

  chatUi.openBtn.addEventListener('click', () => {
    if (isPhoneUi()) return;
    setCollapsed(false);
  });
}

initDesktopChatCollapse();
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

// ---- Phone HUD popovers (dernier pli / historique) ----
const MOBILE_POPOVERS = {
  lasttrick: { bodyClass: 'mobile-lasttrick-open', button: 'btn-hud-lasttrick', title: '#last-trick-panel .last-trick-title' },
  history: { bodyClass: 'mobile-history-open', button: 'btn-hud-history', title: '#round-history-panel .round-history-title' }
};

function syncMobilePopoverButtons() {
  for (const cfg of Object.values(MOBILE_POPOVERS)) {
    const btn = document.getElementById(cfg.button);
    if (btn) btn.setAttribute('aria-pressed', document.body.classList.contains(cfg.bodyClass) ? 'true' : 'false');
  }
}

function closeMobilePopovers() {
  for (const cfg of Object.values(MOBILE_POPOVERS)) document.body.classList.remove(cfg.bodyClass);
  syncMobilePopoverButtons();
}

function toggleMobilePopover(key) {
  const cfg = MOBILE_POPOVERS[key];
  if (!cfg) return;
  const willOpen = !document.body.classList.contains(cfg.bodyClass);
  closeMobilePopovers();
  if (willOpen) {
    document.body.classList.remove('chat-open');
    document.body.classList.add(cfg.bodyClass);
  }
  syncMobilePopoverButtons();
}

function initMobilePopovers() {
  for (const [key, cfg] of Object.entries(MOBILE_POPOVERS)) {
    const btn = document.getElementById(cfg.button);
    if (btn) btn.addEventListener('click', () => toggleMobilePopover(key));

    // Sur téléphone, toucher le titre du panneau le referme.
    const title = document.querySelector(cfg.title);
    if (title) {
      title.addEventListener('click', () => {
        if (!isPhoneUi()) return;
        document.body.classList.remove(cfg.bodyClass);
        syncMobilePopoverButtons();
      });
    }
  }
  syncMobilePopoverButtons();
}

initMobilePopovers();

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

function normalizeTexturePackName(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}

function normalizeTexturePackList(rawPacks) {
  const source = Array.isArray(rawPacks) ? rawPacks : [];
  const seen = new Set();
  const result = [];

  for (const item of source) {
    const packName = normalizeTexturePackName(item);
    if (!packName) continue;
    const key = packName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(packName);
  }

  if (result.length === 0) {
    result.push('Classic');
  }

  return result;
}

function updateTexturePickerLabel() {
  if (texturePickerUi.currentLabel) {
    texturePickerUi.currentLabel.textContent = currentTexturePack;
  }
  if (texturePickerUi.button) {
    const label = `Texture pack: ${currentTexturePack}`;
    texturePickerUi.button.title = label;
    texturePickerUi.button.setAttribute('aria-label', label);
  }
}

function syncTexturePickerSelectValue() {
  if (!texturePickerUi.select) return;
  const hasValue = Array.from(texturePickerUi.select.options)
    .some(option => option.value.toLowerCase() === currentTexturePack.toLowerCase());
  if (hasValue) {
    texturePickerUi.select.value = currentTexturePack;
  }
}

function renderTexturePickerOptions() {
  if (!texturePickerUi.select) return;

  texturePickerUi.select.innerHTML = '';
  for (const packName of availableTexturePacks) {
    const option = document.createElement('option');
    option.value = packName;
    option.textContent = packName;
    texturePickerUi.select.appendChild(option);
  }

  syncTexturePickerSelectValue();
}

function setTexturePack(packName, { rerender = true, persist = false } = {}) {
  const normalized = normalizeTexturePackName(packName) || 'Classic';
  const changed = normalized !== currentTexturePack;

  currentTexturePack = normalized;
  if (persist) {
    savePreferredTexturePack(currentTexturePack);
  }

  applyBackTextureCssVar();
  updateTexturePickerLabel();
  syncTexturePickerSelectValue();

  if (changed && rerender && gameState) {
    updateDisplay();
  }
}

function applyTexturePackOptions(data = {}) {
  availableTexturePacks = normalizeTexturePackList(data.availablePacks);
  const selectedPack = normalizeTexturePackName(currentTexturePack);
  const defaultPack = normalizeTexturePackName(data.defaultPack);

  const selectedIsAvailable = !!selectedPack && availableTexturePacks.some(
    pack => pack.toLowerCase() === selectedPack.toLowerCase()
  );

  let targetPack = selectedIsAvailable ? selectedPack : null;
  if (!targetPack && defaultPack) {
    targetPack = availableTexturePacks.find(
      pack => pack.toLowerCase() === defaultPack.toLowerCase()
    ) || null;
  }
  if (!targetPack) {
    targetPack = availableTexturePacks[0] || 'Classic';
  }

  renderTexturePickerOptions();
  setTexturePack(targetPack, { rerender: true, persist: true });
}

function getPreferredTexturePackForRequest() {
  return normalizeTexturePackName(currentTexturePack) || 'Classic';
}

function setTexturePickerPanelOpen(isOpen) {
  if (!texturePickerUi.button || !texturePickerUi.panel) return;
  texturePickerUi.panel.classList.toggle('hidden', !isOpen);
  texturePickerUi.button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function initLobbyTexturePicker() {
  if (!texturePickerUi.button || !texturePickerUi.panel || !texturePickerUi.select) return;

  availableTexturePacks = normalizeTexturePackList(availableTexturePacks);
  renderTexturePickerOptions();
  setTexturePack(currentTexturePack, { rerender: false, persist: true });

  texturePickerUi.button.addEventListener('click', (event) => {
    event.stopPropagation();
    const shouldOpen = texturePickerUi.panel.classList.contains('hidden');
    setTexturePickerPanelOpen(shouldOpen);
  });

  texturePickerUi.select.addEventListener('change', () => {
    const selectedPack = normalizeTexturePackName(texturePickerUi.select.value);
    if (!selectedPack) return;
    setTexturePack(selectedPack, { rerender: false, persist: true });
    setTexturePickerPanelOpen(false);
  });

  document.addEventListener('click', (event) => {
    if (texturePickerUi.panel.classList.contains('hidden')) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (texturePickerUi.panel.contains(target) || texturePickerUi.button.contains(target)) return;
    setTexturePickerPanelOpen(false);
  });
}

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
  const packFolder = encodeURIComponent(currentTexturePack);

  return `${CARD_TEXTURES.baseUrl}/${packFolder}/${rank}_${suit}.${CARD_TEXTURES.extension}`;
}

function getBackTextureUrl() {
  const packFolder = encodeURIComponent(currentTexturePack);
  return `${CARD_TEXTURES.baseUrl}/${packFolder}/${CARD_TEXTURES.backFile}`;
}

function applyBackTextureCssVar() {
  if (!CARD_TEXTURES.enabled) return;
  const url = getBackTextureUrl();
  const img = new Image();
  img.onload = () => {
    if (getBackTextureUrl() !== url) return;
    document.documentElement.style.setProperty('--card-back-image', `url("${url}")`);
  };
  img.onerror = () => {
    if (getBackTextureUrl() !== url) return;
    document.documentElement.style.setProperty('--card-back-image', 'none');
  };
  img.src = url;
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
  const shownKeys = {};
  for (const visualPos of ['sud', 'nord', 'est', 'ouest']) {
    const existing = document.querySelector(`#trick-${visualPos} .card`);
    shownKeys[visualPos] = existing ? existing.dataset.cardKey : null;
  }
  clearCenterTrickSlots();

  for (const play of trick) {
    const visualPos = absToVisual[play.player];
    const slot = document.getElementById(`trick-${visualPos}`);
    if (!slot) continue;
    const key = `${play.card.suit}-${play.card.rank}`;
    // Pas de nouvelle animation d'entrée si la carte était déjà affichée au centre.
    const alreadyShown = shownKeys[visualPos] === key;
    const flyingFromMyHand = playCardAnim.running && playCardAnim.pendingKey === key;
    const cardEl = (alreadyShown || flyingFromMyHand) ? createTrickCardNoEntrance(play.card) : createTrickCard(play.card);
    if (flyingFromMyHand) {
      // Ma carte est encore en vol : on l'affiche à l'atterrissage.
      cardEl.style.visibility = 'hidden';
      setTimeout(() => { cardEl.style.visibility = ''; }, PLAY_CARD_ANIM_MS);
    }
    if (play.player === winnerAbsPos) cardEl.classList.add('trick-winner');
    slot.appendChild(cardEl);
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
        const previousState = gameState;
        gameState = queued;
        playStateTransitionEffects(previousState, queued);
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


// ============================================================
// EFFETS VISUELS (distribution, annonces, bannières)
// Tout est en transform/opacity pour rester fluide sur mobile.
// ============================================================

// Distribution 3-2-3 : 12 paquets, un toutes les DEAL_PACKET_STAGGER_MS.
// La durée totale doit rester < DEAL_ANIMATION_MS côté serveur (server.js).
const DEAL_PACKET_STAGGER_MS = 85;
const DEAL_CARD_SPREAD_MS = 28;
const DEAL_FLIGHT_MS = 340;
const DEAL_PACKETS = [3, 2, 3];
const DEAL_TOTAL_MS = 11 * DEAL_PACKET_STAGGER_MS + 2 * DEAL_CARD_SPREAD_MS + DEAL_FLIGHT_MS;
const SEAT_ORDER = ['sud', 'ouest', 'nord', 'est'];

let dealAnim = { id: null, start: 0, dealer: null, timer: null };

const prefersReducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function isDealing() {
  return dealAnim.id !== null && (performance.now() - dealAnim.start) < DEAL_TOTAL_MS;
}

function getDealSeatOrder(dealer) {
  const idx = Math.max(0, SEAT_ORDER.indexOf(dealer));
  return [1, 2, 3, 4].map(k => SEAT_ORDER[(idx + k) % 4]);
}

// Délai (ms depuis le début de la donne) auquel la carte n°cardIndex du joueur absPos part du paquet.
function getDealDelay(absPos, cardIndex) {
  const seatIdx = Math.max(0, getDealSeatOrder(dealAnim.dealer).indexOf(absPos));
  let round = 0;
  let packetStart = 0;
  while (round < DEAL_PACKETS.length - 1 && cardIndex >= packetStart + DEAL_PACKETS[round]) {
    packetStart += DEAL_PACKETS[round];
    round++;
  }
  const packetIdx = round * 4 + seatIdx;
  return packetIdx * DEAL_PACKET_STAGGER_MS + (cardIndex - packetStart) * DEAL_CARD_SPREAD_MS;
}

function getDeckCenter() {
  const deck = document.getElementById('deal-deck');
  const rect = deck ? deck.getBoundingClientRect() : null;
  if (rect && rect.width > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

// Applique l'animation "vol depuis le paquet" aux éléments (cartes de ma main ou dos adverses).
function applyDealAnimation(elements, absPos) {
  if (!isDealing() || !elements.length) return;
  const elapsed = performance.now() - dealAnim.start;
  const deck = getDeckCenter();
  // Lecture groupée des positions (un seul calcul de layout).
  const rects = elements.map(el => el.getBoundingClientRect());

  elements.forEach((el, i) => {
    const r = rects[i];
    if (!r.width) return;
    const delay = getDealDelay(absPos, i) - elapsed;
    if (delay + DEAL_FLIGHT_MS <= 0) return;
    el.style.setProperty('--deal-dx', `${Math.round(deck.x - (r.left + r.width / 2))}px`);
    el.style.setProperty('--deal-dy', `${Math.round(deck.y - (r.top + r.height / 2))}px`);
    el.style.setProperty('--deal-rot', `${((i * 47) % 36) - 18}deg`);
    el.style.setProperty('--deal-delay', `${Math.round(delay)}ms`);
    el.classList.add('deal-in');
  });
}

function getSeatInfoElement(absPos) {
  const visualPos = getAbsToVisual()[absPos];
  const nameEl = visualPos ? document.getElementById(`name-${visualPos}`) : null;
  return nameEl ? nameEl.parentElement : null;
}

// Pour les joueurs dont la main n'est pas affichée (téléphone), on fait voler un paquet vers leur pastille.
function spawnDealGhosts() {
  const layer = getOrCreateTrickAnimationLayer();
  const deck = getDeckCenter();
  const texturedClass = CARD_TEXTURES.enabled ? ' card-back--textured' : '';

  for (const absPos of SEAT_ORDER) {
    if (absPos === myPosition) continue;
    const visualPos = getAbsToVisual()[absPos];
    const handEl = document.getElementById(`hand-${visualPos}`);
    if (handEl && handEl.offsetParent !== null) continue; // main visible : animée directement

    const target = getSeatInfoElement(absPos);
    if (!target) continue;
    const tr = target.getBoundingClientRect();
    if (!tr.width) continue;
    const dx = tr.left + tr.width / 2 - deck.x;
    const dy = tr.top + tr.height / 2 - deck.y;

    let packetStart = 0;
    DEAL_PACKETS.forEach((size) => {
      const ghost = document.createElement('div');
      ghost.className = `card-back deal-ghost${texturedClass}`;
      ghost.style.left = `${deck.x}px`;
      ghost.style.top = `${deck.y}px`;
      ghost.style.opacity = '0';
      layer.appendChild(ghost);
      const anim = ghost.animate(
        [
          { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${dx > 0 ? 90 : -90}deg) scale(0.7)`, opacity: 0.15 }
        ],
        { duration: DEAL_FLIGHT_MS, delay: getDealDelay(absPos, packetStart), easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)', fill: 'backwards' }
      );
      packetStart += size;
      anim.finished.catch(() => null).then(() => ghost.remove());
    });
  }
}

function startDealAnimation(state) {
  if (prefersReducedMotion() || typeof Element.prototype.animate !== 'function') return;
  if (dealAnim.timer) clearTimeout(dealAnim.timer);
  dealAnim = { id: state.dealId, start: performance.now(), dealer: state.dealer, timer: null };
  document.body.classList.add('is-dealing');
  dealAnim.timer = setTimeout(() => {
    document.body.classList.remove('is-dealing');
    dealAnim.id = null;
  }, DEAL_TOTAL_MS + 60);
}

// ---- Pops au-dessus des sièges ----
function showSeatPop(absPos, text, variant = 'bid', delayMs = 0) {
  const show = () => {
    const anchor = getSeatInfoElement(absPos);
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (!rect.width) return;
    const visualPos = getAbsToVisual()[absPos];
    const pop = document.createElement('div');
    pop.className = `seat-pop pop-${variant}`;
    pop.textContent = text;
    const x = Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70);
    const y = visualPos === 'nord' ? rect.bottom + 22 : rect.top - 16;
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
    pop.addEventListener('animationend', () => pop.remove());
    document.body.appendChild(pop);
    // Sécurité si animationend n'est pas émis (onglet caché, motion réduit...)
    setTimeout(() => pop.remove(), 2200);
  };
  if (delayMs > 0) setTimeout(show, delayMs); else show();
}

function showCenterBanner(text, variant = 'contract', subtitle = '') {
  document.querySelectorAll('.center-banner').forEach(el => el.remove());
  const banner = document.createElement('div');
  banner.className = `center-banner banner-${variant}`;
  banner.textContent = text;
  if (subtitle) {
    const sub = document.createElement('small');
    sub.textContent = subtitle;
    banner.appendChild(sub);
  }
  banner.addEventListener('animationend', () => banner.remove());
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 2400);
}

function bumpElement(el) {
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth; // relance l'animation
  el.classList.add('bump');
}

const SUIT_SHORT = {
  coeur: '♥', carreau: '♦', trefle: '♣', pique: '♠', 'tout-atout': 'TA', 'sans-atout': 'SA'
};

function shortBidLabel(points) {
  if (points === 250) return 'Capot';
  if (points === 270) return 'Capot B.';
  if (points === 500) return 'Générale';
  return String(points);
}

// Fin de manche : on laisse voir le dernier pli + la bannière avant l'écran de résultat.
const ROUND_END_REVEAL_MS = 1700;
let roundEndRevealAt = 0;
let roundEndRevealTimer = null;

function isRevealingRoundEnd() {
  return performance.now() < roundEndRevealAt;
}

// Compare deux états successifs et déclenche les effets correspondants.
function playStateTransitionEffects(prev, next) {
  if (!prev || !next || prev.roomId !== next.roomId) return;
  const sameDeal = prev.dealId === next.dealId;

  // Nouvelle donne -> animation de distribution.
  if (!sameDeal && next.state === 'bidding') {
    startDealAnimation(next);
  }

  // Nouvelles annonces.
  let bigBannerShown = false;
  if (sameDeal && Array.isArray(next.bids) && Array.isArray(prev.bids) && next.bids.length > prev.bids.length) {
    for (const bid of next.bids.slice(prev.bids.length)) {
      if (!bid) continue;
      const who = next.players?.[bid.player]?.name || '';
      if (bid.type === 'pass') {
        showSeatPop(bid.player, 'Passe', 'pass');
      } else if (bid.type === 'coinche') {
        showSeatPop(bid.player, 'COINCHE !', 'coinche');
        showCenterBanner('COINCHE !', 'coinche', who);
        bigBannerShown = true;
      } else if (bid.type === 'surcoinche') {
        showSeatPop(bid.player, 'SURCOINCHE !', 'surcoinche');
        showCenterBanner('SURCOINCHE !', 'surcoinche', who);
        bigBannerShown = true;
      } else if (bid.type === 'bid') {
        showSeatPop(bid.player, `${shortBidLabel(bid.points)} ${SUIT_SHORT[bid.suit] || ''}`.trim(), 'bid');
        // Annonces spéciales : capot, capot beloté, générale.
        const special = { 250: 'CAPOT !', 270: 'CAPOT BELOTÉ !', 500: 'GÉNÉRALE !' }[bid.points];
        if (special) {
          showCenterBanner(special, 'special', who);
          bigBannerShown = true;
        }
      }
    }
  }

  // Fin des enchères -> bannière du contrat (après la bannière coinche/surcoinche le cas échéant).
  if (prev.state === 'bidding' && next.state === 'playing' && next.contract) {
    let text = `${shortBidLabel(next.contract.points)} ${SUIT_SHORT[next.contract.suit] || ''}`.trim();
    if (next.contract.surcoinched) text += ' ×3';
    else if (next.contract.coinched) text += ' ×2';
    if (bigBannerShown) setTimeout(() => showCenterBanner(text, 'contract'), 1300);
    else showCenterBanner(text, 'contract');
  }

  // Belote / Rebelote.
  if (sameDeal && next.beloteAnnounced && prev.beloteAnnounced) {
    const lastPlay = Array.isArray(next.playHistory) && next.playHistory.length
      ? next.playHistory[next.playHistory.length - 1]
      : null;
    for (const team of ['ns', 'eo']) {
      const before = prev.beloteAnnounced[team] || {};
      const after = next.beloteAnnounced[team] || {};
      for (const suit of Object.keys(after)) {
        if (after[suit] !== before[suit] && lastPlay) {
          showSeatPop(lastPlay.player, after[suit] === 'rebelote' ? 'Rebelote !' : 'Belote !', 'belote');
        }
      }
    }
  }

  // Pli remporté -> "+N" au-dessus du gagnant.
  const prevSig = getTrickSignature(prev.lastTrick);
  const nextSig = getTrickSignature(next.lastTrick);
  if (sameDeal && nextSig && nextSig !== prevSig && next.lastTrickWinner && next.roundPoints && prev.roundPoints) {
    const team = getTeamFromPos(next.lastTrickWinner);
    const gained = (next.roundPoints[team] || 0) - (prev.roundPoints[team] || 0);
    if (gained >= 0) showSeatPop(next.lastTrickWinner, `+${gained}`, 'points', TRICK_COLLECT_DELAY_MS);
  }

  // Fin de manche -> bannière réussite / chute, puis écran de résultat.
  if (prev.state === 'playing' && (next.state === 'scoring' || next.state === 'finished')) {
    const last = Array.isArray(next.roundHistory) ? next.roundHistory[0] : null;
    if (last) {
      showCenterBanner(last.contractMet ? 'Contrat réussi !' : 'Contrat chuté !', last.contractMet ? 'success' : 'fail');
    }
    if (!prefersReducedMotion()) {
      roundEndRevealAt = performance.now() + ROUND_END_REVEAL_MS;
      if (roundEndRevealTimer) clearTimeout(roundEndRevealTimer);
      roundEndRevealTimer = setTimeout(() => {
        roundEndRevealTimer = null;
        if (gameState) updateDisplay();
      }, ROUND_END_REVEAL_MS + 20);
    }
  }
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

function normalizeRoomId(roomId) {
  return (roomId || '').toString().trim().toUpperCase();
}

function isPublicRoomId(roomId) {
  return normalizeRoomId(roomId).startsWith('PUB-');
}

function getLobbyCodeFromUrlPath(pathname = window.location.pathname) {
  const match = (pathname || '').match(LOBBY_PATH_REGEX);
  if (!match || !match[1]) return null;
  try {
    return normalizeRoomId(decodeURIComponent(match[1]));
  } catch {
    return normalizeRoomId(match[1]);
  }
}

function buildLobbyPath(roomId) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) return '/';
  return `/lobby/${encodeURIComponent(normalized)}`;
}

function setLobbyPath(roomId, { replace = false } = {}) {
  const targetPath = buildLobbyPath(roomId);
  if (!window.history || !targetPath) return;
  if (window.location.pathname === targetPath) return;
  const fn = replace ? 'replaceState' : 'pushState';
  window.history[fn]({}, '', targetPath);
}

function setHomePath({ replace = false } = {}) {
  if (!window.history) return;
  if (window.location.pathname === '/') return;
  const fn = replace ? 'replaceState' : 'pushState';
  window.history[fn]({}, '', '/');
}

function getLobbySessionStorageKey(roomId) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) return null;
  return `${LOBBY_SESSION_STORAGE_PREFIX}${normalized}`;
}

function saveLobbySession(data) {
  const roomId = normalizeRoomId(data?.roomId);
  const sessionKey = (data?.sessionKey || '').toString().trim();
  const position = (data?.position || '').toString().trim();
  if (!roomId || !sessionKey || !position) return;

  const key = getLobbySessionStorageKey(roomId);
  if (!key) return;

  const playerNameFromInput = (document.getElementById('player-name')?.value || '').toString().trim();
  const payload = {
    roomId,
    sessionKey,
    position,
    playerName: (data?.playerName || playerNameFromInput || 'Joueur').slice(0, 20),
    isPublic: !!data?.isPublic,
    roomName: data?.roomName || null,
    savedAt: Date.now()
  };

  try {
    localStorage.setItem(key, JSON.stringify(payload));
    localStorage.setItem(LAST_LOBBY_STORAGE_KEY, roomId);
  } catch {
    // Ignore storage failures.
  }
}

function loadLobbySession(roomId) {
  const key = getLobbySessionStorageKey(roomId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || normalizeRoomId(parsed.roomId) !== normalizeRoomId(roomId)) return null;
    if (!parsed.sessionKey || !parsed.position) return null;
    return parsed;
  } catch {
    return null;
  }
}

function removeLobbySession(roomId) {
  const normalized = normalizeRoomId(roomId);
  if (!normalized) return;
  const key = getLobbySessionStorageKey(normalized);
  if (!key) return;
  try {
    localStorage.removeItem(key);
    if (localStorage.getItem(LAST_LOBBY_STORAGE_KEY) === normalized) {
      localStorage.removeItem(LAST_LOBBY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

function getPreferredPlayerName() {
  return (document.getElementById('player-name')?.value || '').toString().trim().slice(0, 20) || 'Joueur';
}

function prefillLobbyFromUrlPath() {
  const lobbyCode = getLobbyCodeFromUrlPath();
  if (!lobbyCode || isPublicRoomId(lobbyCode)) return;

  const roomCodeInput = document.getElementById('room-code');
  if (roomCodeInput && !roomCodeInput.value.trim()) {
    roomCodeInput.value = lobbyCode;
  }
}

function attemptRoomReconnectFromUrl() {
  const lobbyCode = getLobbyCodeFromUrlPath();
  if (!lobbyCode) return;

  const session = loadLobbySession(lobbyCode);
  if (session?.playerName) {
    const playerNameInput = document.getElementById('player-name');
    if (playerNameInput && !playerNameInput.value.trim()) {
      playerNameInput.value = session.playerName;
    }
  }

  if (session?.sessionKey) {
    socket.emit('reconnect-room', {
      roomId: lobbyCode,
      sessionKey: session.sessionKey,
      name: session.playerName || getPreferredPlayerName(),
      texturePack: getPreferredTexturePackForRequest()
    });
    return;
  }

  if (!isPublicRoomId(lobbyCode)) {
    socket.emit('get-available-positions', { roomId: lobbyCode });
  }
}

function handleRoomEntry(data, { clearChatMessages = true, ownerFallback = false } = {}) {
  myRoom = normalizeRoomId(data?.roomId);
  myPosition = data?.position || null;
  isRoomOwner = typeof data?.isOwner === 'boolean' ? data.isOwner : ownerFallback;

  if (data?.playerName) {
    const playerNameInput = document.getElementById('player-name');
    if (playerNameInput) {
      playerNameInput.value = data.playerName;
    }
  }

  updateWaitingRoomRoomInfo(data);
  if (clearChatMessages) {
    clearChat();
    ensurePrivateLobbyCodeFirstChatMessage(data);
  }

  saveLobbySession(data);
  if (myRoom) setLobbyPath(myRoom, { replace: true });
  showScreen('waiting');
}

prefillLobbyFromUrlPath();
initLobbyTexturePicker();

// ---- Screen management ----
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function resetToLobbyAfterLeavingRoom(roomId = myRoom) {
  const normalizedRoom = normalizeRoomId(roomId || myRoom);
  if (normalizedRoom) removeLobbySession(normalizedRoom);

  myRoom = null;
  myPosition = null;
  gameState = null;
  isRoomOwner = false;
  pendingRoomLeave = false;

  const panel = document.getElementById('round-result');
  if (panel) panel.classList.add('hidden');

  setHomePath({ replace: true });
  showScreen('lobby');
  requestPublicRooms();
}

// ---- Lobby ----
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Joueur';
  const position = document.getElementById('create-position').value;
  socket.emit('create-room', { name, position, texturePack: getPreferredTexturePackForRequest() });
});

// Type d'IA à ajouter (Legacy / Règles), mémorisé entre les parties.
const BOT_MODE_STORAGE_KEY = 'coinche:bot-mode';
(() => {
  const select = document.getElementById('bot-mode-select');
  if (!select) return;
  try {
    const saved = localStorage.getItem(BOT_MODE_STORAGE_KEY);
    if (saved === 'rule' || saved === 'legacy') select.value = saved;
  } catch { /* ignore */ }
})();

const addBotBtn = document.getElementById('btn-add-bot');
if (addBotBtn) {
  addBotBtn.addEventListener('click', () => {
    if (!addBotWarningShown) {
      const ok = window.confirm(
        'Ajouter une IA ?\n\n⚠️ Attention : les IA sont encore en béta, elles ont un niveau acceptable, mais restent peu ouf en Sans Atouts/Tout Atouts.'
      );
      if (!ok) return;
      addBotWarningShown = true;
    }
    const modeSelect = document.getElementById('bot-mode-select');
    const mode = modeSelect && modeSelect.value === 'rule' ? 'rule' : 'legacy';
    try { localStorage.setItem(BOT_MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
    socket.emit('add-bot', { mode });
  });
}

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

  socket.emit('join-room', { name, roomId, position, texturePack: getPreferredTexturePackForRequest() });
});

const publicCreateBtn = document.getElementById('btn-public-create');
if (publicCreateBtn) {
  publicCreateBtn.addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim() || 'Joueur';
    socket.emit('create-public-room', { name, texturePack: getPreferredTexturePackForRequest() });
  });
}

const publicJoinBtn = document.getElementById('btn-public-join');
if (publicJoinBtn) {
  publicJoinBtn.addEventListener('click', () => {
    requestPublicRooms();
  });
}

if (publicRoomsUi.refreshBtn) {
  publicRoomsUi.refreshBtn.addEventListener('click', () => {
    requestPublicRooms();
  });
}

const quickPlayBtn = document.getElementById('btn-quick-play');
if (quickPlayBtn) {
  // Compatibilite si l'ancien bouton est encore present
  quickPlayBtn.addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim() || 'Joueur';
    socket.emit('join-public-room', { name, texturePack: getPreferredTexturePackForRequest() });
  });
}

// Update available positions when typing room code
document.getElementById('room-code').addEventListener('input', (e) => {
  const code = e.target.value.trim();
  if (code.length === 6) {
    socket.emit('get-available-positions', { roomId: code });
  }
});

function requestPublicRooms() {
  socket.emit('list-public-rooms');
}

function renderPublicRooms(rooms) {
  if (!publicRoomsUi.list) return;

  publicRoomsUi.list.innerHTML = '';

  if (!Array.isArray(rooms) || rooms.length === 0) {
    publicRoomsUi.list.innerHTML = '<div class="public-rooms-empty">Aucune salle publique disponible pour le moment.</div>';
    return;
  }

  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'public-room-entry';

    const meta = document.createElement('div');
    meta.className = 'public-room-meta';
    // Le nom de salle est choisi par un joueur : texte uniquement, jamais en HTML.
    const title = document.createElement('div');
    title.className = 'public-room-title';
    title.textContent = String(room.roomName || room.displayCode || room.roomId || '');
    const subtitle = document.createElement('div');
    subtitle.className = 'public-room-subtitle';
    subtitle.textContent = `${Number(room.playerCount) || 0}/4 joueurs · ${Number(room.freeSeats) || 0} place(s) libre(s)`;
    meta.append(title, subtitle);

    const joinBtn = document.createElement('button');
    joinBtn.className = 'btn btn-secondary btn-sm';
    joinBtn.type = 'button';
    joinBtn.textContent = 'Rejoindre';
    joinBtn.addEventListener('click', () => {
      const name = document.getElementById('player-name').value.trim() || 'Joueur';
      socket.emit('join-public-room', {
        name,
        roomId: room.roomId,
        texturePack: getPreferredTexturePackForRequest()
      });
    });

    row.appendChild(meta);
    row.appendChild(joinBtn);
    publicRoomsUi.list.appendChild(row);
  }
}

socket.on('public-rooms', (data) => {
  renderPublicRooms(data?.rooms || []);
});

socket.on('public-room-closed', () => {
  if (myRoom) removeLobbySession(myRoom);
  myRoom = null;
  myPosition = null;
  gameState = null;
  setHomePath({ replace: true });
  showScreen('lobby');
  requestPublicRooms();
});

socket.on('room-left', (data) => {
  const leftRoom = normalizeRoomId(data?.roomId || myRoom);
  const backHomeBtn = document.getElementById('btn-back-home');
  if (backHomeBtn) backHomeBtn.disabled = false;
  resetToLobbyAfterLeavingRoom(leftRoom);
});

setInterval(() => {
  if (!screens?.lobby || screens.lobby.classList.contains('hidden')) return;
  requestPublicRooms();
}, PUBLIC_ROOMS_REFRESH_MS);

requestPublicRooms();

socket.on('connect', () => {
  socket.emit('get-texture-packs');
  attemptRoomReconnectFromUrl();
});

socket.on('reconnect-failed', (data) => {
  const failedRoom = normalizeRoomId(data?.roomId || getLobbyCodeFromUrlPath());
  if (failedRoom) removeLobbySession(failedRoom);
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

function updateWaitingRoomRoomInfo(data) {
  const display = document.getElementById('room-code-display');
  const help = document.getElementById('waiting-room-help');
  const isPublic = !!data?.isPublic;

  if (display) {
    display.textContent = isPublic
      ? (data.roomName || data.displayCode || data.roomId || '')
      : (data.displayCode || data.roomId || '');
  }

  if (help) {
    help.textContent = isPublic
      ? 'Partagez ce nom de salle avec vos amis !'
      : 'Partagez ce code de salle avec vos amis !';
  }
}

function getPrivateLobbyCodeFromRoomEvent(data) {
  if (!data) return null;
  if (data.isPublic) return null;
  const code = (data.displayCode || data.roomId || '').toString().trim().toUpperCase();
  if (!code) return null;
  // Private room codes are 6 characters (generated by server). Keep it flexible but bounded.
  return code.slice(0, 12);
}

function ensurePrivateLobbyCodeFirstChatMessage(data) {
  const code = getPrivateLobbyCodeFromRoomEvent(data);
  if (!code) return;
  if (!chatElements.container) return;

  const row = document.createElement('div');
  row.className = 'chat-msg system';

  const author = document.createElement('div');
  author.className = 'chat-author';
  author.textContent = 'Lobby';

  const body = document.createElement('div');
  body.className = 'chat-text';
  body.textContent = `Code de la partie privée : ${code}`;

  row.appendChild(author);
  row.appendChild(body);

  // Insert as the very first message.
  chatElements.container.insertBefore(row, chatElements.container.firstChild);
  while (chatElements.container.children.length > CHAT_MAX_MESSAGES) {
    chatElements.container.removeChild(chatElements.container.lastChild);
  }
  chatElements.container.scrollTop = chatElements.container.scrollHeight;
}

// ---- Socket events ----
socket.on('room-created', (data) => {
  handleRoomEntry(data, { clearChatMessages: true, ownerFallback: true });
});

socket.on('room-joined', (data) => {
  handleRoomEntry(data, { clearChatMessages: true, ownerFallback: false });
});

socket.on('room-reconnected', (data) => {
  handleRoomEntry(data, { clearChatMessages: false, ownerFallback: false });
});

socket.on('kicked-from-room', (data) => {
  const kickedRoom = normalizeRoomId(data?.roomId || myRoom);
  if (kickedRoom) removeLobbySession(kickedRoom);
  myRoom = null;
  myPosition = null;
  gameState = null;
  isRoomOwner = false;
  setHomePath({ replace: true });
  showScreen('lobby');
  requestPublicRooms();
});

socket.on('error-msg', (data) => {
  const message = (data?.message || '').toString();
  const roomIsClosedError =
    message.includes('Salle fermée') ||
    message.includes('n\'existe plus') ||
    message.includes('Session expirée');

  if (roomIsClosedError && myRoom) {
    removeLobbySession(myRoom);
    myRoom = null;
    myPosition = null;
    gameState = null;
    setHomePath({ replace: true });
    showScreen('lobby');
  }

  showError(message);
});

socket.on('message', (data) => {
  addMessage(data.text, data.type);
});

socket.on('chat-message', (data) => {
  addChatMessage(data);
});

socket.on('texture-pack-options', (data) => {
  applyTexturePackOptions(data || {});
});

socket.on('texture-pack', (data) => {
  applyTexturePackOptions(data || {});

  const targetPack = normalizeTexturePackName(data?.pack)
    || normalizeTexturePackName(data?.defaultPack)
    || availableTexturePacks[0]
    || 'Classic';

  setTexturePack(targetPack, { rerender: true, persist: true });
});

// game-state handled below with transition detection

// ---- Messages ----
// Sur téléphone, ces messages sont déjà représentés par des animations (pops / bannières) :
// on évite de les empiler en plus sur la table.
const PHONE_REDUNDANT_MESSAGE = /remporte le pli|COINCHE|Contrat:|Contrat réussi|Contrat chuté|: (belote|rebelote) !|rejoint la salle|a créé la salle|La partie commence|Nouvelle manche/i;

function addMessage(text, type = 'info') {
  if (isPhoneUi() && PHONE_REDUNDANT_MESSAGE.test(String(text || ''))) return;
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
// Points d'accroche pour les modules d'interface chargés après ce fichier
// (public/teams.js, public/stats.js, public/emotes.js...). Chaque fonction de
// uiHooks.afterUpdate est appelée après chaque mise à jour de l'affichage.
const uiHooks = { afterUpdate: [] };

function runAfterUpdateHooks() {
  for (const fn of uiHooks.afterUpdate) {
    try {
      fn(gameState);
    } catch (err) {
      console.error('[uiHooks] erreur :', err);
    }
  }
}

function updateDisplay() {
  if (!gameState) return;

  if (gameState.state === 'waiting') {
    showScreen('waiting');
    updateWaitingRoom();
    runAfterUpdateHooks();
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
  runAfterUpdateHooks();
}

function updateWaitingRoom() {
  const posNames = { sud: 'Sud', nord: 'Nord', est: 'Est', ouest: 'Ouest' };

  const addBotControls = document.getElementById('add-bot-controls');
  if (addBotControls) {
    const canAddBot = isRoomOwner && gameState?.state === 'waiting';
    addBotControls.classList.toggle('hidden', !canAddBot);
  }

  const me = gameState.myPosition || myPosition;
  const canMove = gameState.state === 'waiting';

  for (const pos of ['sud', 'nord', 'est', 'ouest']) {
    const slot = document.getElementById(`slot-${pos}`);
    const nameEl = slot.querySelector('.slot-name');
    const isFree = !gameState.players[pos];
    const isMine = pos === me;

    if (!isFree) {
      const player = gameState.players[pos];
      const suffix = isMine ? ' (moi)' : '';
      const aiTag = player.ai ? ` · IA ${player.ai === 'rule' ? 'Règles' : 'Legacy'}` : '';
      const showTag = player.ai && !/legacy|règles/i.test(player.name);
      nameEl.textContent = `${player.name}${suffix}${showTag ? aiTag : ''}`;
    } else {
      nameEl.textContent = canMove ? 'Libre, clique pour t\'y placer' : 'En attente...';
    }

    slot.classList.toggle('occupied', !isFree);
    slot.classList.toggle('mine', isMine);
    slot.classList.toggle('free', isFree && canMove);
    if (isFree && canMove) {
      slot.setAttribute('role', 'button');
      slot.setAttribute('tabindex', '0');
      slot.setAttribute('aria-label', `Se placer en ${posNames[pos] || pos}`);
    } else {
      slot.removeAttribute('role');
      slot.removeAttribute('tabindex');
      slot.removeAttribute('aria-label');
    }
  }
}

// Clic (ou Entrée / Espace) sur un siège libre de la salle d'attente : on s'y place.
function requestSeatChange(pos) {
  if (!gameState || gameState.state !== 'waiting') return;
  if (gameState.players[pos]) return;
  socket.emit('change-seat', { position: pos });
}

for (const pos of ['sud', 'nord', 'est', 'ouest']) {
  const slot = document.getElementById(`slot-${pos}`);
  if (!slot) continue;
  slot.addEventListener('click', () => requestSeatChange(pos));
  slot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      requestSeatChange(pos);
    }
  });
}

socket.on('seat-changed', (data) => {
  if (!data || !data.position) return;
  myPosition = data.position;
  if (typeof data.isOwner === 'boolean') isRoomOwner = data.isOwner;
  saveLobbySession(data);
  if (gameState) updateDisplay();
});

function setTextWithBump(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = String(value);
  if (el.textContent === text) return;
  const hadValue = el.textContent !== '';
  el.textContent = text;
  if (hadValue) bumpElement(el);
}

function updateScoreboard() {
  setTextWithBump('score-ns', gameState.scores.ns);
  setTextWithBump('score-eo', gameState.scores.eo);
}

function updatePlayers() {
  const absToVisual = getAbsToVisual();
  const positions = ['sud', 'ouest', 'nord', 'est'];
  const posNames = { sud: 'Sud', nord: 'Nord', est: 'Est', ouest: 'Ouest' };

  for (const absPos of positions) {
    const visualPos = absToVisual[absPos];
    const nameEl = document.getElementById(`name-${visualPos}`);
    const cardsEl = document.getElementById(`cards-${visualPos}`);
    const handEl = document.getElementById(`hand-${visualPos}`);
    const infoEl = nameEl ? nameEl.parentElement : null;

    if (gameState.players[absPos]) {
      const baseName = absPos === myPosition
        ? `${gameState.players[absPos].name} (moi)`
        : gameState.players[absPos].name;
      const withPosition = `${baseName} - ${posNames[absPos] || absPos}`;
      if (nameEl) nameEl.textContent = withPosition;
    }

    if (cardsEl) {
      cardsEl.textContent = gameState.cardsLeft[absPos] || 0;
    }

    // Card backs for other players (re-rendered only when the count changes)
    if (handEl && absPos !== myPosition) {
      const count = gameState.cardsLeft[absPos] || 0;
      const key = `${absPos}:${count}:${dealAnim.id ?? ''}`;
      if (handEl.dataset.renderKey !== key) {
        handEl.dataset.renderKey = key;
        handEl.innerHTML = createCardBacks(count);
        if (isDealing() && handEl.offsetParent !== null) {
          applyDealAnimation(Array.from(handEl.children), absPos);
        }
      }
    }

    // Active indicator
    if (infoEl) {
      infoEl.classList.toggle('active', gameState.currentPlayer === absPos);
      infoEl.classList.toggle('dealer', gameState.dealer === absPos);
    }
  }
}

function getBidLogoUrlForSuit(suit) {
  // Dedicated suit icons (transparent PNG) stored under /public/logo.
  const suitMap = {
    coeur: 'COEUR.png',
    carreau: 'CARREAU.png',
    trefle: 'TREFLE.png',
    pique: 'PIC.png',
    'tout-atout': 'TA.png',
    'sans-atout': 'SA.png'
  };
  const file = suitMap[suit];
  if (!file) return null;
  return `/logo/${file}`;
}

function ensureBidBubbleEl(playerAreaEl) {
  if (!playerAreaEl) return null;
  let el = playerAreaEl.querySelector('.bid-bubble');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'bid-bubble hidden';
  el.innerHTML = `
    <div class="bid-bubble__inner">
      <img class="bid-bubble__logo" alt="" />
      <span class="bid-bubble__points"></span>
    </div>
  `;
  // Prefer anchoring to the info header so placement is consistent across orientations.
  const info = playerAreaEl.querySelector('.player-info');
  (info || playerAreaEl).appendChild(el);
  return el;
}

function updateBidBubbles() {
  // Temporarily disable bubbles on mobile UI.
  if (isPhoneUi()) {
    hideAllBidBubbles();
    return;
  }

  const absToVisual = getAbsToVisual();
  const positions = ['sud', 'ouest', 'nord', 'est'];

  // Gather latest bid per player (only actual bids with points).
  const latestByPlayer = {};
  if (gameState && Array.isArray(gameState.bids)) {
    for (const b of gameState.bids) {
      if (b && b.type === 'bid' && typeof b.points === 'number' && b.suit) {
        latestByPlayer[b.player] = b;
      }
    }
  }

  for (const absPos of positions) {
    const visualPos = absToVisual[absPos];
    // DOM uses english seat classes: .player-north/.player-south/.player-east/.player-west
    const seatClass = {
      sud: 'south',
      nord: 'north',
      est: 'east',
      ouest: 'west'
    }[visualPos] || visualPos;

    const playerArea = document.querySelector(`.player-area.player-${seatClass}`);
    const bubble = ensureBidBubbleEl(playerArea);
    if (!bubble) continue;

    if (!gameState || gameState.state !== 'bidding') {
      bubble.classList.add('hidden');
      continue;
    }

    const bid = latestByPlayer[absPos];
    if (!bid) {
      bubble.classList.add('hidden');
      continue;
    }

    const logoUrl = getBidLogoUrlForSuit(bid.suit);
    const img = bubble.querySelector('.bid-bubble__logo');
    const pointsEl = bubble.querySelector('.bid-bubble__points');

    if (img) {
      if (logoUrl) {
        img.src = logoUrl;
        img.classList.remove('hidden');
      } else {
        img.removeAttribute('src');
        img.classList.add('hidden');
      }
    }
    if (pointsEl) pointsEl.textContent = String(bid.points);

    bubble.classList.remove('hidden');
  }
}

function hideAllBidBubbles() {
  document.querySelectorAll('.bid-bubble').forEach((el) => el.classList.add('hidden'));
}

function updateTrick() {
  const absToVisual = getAbsToVisual();

  // Build desired state for current trick per visual position.
  const desiredCurrent = { sud: null, nord: null, est: null, ouest: null };
  const showFinalTrick =
    (gameState.state === 'scoring' || gameState.state === 'finished') &&
    isRevealingRoundEnd() &&
    Array.isArray(gameState.lastTrick) && gameState.lastTrick.length === 4;
  const centerTrick = showFinalTrick ? gameState.lastTrick : gameState.currentTrick;
  if (centerTrick && centerTrick.length > 0) {
    for (const play of centerTrick) {
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

  const isMyPlayTurn = gameState.state === 'playing' && gameState.currentPlayer === myPosition;
  myHand.classList.toggle('is-my-turn', isMyPlayTurn);

  // Éventail : légère rotation + arc selon la position de la carte dans la main.
  const n = gameState.hand.length;
  const mid = (n - 1) / 2;
  const phone = isMobilePortraitGameplay();
  const rotStep = phone ? 2.4 : 3;
  const arc = phone ? 1.6 : 2.2;
  const cardEls = [];

  gameState.hand.forEach((card, i) => {
    const key = `${card.suit}-${card.rank}`;
    const isPlayable = isMyPlayTurn && playableSet.has(key);
    const el = createCardElement(card, isPlayable);
    const offset = i - mid;
    el.style.setProperty('--fan-rot', `${(offset * rotStep).toFixed(2)}deg`);
    // Arc vers le haut : la carte du milieu est la plus haute, les bords restent en place.
    el.style.setProperty('--fan-y', `${((offset * offset - mid * mid) * arc).toFixed(1)}px`);
    myHand.appendChild(el);
    cardEls.push(el);
  });

  if (isDealing()) applyDealAnimation(cardEls, myPosition);
}

function updateBidding() {
  const panel = document.getElementById('bidding-panel');

  if (gameState.state !== 'bidding') {
    panel.classList.add('hidden');
    hideAllBidBubbles();
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
      let label = '';
      if (bid.type === 'pass') {
        div.className = 'bid-entry';
        label = 'passe';
      } else if (bid.type === 'coinche') {
        div.className = 'bid-entry coinche';
        label = 'COINCHE !';
      } else if (bid.type === 'surcoinche') {
        div.className = 'bid-entry surcoinche';
        label = 'SURCOINCHE !';
      } else if (bid.type === 'bid') {
        div.className = 'bid-entry is-bid';
        label = `${formatBidPoints(bid.points)} ${suitNames[bid.suit] || bid.suit}`;
      }
      // Le nom vient d'un autre joueur : toujours en texte, jamais en HTML.
      const strong = document.createElement('strong');
      strong.textContent = String(name ?? '');
      div.append(strong, ` ${label}`);
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
  // Coinche / surcoinche : possibles à tout moment des enchères, sans attendre son tour.
  const canCoinche = !!gameState.contract &&
    getTeamFromPos(gameState.contract.player) !== getTeamFromPos(myPosition) &&
    !gameState.bids.some(b => b.type === 'coinche');
  document.getElementById('btn-coinche').disabled = !canCoinche;

  // Surcoinche
  const canSurcoinche =
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

  // Per-player visual bubbles above each seat during bidding.
  updateBidBubbles();
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
    el.classList.toggle('is-coinched', !!(gameState.contract.coinched || gameState.contract.surcoinched));
  } else {
    el.classList.add('hidden');
  }
}

function updateRoundPoints() {
  if (gameState.roundPoints) {
    setTextWithBump('round-ns', gameState.roundPoints.ns);
    setTextWithBump('round-eo', gameState.roundPoints.eo);
  }
}

function updateTurnIndicator() {
  const el = document.getElementById('turn-indicator');
  if (!gameState.currentPlayer) {
    el.textContent = '';
    return;
  }

  const isMe = gameState.currentPlayer === myPosition &&
    (gameState.state === 'bidding' || gameState.state === 'playing');
  el.classList.toggle('is-me', isMe);

  if (gameState.state !== 'bidding' && gameState.state !== 'playing') {
    el.textContent = '';
    el.classList.remove('is-me');
    return;
  }

  if (gameState.currentPlayer === myPosition) {
    el.textContent = gameState.state === 'bidding' ? 'À vous d\'annoncer !' : 'À vous de jouer !';
  } else {
    const name = gameState.players[gameState.currentPlayer]
      ? gameState.players[gameState.currentPlayer].name
      : gameState.currentPlayer;
    el.textContent = `En attente de ${name}...`;
  }
}

function updateRoundResult() {
  const panel = document.getElementById('round-result');

  if ((gameState.state === 'scoring' || gameState.state === 'finished') && !isRevealingRoundEnd()) {
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

document.getElementById('btn-back-home').addEventListener('click', () => {
  const backHomeBtn = document.getElementById('btn-back-home');

  if (!myRoom) {
    if (backHomeBtn) backHomeBtn.disabled = false;
    resetToLobbyAfterLeavingRoom(null);
    return;
  }

  pendingRoomLeave = true;
  if (backHomeBtn) backHomeBtn.disabled = true;
  socket.emit('leave-room');
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
  if (pendingRoomLeave) return;

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

  const previousState = gameState;
  gameState = state;
  playStateTransitionEffects(previousState, state);
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
  const btnBackHome = document.getElementById('btn-back-home');

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
    if (btnBackHome) {
      btnBackHome.classList.remove('hidden');
      btnBackHome.disabled = pendingRoomLeave;
    }
  } else {
    title.textContent = 'Fin de manche';
    title.className = '';
    details.innerHTML = `
      Score: NS <strong>${state.scores.ns}</strong> - EO <strong>${state.scores.eo}</strong><br>
      Points manche: NS <strong>${state.roundPoints.ns}</strong> - EO <strong>${state.roundPoints.eo}</strong>
    `;
    btnNext.classList.remove('hidden');
    btnNew.classList.add('hidden');
    if (btnBackHome) {
      btnBackHome.classList.add('hidden');
      btnBackHome.disabled = false;
    }
  }
}

// Enter key for inputs
document.getElementById('player-name').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});

document.getElementById('room-code').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});
