'use strict';

// State = [scoreRank, tournament]
//   scoreRank  : array of 3 candidate letters, fewest total stars -> most.
//                scoreRank[0] misses STAR's automatic runoff (only the top
//                2 total scorers advance) in this 3-candidate model.
//   tournament : [dAB, dAC, dBC], each +-1 — independent pairwise results, in
//                fixed MATCHUPS order. Same as irv.js's tournament: no
//                ranking/margin ordering among these three flags.
//
// Winner rule: cut scoreRank[0]; of the 2 finalists, whoever wins the
// tournament matchup between them wins. Structurally identical to irv.js's
// winner() — STAR's automatic runoff is decided by pairwise preference,
// exactly like IRV's runoff between its 2 survivors. Mirrors the Python
// reference model in star_graph_test.py exactly.

const CANDIDATES = ['A', 'B', 'C'];
const MATCHUPS = ['AB', 'AC', 'BC'];
const PAIRS = { AB: ['A', 'B'], AC: ['A', 'C'], BC: ['B', 'C'] };
const SINCERE = { AB: +1, AC: +1, BC: +1 };
const PREF = { A: 2, B: 1, C: 0 };

// pair (order-independent) -> matchup id, needed because winner() must find
// the matchup between two *finalists*, whose identity depends on scoreRank.
const MID_OF = {};
for (const m of MATCHUPS) {
  const [a, b] = PAIRS[m];
  MID_OF[[a, b].sort().join('')] = m;
}
function midOfPair(x, y) {
  return MID_OF[[x, y].sort().join('')];
}

function tournamentMap(tournament) {
  return { AB: tournament[0], AC: tournament[1], BC: tournament[2] };
}

// ── winner ────────────────────────────────────────────────────────────────
function winner(state) {
  const [scoreRank, tournament] = state;
  const dm = tournamentMap(tournament);
  const cut = scoreRank[0];
  const finalists = scoreRank.filter(c => c !== cut);
  const mid = midOfPair(finalists[0], finalists[1]);
  const [a, b] = PAIRS[mid];
  return dm[mid] === +1 ? a : b;
}

// ── condorcet / center-squeeze detection (diagnostic only — NOT used to
// determine the STAR winner; winner() above never needs this) ─────────────
function condorcetWinner(state) {
  const [, tournament] = state;
  const dm = tournamentMap(tournament);
  const wins = { A: 0, B: 0, C: 0 };
  for (const mid of MATCHUPS) {
    const [a, b] = PAIRS[mid];
    wins[dm[mid] === +1 ? a : b]++;
  }
  for (const [c, n] of Object.entries(wins)) {
    if (n === 2) return c;
  }
  return null; // 3-cycle among the tournament results
}

function isCenterSqueeze(state) {
  const [scoreRank] = state;
  const cw = condorcetWinner(state);
  return cw !== null && cw === scoreRank[0];
}

// 3-way tag: [SQZ] Condorcet winner exists but is cut before the runoff
// (center squeeze), [cyc] no Condorcet winner (tournament is a 3-cycle),
// [CW ] Condorcet winner reaches the runoff and wins normally.
function stateTag(state) {
  const cw = condorcetWinner(state);
  if (cw === null) return '[cyc]';
  return isCenterSqueeze(state) ? '[SQZ]' : '[CW ]';
}

// ── winner-relevance of a matchup ────────────────────────────────────────────
// The only tournament matchup that can affect winner() for a given
// scoreRank is the one between the two finalists; the other two (involving
// the cut candidate) are irrelevant to that state's outcome. This is why
// flip_* deviations on an irrelevant matchup can never be profitable.
function relevantMatchup(scoreRank) {
  const cut = scoreRank[0];
  const finalists = scoreRank.filter(c => c !== cut);
  return midOfPair(finalists[0], finalists[1]);
}

// ── display ───────────────────────────────────────────────────────────────
function formatScoreRank(state) {
  const [scoreRank] = state;
  const w = winner(state);
  const cut = scoreRank[0];
  const terms = scoreRank.map(c => {
    let label = c === cut ? `${c}✗` : c;
    if (c === w) label = `<b class="cand-${c.toLowerCase()}">${label}</b>`;
    return label;
  });
  return '(' + terms.join('≺') + ')';
}

function formatTournament(state) {
  const [, tournament] = state;
  const dm = tournamentMap(tournament);
  const w = winner(state);
  const terms = MATCHUPS.map(mid => {
    const [a, b] = PAIRS[mid];
    let [winL, loseL] = dm[mid] === +1 ? [a, b] : [b, a];
    if (winL === w) winL = `<b class="cand-${winL.toLowerCase()}">${winL}</b>`;
    return `${winL}→${loseL}`;
  });
  return '⟨' + terms.join(' ∣ ') + '⟩';
}

function stateKey(state) {
  const [scoreRank, tournament] = state;
  return scoreRank.join('') + '|' + tournament.map(d => (d > 0 ? '+' : '-')).join('');
}

// Human-readable labels. The 3 score-rank levers are fixed ballot shapes
// (see module docstring in star_graph_test.py) so — unlike IRV's dynamic
// "Betray A, vote for X" — the label is static per move type; which
// candidate's ballot score changes is already baked into the move's name.
const MOVE_LABEL = {
  boost_B: '5-4-0 (boost B)',
  starve_B: '5-1-0 (starve B)',
  starve_A: '(x+1)-x-0 (starve A)',
  flip_AB: 'lie B>A',
  flip_AC: 'lie C>A',
  flip_BC: 'lie C>B',
};
function moveLabel(mid) {
  return MOVE_LABEL[mid];
}

// ── scoreRank moves ──────────────────────────────────────────────────────────
// A coalition sincerely voting 5-x-0 (A=5, B=x, C=0, 0<x<5) can move each of
// A's and B's own contributed scores independently (C is always kept at the
// floor, 0 — it's never profitable to raise their least-favorite). That
// gives exactly 3 single-step levers, each gated on there being room to
// move in that direction:
//   boost_B  : raise B's score to 4 (just under A's 5). Available whenever
//              B is not already on top — lets B overtake whoever is
//              directly above it.
//   starve_B : lower B's score to 1 (just above C's 0). Available whenever
//              B is not already at the bottom — lets whoever is directly
//              below B overtake it.
//   starve_A : lower A's score to x+1 (just above B's own sincere x).
//              Available whenever A is not already at the bottom — lets
//              whoever is directly below A overtake it.
// Unlike IRV's swap_A/swap_BC (which can never collide), boost_B and
// starve_A CAN land on the same target — whenever B sits directly below A,
// both "B rises past A" and "A falls past B" describe the identical
// resulting scoreRank. Both are yielded as separate edges (different
// ballot strategies), not deduplicated.
function* scoreRankNeighbours(scoreRank) {
  const idxB = scoreRank.indexOf('B');
  const idxA = scoreRank.indexOf('A');

  if (idxB < 2) {
    const ns = [...scoreRank];
    [ns[idxB], ns[idxB + 1]] = [ns[idxB + 1], ns[idxB]];
    yield { newScoreRank: ns, lab: 'boost_B' };
  }
  if (idxB > 0) {
    const ns = [...scoreRank];
    [ns[idxB - 1], ns[idxB]] = [ns[idxB], ns[idxB - 1]];
    yield { newScoreRank: ns, lab: 'starve_B' };
  }
  if (idxA > 0) {
    const ns = [...scoreRank];
    [ns[idxA - 1], ns[idxA]] = [ns[idxA], ns[idxA - 1]];
    yield { newScoreRank: ns, lab: 'starve_A' };
  }
}

// ── tournament moves (unchanged from IRV) ──────────────────────────────────
// A flip is inherently atomic — no distance/strength concept.
function* tournamentNeighbours(tournament) {
  for (let i = 0; i < MATCHUPS.length; i++) {
    const mid = MATCHUPS[i];
    const d = tournament[i];
    if (d === SINCERE[mid]) {
      const nt = [...tournament];
      nt[i] = -d;
      yield { newTournament: nt, lab: `flip_${mid}` };
    }
  }
}

// ── composed state-level neighbours (single-step / atomic model) ────────────
// Always yields both kinds — 'reorder' (scoreRank levers) and 'flip'
// (tournament levers); callers filter by kind when the "tournament
// deviations" toggle is off (the graph page's default).
function* neighboursMinimal(state) {
  const [scoreRank, tournament] = state;
  for (const { newScoreRank, lab } of scoreRankNeighbours(scoreRank)) {
    yield { newState: [newScoreRank, tournament], label: moveLabel(lab), mid: lab, kind: 'reorder' };
  }
  for (const { newTournament, lab } of tournamentNeighbours(tournament)) {
    yield { newState: [scoreRank, newTournament], label: moveLabel(lab), mid: lab, kind: 'flip' };
  }
}

// ── all 48 states ──────────────────────────────────────────────────────────
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) {
      result.push([arr[i], ...p]);
    }
  }
  return result;
}

const allStates = [];
for (const tournament of [[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]]) {
  for (const perm of permutations(CANDIDATES)) {
    allStates.push([perm, tournament]);
  }
}

// Build state lookup map
const stateMap = new Map();
for (const s of allStates) {
  stateMap.set(stateKey(s), s);
}

// Pre-compute all state data (mirrors irv.js's stateData shape/fields so
// graph_star.js can reuse graph_irv.js's rendering logic almost verbatim).
// Every profitable/multi-step field is precomputed in two variants — Core
// (scoreRank moves only) and Full (scoreRank + tournament flips) — so the
// "tournament deviations" toggle in graph_star.js can switch between them
// instantly with no rebuild, the same way showMinimalEdges already switches
// between single-step and multi-step fields.
const stateData = new Map();

for (const s of allStates) {
  const key = stateKey(s);
  const w = winner(s);
  const tag = stateTag(s);

  const minimalNeighbours = [];
  for (const { newState, label, mid, kind } of neighboursMinimal(s)) {
    const nk = stateKey(newState);
    const nw = winner(newState);
    minimalNeighbours.push({ newState, label, mid, kind, winner: nw, key: nk });
  }

  function profitableAmong(neighbours) {
    if (w === 'A') return [];
    const u0 = PREF[w];
    const out = [];
    for (const dev of neighbours) {
      if (PREF[dev.winner] > u0) {
        out.push({
          ...dev,
          profitable: true,
          hops: 1,
          path: [{ label: dev.label, key: dev.key, winner: dev.winner }],
        });
      }
    }
    return out;
  }

  const reorderNeighbours = minimalNeighbours.filter(n => n.kind === 'reorder');
  const minimalProfitableDeviationsCore = profitableAmong(reorderNeighbours);
  const minimalProfitableDeviationsFull = profitableAmong(minimalNeighbours);

  stateData.set(key, {
    state: s,
    key,
    winner: w,
    tag,
    isCenterSqueeze: tag === '[SQZ]',
    isCycle: tag === '[cyc]',
    descScore: formatScoreRank(s),
    descTournament: formatTournament(s),
    minimalNeighbours,
    minimalProfitableDeviationsCore,
    minimalProfitableDeviationsFull,
    anyMinimalProfitableCore: minimalProfitableDeviationsCore.length > 0,
    anyMinimalProfitableFull: minimalProfitableDeviationsFull.length > 0,
  });
}

// Second pass: monotone multi-step reachability over the neighboursMinimal
// graph — identical algorithm to irv.js, run twice (Core: reorder edges
// only; Full: reorder + flip edges) since — unlike IRV, where the Python
// reference model proved multi-step adds no power — star_graph_test.py
// found STAR's richer edge set DOES let some states reach a profitable
// outcome only via a 2+-step chain.
function buildMultiStep(includeFlip) {
  const result = new Map();
  for (const [startKey, startData] of stateData) {
    const u0 = PREF[startData.winner];
    const parent = new Map();
    parent.set(startKey, { parentKey: null, label: null, hops: 0 });
    const queue = [startKey];
    while (queue.length) {
      const curKey = queue.shift();
      const curInfo = parent.get(curKey);
      const curPref = PREF[stateData.get(curKey).winner];
      const neighbours = stateData.get(curKey).minimalNeighbours
        .filter(n => includeFlip || n.kind === 'reorder');
      for (const nb of neighbours) {
        if (parent.has(nb.key)) continue;
        if (PREF[nb.winner] < curPref) continue;
        parent.set(nb.key, { parentKey: curKey, label: nb.label, hops: curInfo.hops + 1 });
        queue.push(nb.key);
      }
    }

    const multiStepProfitableDeviations = [];
    for (const [key, info] of parent) {
      if (key === startKey) continue;
      const targetData = stateData.get(key);
      if (PREF[targetData.winner] <= u0) continue;
      const path = [];
      let cur = key;
      while (cur !== startKey) {
        const { parentKey, label } = parent.get(cur);
        path.unshift({ label, key: cur, winner: stateData.get(cur).winner });
        cur = parentKey;
      }
      multiStepProfitableDeviations.push({
        key,
        winner: targetData.winner,
        newState: targetData.state,
        hops: info.hops,
        path,
      });
    }
    result.set(startKey, multiStepProfitableDeviations);
  }
  return result;
}

const multiStepCore = buildMultiStep(false);
const multiStepFull = buildMultiStep(true);
for (const [key, data] of stateData) {
  data.multiStepProfitableDeviationsCore = multiStepCore.get(key);
  data.multiStepProfitableDeviationsFull = multiStepFull.get(key);
}

export {
  MATCHUPS, PAIRS, SINCERE, PREF,
  winner, condorcetWinner, isCenterSqueeze, stateTag, relevantMatchup, stateKey,
  formatScoreRank, formatTournament,
  neighboursMinimal, allStates, stateData, stateMap,
};
