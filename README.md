# The Weakest Link

Interactive visualizations of strategic-voting deviation models for three-candidate elections, comparing three voting systems: **Minimax** (Condorcet-consistent pairwise), **IRV** (instant-runoff / ranked-choice), and **STAR** (score then automatic runoff). Every model shares the same setup — a coalition sincerely preferring A ≻ B ≻ C — and asks the same question: from a given election state, which single- or multi-step insincere deviations actually help the coalition?

## Live pages

| Page | Description |
|---|---|
| `index.html` | Scenario explorer — drag-and-drop matchup ranking, live winner + available deviations (Minimax) |
| `graph.html` | Force-directed deviation graph for Minimax (D3.js) |
| `3d.html` | 3D depth-layered surface of the Minimax deviation graph (Three.js) |
| `IRV.html` | Force-directed deviation graph for IRV |
| `star.html` | Force-directed deviation graph for STAR |
| `about.html` | Plain-language explanation of all three models |

All graph pages support a "Profitable edges only" / "Multi step" toggle, a legend, hover-to-highlight (hold Ctrl for direct predecessors, Ctrl+Shift for all ancestors), and clicking a node to open it in the Explorer.

## Minimax (Condorcet)

Given a ranked list of three directed pairwise matchups (rank 1 = largest margin, rank 3 = smallest):

1. If a Condorcet winner exists (wins both their matchups), elect them.
2. If there is a three-way cycle, elect the **loser of the rank-3 matchup** — the candidate whose worst defeat is smallest.

**Notation:** a state is written ⟨weakest ∣ middle ∣ strongest⟩ — matchups in increasing margin order, each term `X→Y` meaning "X beats Y". The winner is bolded in place. E.g. ⟨B→**C** ∣ A→B ∣ C→A⟩ is a cycle decided by C's narrowest loss (to B); ⟨**A**→C ∣ B→C ∣ **A**→B⟩ is a plain Condorcet win for A. This is the only notation used site-wide for this model; `formatState()` in `minimax.js` is the single place that renders it.

**Deviations:** a single step ("simple manipulation") is exactly one of: swap matchup-rank 1&2, swap matchup-rank 2&3, or flip the direction of the rank-3 (smallest) matchup.

Of 48 possible states (8 direction combinations × 6 rank orderings), A wins in 16. Of the remaining 32, exactly **2** cyclic states — the "gates" — have a profitable single-step deviation:

- **Gate G2 — betray your favorite (lie B>A):** ⟨B→**C** ∣ A→B ∣ C→A⟩ [C wins] → ⟨A→**B** ∣ B→C ∣ C→A⟩ [B wins].
- **Gate G1 — bury your second choice (lie C>B):** ⟨C→**B** ∣ B→A ∣ A→C⟩ [B wins] → ⟨B→**A** ∣ C→B ∣ A→C⟩ [A wins].

Chaining single steps — as long as the outcome never gets strictly worse along the way, and the final step is a strict improvement — reveals **4** additional states where no single step is profitable, but a monotone 2-to-4-step chain reaching a gate is. In total, 6 of the 32 non-A states have a profitable path (16 profitable source→target pairs overall), and 26 remain fully powerless at any depth. `graph.html` labels gate states `G1`/`G2` and their targets `Q1`/`Q2`; see its "Multi step" toggle or `minimax_graph_test.py`'s "MULTI-STEP DEVIATION PATHS" report for the concrete chains.

## IRV (Instant-Runoff / Ranked-Choice)

A state is `(votes_rank, tournament)`: `votes_rank` orders the candidates fewest-to-most first-place votes (the leftmost is eliminated this round); `tournament` is three independent pairwise results (unlike Minimax, there's no margin ordering — just 3 win/loss bits). Written ⟨X<Y<Z ∣ X→Y, Y→Z, X→Z⟩. The winner is whichever of the two survivors (after eliminating `votes_rank[0]`) wins their head-to-head matchup — simulating vote transfer.

A sincere ballot A>B>C both adds to A's first-place total and feeds the tournament (A beats B, A beats C, C beats A). Deviations can shift either axis independently: a **tournament flip** (`flip_AB`/`flip_AC`/`flip_BC`) changes a pairwise result, while a **votes-rank move** changes a voter's declared first choice. Because a coalition can only ever betray its own favorite (shift support away from A toward B or C), there are exactly two possible votes-rank moves depending on A's position — `swap_A` (swap A with whoever has fewer votes) and `swap_BC` (swap B and C when A isn't sitting between them) — never both from the same state, and never a third option.

Of the 48 states, A wins outright in 16; of the remaining 32, 12 are center-squeeze (a Condorcet winner exists but gets eliminated before the runoff), 12 are true 3-cycles, and the other 24 hand the win to the surviving Condorcet winner. **8 of the 32** non-A states have a profitable single-step deviation (8 profitable edges total). Tournament flips are **provably never profitable** on their own — a flip on the winner-relevant matchup can only help the less-preferred survivor, and a flip on the winner-irrelevant matchup never changes the outcome at all — so the graph's "Tournament deviations" toggle is off by default and only adds these moves for connectivity. One state maps onto a real election (Burlington 2009), annotated in the graph.

## STAR (Score Then Automatic Runoff)

Structurally identical to the IRV model — a state is `(score_rank, tournament)` with the same ⟨X<Y<Z ∣ X→Y, Y→Z, X→Z⟩ notation and the same winner rule, just re-grounded in total score: the lowest scorer is cut before the automatic runoff, and the runoff between the top two is decided by their pairwise result.

The coalition sincerely scores ballots `5-x-0` for some per-voter `0 < x < 5`. Unlike IRV's single transferable vote, a score ballot lets each voter move every candidate's score independently, giving three generous single-step levers (each the most extreme shift that still preserves the ballot's own sincere ordering):

- `boost_B` — raise B to 4 (just under A), letting B overtake whoever's directly above it.
- `starve_B` — lower B to 1 (just above C), letting whoever's directly below B overtake it.
- `starve_A` — lower A to x+1 (just above B), letting whoever's directly below A overtake it.

All three preserve the tournament exactly, so `score_rank` and `tournament` stay fully independent axes — same as IRV. The only adjacent swap these can't produce is moving A above C when C is already ahead of A (A's ballot contribution can't exceed 5, C's can't go below 0, so if that's not enough already, no lever closes the gap). Because levers are keyed to a candidate rather than a specific pair, the same target state can sometimes be reached by two different levers, kept as parallel edges.

This gives STAR strictly more manipulation power than IRV: **12 score_rank edges per tournament (96 total)** vs. IRV's 8 per tournament (64 total). **12 of the 32** non-A states have a profitable single-step deviation (14 profitable edges), whether or not the "Tournament deviations" toggle is on — tournament flips are never profitable here either, by the same proof as IRV. One state maps onto a real election (Alaska 2022), annotated in the graph.

## Files

**Reference implementations (Python, canonical):**
- [`minimax_graph_test.py`](minimax_graph_test.py) — Minimax model + full deviation report
- [`irv_graph_test.py`](irv_graph_test.py) — IRV model + full deviation report
- [`star_graph_test.py`](star_graph_test.py) — STAR model + full deviation report
- [`export_graph_to_txt.py`](export_graph_to_txt.py) — regenerates the `*_graph_edges.txt` dumps from each model's move rules; re-run after changing any model's logic

**JS ports (used by the live pages):**
- `minimax.js`, `irv.js`, `star.js` — core state/winner/deviation logic per model
- `explorer.js` — drives `index.html`
- `graph.js`, `graph3d.js`, `graph_irv.js`, `graph_star.js` — D3/Three.js graph rendering per model

**Pages:** `index.html`, `graph.html`, `3d.html`, `IRV.html`, `star.html`, `about.html`, `style.css`

**Data dumps:** `graph_edges.txt`, `irv_graph_edges.txt`, `star_graph_edges.txt` — plain-text edge lists kept in sync with the interactive graphs via `export_graph_to_txt.py`

## Running locally

```sh
npx http-server .
```

Then open `http://localhost:8080`.

## GitHub Pages

Push to `main`; enable Pages from the repo settings (source: root of main branch).
