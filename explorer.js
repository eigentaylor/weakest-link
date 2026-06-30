'use strict';

import {
  MATCHUPS, PAIRS, SINCERE, PREF,
  winner, isCycle, desc, stateKey,
  neighbours, allStates, stateData,
  encodeState, decodeState, getStateData,
  SINCERE_STATE,
} from './minimax.js';

// ── State ─────────────────────────────────────────────────────────────────────
// state is represented as array of 3 [mid, dir] pairs in rank order

let currentDirs = { AB: +1, AC: +1, BC: +1 };
let currentRanks = ['AB', 'AC', 'BC']; // rank order, index 0 = rank 1

function getState() {
  return currentRanks.map(m => [m, currentDirs[m]]);
}

// ── Drag state ────────────────────────────────────────────────────────────────
let dragSrc = null;

// ── Shortcuts data ────────────────────────────────────────────────────────────
const SHORTCUTS = [
  {
    archetype: 1,
    label: 'Archetype 1 — Betray your favorite (C wins the cycle)',
    items: [
      { desc: '(A>B) > (C>A) > (B>C)', ranks: ['AB','AC','BC'], dirs: {AB:+1, AC:-1, BC:+1} },
      { desc: '(C>A) > (A>B) > (B>C)', ranks: ['AC','AB','BC'], dirs: {AB:+1, AC:-1, BC:+1} },
    ],
  },
  {
    archetype: 2,
    label: 'Archetype 2 — Bury your second choice (B wins, A>C margin dominates)',
    items: [
      { desc: '(A>C) > (B>A) > (B>C)', ranks: ['AC','AB','BC'], dirs: {AB:-1, AC:+1, BC:+1} },
      { desc: '(A>C) > (B>C) > (B>A)', ranks: ['AC','BC','AB'], dirs: {AB:-1, AC:+1, BC:+1} },
      { desc: '(B>C) > (A>C) > (B>A)', ranks: ['BC','AC','AB'], dirs: {AB:-1, AC:+1, BC:+1} },
      { desc: '(A>C) > (B>A) > (C>B)  [push variant]', ranks: ['AC','AB','BC'], dirs: {AB:-1, AC:+1, BC:-1} },
    ],
  },
];

// ── URL hash encode/decode ────────────────────────────────────────────────────
function stateToHash(ranks, dirs) {
  return '#' + ranks.map(m => `${m}${dirs[m] > 0 ? '+' : '-'}`).join('');
}

function hashToState(hash) {
  const str = hash.replace('#', '');
  if (str.length !== 9) return null;
  const ranks = [];
  const dirs = {};
  for (let i = 0; i < 3; i++) {
    const mid = str.slice(i * 3, i * 3 + 2);
    const d = str[i * 3 + 2] === '+' ? +1 : -1;
    if (!MATCHUPS.includes(mid)) return null;
    ranks.push(mid);
    dirs[mid] = d;
  }
  if (new Set(ranks).size !== 3) return null;
  return { ranks, dirs };
}

function applyHash() {
  // URL hash takes priority; fall back to sessionStorage
  const raw = window.location.hash || ('#' + (sessionStorage.getItem('explorerHash') || ''));
  const parsed = hashToState(raw);
  if (parsed) {
    currentRanks = parsed.ranks;
    currentDirs = parsed.dirs;
  }
}

function pushHash() {
  const hash = stateToHash(currentRanks, currentDirs);
  history.replaceState(null, '', hash);
  // Persist so graph.html's "Explorer" nav link can restore it
  sessionStorage.setItem('explorerHash', hash.slice(1));
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function candClass(c) {
  return c === 'A' ? 'a' : c === 'B' ? 'b' : 'c';
}

function candColor(c) {
  return `cand-${candClass(c)}`;
}

function renderMatchupCards() {
  const list = document.getElementById('matchup-list');
  list.innerHTML = '';

  currentRanks.forEach((mid, idx) => {
    const d = currentDirs[mid];
    const [a, b] = PAIRS[mid];
    const winner_label = d === +1 ? `${a}>${b}` : `${b}>${a}`;

    const card = document.createElement('div');
    card.className = 'matchup-card';
    card.draggable = true;
    card.dataset.mid = mid;
    card.dataset.idx = idx;

    card.innerHTML = `
      <span class="rank-badge">${idx + 1}</span>
      <span class="matchup-label">${winner_label}</span>
      <button class="flip-btn" data-mid="${mid}" title="Flip direction">⇄</button>
    `;

    // Drag events
    card.addEventListener('dragstart', e => {
      dragSrc = idx;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.matchup-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.matchup-card').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrc !== null && dragSrc !== idx) {
        const newRanks = [...currentRanks];
        const [removed] = newRanks.splice(dragSrc, 1);
        newRanks.splice(idx, 0, removed);
        currentRanks = newRanks;
        render();
      }
    });

    list.appendChild(card);
  });

  // Flip buttons
  list.querySelectorAll('.flip-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const mid = btn.dataset.mid;
      currentDirs[mid] *= -1;
      render();
    });
  });
}

function renderStatePanel() {
  const state = getState();
  const w = winner(state);
  const cycle = isCycle(state);
  const stateDesc = desc(state);

  // Sincere = A wins
  const sincere = w === 'A';

  document.getElementById('winner-display').textContent = w;
  document.getElementById('winner-display').className = `winner-display ${candClass(w)}`;
  document.getElementById('state-desc').textContent = stateDesc;
  document.getElementById('state-cycle').textContent = cycle ? '[cycle]' : `[CW: ${w}]`;

  const sinTag = document.getElementById('sincere-tag');
  if (sincere) {
    sinTag.textContent = 'Sincere outcome';
    sinTag.className = 'sincere-tag yes';
  } else {
    sinTag.textContent = 'Insincere outcome';
    sinTag.className = 'sincere-tag no';
  }
}

function renderDeviationPanel() {
  const state = getState();
  const w = winner(state);
  const panel = document.getElementById('deviation-panel');
  const callout = document.getElementById('callout');

  if (w === 'A') {
    panel.innerHTML = '';
    callout.style.display = 'none';
    document.getElementById('deviation-section').style.display = 'none';
    return;
  }

  document.getElementById('deviation-section').style.display = '';
  callout.style.display = '';

  const u0 = PREF[w];
  const data = getStateData(state);

  // Group deviations by matchup in the order AB/AC/BC
  let html = '';
  let anyProfitable = false;

  for (const mid of MATCHUPS) {
    const devs = data.devByMid[mid];
    if (!devs || devs.length === 0) continue;

    html += `<div class="dev-section">`;
    html += `<div class="dev-section-title">on ${mid}</div>`;

    for (const dev of devs) {
      const nw = dev.winner;
      const profitable = PREF[nw] > u0;
      if (profitable) anyProfitable = true;

      let symbol = '';
      let tagHtml = '';
      if (profitable) {
        symbol = nw === 'A' ? '<span class="tag-star">★</span>' : '<span class="tag-dot">·</span>';
        if (dev.tag === 'MIN') {
          tagHtml = '<span class="dev-tag tag-min">MIN</span>';
        } else {
          tagHtml = '<span class="dev-tag tag-more">+</span>';
        }
      } else {
        symbol = '<span class="tag-down">↓</span>';
      }

      const rowClass = profitable ? 'dev-row profitable' : 'dev-row';
      const [nm, nd] = dev.newState[0];

      html += `<div class="${rowClass}">
        <span class="dev-label">${dev.label}</span>
        <span class="dev-desc">${desc(dev.newState)}</span>
        <span class="dev-winner ${candColor(nw)}">${nw}</span>
        <span>${symbol} ${tagHtml}</span>
      </div>`;
    }

    html += `</div>`;
  }

  if (!anyProfitable) {
    html += `<p class="no-dev-msg">No profitable deviation — the coalition is powerless here (common case: 26 of 32 non-A states).</p>`;
  }

  panel.innerHTML = html;
}

function renderShortcuts() {
  const container = document.getElementById('shortcuts-container');
  container.innerHTML = '';

  SHORTCUTS.forEach((group, gi) => {
    const acc = document.createElement('div');
    acc.className = 'accordion';

    const header = document.createElement('button');
    header.className = 'accordion-header';
    header.innerHTML = `<span class="chevron">▶</span> ${group.label}`;

    const body = document.createElement('div');
    body.className = 'accordion-body';

    group.items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'shortcut-btn';
      btn.textContent = item.desc;
      btn.addEventListener('click', () => {
        currentRanks = [...item.ranks];
        currentDirs = { ...item.dirs };
        render();
      });
      body.appendChild(btn);
    });

    header.addEventListener('click', () => {
      const open = body.classList.toggle('open');
      header.classList.toggle('open', open);
    });

    acc.appendChild(header);
    acc.appendChild(body);
    container.appendChild(acc);
  });
}

function render() {
  pushHash();
  renderMatchupCards();
  renderStatePanel();
  renderDeviationPanel();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyHash();
  renderShortcuts();
  render();
});

window.addEventListener('hashchange', () => {
  applyHash();
  render();
});
