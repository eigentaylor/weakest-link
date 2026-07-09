'use strict';

// State = [votesRank, tournament]
//   votesRank  : array of 3 candidate letters, fewest first-place votes -> most.
//                votesRank[0] is eliminated in this 3-candidate IRV round.
//   tournament : [dAB, dAC, dBC], each +-1 — independent pairwise results, in
//                fixed MATCHUPS order. UNLIKE minimax's state, there is no
//                ranking/margin ordering among these three flags.
//
// Winner rule: eliminate votesRank[0]; of the 2 survivors, whoever wins the
// tournament matchup between them wins the state. Mirrors the Python
// reference model in irv_graph_test.py exactly.

const CANDIDATES = ['A', 'B', 'C'];
const MATCHUPS = ['AB', 'AC', 'BC'];
const PAIRS = { AB: ['A', 'B'], AC: ['A', 'C'], BC: ['B', 'C'] };
const SINCERE = { AB: +1, AC: +1, BC: +1 };
const PREF = { A: 2, B: 1, C: 0 };

// pair (order-independent) -> matchup id, needed because winner() must find
// the matchup between two *survivors*, whose identity depends on votesRank.
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
  const [votesRank, tournament] = state;
  const dm = tournamentMap(tournament);
  const eliminated = votesRank[0];
  const survivors = votesRank.filter(c => c !== eliminated);
  const mid = midOfPair(survivors[0], survivors[1]);
  const [a, b] = PAIRS[mid];
  return dm[mid] === +1 ? a : b;
}

// ── condorcet / center-squeeze detection (diagnostic only — NOT used to
// determine the IRV winner; winner() above never needs this) ───────────────
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
  const [votesRank] = state;
  const cw = condorcetWinner(state);
  return cw !== null && cw === votesRank[0];
}

// 3-way tag: [SQZ] Condorcet winner exists but is eliminated (center squeeze),
// [cyc] no Condorcet winner (tournament is a 3-cycle), [CW ] Condorcet winner
// survives and wins normally.
function stateTag(state) {
  const cw = condorcetWinner(state);
  if (cw === null) return '[cyc]';
  return isCenterSqueeze(state) ? '[SQZ]' : '[CW ]';
}

// ── winner-relevance of a matchup ────────────────────────────────────────────
// The only tournament matchup that can affect winner() for a given votesRank
// is the one between the two survivors; the other two (involving the
// eliminated candidate) are irrelevant to that state's outcome. This is why
// flip_* deviations on an irrelevant matchup can never be profitable.
function relevantMatchup(votesRank) {
  const eliminated = votesRank[0];
  const survivors = votesRank.filter(c => c !== eliminated);
  return midOfPair(survivors[0], survivors[1]);
}

// ── display ───────────────────────────────────────────────────────────────
// Votes-rank and tournament are rendered as two separate strings so callers
// can lay them out on two lines (per the model's own display convention —
// see irv_graph_test.py's desc_block()) — tournament on its own line, vote
// order front and center.
function formatVotesRank(state) {
  const [votesRank] = state;
  const w = winner(state);
  const eliminated = votesRank[0];
  const terms = votesRank.map(c => {
    let label = c === eliminated ? `${c}✗` : c;
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
  const [votesRank, tournament] = state;
  return votesRank.join('') + '|' + tournament.map(d => (d > 0 ? '+' : '-')).join('');
}

// Human-readable labels. flip_* reuses minimax's "lie" framing (the
// insincere direction winning), since SINCERE has identical values here.
const MOVE_LABEL = {
  lower_A: 'lower A',
  raise_B: 'raise B',
  raise_C: 'raise C',
  flip_AB: 'lie B>A',
  flip_AC: 'lie C>A',
  flip_BC: 'lie C>B',
};
function moveLabel(mid) {
  return MOVE_LABEL[mid];
}

// ── votesRank moves ──────────────────────────────────────────────────────────
function moveCandidate(votesRank, cand, targetIdx) {
  const others = votesRank.filter(c => c !== cand);
  others.splice(targetIdx, 0, cand);
  return others;
}

// Full model: a candidate can jump to any legal position, closest (adjacent)
// first. No raise_A / lower_B / lower_C — the coalition can't manufacture
// A's first-place support or suppress B/C below their sincere level.
function* votesRankNeighbours(votesRank) {
  for (let k = 0; k < 3; k++) {
    const cand = votesRank[k];
    if (cand === 'A') {
      for (let j = k - 1; j >= 0; j--) {
        yield { newVotesRank: moveCandidate(votesRank, cand, j), lab: 'lower_A' };
      }
    } else {
      for (let j = k + 1; j < 3; j++) {
        yield { newVotesRank: moveCandidate(votesRank, cand, j), lab: `raise_${cand}` };
      }
    }
  }
}

// Minimal model: adjacent-swap only.
function* votesRankNeighboursMinimal(votesRank) {
  for (let k = 0; k < 3; k++) {
    const cand = votesRank[k];
    if (cand === 'A') {
      if (k > 0) yield { newVotesRank: moveCandidate(votesRank, cand, k - 1), lab: 'lower_A' };
    } else {
      if (k < 2) yield { newVotesRank: moveCandidate(votesRank, cand, k + 1), lab: `raise_${cand}` };
    }
  }
}

// ── tournament moves ──────────────────────────────────────────────────────────
// A flip is inherently atomic — no distance/strength concept — so this
// single generator backs both the full and minimal composed generators.
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

// ── composed state-level neighbours ──────────────────────────────────────────
function* neighbours(state) {
  const [votesRank, tournament] = state;
  for (const { newVotesRank, lab } of votesRankNeighbours(votesRank)) {
    yield { newState: [newVotesRank, tournament], label: moveLabel(lab), mid: lab, kind: 'reorder' };
  }
  for (const { newTournament, lab } of tournamentNeighbours(tournament)) {
    yield { newState: [votesRank, newTournament], label: moveLabel(lab), mid: lab, kind: 'flip' };
  }
}

function* neighboursMinimal(state) {
  const [votesRank, tournament] = state;
  for (const { newVotesRank, lab } of votesRankNeighboursMinimal(votesRank)) {
    yield { newState: [newVotesRank, tournament], label: moveLabel(lab), mid: lab, kind: 'reorder' };
  }
  for (const { newTournament, lab } of tournamentNeighbours(tournament)) {
    yield { newState: [votesRank, newTournament], label: moveLabel(lab), mid: lab, kind: 'flip' };
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

// Pre-compute all state data (mirrors minimax.js's stateData shape/fields so
// graph_irv.js can reuse graph.js's rendering logic almost verbatim).
const stateData = new Map();

for (const s of allStates) {
  const key = stateKey(s);
  const w = winner(s);
  const tag = stateTag(s);

  const allNeighbours = [];
  const devByMid = {};
  for (const { newState, label, mid, kind } of neighbours(s)) {
    const nk = stateKey(newState);
    const nw = winner(newState);
    const entry = { newState, label, mid, kind, winner: nw, key: nk };
    allNeighbours.push(entry);
    if (!devByMid[mid]) devByMid[mid] = [];
    devByMid[mid].push(entry);
  }

  const profitableDeviations = [];
  if (w !== 'A') {
    const u0 = PREF[w];
    for (const mid of Object.keys(devByMid)) {
      let foundMin = false;
      for (const dev of devByMid[mid]) {
        if (PREF[dev.winner] > u0) {
          dev.profitable = true;
          dev.tag = foundMin ? 'MORE' : 'MIN';
          if (!foundMin) foundMin = true;
          profitableDeviations.push(dev);
        }
      }
    }
  }

  const minimalNeighbours = [];
  const minDevByMid = {};
  for (const { newState, label, mid, kind } of neighboursMinimal(s)) {
    const nk = stateKey(newState);
    const nw = winner(newState);
    const entry = { newState, label, mid, kind, winner: nw, key: nk };
    minimalNeighbours.push(entry);
    if (!minDevByMid[mid]) minDevByMid[mid] = [];
    minDevByMid[mid].push(entry);
  }

  const minimalProfitableDeviations = [];
  if (w !== 'A') {
    const u0 = PREF[w];
    for (const mid of Object.keys(minDevByMid)) {
      for (const dev of minDevByMid[mid]) {
        if (PREF[dev.winner] > u0) {
          dev.profitable = true;
          dev.hops = 1;
          dev.path = [{ label: dev.label, key: dev.key, winner: dev.winner }];
          minimalProfitableDeviations.push(dev);
        }
      }
    }
  }

  stateData.set(key, {
    state: s,
    key,
    winner: w,
    tag,
    isCenterSqueeze: tag === '[SQZ]',
    isCycle: tag === '[cyc]',
    descVotes: formatVotesRank(s),
    descTournament: formatTournament(s),
    allNeighbours,
    devByMid,
    profitableDeviations,
    anyProfitable: profitableDeviations.length > 0,
    minimalNeighbours,
    minimalProfitableDeviations,
    anyMinimalProfitable: minimalProfitableDeviations.length > 0,
  });
}

// Second pass: monotone multi-step reachability over the neighboursMinimal
// graph — identical algorithm to minimax.js. (The Python reference model
// found this adds zero power beyond single-step for IRV: every multi-step
// path collapses to a 1-hop profitable edge. Kept anyway for UI/toggle
// parity with the minimax graph page and in case the model is extended.)
for (const [startKey, startData] of stateData) {
  const u0 = PREF[startData.winner];
  const parent = new Map();
  parent.set(startKey, { parentKey: null, label: null, hops: 0 });
  const queue = [startKey];
  while (queue.length) {
    const curKey = queue.shift();
    const curInfo = parent.get(curKey);
    const curPref = PREF[stateData.get(curKey).winner];
    for (const nb of stateData.get(curKey).minimalNeighbours) {
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
  startData.multiStepProfitableDeviations = multiStepProfitableDeviations;
}

export {
  MATCHUPS, PAIRS, SINCERE, PREF,
  winner, condorcetWinner, isCenterSqueeze, stateTag, relevantMatchup, stateKey,
  formatVotesRank, formatTournament,
  neighbours, neighboursMinimal, allStates, stateData, stateMap,
};
