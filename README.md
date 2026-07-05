# The Weakest Link

Interactive visualization of a minimax pairwise voting deviation model for a three-candidate election with coalition A ≻ B ≻ C.

## Winner rule

Given a ranked list of three directed pairwise matchups (rank 1 = largest margin, rank 3 = smallest):

1. If a Condorcet winner exists (wins both their matchups), elect them.
2. If there is a three-way cycle, elect the **loser of the rank-3 matchup** — the candidate whose worst defeat is smallest.

## Simple manipulations

A single step ("simple manipulation") is exactly one of: swap matchup-rank 1&2, swap matchup-rank 2&3, or flip the direction of the rank-3 (smallest) matchup.

## Two-archetype result

Of 48 possible states (8 direction combinations × 6 rank orderings), A wins in 16 states. Of the remaining 32, exactly **2** have a profitable single-step deviation:

**Archetype 1 — Betray your favorite (weaken AB):** `(C>A) > (A>B) > (B>C)` [C wins] — weakening A>B by one rank reaches `(C>A) > (B>C) > (A>B)`, improving the outcome to B.

**Archetype 2 — Bury your second choice (push BC):** `(A>C) > (B>A) > (C>B)` [B wins] — pushing B>C up one rank reaches `(A>C) > (C>B) > (B>A)`, improving the outcome to A.

## Multi-step deviations can help

Chaining single steps — as long as the outcome never gets strictly worse along the way, and the final step is a strict improvement — reveals **4** additional states where no single step is profitable, but a monotone 2-to-4-step chain is. In total, 6 of the 32 non-A states have a profitable path (16 profitable source→target pairs overall), and 26 remain fully powerless at any depth. See `graph.html`'s "Multi step" toggle, or `minimax_graph_test.py`'s "MULTI-STEP DEVIATION PATHS" report, for the concrete chains.

## Files

- [`minimax_graph_test.py`](minimax_graph_test.py) — canonical reference implementation (Python)
- `minimax.js` — port of all core logic
- `index.html` — scenario explorer
- `graph.html` — force-directed deviation graph (D3.js)

## Running locally

```sh
npx http-server .
```

Then open `http://localhost:8080`.

## GitHub Pages

Push to `main`; enable Pages from the repo settings (source: root of main branch).
