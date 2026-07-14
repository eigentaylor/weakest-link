"""
STAR (Score Then Automatic Runoff) — Combinatorial Deviation Graph  (3 candidates)
============================================================================
State = (score_rank, tournament)
  score_rank : permutation of (A,B,C), fewest total stars -> most.
               score_rank[0] misses STAR's automatic runoff (only the top
               2 total scorers advance) in this 3-candidate model.
  tournament : (dAB, dAC, dBC), each +-1 — independent pairwise results,
               exactly as in irv_graph_test.py. Same caveat: no ranking/
               margin ordering among the three flags, just 3 independent
               bits.

Winner rule (IDENTICAL to IRV's, just re-grounded in "total score" instead
of "first-place votes" — STAR's automatic runoff between the top 2
scorers is decided by pairwise preference, exactly like IRV's runoff
between its 2 survivors):
  cut       = score_rank[0]      (lowest total score, misses the runoff)
  finalists = the other two candidates
  winner    = whichever finalist wins the tournament matchup between them

Coalition A > B > C  sincere ballot: 5 - x - 0, for some voter-specific
0 < x < 5. Sincere tournament contribution: A>B (+1), A>C (+1), B>C (+1) —
identical SINCERE direction to IRV, since this is still the same coalition
preference order.

Moves available to the coalition on score_rank
------------------------------------------------
Unlike IRV (a ranked ballot -> only "betray A toward X" is expressible),
STAR's *score* ballot lets each voter move every candidate's own score
independently, not just reassign one transferable vote. But two of the six
conceivable single-candidate levers never exist: "boost A" (already
sincerely maxed at 5 — no room left) and "starve C" (already sincerely
minned at 0 — no room left). And "boost C" is never generous to the
coalition (it only ever helps their least-favorite), so it's excluded from
the *most generous* map of deviation this model builds. That leaves
exactly three levers, all applied per-ballot by every coalition voter:

  boost_B  : raise B's contributed score up to 4 (just under A's 5) — the
             most generous boost that still keeps the ballot's own A>B
             preference strictly intact. Lets B overtake whoever is
             directly above B in total score.
  starve_B : lower B's contributed score down to 1 (just above C's 0) —
             the most generous starve that still keeps B>C strictly
             intact. Lets whoever is directly below B overtake B.
  starve_A : lower A's contributed score down to x+1 (just above B's own
             sincere x) — the most generous starve that still keeps A>B
             strictly intact. Lets whoever is directly below A overtake A.

All three preserve the tournament exactly (they only ever change *how
much* the ballot prefers one candidate over another, never *which* one it
prefers) — so score_rank and tournament remain fully independent axes,
same as in the IRV model.

The one swap this can NEVER achieve: moving A above C when C is already
above A in total score. C's ballot contribution is always 0 and A's is
always >= x+1 > 0 — so the coalition's ballot already favors A over C as
much as it possibly can, even sincerely. If that's still not enough for A
to out-score C, no lever here can close the gap. (The reverse direction —
starving A until C overtakes it — is exactly what starve_A does, so this
is NOT a symmetric restriction.)

Because each lever is keyed to a single candidate's move direction (not to
a specific pair, like IRV's swap_A/swap_BC were), the same target state can
sometimes be reached by TWO different levers — e.g. if B sits directly
below A, both boost_B (B moves up past A) and starve_A (A moves down past
B) land on the identical resulting score_rank. Both are kept as parallel
edges (same source+target, different label) since they're genuinely
different ballot strategies, not the same move counted twice. This is why
STAR's score_rank graph has more edges than IRV's — see the edge-count
comparison in the report below.

Tournament moves (unchanged from IRV): flip_AB / flip_AC / flip_BC — on a
matchup currently at its sincere direction, flip it to insincere. Gated by
d == SINCERE[mid], same as IRV's flip. The graph page defaults to
EXCLUDING these ("tournament deviations" toggle, off by default) since
this model is primarily about exposing how much manipulation power
score_rank alone adds over IRV — but they're implemented here (and the
never-profitable proof re-verified below) for parity, and in case the UI
toggle is switched on.
"""

from itertools import product, permutations
from collections import deque

CANDIDATES = ['A', 'B', 'C']
MATCHUPS   = ['AB', 'AC', 'BC']
PAIRS      = {'AB': ('A', 'B'), 'AC': ('A', 'C'), 'BC': ('B', 'C')}
SINCERE    = {'AB': +1, 'AC': +1, 'BC': +1}   # coalition's preferred direction
PREF       = {'A': 2, 'B': 1, 'C': 0}
MID_OF     = {frozenset(PAIRS[m]): m for m in MATCHUPS}   # pair -> matchup id

MOVE_LABEL = {
    'boost_B':  '5-4-0 (boost B)',
    'starve_B': '5-1-0 (starve B)',
    'starve_A': '(x+1)-x-0 (starve A)',
    'flip_AB':  'lie B>A',
    'flip_AC':  'lie C>A',
    'flip_BC':  'lie C>B',
}

# ── winner ─────────────────────────────────────────────────────────────────
def winner(state):
    """state: (score_rank, tournament). Cut the lowest-total-score
    candidate, then the tournament result between the 2 finalists decides
    it. Structurally identical to irv_graph_test.py's winner()."""
    score_rank, tournament = state
    dm = dict(zip(MATCHUPS, tournament))
    cut = score_rank[0]
    s1, s2 = [c for c in score_rank if c != cut]
    mid = MID_OF[frozenset((s1, s2))]
    a, b = PAIRS[mid]
    return a if dm[mid] == +1 else b

# ── condorcet / center-squeeze detection (diagnostic only) ──────────────────
def condorcet_winner(state):
    """Candidate beating both others across all 3 tournament flags, or None
    if it's a 3-cycle. NOT used to determine the STAR winner."""
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
    """Condorcet winner exists AND STAR's score cut removes them from the
    runoff anyway."""
    score_rank, _ = state
    cw = condorcet_winner(state)
    return cw is not None and cw == score_rank[0]

def state_tag(state):
    """3-way tag: [SQZ] Condorcet winner exists but is cut before the
    runoff (center squeeze), [cyc] no Condorcet winner, [CW ] Condorcet
    winner reaches the runoff and wins normally."""
    cw = condorcet_winner(state)
    if cw is None:
        return '[cyc]'
    return '[SQZ]' if is_center_squeeze(state) else '[CW ]'

# ── winner-relevance of a matchup ────────────────────────────────────────────
def relevant_matchup(score_rank):
    cut = score_rank[0]
    s1, s2 = [c for c in score_rank if c != cut]
    return MID_OF[frozenset((s1, s2))]

def is_winner_relevant(score_rank, mid):
    return mid == relevant_matchup(score_rank)

# ── description ────────────────────────────────────────────────────────────
def _desc_parts(state):
    score_rank, tournament = state
    dm = dict(zip(MATCHUPS, tournament))
    w = winner(state)
    cut = score_rank[0]

    rank_terms = []
    for c in score_rank:
        label = f'{c}✗' if c == cut else c
        if c == w:
            label = f'**{label}**'
        rank_terms.append(label)
    score_part = '(' + '≺'.join(rank_terms) + ')'          # fewest -> most

    tourn_terms = []
    for mid in MATCHUPS:
        a, b = PAIRS[mid]
        win_l, lose_l = (a, b) if dm[mid] == +1 else (b, a)
        if win_l == w:
            win_l = f'**{win_l}**'
        tourn_terms.append(f'{win_l}→{lose_l}')
    tourn_part = '⟨' + ' ∣ '.join(tourn_terms) + '⟩'

    return score_part, tourn_part

def desc(state):
    """Compact one-line form for tabular listings."""
    score_part, tourn_part = _desc_parts(state)
    return f'{score_part} │ {tourn_part}'

def desc_block(state, indent='    '):
    """Two-line form for state-header blocks."""
    score_part, tourn_part = _desc_parts(state)
    return f'score: {score_part}\n{indent}tourn: {tourn_part}'

# ── score_rank moves ─────────────────────────────────────────────────────────
def score_rank_neighbours(score_rank):
    """Three independent single-step levers — see module docstring. Unlike
    IRV's swap_A/swap_BC (which can never collide), boost_B and starve_A CAN
    land on the same target (whenever B sits directly below A) — both are
    yielded as separate, differently-labeled edges rather than deduplicated,
    since they represent distinct ballot strategies."""
    idx_b = score_rank.index('B')
    idx_a = score_rank.index('A')

    if idx_b < 2:
        ns = list(score_rank)
        ns[idx_b], ns[idx_b + 1] = ns[idx_b + 1], ns[idx_b]
        yield tuple(ns), 'boost_B'

    if idx_b > 0:
        ns = list(score_rank)
        ns[idx_b - 1], ns[idx_b] = ns[idx_b], ns[idx_b - 1]
        yield tuple(ns), 'starve_B'

    if idx_a > 0:
        ns = list(score_rank)
        ns[idx_a - 1], ns[idx_a] = ns[idx_a], ns[idx_a - 1]
        yield tuple(ns), 'starve_A'

# ── tournament moves (unchanged from IRV) ────────────────────────────────────
def tournament_neighbours(tournament):
    for i, mid in enumerate(MATCHUPS):
        d = tournament[i]
        if d == SINCERE[mid]:
            nt = list(tournament)
            nt[i] = -d
            yield tuple(nt), f'flip_{mid}'

# ── composed state-level neighbours ──────────────────────────────────────────
def neighbours_minimal(state, include_tournament=True):
    score_rank, tournament = state
    for nsr, lab in score_rank_neighbours(score_rank):
        yield (nsr, tournament), lab, 'reorder'
    if include_tournament:
        for nt, lab in tournament_neighbours(tournament):
            yield (score_rank, nt), lab, 'flip'

# ── all 48 states ──────────────────────────────────────────────────────────
all_states = []
for tournament in product((+1, -1), repeat=3):
    for score_rank in permutations(CANDIDATES):
        all_states.append((score_rank, tournament))
assert len(all_states) == 48
assert len(set(all_states)) == 48
for _s in all_states:
    assert winner(_s) in ('A', 'B', 'C')

# ── report ─────────────────────────────────────────────────────────────────
W = 72
print('=' * W)
print('  STAR  ·  COMBINATORIAL DEVIATION GRAPH  (3 candidates)')
print('  Coalition A>B>C  |  sincere ballot: 5-x-0  |  48 states')
print('=' * W)

# ── section 1: summary counts (identical distribution to IRV — same 48-state
# space, same winner()/state_tag() math, just re-grounded in score not votes)
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
print(f'\n  Center-squeeze [SQZ] (CW exists, cut before runoff) : {sqz_count}')
print(f'  Cycle [cyc] (no Condorcet winner)                   : {cyc_count}')
print(f'  Condorcet winner reaches runoff [CW ]                : {cw_survive_count}')

# ── section 2: adjacent-swap achievability ───────────────────────────────────
print(f'\n{"=" * W}')
print('  ADJACENT-SWAP ACHIEVABILITY  (by (lower, upper) pair-shape)')
print('  lower/upper = who currently has fewer/more total stars. Checked')
print('  for consistency across every context (position, third candidate)')
print('  the pair-shape appears in, not just one example.')
print('=' * W)

achievable = {}
for score_rank in permutations(CANDIDATES):
    targets = {ns for ns, _ in score_rank_neighbours(score_rank)}
    for i in (0, 1):
        lower, upper = score_rank[i], score_rank[i + 1]
        want = list(score_rank)
        want[i], want[i + 1] = want[i + 1], want[i]
        ok = tuple(want) in targets
        achievable.setdefault((lower, upper), set()).add(ok)

blocked = []
print()
for (lower, upper), oks in sorted(achievable.items()):
    assert len(oks) == 1, f'inconsistent achievability for {lower}->{upper}: {oks}'
    ok = next(iter(oks))
    print(f'  {lower} below {upper}  ->  swap so {lower} overtakes {upper}:  '
          f'{"yes" if ok else "NO -- blocked"}')
    if not ok:
        blocked.append((lower, upper))

assert blocked == [('A', 'C')], f'expected only (A,C) blocked, got {blocked}'
print(f'\n  => exactly one blocked pair-shape: A below C can never overtake C.')
print('     (sincere ballot already maxes A at 5 and mins C at 0 -- no lever')
print('     left to close that gap; see module docstring.)')

# ── section 3: score_rank move availability, by permutation ─────────────────
print(f'\n{"=" * W}')
print('  SCORE_RANK MOVE AVAILABILITY  (fewest -> most total stars)')
print('=' * W)
print()
print(f'  {"score_rank":<12}{"moves available":<32}{"targets"}')
total_reorder_edges = 0
for score_rank in permutations(CANDIDATES):
    moves = list(score_rank_neighbours(score_rank))
    total_reorder_edges += len(moves)
    move_strs = [f'{lab}->{"".join(ns)}' for ns, lab in moves]
    print(f'  {"".join(score_rank):<12}{", ".join(lab for _, lab in moves):<32}'
          f'{", ".join(move_strs)}')
print(f'\n  total score_rank edges (this tournament): {total_reorder_edges}')
print(f'  total score_rank edges (all 8 tournaments): {total_reorder_edges * 8}')
print('  (IRV\'s votes_rank graph has 8 edges/tournament, 64 total -- STAR\'s')
print(f'  extra levers give it {total_reorder_edges} and {total_reorder_edges * 8}: strictly more manipulation power.)')

assert total_reorder_edges == 12

# ── section 4: profitable deviations (1-step), core vs full ─────────────────
def profitable_devs(state, include_tournament):
    w = winner(state)
    u0 = PREF[w]
    for ns, lab, kind in neighbours_minimal(state, include_tournament):
        nw = winner(ns)
        if PREF[nw] > u0:
            yield ns, lab, kind, nw

def summarize_profitable(include_tournament, title):
    cases = []
    total_edges = 0
    for s in all_states:
        if winner(s) == 'A':
            continue
        rows = list(profitable_devs(s, include_tournament))
        if rows:
            cases.append((s, winner(s), rows))
            total_edges += len(rows)
    print(f'\n  [{title}]')
    print(f'    any profitable deviation      : {len(cases)} / {a_loses}')
    print(f'    no profitable deviation        : {a_loses - len(cases)} / {a_loses}')
    print(f'    total profitable edges         : {total_edges}')
    return cases

print(f'\n{"=" * W}')
print('  PROFITABLE DEVIATIONS (single-step)')
print('  "Core" = score_rank moves only (tournament deviations toggle OFF,')
print('  the graph page default). "Full" = also allows flip_* moves.')
print('=' * W)

core_cases = summarize_profitable(False, 'Core: score_rank moves only (UI default)')
full_cases = summarize_profitable(True, 'Full: score_rank + tournament flips')

# ── section 5: flip-profitability proof (re-verified for STAR) ──────────────
print(f'\n{"=" * W}')
print('  FLIP-PROFITABILITY PROOF (re-verified for STAR)')
print('=' * W)
print('''
  Claim: a flip_* deviation is NEVER profitable here either -- the proof is
  identical to IRV's, since it only depends on winner()/tournament
  structure, not on how score_rank moves. A flip is only legal on a matchup
  at its sincere direction. If the matchup is winner-relevant (between the
  two current finalists), sincere always favors the more-preferred
  finalist -- flipping it can only hand the win to the LESS-preferred one,
  never profitable. If winner-irrelevant (involves the cut candidate),
  flipping it changes winner() not at all. Every flip is one of these two
  cases, so no flip is ever profitable.
''')

flip_edges = 0
flip_profitable = 0
for s in all_states:
    w = winner(s)
    u0 = PREF[w]
    for ns, lab, kind in neighbours_minimal(s, include_tournament=True):
        if kind == 'flip':
            flip_edges += 1
            if PREF[winner(ns)] > u0:
                flip_profitable += 1

assert flip_profitable == 0
print(f'  flip edges checked: {flip_edges}, profitable: {flip_profitable}  '
      f'(flip is NEVER profitable)')

# ── section 6: all profitable cases (core model) ─────────────────────────────
print(f'\n{"=" * W}')
print('  ALL PROFITABLE CASES (single-step, core model: score_rank only)')
print('  (★=A wins  ·=B wins)')
print('=' * W)

by_type = {'boost_B': 0, 'starve_B': 0, 'starve_A': 0}
for s, w, rows in core_cases:
    for ns, lab, kind, nw in rows:
        by_type[lab] = by_type.get(lab, 0) + 1

print(f'\n  {"type":<10}  cases')
for k, n in by_type.items():
    if n == 0:
        continue
    print(f'  {k:<10}  {n:>4}')

print()
for s, w, rows in core_cases:
    print(f'  ┌ {state_tag(s)} {desc_block(s, indent="    ")}')
    print(f'  │   winner = {w}')
    for ns, lab, kind, nw in rows:
        star = '★' if nw == 'A' else '·'
        print(f'  │    {star} {state_tag(ns)} {MOVE_LABEL[lab]:<20} → {desc(ns):<48} → {nw}')
    print()

# ── section 7: multi-step monotone reachability, core vs full ───────────────
def build_monotone_graph(include_tournament):
    adj = {}
    for s in all_states:
        wu = winner(s)
        adj[s] = [(ns, lab) for ns, lab, kind in neighbours_minimal(s, include_tournament)
                  if PREF[winner(ns)] >= PREF[wu]]
    return adj

def bfs_monotone(adj, start):
    parent = {start: (None, None, 0)}
    q = deque([start])
    while q:
        curr = q.popleft()
        _, _, hops = parent[curr]
        for ns, lab in adj[curr]:
            if ns not in parent:
                parent[ns] = (curr, lab, hops + 1)
                q.append(ns)
    return parent

def analyze_multistep(include_tournament, title):
    adj = build_monotone_graph(include_tournament)
    multi_only_cases = []
    upgrade_cases = []
    no_path_count = 0
    total_pairs = 0

    for s in all_states:
        w = winner(s)
        if w == 'A':
            continue
        u0 = PREF[w]

        best_single = max((PREF[winner(ns)] for ns, _, _ in neighbours_minimal(s, include_tournament)),
                           default=u0)

        parent_map = bfs_monotone(adj, s)
        better = [r for r in parent_map if r != s and PREF[winner(r)] > u0]
        total_pairs += len(better)

        if not better:
            no_path_count += 1
            continue

        best_multi = max(PREF[winner(r)] for r in better)
        targets = [r for r in better if PREF[winner(r)] == best_multi]
        best_t = min(targets, key=lambda r: parent_map[r][2])

        if best_single <= u0:
            multi_only_cases.append((s, w, best_t, parent_map))
        elif best_multi > best_single:
            upgrade_cases.append((s, w, best_single, best_t, parent_map))

    print(f'\n  [{title}]')
    print(f'    profitable ONLY via 2+ step chains       : {len(multi_only_cases)}')
    print(f'    multi-step reaches an even better outcome : {len(upgrade_cases)}')
    print(f'    no profitable path at any depth            : {no_path_count} / {a_loses}')
    print(f'    total profitable (source, target) pairs    : {total_pairs}')
    return multi_only_cases, upgrade_cases

print(f'\n{"=" * W}')
print('  MULTI-STEP DEVIATION PATHS')
print('  Coalition chains single steps; the outcome may never get strictly')
print('  worse along the way, but the final step must strictly improve it.')
print('=' * W)

core_multi_only, core_upgrade = analyze_multistep(False, 'Core: score_rank moves only')
full_multi_only, full_upgrade = analyze_multistep(True, 'Full: score_rank + tournament flips')

if not core_multi_only and not core_upgrade:
    print('\n  => Multi-step chaining adds NO power beyond single-step in the core')
    print('     model: every profitable target reachable via a chain is already')
    print('     reachable in one step.')
else:
    print('\n  => Unlike IRV, multi-step chaining DOES add power here: some states')
    print('     reach a strictly better outcome only through a 2+-step chain, or')
    print('     reach a better outcome via chaining than any single step allows.')

# ── section 8: edge-count comparison vs IRV ──────────────────────────────────
print(f'\n{"=" * W}')
print('  STAR vs IRV: MANIPULATION-POWER COMPARISON')
print('=' * W)
print(f'''
  score_rank / votes_rank edges (per tournament) :  STAR {total_reorder_edges}   vs  IRV 8
  score_rank / votes_rank edges (all 48 states)  :  STAR {total_reorder_edges * 8}  vs  IRV 64
  profitable single-step cases (core, no flips)  :  STAR {len(core_cases)}   vs  IRV (see irv_graph_test.py)

  STAR's 3 independent score levers (boost_B / starve_B / starve_A) reach
  5 of the 6 adjacent-swap pair-shapes -- IRV's single transferable vote
  reaches strictly fewer. The only pair-shape unreachable in EITHER model
  by construction is not comparable 1:1 (IRV has no notion of "adjacent
  pair-shape blocked" -- its swap_A/swap_BC are gated by A's position, not
  by a candidate-pair rule) but the raw edge count above is the clean,
  model-agnostic confirmation that STAR gives the coalition strictly more
  room to maneuver while preserving the tournament exactly.
''')

print('=' * W)
