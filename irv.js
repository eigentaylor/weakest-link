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

// Real-world 3-candidate IRV elections that map onto states here. A node
// is identified by GENERIC letters, but which real candidate is "A" vs
// "B" vs "C" is an arbitrary choice — each fixed real election (with its
// own votes_rank + tournament data) corresponds to 3! = 6 different nodes,
// one per relabeling. Both elections below are center-squeeze cases (a
// Condorcet winner is eliminated for lack of first-place votes); together
// their 6+6 relabelings exhaust all 12 center-squeeze [SQZ] states in the
// 48-state graph — Burlington and Alaska turn out to be the two distinct
// "shapes" a 3-candidate center squeeze can take (whether the higher- or
// lower-vote survivor wins the runoff between the other two).
const REAL_EXAMPLES = {
  'ABC|+++': { name: 'Burlington 2009', candidates: { A: 'Montroll', B: 'Kiss', C: 'Wright' } },
  'ACB|++-': { name: 'Burlington 2009', candidates: { A: 'Montroll', B: 'Wright', C: 'Kiss' } },
  'BAC|-++': { name: 'Burlington 2009', candidates: { A: 'Kiss', B: 'Montroll', C: 'Wright' } },
  'BCA|--+': { name: 'Burlington 2009', candidates: { A: 'Wright', B: 'Montroll', C: 'Kiss' } },
  'CAB|+--': { name: 'Burlington 2009', candidates: { A: 'Kiss', B: 'Wright', C: 'Montroll' } },
  'CBA|---': { name: 'Burlington 2009', candidates: { A: 'Wright', B: 'Kiss', C: 'Montroll' } },
  'ABC|++-': { name: 'Alaska 2022', candidates: { A: 'Begich', B: 'Palin', C: 'Peltola' } },
  'ACB|+++': { name: 'Alaska 2022', candidates: { A: 'Begich', B: 'Peltola', C: 'Palin' } },
  'BAC|--+': { name: 'Alaska 2022', candidates: { A: 'Palin', B: 'Begich', C: 'Peltola' } },
  'BCA|-++': { name: 'Alaska 2022', candidates: { A: 'Peltola', B: 'Begich', C: 'Palin' } },
  'CAB|---': { name: 'Alaska 2022', candidates: { A: 'Palin', B: 'Peltola', C: 'Begich' } },
  'CBA|+--': { name: 'Alaska 2022', candidates: { A: 'Peltola', B: 'Palin', C: 'Begich' } },
};

function stateKey(state) {
  const [votesRank, tournament] = state;
  return votesRank.join('') + '|' + tournament.map(d => (d > 0 ? '+' : '-')).join('');
}

// Human-readable labels for the tournament flips only — flip_* reuses
// minimax's "lie" framing (the insincere direction winning), since SINCERE
// has identical values here. votes_rank moves (swap_A / swap_BC) build
// their label dynamically per-edge instead (see votesRankNeighbours):
// both moves are really the same underlying action — the coalition
// betrays A and gives their vote to whichever of B/C benefits — so the
// display should say exactly that, naming the specific candidate.
const MOVE_LABEL = {
  flip_AB: 'lie B>A',
  flip_AC: 'lie C>A',
  flip_BC: 'lie C>B',
};
function moveLabel(mid) {
  return MOVE_LABEL[mid];
}

// ── votesRank moves ──────────────────────────────────────────────────────────
// A coalition preferring A can only ever betray A — shift support away from
// A toward whichever of B/C they'd rather see survive. With only 3 slots,
// that collapses to exactly two possible single-step moves (never both
// "lower A" and "raise B" as separate edges — betraying A downward IS
// raising whoever it lands on, the same swap either way):
//   swap_A  : swap A with the candidate directly below it (fewer votes),
//             available whenever A is not already last. That candidate is
//             who the coalition is betraying A in favor of.
//   swap_BC : swap B and C, available whenever they're adjacent to each
//             other — i.e. whenever A is NOT sitting between them (A is
//             first or last, not in the middle). The one moving to more
//             votes is who the coalition is betraying A in favor of.
// Either way the display label is "Betray A, vote for X" — that's what
// both moves are, mechanically.
function* votesRankNeighbours(votesRank) {
  const idxA = votesRank.indexOf('A');
  if (idxA > 0) {
    const betray = votesRank[idxA - 1];
    const ns = [...votesRank];
    [ns[idxA - 1], ns[idxA]] = [ns[idxA], ns[idxA - 1]];
    yield { newVotesRank: ns, lab: 'swap_A', label: `Betray A, vote for ${betray}` };
  }
  if (idxA !== 1) {
    const i = idxA === 0 ? 1 : 0;
    const j = idxA === 0 ? 2 : 1;
    const betray = votesRank[i];   // moving to the higher (more-votes) slot
    const ns = [...votesRank];
    [ns[i], ns[j]] = [ns[j], ns[i]];
    yield { newVotesRank: ns, lab: 'swap_BC', label: `Betray A, vote for ${betray}` };
  }
}

// ── tournament moves ──────────────────────────────────────────────────────────
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
function* neighboursMinimal(state) {
  const [votesRank, tournament] = state;
  for (const { newVotesRank, lab, label } of votesRankNeighbours(votesRank)) {
    yield { newState: [newVotesRank, tournament], label, mid: lab, kind: 'reorder' };
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
// Every profitable/multi-step field is precomputed in two variants — Core
// (swap_* moves only) and Full (swap_* + flip_* moves) — so graph_irv.js's
// "Tournament deviations" toggle can switch between them instantly with no
// rebuild. Single-step profitability is always identical between Core and
// Full (flip is proven never profitable — see FLIP-PROFITABILITY PROOF in
// irv_graph_test.py), but the multi-step *reachable-target* sets can still
// differ: a flip can be a neutral (never profitable, but not worse either)
// detour that changes the tournament axis before a later swap_* step, which
// star.js's richer model showed matters in general — verified empirically
// for IRV too, where it turns out to affect which specific nodes are
// reachable (though never whether a state is profitable at all, nor the
// best reachable outcome — both proven state-independent of flip already).
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
    descVotes: formatVotesRank(s),
    descTournament: formatTournament(s),
    minimalNeighbours,
    minimalProfitableDeviationsCore,
    minimalProfitableDeviationsFull,
    anyMinimalProfitableCore: minimalProfitableDeviationsCore.length > 0,
    anyMinimalProfitableFull: minimalProfitableDeviationsFull.length > 0,
    realExample: REAL_EXAMPLES[key] || null,
  });
}

// Second pass: monotone multi-step reachability over the neighboursMinimal
// graph — identical algorithm to minimax.js, run twice (Core: swap_* edges
// only; Full: swap_* + flip_* edges).
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
  formatVotesRank, formatTournament,
  neighboursMinimal, allStates, stateData, stateMap,
};
