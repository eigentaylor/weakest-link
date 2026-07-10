"""
IRV (Instant-Runoff Voting) — Combinatorial Deviation Graph  (3 candidates)
============================================================================
State = (votes_rank, tournament)
  votes_rank : permutation of (A,B,C), fewest first-place votes -> most.
               votes_rank[0] is eliminated in this 3-candidate IRV round.
  tournament : (dAB, dAC, dBC), each +-1 — independent pairwise results.
               UNLIKE minimax's tournament tuple, there is no ranking/margin
               ordering among these three flags — just 3 independent bits.

Winner rule:
  eliminated = votes_rank[0]
  survivors  = the other two candidates
  winner     = whichever survivor wins the tournament matchup between them

Coalition A > B > C  sincere: A>B (+1), A>C (+1), B>C (+1)

Moves available to the coalition on votes_rank — NOT symmetric, and not
independent per-candidate either. A coalition that prefers A can only ever
betray A: shift support away from A toward whichever of B/C they'd rather
see survive. With only 3 slots that collapses to exactly TWO possible
single-step moves, never three, and never both "lower A" and "raise B" as
separate edges on the same state — betraying A downward IS raising whoever
it lands on, the same swap either way:

  swap_A  : swap A with the candidate directly below it (fewer votes),
            available whenever A is not already last (about to be
            eliminated already — nothing left to betray it into).
  swap_BC : swap B and C, available whenever they're adjacent to each
            other — i.e. whenever A is NOT sitting between them in
            votes_rank (A is first or last, not in the middle).

Worked through by case (A's current position, fewest->most):
  A last (already eliminated next)  -> only swap_BC available.
  A middle                          -> only swap_A available.
  A first (safest)                  -> both swap_A and swap_BC available.

Tournament moves (unchanged): flip_AB / flip_AC / flip_BC — on a matchup
currently at its sincere direction, flip it to insincere. Gated by
d == SINCERE[mid], same as minimax's flip.
"""

from itertools import product, permutations
from collections import deque

CANDIDATES = ['A', 'B', 'C']
MATCHUPS   = ['AB', 'AC', 'BC']
PAIRS      = {'AB': ('A', 'B'), 'AC': ('A', 'C'), 'BC': ('B', 'C')}
SINCERE    = {'AB': +1, 'AC': +1, 'BC': +1}   # coalition's preferred direction
PREF       = {'A': 2, 'B': 1, 'C': 0}
MID_OF     = {frozenset(PAIRS[m]): m for m in MATCHUPS}   # pair -> matchup id

# ── winner ─────────────────────────────────────────────────────────────────
def winner(state):
    """state: (votes_rank, tournament). Eliminate the fewest-vote candidate,
    then the tournament result between the 2 survivors decides it."""
    votes_rank, tournament = state
    dm = dict(zip(MATCHUPS, tournament))
    eliminated = votes_rank[0]
    s1, s2 = [c for c in votes_rank if c != eliminated]
    mid = MID_OF[frozenset((s1, s2))]
    a, b = PAIRS[mid]
    return a if dm[mid] == +1 else b

# ── condorcet / center-squeeze detection (diagnostic only) ──────────────────
def condorcet_winner(state):
    """Candidate beating both others across all 3 tournament flags, or None
    if it's a 3-cycle. NOT used to determine the IRV winner — winner() never
    needs this; it's purely for tagging center-squeeze pathologies."""
    _, tournament = state
    dm = dict(zip(MATCHUPS, tournament))
    wins = {'A': 0, 'B': 0, 'C': 0}
    for mid, d in dm.items():
        a, b = PAIRS[mid]
        wins[a if d == +1 else b] += 1
    for c, n in wins.items():
        if n == 2:
            return c
    return None

def is_center_squeeze(state):
    """Condorcet winner exists AND IRV eliminates them anyway."""
    votes_rank, _ = state
    cw = condorcet_winner(state)
    return cw is not None and cw == votes_rank[0]

def state_tag(state):
    """3-way tag: [SQZ] Condorcet winner exists but is eliminated (center
    squeeze), [cyc] no Condorcet winner, [CW ] Condorcet winner survives."""
    cw = condorcet_winner(state)
    if cw is None:
        return '[cyc]'
    return '[SQZ]' if is_center_squeeze(state) else '[CW ]'

# ── winner-relevance of a matchup ────────────────────────────────────────────
def relevant_matchup(votes_rank):
    """The only tournament matchup that can affect winner() for this
    votes_rank: the one between the two survivors (non-eliminated)."""
    eliminated = votes_rank[0]
    s1, s2 = [c for c in votes_rank if c != eliminated]
    return MID_OF[frozenset((s1, s2))]

def is_winner_relevant(votes_rank, mid):
    return mid == relevant_matchup(votes_rank)

# ── description ────────────────────────────────────────────────────────────
# Single source of truth for state notation, split into two parts so callers
# can lay them out either on one line (tabular rows) or two (state-header
# blocks) — tournament on its own line, vote order front and center.
def _desc_parts(state):
    votes_rank, tournament = state
    dm = dict(zip(MATCHUPS, tournament))
    w = winner(state)
    eliminated = votes_rank[0]

    rank_terms = []
    for c in votes_rank:
        label = f'{c}✗' if c == eliminated else c
        if c == w:
            label = f'**{label}**'
        rank_terms.append(label)
    votes_part = '(' + '≺'.join(rank_terms) + ')'          # fewest -> most

    tourn_terms = []
    for mid in MATCHUPS:
        a, b = PAIRS[mid]
        win_l, lose_l = (a, b) if dm[mid] == +1 else (b, a)
        if win_l == w:
            win_l = f'**{win_l}**'
        tourn_terms.append(f'{win_l}→{lose_l}')
    tourn_part = '⟨' + ' ∣ '.join(tourn_terms) + '⟩'

    return votes_part, tourn_part

def desc(state):
    """Compact one-line form for tabular listings."""
    votes_part, tourn_part = _desc_parts(state)
    return f'{votes_part} │ {tourn_part}'

def desc_block(state, indent='    '):
    """Two-line form for state-header blocks — votes_rank and tournament in
    separate blocks, previewing the eventual HTML tooltip layout."""
    votes_part, tourn_part = _desc_parts(state)
    return f'votes: {votes_part}\n{indent}tourn: {tourn_part}'

# ── votes_rank moves ─────────────────────────────────────────────────────────
# See module docstring: exactly two possible moves, never three, and never
# a duplicate pair of edges to the same target.
def votes_rank_neighbours(votes_rank):
    idx_a = votes_rank.index('A')
    if idx_a > 0:
        ns = list(votes_rank)
        ns[idx_a - 1], ns[idx_a] = ns[idx_a], ns[idx_a - 1]
        yield tuple(ns), 'swap_A'
    if idx_a != 1:
        i, j = (1, 2) if idx_a == 0 else (0, 1)
        ns = list(votes_rank)
        ns[i], ns[j] = ns[j], ns[i]
        yield tuple(ns), 'swap_BC'

# ── tournament moves ──────────────────────────────────────────────────────────
# A flip is inherently atomic — no distance/strength concept.
def tournament_neighbours(tournament):
    for i, mid in enumerate(MATCHUPS):
        d = tournament[i]
        if d == SINCERE[mid]:
            nt = list(tournament)
            nt[i] = -d
            yield tuple(nt), f'flip_{mid}'

# ── composed state-level neighbours (single-step / atomic model) ────────────
def neighbours_minimal(state):
    votes_rank, tournament = state
    for nvr, lab in votes_rank_neighbours(votes_rank):
        yield (nvr, tournament), lab
    for nt, lab in tournament_neighbours(tournament):
        yield (votes_rank, nt), lab

# ── all 48 states ──────────────────────────────────────────────────────────
all_states = []
for tournament in product((+1, -1), repeat=3):
    for votes_rank in permutations(CANDIDATES):
        all_states.append((votes_rank, tournament))
assert len(all_states) == 48
assert len(set(all_states)) == 48
for _s in all_states:
    assert winner(_s) in ('A', 'B', 'C')

# ── report ─────────────────────────────────────────────────────────────────
W = 72
print('=' * W)
print('  IRV  ·  COMBINATORIAL DEVIATION GRAPH  (3 candidates)')
print('  Coalition A>B>C  |  sincere: A>B, A>C, B>C  |  48 states')
print('=' * W)

# ── section 1: summary counts ────────────────────────────────────────────────
a_wins = a_loses = 0
sqz_count = cyc_count = cw_survive_count = 0
for s in all_states:
    w = winner(s)
    if w == 'A':
        a_wins += 1
    else:
        a_loses += 1
    tag = state_tag(s)
    if tag == '[SQZ]':
        sqz_count += 1
    elif tag == '[cyc]':
        cyc_count += 1
    else:
        cw_survive_count += 1

assert a_wins + a_loses == 48
assert sqz_count + cyc_count + cw_survive_count == 48

print(f'\n  A wins outright              : {a_wins}')
print(f'  A does not win                : {a_loses}')
print(f'\n  Center-squeeze [SQZ] (CW exists, eliminated) : {sqz_count}')
print(f'  Cycle [cyc] (no Condorcet winner)            : {cyc_count}')
print(f'  Condorcet winner survives [CW ]              : {cw_survive_count}')

def profitable_devs(state):
    w = winner(state)
    u0 = PREF[w]
    for ns, lab in neighbours_minimal(state):
        nw = winner(ns)
        if PREF[nw] > u0:
            yield ns, lab, nw

profitable_cases = []   # (state, winner, [(ns, lab, nw), ...])
total_profitable_edges = 0
for s in all_states:
    if winner(s) == 'A':
        continue
    rows = list(profitable_devs(s))
    if rows:
        profitable_cases.append((s, winner(s), rows))
        total_profitable_edges += len(rows)

print(f'\n  Any profitable deviation      : {len(profitable_cases)}')
print(f'  No profitable deviation       : {a_loses - len(profitable_cases)}')
print(f'  Total profitable edges        : {total_profitable_edges}')

# ── section 2: flip-profitability proof ──────────────────────────────────────
print(f'\n{"=" * W}')
print('  FLIP-PROFITABILITY PROOF')
print('=' * W)
print('''
  Claim: a flip_* deviation is NEVER profitable.

  Proof: a flip is only legal on a matchup currently at its sincere
  direction. If the matchup is winner-relevant (i.e. it is the matchup
  between the two current survivors), sincere always favors the more-
  preferred survivor — flipping it can only hand the win to the LESS-
  preferred survivor, which is strictly worse for the coalition, never
  profitable. If the matchup is winner-irrelevant (it involves the
  eliminated candidate), flipping it changes winner() not at all, so it
  cannot be profitable either. Every flip falls into one of these two
  cases, so no flip is ever profitable — this holds structurally, not
  just empirically.
''')

flip_edges = 0
flip_profitable = 0
for s in all_states:
    w = winner(s)
    u0 = PREF[w]
    for ns, lab in neighbours_minimal(s):
        if lab.startswith('flip_'):
            flip_edges += 1
            if PREF[winner(ns)] > u0:
                flip_profitable += 1

assert flip_profitable == 0
print(f'  flip edges checked: {flip_edges}, profitable: {flip_profitable}  '
      f'(flip is NEVER profitable)')

# ── section 3: all profitable cases ──────────────────────────────────────────
# No MIN/MORE distinction here (unlike minimax): every move type yields at
# most one alternative in this model, so there is nothing to rank by
# strength — a state either has a profitable move of a given type or not.
print(f'\n{"=" * W}')
print('  ALL PROFITABLE CASES (single-step model)')
print('  (★=A wins  ·=B wins)')
print('=' * W)

by_type = {'swap_A': 0, 'swap_BC': 0}
for s, w, rows in profitable_cases:
    for ns, lab, nw in rows:
        by_type[lab] = by_type.get(lab, 0) + 1

print(f'\n  {"type":<10}  cases')
for k, n in by_type.items():
    if n == 0:
        continue
    print(f'  {k:<10}  {n:>4}')

print()
for s, w, rows in profitable_cases:
    print(f'  ┌ {state_tag(s)} {desc_block(s, indent="    ")}')
    print(f'  │   winner = {w}')
    for ns, lab, nw in rows:
        star = '★' if nw == 'A' else '·'
        print(f'  │    {star} {state_tag(ns)} {lab:<9} → {desc(ns):<48} → {nw}')
    print()

# ── section 4: worked examples ───────────────────────────────────────────────
def show_example(label, state):
    w = winner(state)
    u0 = PREF[w]
    print(f'\n  {label}')
    print(f'    base: {state_tag(state)} {desc_block(state, indent="          ")}')
    print(f'          winner={w}  condorcet_winner={condorcet_winner(state)}  '
          f'center_squeeze={is_center_squeeze(state)}')
    all_devs = list(neighbours_minimal(state))
    if not all_devs:
        print('    (no deviations available)')
        return
    any_profitable = False
    for ns, lab in all_devs:
        nw = winner(ns)
        if nw == w:
            cmp_sym = '='
        elif PREF[nw] > u0:
            cmp_sym = '↑'
            any_profitable = True
        else:
            cmp_sym = '↓'
        flag = '  ★ A WINS' if nw == 'A' else ('  ✓ B wins' if nw == 'B' and PREF[nw] > u0 else '')
        print(f'    {state_tag(ns)} [{lab}]  {desc(ns):<48} → {nw} {cmp_sym}{flag}')
    if not any_profitable:
        print('    => NO profitable deviation exists from this state at any depth.')

print(f'\n{"=" * W}')
print('  WORKED EXAMPLES')
print('=' * W)

# Ex CS: A is the Condorcet winner (beats B and C) but has the fewest
# first-place votes, so IRV eliminates A first. Remaining B,C: B beats C,
# so B wins. This is the user's original center-squeeze example. A is
# already last in votes_rank, so swap_A is unavailable — only swap_BC and
# the (never-profitable) flips are.
_ex_cs = (('A', 'B', 'C'), (+1, +1, +1))
assert winner(_ex_cs) == 'B'
assert condorcet_winner(_ex_cs) == 'A'
assert is_center_squeeze(_ex_cs) is True
show_example(
    'Ex CS: A is Condorcet winner but eliminated (center squeeze) — '
    'powerless case',
    _ex_cs
)

# A center-squeeze state where a profitable deviation DOES exist, for
# contrast: best reachable is B, not A. A is in the middle of votes_rank
# here, so swap_A is the only votes_rank move available.
_ex_cs2 = (('B', 'A', 'C'), (-1, -1, +1))
assert is_center_squeeze(_ex_cs2) is True
show_example(
    'Ex CS2: center squeeze with an available (but only B-reaching) '
    'deviation',
    _ex_cs2
)

# ── section 5: multi-step monotone reachability ──────────────────────────────
def build_monotone_graph():
    adj = {}
    for s in all_states:
        wu = winner(s)
        adj[s] = [(ns, lab) for ns, lab in neighbours_minimal(s)
                  if PREF[winner(ns)] >= PREF[wu]]
    return adj

MONO_ADJ = build_monotone_graph()

def bfs_monotone(start):
    parent = {start: (None, None, 0)}
    q = deque([start])
    while q:
        curr = q.popleft()
        _, _, hops = parent[curr]
        for ns, lab in MONO_ADJ[curr]:
            if ns not in parent:
                parent[ns] = (curr, lab, hops + 1)
                q.append(ns)
    return parent

def reconstruct_monotone(parent, target):
    path = []
    node = target
    while node is not None:
        prev, lab, hops = parent[node]
        path.append((node, lab, hops))
        node = prev
    path.reverse()
    return path

def show_path(path, u0):
    start_w = winner(path[0][0])
    for state, lab, hops in path:
        nw = winner(state)
        ct = state_tag(state)
        if hops == 0:
            print(f'  │  start      : {ct} {desc(state):<42} winner={nw}')
        else:
            if nw == start_w:
                cmp = '='
            elif PREF[nw] > u0:
                cmp = '★' if nw == 'A' else '↑'
            else:
                cmp = '↓'
            print(f'  │  step {hops} [{lab}]: {ct} {desc(state):<42} winner={nw} {cmp}')

print('=' * W)
print('  MULTI-STEP DEVIATION PATHS')
print('  Coalition chains single steps; the outcome may never get strictly')
print('  worse along the way, but the final step must strictly improve it.')
print('=' * W)

multi_only_cases = []
upgrade_cases = []
no_path_count = 0
total_pairs = 0

pref_name = {0: 'C', 1: 'B', 2: 'A'}

for s in all_states:
    w = winner(s)
    if w == 'A':
        continue
    u0 = PREF[w]

    best_single = max((PREF[winner(ns)] for ns, _ in neighbours_minimal(s)), default=u0)

    parent_map = bfs_monotone(s)
    better = [r for r in parent_map if r != s and PREF[winner(r)] > u0]
    total_pairs += len(better)

    if not better:
        no_path_count += 1
        continue

    best_multi = max(PREF[winner(r)] for r in better)
    targets = [r for r in better if PREF[winner(r)] == best_multi]
    best_t = min(targets, key=lambda r: parent_map[r][2])

    if best_single <= u0:
        multi_only_cases.append((s, w, reconstruct_monotone(parent_map, best_t)))
    elif best_multi > best_single:
        upgrade_cases.append((s, w, best_single, reconstruct_monotone(parent_map, best_t)))

assert len(multi_only_cases) == 0
assert len(upgrade_cases) == 0

print(f'\n  Of {a_loses} states where A does not win:')
print(f'    {len(profitable_cases):>2}  profitable in 1 step (shown above)')
print(f'    {len(upgrade_cases):>2}    of which: multi-step reaches an even better outcome')
print(f'    {len(multi_only_cases):>2}  profitable ONLY via 2+ step chains')
print(f'    {no_path_count:>2}  no profitable path at any depth')
print(f'    {total_pairs:>2}  total profitable (source, target) pairs across all states')

print('\n  => Multi-step chaining adds NO power beyond single-step in this')
print('     model: every profitable target reachable via a chain is already')
print('     reachable in one step (unlike minimax, which has real')
print('     multi-step-only / upgrade cases).')

print('=' * W)

# ── section 6: winner-relevant vs winner-irrelevant flip tagging ────────────
print('\n' + '=' * W)
print('  WINNER-RELEVANT VS WINNER-IRRELEVANT FLIPS  (backs section 2)')
print('  For each votes_rank, the tournament matchup between the two')
print('  survivors is "relevant" (a flip there changes winner()); the other')
print('  two matchups involve the eliminated candidate and are "irrelevant"')
print('  (a flip there never changes winner()).')
print('=' * W)

for votes_rank in permutations(CANDIDATES):
    rel = relevant_matchup(votes_rank)
    tags = []
    for mid in MATCHUPS:
        tags.append(f'{mid}:{"relevant" if mid == rel else "irrelevant"}')
    eliminated = votes_rank[0]
    print(f'  votes_rank={"".join(votes_rank):<4} (eliminated={eliminated})  '
          + '  '.join(tags))

print('=' * W)

# ── section 7: votes_rank move availability, by A's position ────────────────
# Demonstrates the rule directly (see module docstring): A last -> only
# swap_BC; A middle -> only swap_A; A first -> both. Also confirms there is
# never a duplicate edge (both moves landing on the identical target) —
# by construction, swap_A and swap_BC always move DIFFERENT pairs of
# candidates, so they can never collide.
print('\n' + '=' * W)
print('  VOTES_RANK MOVE AVAILABILITY  (by A\'s position, fewest -> most)')
print('=' * W)
print()
print(f'  {"votes_rank":<12}{"A at idx":<10}{"available moves":<24}{"targets"}')
for votes_rank in permutations(CANDIDATES):
    idx_a = votes_rank.index('A')
    moves = list(votes_rank_neighbours(votes_rank))
    move_strs = [f'{lab}->{"".join(ns)}' for ns, lab in moves]
    assert len(set(ns for ns, _ in moves)) == len(moves), 'duplicate target detected'
    print(f'  {"".join(votes_rank):<12}{idx_a:<10}{", ".join(lab for _, lab in moves):<24}'
          f'{", ".join(move_strs)}')
print()
print('  A last (idx 0)   -> 1 move  (swap_BC only)')
print('  A middle (idx 1) -> 1 move  (swap_A only)')
print('  A first (idx 2)  -> 2 moves (swap_A and swap_BC — never the same target)')
print('=' * W)

# ═══════════════════════════════════════════════════════════════════════════
#  N-CANDIDATE GENERALIZATION: intentionally omitted.
#
#  IRV elimination-with-vote-reallocation does not reduce to this
#  3-candidate (votes_rank, tournament) model for N>3: with more than 3
#  candidates IRV eliminates repeatedly, recomputing first-place votes
#  among remaining candidates as eliminated candidates' ballots reallocate
#  to next choices. That requires modeling full ranked ballots (or a
#  redistribution rule), not just a permutation of first-place order plus
#  a fixed pairwise tournament. The clean 2-component model here only
#  works because with 3 candidates there is exactly one elimination round
#  and the tournament between the 2 survivors fully determines the
#  outcome. The swap_A/swap_BC move simplification is also specific to
#  3 candidates (it relies on there being only one "other" candidate below
#  A and only one pair left over once A is placed) and would need its own
#  rework for N>3. Left for a future design task rather than forced into
#  this model.
# ═══════════════════════════════════════════════════════════════════════════
print('\n' + '=' * W)
print('  N-CANDIDATE GENERALIZATION: intentionally omitted.')
print('  IRV elimination-with-vote-reallocation does not reduce to this')
print('  3-candidate (votes_rank, tournament) model for N>3 — see comment')
print('  above. Left for a future design task.')
print('=' * W)
