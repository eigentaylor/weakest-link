'use strict';

const MATCHUPS = ['AB', 'AC', 'BC'];
const PAIRS = { AB: ['A', 'B'], AC: ['A', 'C'], BC: ['B', 'C'] };
const SINCERE = { AB: +1, AC: +1, BC: +1 };
const PREF = { A: 2, B: 1, C: 0 };

function winner(state) {
  const wins = { A: 0, B: 0, C: 0 };
  for (const [mid, d] of state) {
    const [a, b] = PAIRS[mid];
    wins[d === +1 ? a : b]++;
  }
  for (const [c, n] of Object.entries(wins)) {
    if (n === 2) return c;
  }
  // cycle → loser of last (rank-3 = smallest margin) matchup wins
  const [lm, ld] = state[2];
  const [a, b] = PAIRS[lm];
  return ld === +1 ? b : a;
}

function isCycle(state) {
  const wins = { A: 0, B: 0, C: 0 };
  for (const [mid, d] of state) {
    const [a, b] = PAIRS[mid];
    wins[d === +1 ? a : b]++;
  }
  return !Object.values(wins).some(n => n === 2);
}

function desc(state) {
  return state.map(([mid, d]) => {
    const [a, b] = PAIRS[mid];
    return d === +1 ? `(${a}>${b})` : `(${b}>${a})`;
  }).join(' > ');
}

function stateKey(state) {
  return state.map(([m, d]) => `${m}${d > 0 ? '+' : '-'}`).join(',');
}

function* neighbours(state) {
  for (let k = 0; k < 3; k++) {
    const [mid, d] = state[k];
    const others = state.filter((_, i) => i !== k);
    if (d === SINCERE[mid]) {
      // weaken: same dir, shift to lower rank (min to max strength)
      for (let j = k + 1; j < 3; j++) {
        const ns = [...others];
        ns.splice(j, 0, [mid, d]);
        yield { newState: ns, label: `weak_${mid}`, type: 'weak' };
      }
      // flip: opposite dir, rank 2→0 (min to max strength)
      for (let j = 2; j >= 0; j--) {
        const ns = [...others];
        ns.splice(j, 0, [mid, -d]);
        yield { newState: ns, label: `flip_${mid}`, type: 'flip' };
      }
    } else {
      // insincere: push to higher rank (rank k-1→0, min to max strength)
      for (let j = k - 1; j >= 0; j--) {
        const ns = [...others];
        ns.splice(j, 0, [mid, d]);
        yield { newState: ns, label: `push_${mid}`, type: 'push' };
      }
    }
  }
}

// Single-step variant: each edge changes exactly one rank position OR flips direction
// at the weakest position (k===2). Weaken by 1, flip at bottom, push by 1.
function* neighboursMinimal(state) {
  for (let k = 0; k < 3; k++) {
    const [mid, d] = state[k];
    const others = state.filter((_, i) => i !== k);
    if (d === SINCERE[mid]) {
      if (k < 2) {
        const ns = [...others];
        ns.splice(k + 1, 0, [mid, d]);
        yield { newState: ns, label: `weak_${mid}`, type: 'weak' };
      }
      if (k === 2) {
        const ns = [...others];
        ns.splice(2, 0, [mid, -d]);
        yield { newState: ns, label: `flip_${mid}`, type: 'flip' };
      }
    } else {
      if (k > 0) {
        const ns = [...others];
        ns.splice(k - 1, 0, [mid, d]);
        yield { newState: ns, label: `push_${mid}`, type: 'push' };
      }
    }
  }
}

// Pre-enumerate all 48 states
const allStates = [];
for (const dirs of [[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]]) {
  const dm = { AB: dirs[0], AC: dirs[1], BC: dirs[2] };
  for (const perm of permutations(MATCHUPS)) {
    allStates.push(perm.map(m => [m, dm[m]]));
  }
}

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

// Build state lookup map
const stateMap = new Map();
for (const s of allStates) {
  stateMap.set(stateKey(s), s);
}

// Pre-compute all state data
const stateData = new Map();

for (const s of allStates) {
  const key = stateKey(s);
  const w = winner(s);
  const cycle = isCycle(s);

  // Compute all neighbours with profitable info
  const allNeighbours = [];
  const devByMid = {};

  for (const { newState, label, type } of neighbours(s)) {
    const nk = stateKey(newState);
    const nw = winner(newState);
    const entry = { newState, label, type, winner: nw, key: nk };
    allNeighbours.push(entry);
    const mid = label.split('_')[1];
    if (!devByMid[mid]) devByMid[mid] = [];
    devByMid[mid].push(entry);
  }

  // Mark profitable deviations (MIN / MORE)
  const profitableDeviations = [];
  if (w !== 'A') {
    const u0 = PREF[w];
    for (const mid of MATCHUPS) {
      const devs = devByMid[mid] || [];
      let foundMin = false;
      for (const dev of devs) {
        if (PREF[dev.winner] > u0) {
          dev.profitable = true;
          dev.tag = foundMin ? 'MORE' : 'MIN';
          if (!foundMin) foundMin = true;
          profitableDeviations.push(dev);
        }
      }
    }
  }

  // Minimal (single-step) neighbours
  const minimalNeighbours = [];
  const minDevByMid = {};
  for (const { newState, label, type } of neighboursMinimal(s)) {
    const nk = stateKey(newState);
    const nw = winner(newState);
    const entry = { newState, label, type, winner: nw, key: nk };
    minimalNeighbours.push(entry);
    const mid = label.split('_')[1];
    if (!minDevByMid[mid]) minDevByMid[mid] = [];
    minDevByMid[mid].push(entry);
  }

  const minimalProfitableDeviations = [];
  if (w !== 'A') {
    const u0 = PREF[w];
    for (const mid of MATCHUPS) {
      for (const dev of (minDevByMid[mid] || [])) {
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
    isCycle: cycle,
    desc: desc(s),
    allNeighbours,
    devByMid,
    profitableDeviations,
    anyProfitable: profitableDeviations.length > 0,
    minimalNeighbours,
    minimalProfitableDeviations,
    anyMinimalProfitable: minimalProfitableDeviations.length > 0,
  });
}

// Second pass: monotone multi-step reachability over the neighboursMinimal graph.
// An edge cur -> nb may only be traversed if PREF[nb.winner] >= PREF[curWinner]
// (the outcome may never get strictly worse along the way). Any state reached
// this way whose PREF strictly exceeds the start's PREF is a valid multi-step
// profitable target — BFS naturally yields the shortest such monotone path.
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

// Identify the single-step-profitable source states and tag archetypes
// Archetype 1 (betray A): weak_AB or flip_AB from C-wins cycle, improves to B
// Archetype 2 (bury BC): flip_BC or push_BC from B-wins state, improves to A
const profitableStates = [];
for (const [key, data] of stateData) {
  if (data.winner !== 'A' && data.anyMinimalProfitable) {
    // Determine archetype
    let archetype = null;
    for (const dev of data.minimalProfitableDeviations) {
      const lab = dev.label;
      const nw = dev.winner;
      if ((lab.startsWith('weak_AB') || lab.startsWith('flip_AB')) && nw === 'B') {
        archetype = 1;
      } else if ((lab.startsWith('flip_BC') || lab.startsWith('push_BC')) && nw === 'A') {
        archetype = 2;
      } else if (nw === 'A') {
        archetype = 2;
      } else if (nw === 'B') {
        archetype = 1;
      }
    }
    data.archetype = archetype;
    profitableStates.push(data);
  }
}

// State encoding for URL: 6-char string e.g. "AB+AC-BC+"
// encodes rank-1 matchup first
function encodeState(state) {
  return state.map(([m, d]) => `${m}${d > 0 ? '+' : '-'}`).join('');
}

function decodeState(str) {
  // Parse "AB+AC-BC+" → [['AB',+1],['AC',-1],['BC',+1]]
  if (!str || str.length !== 9) return null;
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const mid = str.slice(i * 3, i * 3 + 2);
    const d = str[i * 3 + 2] === '+' ? +1 : -1;
    if (!MATCHUPS.includes(mid)) return null;
    parts.push([mid, d]);
  }
  return parts;
}

function getStateData(state) {
  return stateData.get(stateKey(state));
}

// Default sincere state
const SINCERE_STATE = [['AB', +1], ['AC', +1], ['BC', +1]];

export {
  MATCHUPS, PAIRS, SINCERE, PREF,
  winner, isCycle, desc, stateKey,
  neighbours, allStates, stateData, stateMap,
  profitableStates,
  encodeState, decodeState, getStateData,
  SINCERE_STATE,
};
