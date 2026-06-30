# The Weakest Link

Interactive visualization of a minimax pairwise voting deviation model for a three-candidate election with coalition A ≻ B ≻ C.

## Winner rule

Given a ranked list of three directed pairwise matchups (rank 1 = largest margin, rank 3 = smallest):

1. If a Condorcet winner exists (wins both their matchups), elect them.
2. If there is a three-way cycle, elect the **loser of the rank-3 matchup** — the candidate whose worst defeat is smallest.

## Two-archetype result

Of 48 possible states (8 direction combinations × 6 rank orderings), A wins in 16 states. Of the remaining 32:

**Archetype 1 — Betray your favorite (weak or flip AB):** The coalition demotes or reverses A>B, creating a cycle in which C wins. This is profitable only in 2 states, and the deviation improves the outcome to B (not A).

**Archetype 2 — Bury your second choice (flip or push BC):** The coalition reverses B>C or strengthens B>C's rank while A>C dominates. This is profitable in 3 states and reaches A as the winner.

Total: 6 states with at least one profitable single-step deviation, 26 with none.

## No-multi-step-deviation theorem

If no single-step deviation from a state is profitable for the coalition, then no sequence of deviations — however long — leads to a better outcome. This covers 26 of the 32 non-A states. The profitable states form a sink: every deviation graph path either stays at the same utility level or cycles back.

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
