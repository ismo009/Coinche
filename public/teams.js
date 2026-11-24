// ============================================================
// Cari'Coinche — noms d'équipe (Nord-Sud = 'ns', Est-Ouest = 'eo')
// Script classique chargé après game-client.js : il utilise les globales
// socket, gameState, myPosition, getTeamFromPos et uiHooks.afterUpdate.
// SÉCURITÉ : les noms viennent des joueurs -> uniquement textContent.
// ============================================================
(function () {
  'use strict';

  const TEAMS = ['ns', 'eo'];
  const DEFAULT_NAMES = { ns: 'Nord-Sud', eo: 'Est-Ouest' };
  const SHORT_NAMES = { ns: 'NS', eo: 'EO' };
  const MAX_LENGTH = 24;

  // ---------- Utilitaires ----------
  function teamName(state, team) {
    const name = state && state.teamNames && state.teamNames[team];
    return typeof name === 'string' && name ? name : DEFAULT_NAMES[team];
  }

  function isCustomName(state, team) {
    return teamName(state, team) !== DEFAULT_NAMES[team];
  }

  function getMyTeam() {
    const pos = (gameState && gameState.myPosition) || myPosition;
    return pos ? getTeamFromPos(pos) : null;
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  // Nom d'équipe en ligne (coloré, tronqué en CSS).
  function inlineName(state, team) {
    const span = make('span', `teams-inline team-${team}`, teamName(state, team));
    span.title = teamName(state, team);
    return span;
  }

  function sendTeamName(raw) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
    socket.emit('set-team-name', { name });
  }

  // Formulaire « champ + bouton Nommer » (salle d'attente et popover en jeu).
  function buildRenameForm(idSuffix, onDone) {
    const form = make('form', 'teams-rename-form');
    form.setAttribute('autocomplete', 'off');
    const inputId = `teams-rename-input-${idSuffix}`;
    const label = make('label', 'teams-rename-label', 'Nom de ton équipe');
    label.setAttribute('for', inputId);
    const row = make('div', 'teams-rename-row');
    const input = make('input', 'teams-rename-input');
    input.type = 'text';
    input.id = inputId;
    input.maxLength = MAX_LENGTH;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    const button = make('button', 'btn btn-primary btn-sm teams-rename-btn', 'Nommer');
    button.type = 'submit';
    row.append(input, button);
    form.append(label, row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendTeamName(input.value);
      input.dataset.dirty = '';
      input.blur();
      if (onDone) onDone();
    });
    input.addEventListener('input', () => { input.dataset.dirty = '1'; });
    return { form, input, label };
  }

  // Remplit le champ avec le nom actuel (vide = nom par défaut), sauf pendant la saisie.
  function syncInput(input, state, team) {
    if (!input || !team) return;
    input.placeholder = DEFAULT_NAMES[team];
    if (document.activeElement === input || input.dataset.dirty === '1') return;
    input.value = isCustomName(state, team) ? teamName(state, team) : '';
  }

  // ---------- Salle d'attente ----------
  const waiting = { chips: {}, form: null };

  function initWaitingRoom() {
    const info = document.querySelector('#waiting-room .team-info');
    if (!info) return;
    info.textContent = '';
    info.classList.add('teams-info');
    for (const team of TEAMS) {
      const chip = make('span', `teams-chip team-${team}`);
      const name = make('span', 'teams-chip-name');
      const seats = make('span', 'teams-chip-seats', team === 'ns' ? 'Nord ↔ Sud' : 'Ouest ↔ Est');
      chip.append(name, seats);
      waiting.chips[team] = { chip, name };
      if (team === 'ns') {
        info.append(chip, make('span', 'teams-vs', 'vs'));
      } else {
        info.append(chip);
      }
    }
    waiting.form = buildRenameForm('waiting');
    waiting.form.form.classList.add('teams-rename-waiting');
    info.insertAdjacentElement('afterend', waiting.form.form);
  }

  function updateWaitingRoom(state) {
    const mine = getMyTeam();
    for (const team of TEAMS) {
      const c = waiting.chips[team];
      if (!c) continue;
      c.name.textContent = teamName(state, team);
      c.chip.title = teamName(state, team);
      c.chip.classList.toggle('is-mine', team === mine);
    }
    if (waiting.form) {
      waiting.form.form.classList.toggle('hidden', !mine);
      waiting.form.label.textContent = mine
        ? `Nom de ton équipe (${mine === 'ns' ? 'Nord ↔ Sud' : 'Ouest ↔ Est'})`
        : 'Nom de ton équipe';
      syncInput(waiting.form.input, state, mine);
    }
  }

  // ---------- Popover de renommage en jeu ----------
  const pop = { root: null, form: null };

  function initPopover() {
    pop.root = make('div', 'teams-pop hidden');
    pop.root.id = 'teams-rename-pop';
    pop.root.setAttribute('role', 'dialog');
    pop.root.setAttribute('aria-label', 'Renommer ton équipe');
    pop.form = buildRenameForm('game', closePopover);
    const close = make('button', 'teams-pop-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer');
    close.addEventListener('click', closePopover);
    const hint = make('p', 'teams-pop-hint', 'Vide = nom par défaut. Aussi : /team <nom> dans le chat.');
    pop.root.append(close, pop.form.form, hint);
    pop.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePopover();
    });
    document.getElementById('game-table')?.appendChild(pop.root);

    document.addEventListener('pointerdown', (e) => {
      if (pop.root.classList.contains('hidden')) return;
      if (pop.root.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#scoreboard .team-label.is-mine')) return;
      closePopover();
    });
  }

  function openPopover() {
    const mine = getMyTeam();
    if (!pop.root || !mine) return;
    pop.form.input.dataset.dirty = '';
    syncInput(pop.form.input, gameState, mine);
    pop.root.classList.remove('hidden');
    pop.form.input.focus();
    pop.form.input.select();
  }

  function closePopover() {
    if (pop.root) pop.root.classList.add('hidden');
  }

  function togglePopover() {
    if (!pop.root) return;
    if (pop.root.classList.contains('hidden')) openPopover();
    else closePopover();
  }

  // ---------- Scoreboard ----------
  const scoreLabels = {};

  // Remplace le texte d'un élément par deux variantes : nom complet / abrégé (téléphone).
  function splitLabel(target, team) {
    const full = make('span', 'teams-full');
    const short = make('span', 'teams-short', SHORT_NAMES[team]);
    target.textContent = '';
    target.append(full, short);
    return full;
  }

  function initScoreboard() {
    for (const team of TEAMS) {
      const label = document.querySelector(`#scoreboard .team-label.team-${team}`);
      if (!label) continue;
      scoreLabels[team] = { label, full: splitLabel(label, team) };
      label.addEventListener('click', () => {
        if (label.classList.contains('is-mine')) togglePopover();
      });
      label.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && label.classList.contains('is-mine')) {
          e.preventDefault();
          togglePopover();
        }
      });
    }
  }

  function updateScoreboard(state) {
    const mine = getMyTeam();
    for (const team of TEAMS) {
      const s = scoreLabels[team];
      if (!s) continue;
      const name = teamName(state, team);
      s.full.textContent = name;
      const isMine = team === mine;
      s.label.classList.toggle('is-mine', isMine);
      s.label.title = isMine ? `${name} — clique pour renommer ton équipe` : name;
      if (isMine) {
        s.label.setAttribute('role', 'button');
        s.label.setAttribute('tabindex', '0');
        s.label.setAttribute('aria-label', `${name} : renommer ton équipe`);
      } else {
        s.label.removeAttribute('role');
        s.label.removeAttribute('tabindex');
        s.label.removeAttribute('aria-label');
      }
    }
  }

  // ---------- Points de la manche ----------
  const roundLabels = {};

  function initRoundPoints() {
    for (const team of TEAMS) {
      const span = document.querySelector(`#round-points > .team-${team}`);
      if (!span) continue;
      // Le premier nœud est le texte « NS: » ; on garde intact #round-ns / #round-eo.
      const first = span.firstChild;
      if (!first || first.nodeType !== Node.TEXT_NODE) continue;
      const label = make('span', 'teams-rp-label');
      const full = splitLabel(label, team);
      span.replaceChild(label, first);
      span.insertBefore(document.createTextNode(' '), label.nextSibling);
      roundLabels[team] = { span, full };
    }
  }

  function updateRoundPoints(state) {
    for (const team of TEAMS) {
      const r = roundLabels[team];
      if (!r) continue;
      r.full.textContent = teamName(state, team);
      r.span.title = teamName(state, team);
    }
  }

  // Petit tableau « équipe | colonne 1 | colonne 2... » (fin de manche, historique).
  function buildScoreGrid(state, className, columns) {
    const grid = make('div', `teams-grid ${className}`);
    grid.style.setProperty('--teams-cols', String(columns.length));
    grid.append(make('span', 'teams-grid-head'));
    for (const col of columns) grid.append(make('span', 'teams-grid-head', col.label));
    for (const team of TEAMS) {
      grid.append(inlineName(state, team));
      for (const col of columns) {
        const value = col.values && col.values[team] !== undefined ? col.values[team] : 0;
        grid.append(make('strong', 'teams-grid-value', value));
      }
    }
    return grid;
  }

  // ---------- Panneau de fin de manche ----------
  // game-client.js le remplit avec « NS / EO » ; on le réécrit avec les noms (DOM, pas innerHTML).
  function updateRoundResult(state) {
    const panel = document.getElementById('round-result');
    const details = document.getElementById('result-details');
    if (!panel || !details || panel.classList.contains('hidden')) return;
    if (state.state !== 'scoring' && state.state !== 'finished') return;

    const scores = state.scores || { ns: 0, eo: 0 };
    details.textContent = '';
    if (state.state === 'finished') {
      const target = state.targetScore || 2000;
      const winner = scores.ns >= target ? 'ns' : 'eo';
      const line = make('div', 'teams-winner-line');
      const strong = make('strong', 'teams-winner');
      strong.append(inlineName(state, winner));
      line.append(strong, ' remporte la partie !');
      const goal = make('div', 'teams-goal');
      goal.append('Objectif : ', make('strong', null, target));
      details.append(line, buildScoreGrid(state, 'teams-result-grid', [
        { label: 'Score final', values: scores }
      ]), goal);
    } else {
      details.append(buildScoreGrid(state, 'teams-result-grid', [
        { label: 'Manche', values: state.roundPoints || { ns: 0, eo: 0 } },
        { label: 'Total', values: scores }
      ]));
    }
  }

  // ---------- Historique des manches ----------
  // game-client.js écrit « Manche: NS x - EO y / Total: ... » : on garde la ligne du contrat
  // et on remplace le reste par un mini-tableau avec les noms d'équipe.
  function updateRoundHistory(state) {
    const list = document.getElementById('round-history-list');
    const history = Array.isArray(state.roundHistory) ? state.roundHistory : [];
    if (!list) return;
    const rows = list.querySelectorAll('.history-entry');
    if (rows.length !== history.length) return;
    rows.forEach((row, i) => {
      const details = row.querySelector('.history-entry-details');
      const entry = history[i];
      if (!details || !entry || details.dataset.teamsDone === '1') return;
      details.dataset.teamsDone = '1';
      const firstBr = details.querySelector('br');
      if (!firstBr) return;
      while (firstBr.nextSibling) details.removeChild(firstBr.nextSibling);
      details.removeChild(firstBr);
      details.append(buildScoreGrid(state, 'teams-history-grid', [
        { label: 'Manche', values: { ns: entry.scoreNS, eo: entry.scoreEO } },
        { label: 'Total', values: entry.totalScores }
      ]));
    });
  }

  // ---------- Branchement ----------
  function onUpdate(state) {
    if (!state) return;
    if (state.state === 'waiting') {
      updateWaitingRoom(state);
      closePopover();
      return;
    }
    updateScoreboard(state);
    updateRoundPoints(state);
    updateRoundResult(state);
    updateRoundHistory(state);
  }

  initWaitingRoom();
  initPopover();
  initScoreboard();
  initRoundPoints();
  uiHooks.afterUpdate.push(onUpdate);
})();
