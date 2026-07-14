'use strict';

// Shared "isolate a move" feature for the deviation graph pages (graph.js /
// graph_star.js / graph_irv.js). Click a move chip to pin its edges glowing
// (full-bright regardless of the "profitable edges only" toggle) and dim
// everything else, with a live N-profitable/M-total count per move. This is
// the one piece of the render pipeline that's genuinely identical across all
// three pages — the rest (hover BFS, tooltip content, node shapes) diverges
// enough per voting method that it's kept separate rather than unified here.
//
// `getNeighbours(node)` returns that node's currently-visible atomic
// single-step neighbour list (already filtered for any per-page toggle, e.g.
// the tournament-deviations toggle on STAR/IRV).
// `isProfitable(node, neighbour)` reports whether that single-step edge is a
// profitable deviation, independent of the multi-step toggle.
// `profitColor` maps a winner letter to the color used for profitable-edge
// glow (matches each page's own PROFIT_COLOR).
export function createMoveIsolation({ getNeighbours, isProfitable, profitColor, panelId = 'moves-panel' }) {
  let isolatedMoves = new Set();
  let moveStats = new Map();

  // Tally, per human-readable move label, how many edges use it in the
  // currently visible atomic single-step graph and how many of those are
  // profitable. Counts always reflect the atomic (single-step) model
  // regardless of the "Multi step" toggle — a composite multi-hop edge has
  // no single clean per-move profitability count of its own.
  function rebuildStats(nodes) {
    const stats = new Map();
    for (const n of nodes) {
      for (const nb of getNeighbours(n)) {
        const s = stats.get(nb.label) || { total: 0, profitable: 0, kind: nb.kind };
        s.total++;
        if (isProfitable(n, nb)) s.profitable++;
        stats.set(nb.label, s);
      }
    }
    moveStats = stats;
    // Drop any pinned label that no longer exists under the current toggles
    // (e.g. a flip_* move after "Tournament deviations" is switched off).
    for (const l of [...isolatedMoves]) if (!moveStats.has(l)) isolatedMoves.delete(l);
  }

  function isActive() {
    return isolatedMoves.size > 0;
  }

  // An edge object matches if any of its move labels are currently pinned.
  // `d.labels` is a Set the caller attaches when building allLinks/profitLinks
  // (a single label for an atomic edge, every label along the chain for a
  // multi-hop shortcut).
  function matches(d) {
    for (const l of isolatedMoves) if (d.labels.has(l)) return true;
    return false;
  }

  // Re-style the two edge selections in place. Call after (re)building them
  // in render(), and again after any toggle that changes which edges are
  // visible without a full render() (e.g. the "profitable edges only" button).
  function apply(allEdgeEls, profitEdgeEls, showAllEdges) {
    if (isolatedMoves.size > 0) {
      allEdgeEls
        .attr('stroke', d => matches(d) ? '#ffffff' : '#3d4466')
        .attr('stroke-width', d => matches(d) ? 2.2 : 0.8)
        .attr('stroke-opacity', d => matches(d) ? 0.95 : 0.05)
        .style('filter', d => matches(d) ? 'drop-shadow(0 0 5px #fff)' : null);
      profitEdgeEls
        .attr('stroke-width', d => matches(d) ? 3.5 : 2)
        .attr('stroke-opacity', d => matches(d) ? 1 : 0.05)
        .style('filter', d => matches(d) ? `drop-shadow(0 0 6px ${profitColor[d.w]})` : null);
    } else {
      allEdgeEls.attr('stroke', '#3d4466').attr('stroke-width', 0.8)
        .attr('stroke-opacity', showAllEdges ? 0.3 : 0).style('filter', null);
      profitEdgeEls.attr('stroke-width', 2).attr('stroke-opacity', 1).style('filter', null);
    }
  }

  // Draw the chip list into #<panelId>. `onChange` is called after a click
  // toggles a move in/out of the isolated set — the caller re-applies styles
  // (it owns the current D3 edge selections, this module doesn't).
  function renderPanel(onChange) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const labels = [...moveStats.keys()].sort();
    panel.innerHTML = '';
    if (!labels.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'flex';

    const title = document.createElement('span');
    title.className = 'moves-panel-label';
    title.textContent = 'Isolate move:';
    panel.appendChild(title);

    for (const label of labels) {
      const s = moveStats.get(label);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'move-chip' + (isolatedMoves.has(label) ? ' active' : '');
      chip.innerHTML =
        `<span class="move-kind kind-${s.kind}">${s.kind}</span>` +
        `<span class="move-name">${label}</span>` +
        `<span class="move-count${s.profitable > 0 ? ' has-profitable' : ''}">${s.profitable}/${s.total}</span>`;
      chip.addEventListener('click', () => {
        if (isolatedMoves.has(label)) isolatedMoves.delete(label);
        else isolatedMoves.add(label);
        renderPanel(onChange);
        onChange();
      });
      panel.appendChild(chip);
    }
  }

  return { rebuildStats, isActive, matches, apply, renderPanel };
}
