"""
Minimax Pairwise Voting — Combinatorial Deviation Graph
=======================================================
State = ranked tuple of 3 directed matchups, rank1 > rank2 > rank3 by margin.

Winner rule (no margins needed — only ordering):
  1. CW exists  → elect them.
  2. Cycle       → elect the LOSER of the last (rank-3 = smallest) matchup.
     (That candidate's worst loss is smallest, so they win minimax.)

Coalition A ≻ B ≻ C  sincere: A>B (+1), A>C (+1), B>C (+1)

Deviation on matchup m always moves toward the insincere direction:
  sincere winning at rank k:   (2-k) weaken + 3 flip  →  5-k alternatives
  insincere winning at rank k:  k push alternatives    →  k alternatives (0 if k=0)
  ─────────────────────────────────────────────────────────────────────────────
  sincere  rank 0  →  2 weak + 3 flip = 5 alternatives
  sincere  rank 1  →  1 weak + 3 flip = 4 alternatives
  sincere  rank 2  →  0 weak + 3 flip = 3 alternatives
  insincere rank 0 →  0 push           = 0 alternatives (already maximally insincere)
  insincere rank 1 →  1 push           = 1 alternative
  insincere rank 2 →  2 push           = 2 alternatives
"""

from itertools import product, permutations
from collections import deque

MATCHUPS = ['AB', 'AC', 'BC']
PAIRS    = {'AB': ('A','B'), 'AC': ('A','C'), 'BC': ('B','C')}
SINCERE  = {'AB': +1, 'AC': +1, 'BC': +1}   # coalition's preferred direction
PREF     = {'A': 2, 'B': 1, 'C': 0}

# ── winner ─────────────────────────────────────────────────────────────────
def winner(state):
    """state: tuple of (mid, dir) in rank order (rank-1 first = largest margin)."""
    wins = {'A': 0, 'B': 0, 'C': 0}
    for mid, d in state:
        a, b = PAIRS[mid]
        wins[a if d == +1 else b] += 1
    for c, n in wins.items():
        if n == 2: return c                         # Condorcet winner
    # cycle → loser of last (smallest-margin) matchup wins
    lm, ld = state[-1]
    a, b = PAIRS[lm]
    return b if ld == +1 else a

# ── description ────────────────────────────────────────────────────────────
def desc(state):
    def f(mid, d):
        a, b = PAIRS[mid]
        return f'({a}>{b})' if d == +1 else f'({b}>{a})'
    return ' > '.join(f(m, d) for m, d in state)

# ── cycle detection ────────────────────────────────────────────────────────
def is_cycle(state):
    wins = {'A': 0, 'B': 0, 'C': 0}
    for mid, d in state:
        a, b = PAIRS[mid]
        wins[a if d == +1 else b] += 1
    return not any(n == 2 for n in wins.values())

def cycle_tag(state):
    return '[cyc]' if is_cycle(state) else '[CW] '

# ── neighbour states ───────────────────────────────────────────────────────
def neighbours(state):
    """Yield (new_state, label) for every available deviation."""
    sl = list(state)
    for k, (mid, d) in enumerate(sl):              # k = 0-indexed rank (0=largest)
        others = [x for x in sl if x[0] != mid]   # 2 remaining, order preserved
        if d == SINCERE[mid]:
            # weaken: same dir, shift to lower rank — min to max strength
            for j in range(k + 1, 3):
                ns = list(others); ns.insert(j, (mid, d))
                yield tuple(ns), f'weak_{mid}'
            # flip: opposite dir — rank 2→0 (min to max strength)
            for j in range(2, -1, -1):
                ns = list(others); ns.insert(j, (mid, -d))
                yield tuple(ns), f'flip_{mid}'
        else:
            # insincere direction already winning — strengthen by moving to
            # higher rank (rank k-1→0, min to max strength); skip if at rank 0
            for j in range(k - 1, -1, -1):
                ns = list(others); ns.insert(j, (mid, d))
                yield tuple(ns), f'push_{mid}'

# ── all 48 states ──────────────────────────────────────────────────────────
all_states = []
for dirs in product((+1, -1), repeat=3):
    dAB, dAC, dBC = dirs
    dm = {'AB': dAB, 'AC': dAC, 'BC': dBC}
    for perm in permutations(MATCHUPS):
        all_states.append(tuple((m, dm[m]) for m in perm))
assert len(all_states) == 48

# ── analyse ────────────────────────────────────────────────────────────────
counts   = {'A_wins': 0, 'A_loses': 0, 'any_help': 0, 'no_help': 0}
by_type  = {k: {'total': 0, 'to_A': 0, 'to_B': 0}
            for k in ['weak_AB','weak_AC','weak_BC',
                       'flip_AB','flip_AC','flip_BC',
                       'push_AB','push_AC','push_BC']}
cases    = []

for s in all_states:
    w = winner(s)
    if w == 'A':
        counts['A_wins'] += 1
        continue
    counts['A_loses'] += 1
    u0 = PREF[w]

    # Group all deviations by matchup, in min-to-max strength order
    dev_by_mid = {}
    for ns, lab in neighbours(s):
        mid = lab.split('_')[1]
        if mid not in dev_by_mid:
            dev_by_mid[mid] = []
        dev_by_mid[mid].append((ns, lab, winner(ns)))

    # For each matchup, find the minimum profitable deviation; extras are 'MORE'
    profitable_found = False
    case_rows = []   # (ns, lab, nw, tag)  tag = 'MIN' | 'MORE'
    for mid, devs in dev_by_mid.items():
        found_min = False
        for ns, lab, nw in devs:
            if PREF[nw] > u0:
                if not found_min:
                    tag = 'MIN'
                    found_min = True
                    profitable_found = True
                    by_type[lab]['total'] += 1
                    by_type[lab]['to_A' if nw == 'A' else 'to_B'] += 1
                else:
                    tag = 'MORE'
                case_rows.append((ns, lab, nw, tag))

    if profitable_found:
        counts['any_help'] += 1
        cases.append((s, w, case_rows))
    else:
        counts['no_help'] += 1

# ── report ─────────────────────────────────────────────────────────────────
W = 72
print('═' * W)
print('  MINIMAX PAIRWISE  ·  COMBINATORIAL DEVIATION GRAPH')
print('  Coalition A≻B≻C  |  sincere: A>B, A>C, B>C  |  48 states')
print('═' * W)
print(f'\n  A wins outright           : {counts["A_wins"]}')
print(f'  A does not win             : {counts["A_loses"]}')
print(f'  Any profitable deviation   : {counts["any_help"]}')
print(f'  No profitable deviation    : {counts["no_help"]}')

print(f'\n  ── Min-strength profitable deviations by type ───────────────────────')
print(f'  {"type":<12}  cases  → A wins  → B wins')
for k, d in by_type.items():
    if d['total'] == 0: continue
    print(f'  {k:<12}  {d["total"]:>4}      '
          f'  {d["to_A"]:>4}       {d["to_B"]:>4}')

print(f'\n  ── All profitable cases ─────────────────────────────────────────────')
print(f'  (★=A wins  ·=B wins  ◄MIN=minimum deviation strength  +=extra-strong)')
for s, w, rows in cases:
    ctag_s = cycle_tag(s)
    print(f'  ┌ {ctag_s} {desc(s):<48}  winner = {w}')
    prev_mid = None
    for ns, lab, nw, tag in rows:
        mid = lab.split('_')[1]
        if mid != prev_mid:
            print(f'  │  — on {mid} —')
            prev_mid = mid
        ctag_ns = cycle_tag(ns)
        star  = '★' if nw == 'A' else '·'
        mark  = ' ◄MIN' if tag == 'MIN' else ' +'
        print(f'  │    {star} {ctag_ns} {lab:<9} → {desc(ns):<44} → {nw}{mark}')
    print()

print('═' * W)

# ── verify Taylor's two examples ───────────────────────────────────────────
def show_example(label, state):
    w = winner(state)
    u0 = PREF[w]
    ctag = cycle_tag(state)
    print(f'\n  {label}')
    print(f'    base: {ctag} {desc(state)}  →  winner {w}')
    all_devs = list(neighbours(state))
    prev_mid = None
    for ns, lab in all_devs:
        mid = lab.split('_')[1]
        if mid != prev_mid:
            cnt = sum(1 for _, l in all_devs if l.split('_')[1] == mid)
            print(f'    — deviation on {mid} ({cnt} alternatives) —')
            prev_mid = mid
        nw = winner(ns)
        ctag_ns = cycle_tag(ns)
        if nw == w:        cmp_sym = '='
        elif PREF[nw] > u0: cmp_sym = '↑'
        else:               cmp_sym = '↓'
        flag = '  ★ A WINS' if nw == 'A' else ('  ✓ B wins' if nw == 'B' and PREF[nw] > u0 else '')
        print(f'      {ctag_ns} [{lab}]  {desc(ns):<48} → {nw} {cmp_sym}{flag}')

print('\n' + '═' * W)
print('  WORKED EXAMPLES')
print('═' * W)

# Ex 1: (A>B) > (C>B) > (C>A)   [deviate on AB — 5 alternatives]
show_example(
    'Ex 1: (A>B) > (C>B) > (C>A)',
    (('AB',+1), ('BC',-1), ('AC',-1))
)

# Ex 2: (A>C) > (B>A) > (B>C)   [deviate on BC — 3 alternatives, on AC — 5 alt]
show_example(
    'Ex 2: (A>C) > (B>A) > (B>C)',
    (('AC',+1), ('AB',-1), ('BC',+1))
)

# Ex 3: (A>B) > (C>A) > (B>C)   [5 dev on AB, 1 push on AC, 3 dev on BC]
show_example(
    'Ex 3: (A>B) > (C>A) > (B>C)',
    (('AB',+1), ('AC',-1), ('BC',+1))
)

# Ex 4: all-insincere state — (C>A) > (C>B) > (B>A)
#   AC at rank 0 insincere → 0 push; BC at rank 1 → 1 push; AB at rank 2 → 2 push
show_example(
    'Ex 4: (C>A) > (C>B) > (B>A)   [push-only: 0+1+2=3 edges]',
    (('AC',-1), ('BC',-1), ('AB',-1))
)

print('\n' + '═' * W)

# ── multi-step reachability ─────────────────────────────────────────────────
def bfs_parents(start):
    """BFS from start; return {state: (prev_state, label)} for all reachable."""
    parent = {start: (None, None)}
    q = deque([start])
    while q:
        curr = q.popleft()
        for ns, lab in neighbours(curr):
            if ns not in parent:
                parent[ns] = (curr, lab)
                q.append(ns)
    return parent

def reconstruct(parent, target):
    """Shortest path as [(state, label_used_to_arrive)]; first entry is (start, None)."""
    path = []
    node = target
    while node is not None:
        prev, lab = parent[node]
        path.append((node, lab))
        node = prev
    path.reverse()
    return path

def show_path(path, u0):
    start_w = winner(path[0][0])
    for i, (state, lab) in enumerate(path):
        nw = winner(state)
        ct = cycle_tag(state)
        if i == 0:
            print(f'  │  start      : {ct} {desc(state):<42} winner={nw}')
        else:
            if   nw == start_w:    cmp = '='
            elif PREF[nw] > u0:    cmp = '★' if nw == 'A' else '↑'
            else:                  cmp = '↓'
            print(f'  │  step {i} [{lab}]: {ct} {desc(state):<42} winner={nw} {cmp}')

print('═' * W)
print('  MULTI-STEP DEVIATION PATHS')
print('  Coalition makes sequential single-matchup deviations across multiple rounds.')
print('  Paths may worsen the outcome temporarily before reaching a better state.')
print('═' * W)

multi_only_cases = []   # no 1-step help, but 2+ steps profitable
upgrade_cases    = []   # 1-step reaches B; multi-step can reach A
no_path_count    = 0

pref_name = {0: 'C', 1: 'B', 2: 'A'}

for s in all_states:
    w = winner(s)
    if w == 'A':
        continue
    u0 = PREF[w]

    best_single = max((PREF[winner(ns)] for ns, _ in neighbours(s)), default=u0)

    parent_map = bfs_parents(s)
    reachable  = [r for r in parent_map if r != s]
    best_multi = max((PREF[winner(r)] for r in reachable), default=u0)

    if best_multi <= u0:
        no_path_count += 1
    elif best_single <= u0:
        # Multi-only: single step is never profitable
        targets = [r for r in reachable if PREF[winner(r)] == best_multi]
        best_t  = min(targets, key=lambda r: len(reconstruct(parent_map, r)))
        multi_only_cases.append((s, w, reconstruct(parent_map, best_t)))
    elif best_multi > best_single:
        # Upgrade: single-step helps but multi-step reaches a higher outcome
        targets = [r for r in reachable if PREF[winner(r)] == best_multi]
        best_t  = min(targets, key=lambda r: len(reconstruct(parent_map, r)))
        upgrade_cases.append((s, w, best_single, reconstruct(parent_map, best_t)))
    # else: single-step already achieves the best reachable outcome

print(f'\n  Of {counts["A_loses"]} states where A does not win:')
print(f'    {counts["any_help"]:>2}  profitable in 1 step (shown above)')
print(f'    {len(upgrade_cases):>2}    of which: multi-step reaches an even better outcome')
print(f'    {len(multi_only_cases):>2}  profitable ONLY via 2+ step chains')
print(f'    {no_path_count:>2}  no profitable path at any depth')

if multi_only_cases:
    print(f'\n  ── Multi-step-only profitable (1-step never helps) ──────────────────')
    for s, w, path in multi_only_cases:
        print(f'  ┌ {cycle_tag(s)} {desc(s):<46} winner={w}')
        show_path(path, PREF[w])
        print()
else:
    print(f'\n  No multi-step-only cases — single-step analysis is complete.')

if upgrade_cases:
    print(f'\n  ── Upgrades: 1-step reaches B, multi-step can reach A ───────────────')
    for s, w, best_s, path in upgrade_cases:
        print(f'  ┌ {cycle_tag(s)} {desc(s):<46} winner={w}  (best 1-step={pref_name[best_s]})')
        show_path(path, PREF[w])
        print()
else:
    print(f'\n  No upgrade cases — 1-step already achieves the best reachable outcome.')

print('═' * W)