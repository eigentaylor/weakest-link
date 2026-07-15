"""
export_graph_to_txt.py — regenerates graph_edges.txt (minimax),
irv_graph_edges.txt (IRV), star_graph_edges.txt (STAR), and
profitable_summary.txt (cross-system manipulation tables) from each
model's canonical single-step move rules.

Run this (`python export_graph_to_txt.py`) any time any model's move
logic changes, so the plain-text edge dumps stay in sync with the
interactive graphs (graph.js / graph_irv.js / graph_star.js) and the
Python reference models (minimax_graph_test.py / irv_graph_test.py /
star_graph_test.py).

Each model's core rules (winner, tag, neighbours_minimal) are
reimplemented directly here rather than imported — this keeps the
exporter a lean, single-purpose, dependency-free script, and mirrors
how the project already carries independent copies of each model (JS
runtime vs. Python reference) for cross-checking rather than a single
shared source of truth.
"""

from itertools import product, permutations

OUT_DIR = None  # write alongside this script


# ═══════════════════════════════════════════════════════════════════════════
#  MINIMAX  ->  graph_edges.txt
# ═══════════════════════════════════════════════════════════════════════════

MM_MATCHUPS = ['AB', 'AC', 'BC']
MM_PAIRS = {'AB': ('A', 'B'), 'AC': ('A', 'C'), 'BC': ('B', 'C')}
MM_SINCERE = {'AB': +1, 'AC': +1, 'BC': +1}
MM_PREF = {'A': 2, 'B': 1, 'C': 0}
MM_LIE = {'AB': 'B>A', 'AC': 'C>A', 'BC': 'C>B'}   # matches minimax.js's LIE dict


def mm_winner(state):
    wins = {'A': 0, 'B': 0, 'C': 0}
    for mid, d in state:
        a, b = MM_PAIRS[mid]
        wins[a if d == +1 else b] += 1
    for c, n in wins.items():
        if n == 2:
            return c
    lm, ld = state[-1]
    a, b = MM_PAIRS[lm]
    return b if ld == +1 else a


def mm_is_cycle(state):
    wins = {'A': 0, 'B': 0, 'C': 0}
    for mid, d in state:
        a, b = MM_PAIRS[mid]
        wins[a if d == +1 else b] += 1
    return not any(n == 2 for n in wins.values())


def mm_state_key(state):
    return ','.join(f'{m}{"+" if d > 0 else "-"}' for m, d in state)


def mm_desc(state):
    # Rank order as stored (rank-1 first), each term "winner>loser".
    terms = []
    for mid, d in state:
        a, b = MM_PAIRS[mid]
        w, l = (a, b) if d == +1 else (b, a)
        terms.append(f'({w}>{l})')
    return ' > '.join(terms)


def mm_desc_latex(state):
    # Same rank order as mm_desc, in LaTeX: \succ between rank terms (this
    # IS a ranking, unlike the \to inside each term, which is a single
    # matchup's winner->loser).
    terms = []
    for mid, d in state:
        a, b = MM_PAIRS[mid]
        w, l = (a, b) if d == +1 else (b, a)
        terms.append(f'{w}\\to {l}')
    return '$\\langle ' + ' \\succ '.join(terms) + ' \\rangle$'


def mm_neighbours_minimal(state):
    """Single adjacent-rank swap while sincere ('reorder'), swap while
    insincere ('reorder'), or flip-in-place at the weakest rank ('flip')."""
    sl = list(state)
    for k, (mid, d) in enumerate(sl):
        others = [x for x in sl if x[0] != mid]
        if d == MM_SINCERE[mid]:
            if k < 2:
                ns = list(others)
                ns.insert(k + 1, (mid, d))
                yield tuple(ns), mid, 'reorder'
            if k == 2:
                ns = list(others)
                ns.insert(2, (mid, -d))
                yield tuple(ns), mid, 'flip'
        else:
            if k > 0:
                ns = list(others)
                ns.insert(k - 1, (mid, d))
                yield tuple(ns), mid, 'reorder'


def mm_all_states():
    # Recursively pick (matchup, direction) one rank at a time from whatever
    # matchups remain, direction '-' before '+' — this specific interleaved
    # traversal order (not a separate permutations-x-directions product) is
    # what the existing graph_edges.txt was originally generated with, and
    # is preserved here so re-running this script without a model change
    # doesn't reorder (and hence spuriously diff) the file.
    def rec(remaining, prefix):
        if not remaining:
            yield tuple(prefix)
            return
        for m in remaining:
            rest = [x for x in remaining if x != m]
            for d in (-1, +1):
                yield from rec(rest, prefix + [(m, d)])
    yield from rec(MM_MATCHUPS, [])


def export_minimax(path):
    all_states = list(mm_all_states())
    assert len(all_states) == 48

    lines = [
        'Weakest Link Strategic-Voting Graph',
        '=' * 37,
        '',
        'Each node is a ranking state (rank-1 > rank-2 > rank-3 matchup, with the',
        'sincere/insincere direction of each matchup) together with its outcome',
        '(winner: A, B, or C). Edges are single-step deviations (one voter lie',
        'changing rank position or flipping a matchup), labeled with the lie',
        'being told, the move kind (reorder vs flip), and the resulting outcome.',
        '',
    ]

    for s in all_states:
        w = mm_winner(s)
        u0 = MM_PREF[w]
        tag = 'cycle' if mm_is_cycle(s) else 'CW'
        lines.append(f'NODE {mm_state_key(s)}  [{mm_desc(s)}]  outcome: {w} ({tag})')
        for ns, mid, kind in mm_neighbours_minimal(s):
            nw = mm_winner(ns)
            profitable = '  [profitable: yes]' if MM_PREF[nw] > u0 else ''
            lines.append(f'  -> {mm_state_key(ns)}  (lie {MM_LIE[mid]}, {kind})  outcome: {nw}{profitable}')
        lines.append('')

    # newline='' keeps line endings as pure LF ('\n' in the joined lines
    # below) instead of Python's default universal-newline translation to
    # '\r\n' on Windows -- matches the existing committed files' encoding.
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\n'.join(lines).rstrip() + '\n')
    return len(all_states)


# ═══════════════════════════════════════════════════════════════════════════
#  IRV  ->  irv_graph_edges.txt
# ═══════════════════════════════════════════════════════════════════════════

IRV_CANDIDATES = ['A', 'B', 'C']
IRV_MATCHUPS = ['AB', 'AC', 'BC']
IRV_PAIRS = {'AB': ('A', 'B'), 'AC': ('A', 'C'), 'BC': ('B', 'C')}
IRV_SINCERE = {'AB': +1, 'AC': +1, 'BC': +1}
IRV_MID_OF = {frozenset(IRV_PAIRS[m]): m for m in IRV_MATCHUPS}
IRV_PREF = {'A': 2, 'B': 1, 'C': 0}   # matches irv.js's PREF dict

# Real-world 3-candidate IRV elections that map onto states here. A node is
# identified by GENERIC letters, but which real candidate is "A" vs "B" vs
# "C" is an arbitrary choice -- each fixed real election corresponds to
# 3! = 6 different nodes, one per relabeling. Both elections are
# center-squeeze cases; together their 6+6 relabelings exhaust all 12
# center-squeeze [SQZ] states in the graph (the two distinct "shapes" a
# 3-candidate center squeeze can take). See irv.js's REAL_EXAMPLES for the
# derivation.
IRV_REAL_EXAMPLES = {
    'ABC|+++': 'Burlington 2009 (A=Montroll, B=Kiss, C=Wright)',
    'ACB|++-': 'Burlington 2009 (A=Montroll, B=Wright, C=Kiss)',
    'BAC|-++': 'Burlington 2009 (A=Kiss, B=Montroll, C=Wright)',
    'BCA|--+': 'Burlington 2009 (A=Wright, B=Montroll, C=Kiss)',
    'CAB|+--': 'Burlington 2009 (A=Kiss, B=Wright, C=Montroll)',
    'CBA|---': 'Burlington 2009 (A=Wright, B=Kiss, C=Montroll)',
    'ABC|++-': 'Alaska 2022 (A=Begich, B=Palin, C=Peltola)',
    'ACB|+++': 'Alaska 2022 (A=Begich, B=Peltola, C=Palin)',
    'BAC|--+': 'Alaska 2022 (A=Palin, B=Begich, C=Peltola)',
    'BCA|-++': 'Alaska 2022 (A=Peltola, B=Begich, C=Palin)',
    'CAB|---': 'Alaska 2022 (A=Palin, B=Peltola, C=Begich)',
    'CBA|+--': 'Alaska 2022 (A=Peltola, B=Palin, C=Begich)',
}


def irv_winner(state):
    votes_rank, tournament = state
    dm = dict(zip(IRV_MATCHUPS, tournament))
    eliminated = votes_rank[0]
    s1, s2 = [c for c in votes_rank if c != eliminated]
    mid = IRV_MID_OF[frozenset((s1, s2))]
    a, b = IRV_PAIRS[mid]
    return a if dm[mid] == +1 else b


def irv_condorcet_winner(state):
    _, tournament = state
    dm = dict(zip(IRV_MATCHUPS, tournament))
    wins = {'A': 0, 'B': 0, 'C': 0}
    for mid, d in dm.items():
        a, b = IRV_PAIRS[mid]
        wins[a if d == +1 else b] += 1
    for c, n in wins.items():
        if n == 2:
            return c
    return None


def irv_state_tag(state):
    votes_rank, _ = state
    cw = irv_condorcet_winner(state)
    if cw is None:
        return 'cycle'
    return 'SQZ' if cw == votes_rank[0] else 'CW'


def irv_state_key(state):
    votes_rank, tournament = state
    return ''.join(votes_rank) + '|' + ''.join('+' if d > 0 else '-' for d in tournament)


def irv_desc_ascii(state):
    votes_rank, tournament = state
    dm = dict(zip(IRV_MATCHUPS, tournament))
    votes_part = '<'.join(votes_rank)
    tourn_terms = []
    for mid in IRV_MATCHUPS:
        a, b = IRV_PAIRS[mid]
        w, l = (a, b) if dm[mid] == +1 else (b, a)
        tourn_terms.append(f'{w}>{l}')
    return f'{votes_part} | ' + ', '.join(tourn_terms)


def irv_desc_latex(state):
    votes_rank, tournament = state
    dm = dict(zip(IRV_MATCHUPS, tournament))
    votes_part = '<'.join(votes_rank)
    tourn_terms = []
    for mid in IRV_MATCHUPS:
        a, b = IRV_PAIRS[mid]
        w, l = (a, b) if dm[mid] == +1 else (b, a)
        tourn_terms.append(f'{w}\\to {l}')
    return '$\\langle ' + votes_part + ' \\mid ' + ', '.join(tourn_terms) + ' \\rangle$'


def irv_votes_rank_neighbours(votes_rank):
    """Exactly two possible moves (see irv_graph_test.py module docstring):
    swap_A (A with whoever is directly below it, if A isn't last) and
    swap_BC (whenever B,C are adjacent, i.e. A isn't between them)."""
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


def irv_tournament_neighbours(tournament):
    for i, mid in enumerate(IRV_MATCHUPS):
        d = tournament[i]
        if d == IRV_SINCERE[mid]:
            nt = list(tournament)
            nt[i] = -d
            yield tuple(nt), f'flip_{mid}'


def irv_neighbours_minimal(state):
    votes_rank, tournament = state
    for nvr, lab in irv_votes_rank_neighbours(votes_rank):
        yield (nvr, tournament), lab, 'reorder'
    for nt, lab in irv_tournament_neighbours(tournament):
        yield (votes_rank, nt), lab, 'flip'


def export_irv(path):
    all_states = []
    for tournament in product((+1, -1), repeat=3):
        for votes_rank in permutations(IRV_CANDIDATES):
            all_states.append((votes_rank, tournament))
    assert len(all_states) == 48

    lines = [
        'Weakest Link Strategic-Voting Graph -- IRV',
        '=' * 43,
        '',
        'Each node is (votes_rank, tournament): votes_rank is the first-place-vote',
        'order from fewest to most (leftmost candidate is eliminated); tournament is',
        'the pairwise winner for each matchup (AB, AC, BC), shown winner>loser. Edges',
        'are single-step deviations available to a coalition preferring A>B>C:',
        'swap_A (swap A with whoever is directly below it, if A is not already',
        'last) or swap_BC (swap B and C, whenever they are adjacent -- i.e. A is',
        'not between them), or flip_<matchup> (reverse a currently-sincere',
        'matchup), labeled with the move, the move kind (reorder vs flip), the',
        'resulting outcome, and whether the deviation is profitable for a',
        'coalition preferring A>B>C. Node tags: CW = a Condorcet winner exists and',
        'wins; cycle = no Condorcet winner; SQZ = a Condorcet winner exists but',
        'is eliminated (center squeeze). A trailing bracket on a NODE line tags',
        'a real-world election that maps onto that exact state. Reference model',
        '/ proofs: irv_graph_test.py. Rendered graph: IRV.html.',
        '',
    ]

    for s in all_states:
        w = irv_winner(s)
        u0 = IRV_PREF[w]
        tag = irv_state_tag(s)
        key = irv_state_key(s)
        real = IRV_REAL_EXAMPLES.get(key)
        real_suffix = f'  [{real}]' if real else ''
        lines.append(f'NODE {key}  [{irv_desc_ascii(s)}]  outcome: {w} ({tag}){real_suffix}')
        for ns, lab, kind in irv_neighbours_minimal(s):
            nw = irv_winner(ns)
            nk = irv_state_key(ns)
            profitable = '  [profitable: yes]' if IRV_PREF[nw] > u0 else ''
            lines.append(f'  -> {nk}  ({lab}, {kind})  outcome: {nw}{profitable}')
        lines.append('')

    # newline='' keeps line endings as pure LF ('\n' in the joined lines
    # below) instead of Python's default universal-newline translation to
    # '\r\n' on Windows -- matches the existing committed files' encoding.
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\n'.join(lines).rstrip() + '\n')
    return len(all_states)


# ═══════════════════════════════════════════════════════════════════════════
#  STAR  ->  star_graph_edges.txt
# ═══════════════════════════════════════════════════════════════════════════
# STAR's winner()/tag rules are IDENTICAL to IRV's (cut the lowest-total-
# score candidate, tournament decides the 2 finalists) -- only the moves on
# score_rank differ, since a score ballot lets the coalition move each
# candidate's own score independently instead of reassigning one
# transferable vote. See star_graph_test.py's module docstring for the full
# derivation of the 3 levers below (boost_B / starve_B / starve_A) and the
# one adjacent swap they can never achieve (A below C, wanting to overtake
# C -- both ends of that gap are already sincerely maxed/minned).

STAR_CANDIDATES = ['A', 'B', 'C']
STAR_MATCHUPS = ['AB', 'AC', 'BC']
STAR_PAIRS = {'AB': ('A', 'B'), 'AC': ('A', 'C'), 'BC': ('B', 'C')}
STAR_SINCERE = {'AB': +1, 'AC': +1, 'BC': +1}
STAR_MID_OF = {frozenset(STAR_PAIRS[m]): m for m in STAR_MATCHUPS}
STAR_PREF = {'A': 2, 'B': 1, 'C': 0}   # matches star.js's PREF dict

# Friendly ballot-shape labels, matching star_graph_test.py's MOVE_LABEL.
STAR_MOVE_LABEL = {
    'boost_B':  '5-4-0 (boost B)',
    'starve_B': '5-1-0 (starve B)',
    'starve_A': '(x+1)-x-0 (starve A)',
    'flip_AB':  'lie B>A',
    'flip_AC':  'lie C>A',
    'flip_BC':  'lie C>B',
}


def star_winner(state):
    score_rank, tournament = state
    dm = dict(zip(STAR_MATCHUPS, tournament))
    cut = score_rank[0]
    s1, s2 = [c for c in score_rank if c != cut]
    mid = STAR_MID_OF[frozenset((s1, s2))]
    a, b = STAR_PAIRS[mid]
    return a if dm[mid] == +1 else b


def star_condorcet_winner(state):
    _, tournament = state
    dm = dict(zip(STAR_MATCHUPS, tournament))
    wins = {'A': 0, 'B': 0, 'C': 0}
    for mid, d in dm.items():
        a, b = STAR_PAIRS[mid]
        wins[a if d == +1 else b] += 1
    for c, n in wins.items():
        if n == 2:
            return c
    return None


def star_state_tag(state):
    score_rank, _ = state
    cw = star_condorcet_winner(state)
    if cw is None:
        return 'cycle'
    return 'SQZ' if cw == score_rank[0] else 'CW'


def star_state_key(state):
    score_rank, tournament = state
    return ''.join(score_rank) + '|' + ''.join('+' if d > 0 else '-' for d in tournament)


def star_desc_ascii(state):
    score_rank, tournament = state
    dm = dict(zip(STAR_MATCHUPS, tournament))
    score_part = '<'.join(score_rank)
    tourn_terms = []
    for mid in STAR_MATCHUPS:
        a, b = STAR_PAIRS[mid]
        w, l = (a, b) if dm[mid] == +1 else (b, a)
        tourn_terms.append(f'{w}>{l}')
    return f'{score_part} | ' + ', '.join(tourn_terms)


def star_desc_latex(state):
    score_rank, tournament = state
    dm = dict(zip(STAR_MATCHUPS, tournament))
    score_part = '<'.join(score_rank)
    tourn_terms = []
    for mid in STAR_MATCHUPS:
        a, b = STAR_PAIRS[mid]
        w, l = (a, b) if dm[mid] == +1 else (b, a)
        tourn_terms.append(f'{w}\\to {l}')
    return '$\\langle ' + score_part + ' \\mid ' + ', '.join(tourn_terms) + ' \\rangle$'


def star_score_rank_neighbours(score_rank):
    """Three independent single-step levers (see star_graph_test.py):
    boost_B (B up past whoever's above), starve_B (B down past whoever's
    below), starve_A (A down past whoever's below). Unlike IRV's
    swap_A/swap_BC, boost_B and starve_A CAN land on the same target
    (whenever B sits directly below A) -- both are yielded regardless."""
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


def star_tournament_neighbours(tournament):
    for i, mid in enumerate(STAR_MATCHUPS):
        d = tournament[i]
        if d == STAR_SINCERE[mid]:
            nt = list(tournament)
            nt[i] = -d
            yield tuple(nt), f'flip_{mid}'


def star_neighbours_minimal(state):
    score_rank, tournament = state
    for nsr, lab in star_score_rank_neighbours(score_rank):
        yield (nsr, tournament), lab, 'reorder'
    for nt, lab in star_tournament_neighbours(tournament):
        yield (score_rank, nt), lab, 'flip'


def export_star(path):
    all_states = []
    for tournament in product((+1, -1), repeat=3):
        for score_rank in permutations(STAR_CANDIDATES):
            all_states.append((score_rank, tournament))
    assert len(all_states) == 48

    lines = [
        'Weakest Link Strategic-Voting Graph -- STAR',
        '=' * 44,
        '',
        'Each node is (score_rank, tournament): score_rank is the total-star',
        'order from fewest to most (leftmost candidate misses the automatic',
        'runoff); tournament is the pairwise winner for each matchup (AB, AC,',
        'BC), shown winner>loser. Coalition A>B>C sincerely scores 5-x-0.',
        'Edges are the most generous single-step ballot deviations that hold',
        'the tournament fixed: boost_B (raise B to 5-4-0), starve_B (bury B to',
        '5-1-0), starve_A ((x+1)-x-0), or flip_<matchup> (reverse a currently-',
        'sincere matchup) -- labeled with the move, the move kind (reorder vs',
        'flip), the resulting outcome, and whether the deviation is profitable',
        'for a coalition preferring A>B>C. Node tags: CW = a Condorcet winner',
        'exists and reaches the runoff; cycle = no Condorcet winner; SQZ = a',
        'Condorcet winner exists but misses the runoff (center squeeze). No',
        'real-world STAR elections are tagged (unlike irv_graph_edges.txt) --',
        "ballot-level score data for a real 3-candidate STAR election isn't",
        'available for this abstraction. Reference model / proofs:',
        'star_graph_test.py. Rendered graph: star.html.',
        '',
    ]

    for s in all_states:
        w = star_winner(s)
        u0 = STAR_PREF[w]
        tag = star_state_tag(s)
        key = star_state_key(s)
        lines.append(f'NODE {key}  [{star_desc_ascii(s)}]  outcome: {w} ({tag})')
        for ns, lab, kind in star_neighbours_minimal(s):
            nw = star_winner(ns)
            nk = star_state_key(ns)
            profitable = '  [profitable: yes]' if STAR_PREF[nw] > u0 else ''
            lines.append(f'  -> {nk}  ({lab}, {kind})  outcome: {nw}{profitable}')
        lines.append('')

    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\n'.join(lines).rstrip() + '\n')
    return len(all_states)


# ═══════════════════════════════════════════════════════════════════════════
#  CROSS-SYSTEM SUMMARY  ->  profitable_summary.txt
# ═══════════════════════════════════════════════════════════════════════════
# Two markdown tables per system:
#   1. every single-step profitable deviation (already tagged
#      "[profitable: yes]" above), one row per edge.
#   2. "complex manipulations" -- chains of 2+ moves where the outcome may
#      dip at intermediate steps (unlike the *_graph_test.py scripts' own
#      MULTI-STEP DEVIATION PATHS section, which requires monotone
#      non-decrease); only start-outcome < end-outcome matters. A given
#      start state can have SEVERAL independent such targets -- e.g. one
#      reachable in 1 hop (already in table 1) and a genuinely different one
#      reachable only via a distinct 2+-hop route -- so we record every
#      "first crossing" boundary node down every branch, not just the
#      globally nearest one. Per distinct target, only the deepest (max-hop)
#      originating state is kept, so shallower waypoints on the same chain
#      don't also get their own redundant row.
#
# IRV/STAR exclude flip_* moves from this search entirely (minimax keeps
# them). Both proofs (irv_graph_test.py / star_graph_test.py) already show
# flip is never profitable as the crossing move itself; on top of that,
# flip only ever toggles the tournament axis, which votes_rank/score_rank
# moves never look at (their availability depends solely on position), so
# flip can never be a NECESSARY intermediate step either -- chaining through
# it just visits cosmetically-different tournament twins of states already
# reachable via reorder moves alone, which floods the search with duplicate
# non-answers (empirically: 10 raw IRV records / 33 raw STAR records with
# flip included, collapsing to the true 2 / 12 once flip is excluded).
# Minimax has no such proof or axis-independence -- its own worked example
# (see minimax_graph_test.py) genuinely requires a flip mid-chain -- so its
# search keeps the full neighbour set.

def md_escape(key):
    # IRV/STAR keys contain a literal "|" (e.g. "ABC|+++"), which would
    # otherwise be parsed as a markdown table column delimiter.
    return key.replace('|', '\\|')


def boundary_targets(start, adj, winner_fn, pref):
    """Level-order BFS from `start` that only continues expanding through
    nodes whose outcome is still <= start's (a "dip" or a wash); the first
    time each branch reaches a node strictly better than start, that node is
    recorded and NOT expanded further. Returns [(target, hops), ...] -- a
    single start can yield several targets down different branches."""
    u0 = pref[winner_fn(start)]
    visited = {start}
    frontier = [start]
    hops = 0
    found = []
    while frontier:
        hops += 1
        next_frontier = []
        for cur in frontier:
            for ns in adj[cur]:
                if ns in visited:
                    continue
                visited.add(ns)
                if pref[winner_fn(ns)] > u0:
                    found.append((ns, hops))
                else:
                    next_frontier.append(ns)
        frontier = next_frontier
    return found


def find_complex_cases(all_states, winner_fn, pref, neighbours_fn):
    """neighbours_fn(state) -> iterable of next states (labels stripped).
    Returns [(start, target, hops), ...], sorted by descending hops."""
    adj = {s: list(neighbours_fn(s)) for s in all_states}

    records = []
    for s in all_states:
        if winner_fn(s) == 'A':
            continue
        for target, hops in boundary_targets(s, adj, winner_fn, pref):
            if hops < 2:
                continue   # hops == 1 is already a single-step profitable edge
            records.append((s, target, hops))

    best_by_target = {}
    for s, t, hops in records:
        cur = best_by_target.get(t)
        if cur is None or hops > cur[1] or (hops == cur[1] and repr(s) < repr(cur[0])):
            best_by_target[t] = (s, hops)

    result = [(s, t, hops) for t, (s, hops) in best_by_target.items()]
    result.sort(key=lambda r: (-r[2], repr(r[0])))
    return result


def export_profitable_summary(path):
    lines = [
        '# Weakest Link -- Profitable Deviations Summary',
        '',
        'One section per voting system, each with two tables:',
        '',
        '1. **Profitable single-step deviations** -- every edge from the',
        '   corresponding `*_graph_edges.txt` dump tagged `[profitable: yes]`.',
        '2. **Complex manipulations** -- chains of 2+ moves reaching a target',
        '   not reachable in a single step, where the outcome may dip at',
        '   intermediate steps (only start-outcome < end-outcome matters). A',
        '   state can have more than one such target down different branches;',
        '   for each distinct target, only the deepest (longest-chain)',
        '   originating state is shown.',
        '',
        'Node notation is given both as the plain-text key (matching the',
        '`*_graph_edges.txt` files) and as LaTeX (requires a math-rendering',
        'markdown viewer, e.g. Obsidian, Typora, or GitHub with KaTeX).',
        '',
    ]

    # ── MINIMAX ──────────────────────────────────────────────────────────────
    mm_states = list(mm_all_states())

    lines += ['## Minimax', '', '### Profitable single-step deviations', '',
              '| Start | Move | End | Outcome |', '|---|---|---|---|']
    for s in mm_states:
        w = mm_winner(s)
        u0 = MM_PREF[w]
        for ns, mid, kind in mm_neighbours_minimal(s):
            nw = mm_winner(ns)
            if MM_PREF[nw] <= u0:
                continue
            start_cell = f'{md_escape(mm_state_key(s))} <br> {mm_desc_latex(s)}'
            end_cell = f'{md_escape(mm_state_key(ns))} <br> {mm_desc_latex(ns)}'
            lines.append(f'| {start_cell} | lie {MM_LIE[mid]} | {end_cell} | {w} → **{nw}** |')

    mm_complex = find_complex_cases(mm_states, mm_winner, MM_PREF,
                                     lambda s: (ns for ns, mid, kind in mm_neighbours_minimal(s)))
    lines += ['', '### Complex manipulations (multi-step only)', '']
    if mm_complex:
        lines += ['| Start | End | Outcome | Steps |', '|---|---|---|---|']
        for s, t, hops in mm_complex:
            start_cell = f'{md_escape(mm_state_key(s))} <br> {mm_desc_latex(s)}'
            end_cell = f'{md_escape(mm_state_key(t))} <br> {mm_desc_latex(t)}'
            lines.append(f'| {start_cell} | {end_cell} | {mm_winner(s)} → **{mm_winner(t)}** | {hops} |')
    else:
        lines.append('None.')
    lines.append('')

    # ── IRV ──────────────────────────────────────────────────────────────────
    irv_states = []
    for tournament in product((+1, -1), repeat=3):
        for votes_rank in permutations(IRV_CANDIDATES):
            irv_states.append((votes_rank, tournament))

    lines += ['## IRV', '', '### Profitable single-step deviations', '',
              '| Start | Move | End | Outcome |', '|---|---|---|---|']
    for s in irv_states:
        w = irv_winner(s)
        u0 = IRV_PREF[w]
        for ns, lab, kind in irv_neighbours_minimal(s):
            nw = irv_winner(ns)
            if IRV_PREF[nw] <= u0:
                continue
            start_cell = f'{md_escape(irv_state_key(s))} <br> {irv_desc_latex(s)}'
            end_cell = f'{md_escape(irv_state_key(ns))} <br> {irv_desc_latex(ns)}'
            lines.append(f'| {start_cell} | {lab} | {end_cell} | {w} → **{nw}** |')

    irv_complex = find_complex_cases(
        irv_states, irv_winner, IRV_PREF,
        lambda s: (ns for ns, lab, kind in irv_neighbours_minimal(s) if kind == 'reorder'))
    lines += ['', '### Complex manipulations (multi-step only)', '']
    if irv_complex:
        lines += ['| Start | End | Outcome | Steps |', '|---|---|---|---|']
        for s, t, hops in irv_complex:
            start_cell = f'{md_escape(irv_state_key(s))} <br> {irv_desc_latex(s)}'
            end_cell = f'{md_escape(irv_state_key(t))} <br> {irv_desc_latex(t)}'
            lines.append(f'| {start_cell} | {end_cell} | {irv_winner(s)} → **{irv_winner(t)}** | {hops} |')
    else:
        lines.append('None.')
    lines.append('')

    # ── STAR ─────────────────────────────────────────────────────────────────
    star_states = []
    for tournament in product((+1, -1), repeat=3):
        for score_rank in permutations(STAR_CANDIDATES):
            star_states.append((score_rank, tournament))

    # Group by (start, end) first: boost_B/starve_A can land on the same
    # target (see star_score_rank_neighbours docstring) -- when that happens,
    # show only the concrete numeric ballot move (boost_B/starve_B) rather
    # than both, since starve_A's "(x+1)-x-0" is the same move in disguise.
    star_rows = {}
    for s in star_states:
        w = star_winner(s)
        u0 = STAR_PREF[w]
        for ns, lab, kind in star_neighbours_minimal(s):
            nw = star_winner(ns)
            if STAR_PREF[nw] <= u0:
                continue
            key = (s, ns)
            if key in star_rows and star_rows[key][0] != 'starve_A' and lab == 'starve_A':
                continue
            star_rows[key] = (lab, nw)

    lines += ['## STAR', '', '### Profitable single-step deviations', '',
              '| Start | Move | End | Outcome |', '|---|---|---|---|']
    for (s, ns), (lab, nw) in star_rows.items():
        w = star_winner(s)
        start_cell = f'{md_escape(star_state_key(s))} <br> {star_desc_latex(s)}'
        end_cell = f'{md_escape(star_state_key(ns))} <br> {star_desc_latex(ns)}'
        lines.append(f'| {start_cell} | {STAR_MOVE_LABEL[lab]} | {end_cell} | {w} → **{nw}** |')

    star_complex = find_complex_cases(
        star_states, star_winner, STAR_PREF,
        lambda s: (ns for ns, lab, kind in star_neighbours_minimal(s) if kind == 'reorder'))
    lines += ['', '### Complex manipulations (multi-step only)', '']
    if star_complex:
        lines += ['| Start | End | Outcome | Steps |', '|---|---|---|---|']
        for s, t, hops in star_complex:
            start_cell = f'{md_escape(star_state_key(s))} <br> {star_desc_latex(s)}'
            end_cell = f'{md_escape(star_state_key(t))} <br> {star_desc_latex(t)}'
            lines.append(f'| {start_cell} | {end_cell} | {star_winner(s)} → **{star_winner(t)}** | {hops} |')
    else:
        lines.append('None.')
    lines.append('')

    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\n'.join(lines).rstrip() + '\n')


if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    n_mm = export_minimax(os.path.join(here, 'graph_edges.txt'))
    n_irv = export_irv(os.path.join(here, 'irv_graph_edges.txt'))
    n_star = export_star(os.path.join(here, 'star_graph_edges.txt'))
    export_profitable_summary(os.path.join(here, 'profitable_summary.txt'))
    print(f'wrote graph_edges.txt ({n_mm} nodes)')
    print(f'wrote irv_graph_edges.txt ({n_irv} nodes)')
    print(f'wrote star_graph_edges.txt ({n_star} nodes)')
    print('wrote profitable_summary.txt')
