'use strict';

import {
  MATCHUPS, PAIRS, SINCERE, PREF,
  winner, isCycle, stateKey,
  allStates, stateData,
  encodeState,
} from './minimax.js';

const COLOR = { A: '#60a5fa', B: '#fbbf24', C: '#f87171' };
const PROFIT_COLOR = { A: '#34d399', B: '#fde68a' };

// ── State ─────────────────────────────────────────────────────────────────────
let showAllNodes = true;    // toggle: all 48 vs 32 non-A-wins (default: show all)
let showAllEdges = true;    // toggle: show all deviation edges (default on)
let showMinimalEdges = true; // toggle: single-step edges only
let hoveredNode = null;
let ctrlDown = false, shiftDown = false; // hover-direction modifiers

// ── Data ──────────────────────────────────────────────────────────────────────
let nodes = [];
let allLinks = [];    // all deviation edges, direct node refs (source, target)
let profitLinks = []; // profitable only, string IDs → resolved by forceLink

// ── D3 selections kept at module scope so tick() can update them ──────────────
let nodeEls, allEdgeEls, profitEdgeEls, hoverEdgeEls;
let hoverEdgeGroup;
let sim;
const tooltip = document.getElementById('tooltip');

function getVisible() {
  return showAllNodes ? allStates : allStates.filter(s => winner(s) !== 'A');
}

function buildData() {
  const visible = getVisible();
  const visibleKeys = new Set(visible.map(s => stateKey(s)));

  nodes = visible.map(s => {
    const key = stateKey(s);
    const data = stateData.get(key);
    const profitable = showMinimalEdges
      ? data.anyMinimalProfitable
      : data.multiStepProfitableDeviations.length > 0;
    return {
      id: key,
      state: s,
      data,
      winner: winner(s),
      profitable,
      aWins: winner(s) === 'A',
    };
  });

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // All deviation edges — always the atomic single-step (neighboursMinimal) graph;
  // these are the only genuinely adjacent moves under the current model.
  allLinks = [];
  for (const n of nodes) {
    for (const nb of n.data.minimalNeighbours) {
      const target = nodeById.get(nb.key);
      if (target) allLinks.push({ source: n, target, label: nb.label, w: nb.winner });
    }
  }

  // Profitable edges (string IDs → forceLink resolves them). Single step = direct
  // one-hop improvements; multi step = monotone (never-worse) chains that end in a
  // strict improvement, drawn as shortcuts (dashed when the shortest path is >1 hop).
  profitLinks = [];
  for (const n of nodes) {
    const devs = showMinimalEdges ? n.data.minimalProfitableDeviations : n.data.multiStepProfitableDeviations;
    for (const dev of devs) {
      if (visibleKeys.has(dev.key)) {
        profitLinks.push({ source: n.id, target: dev.key, w: dev.winner, hops: dev.hops, dashed: dev.hops > 1 });
      }
    }
  }
}

function initPositions(W, H) {
  const n = nodes.length;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) * 0.36;
  nodes.forEach((node, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    // slight jitter so the simulation doesn't start symmetric
    node.x = cx + r * Math.cos(angle) + (Math.random() - 0.5) * 20;
    node.y = cy + r * Math.sin(angle) + (Math.random() - 0.5) * 20;
    node.vx = 0; node.vy = 0;
    node.fx = null; node.fy = null;
  });
}

// ── Markers ───────────────────────────────────────────────────────────────────
function addMarkers(defs) {
  function mkArrow(id, color) {
    defs.append('marker')
      .attr('id', id)
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', color);
  }
  mkArrow('arrow-A', PROFIT_COLOR.A);
  mkArrow('arrow-B', PROFIT_COLOR.B);
  mkArrow('arrow-hover-A', PROFIT_COLOR.A);
  mkArrow('arrow-hover-B', PROFIT_COLOR.B);
  mkArrow('arrow-hover-C', '#94a3b8');
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  if (sim) sim.stop();
  buildData();

  const container = document.getElementById('graph-container');
  const W = container.clientWidth || 900;
  const H = container.clientHeight || 600;

  initPositions(W, H);

  d3.select('#graph-svg').selectAll('*').remove();

  const svg = d3.select('#graph-svg').attr('viewBox', `0 0 ${W} ${H}`);
  const defs = svg.append('defs');
  addMarkers(defs);

  // Zoom / pan
  const zoom = d3.zoom().scaleExtent([0.15, 5])
    .on('zoom', ({ transform }) => g.attr('transform', transform));
  svg.call(zoom);
  // Deselect on background click
  svg.on('click', () => { if (hoveredNode) { clearHover(); hideTooltip(); } });

  const g = svg.append('g');

  // Layers (bottom → top)
  const allEdgeGroup  = g.append('g');
  const profitEdgeGroup = g.append('g');
  hoverEdgeGroup = g.append('g');
  const nodeGroup = g.append('g');

  // ── All edges (thin, shown when toggle active or hover) ────────────────────
  allEdgeEls = allEdgeGroup.selectAll('line')
    .data(allLinks)
    .join('line')
    .attr('stroke', '#3d4466')
    .attr('stroke-width', 0.8)
    .attr('stroke-opacity', showAllEdges ? 0.3 : 0)
    .attr('pointer-events', 'none');

  // ── Profitable edges (colored arrows) ─────────────────────────────────────
  profitEdgeEls = profitEdgeGroup.selectAll('line')
    .data(profitLinks)
    .join('line')
    .attr('stroke', d => PROFIT_COLOR[d.w])
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 1)
    .attr('stroke-dasharray', d => d.dashed ? '6,4' : null)
    .attr('marker-end', d => `url(#arrow-${d.w})`)
    .attr('pointer-events', 'none');

  // ── Hover edge group (rebuilt on each hover) ───────────────────────────────
  hoverEdgeEls = hoverEdgeGroup.selectAll('line'); // empty D3 selection — safe to call .attr() on

  // ── Nodes ─────────────────────────────────────────────────────────────────
  nodeEls = nodeGroup.selectAll('g.node')
    .data(nodes, d => d.id)
    .join('g')
    .attr('class', 'node')
    .style('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    )
    .on('mouseenter', (ev, d) => {
      ev.stopPropagation();
      ctrlDown = ev.ctrlKey;
      shiftDown = ev.shiftKey;
      applyHover(d);
      showTooltip(d, currentMode());
    })
    .on('mouseleave', ()      => { clearHover(); hideTooltip(); })
    .on('click', (ev, d) => {
      ev.stopPropagation();
      const hash = encodeState(d.state);
      sessionStorage.setItem('explorerHash', hash);
      window.location.href = `index.html#${hash}`;
    });

  // Shapes
  nodeEls.each(function(d) {
    const el = d3.select(this);
    const r = d.aWins ? 9 : 6;
    const dash = d.data.isCycle ? '4,3' : null;
    if (d.profitable) {
      const s = r * 1.7;
      el.append('polygon')
        .attr('points', `0,${-s} ${s},0 0,${s} ${-s},0`)
        .attr('fill', COLOR[d.winner])
        .attr('stroke', '#0a0d18')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', dash);
    } else {
      el.append('circle')
        .attr('r', r)
        .attr('fill', COLOR[d.winner])
        .attr('fill-opacity', d.aWins ? 0.85 : 0.5)
        .attr('stroke', '#0a0d18')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', dash);
    }
  });

  // Archetype labels (only for states that carry an archetype tag — the
  // multi-step-only profitable states have no single-step archetype to show)
  nodeEls.filter(d => d.profitable && d.data.archetype != null)
    .append('text')
    .attr('dy', -14)
    .attr('text-anchor', 'middle')
    .attr('fill', '#a5b4fc')
    .attr('font-size', '9px')
    .attr('font-family', 'monospace')
    .attr('pointer-events', 'none')
    .text(d => `A${d.data.archetype ?? '?'}`);

  // ── Simulation ─────────────────────────────────────────────────────────────
  // Use profitable links for the link force so those nodes cluster together.
  // Repulsion + centering handle the rest.
  sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(profitLinks)
      .id(d => d.id)
      .distance(d => d.hops > 1 ? 90 + (d.hops - 1) * 50 : 90)
      .strength(d => d.hops > 1 ? 0.25 : 0.6))
    .force('charge', d3.forceManyBody().strength(-320).distanceMax(400))
    .force('cx', d3.forceX(W / 2).strength(0.05))
    .force('cy', d3.forceY(H / 2).strength(0.05))
    .force('collide', d3.forceCollide(14))
    .alphaDecay(0.025)
    .on('tick', tick);
}

function tick() {
  allEdgeEls
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

  profitEdgeEls
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

  nodeEls.attr('transform', d => `translate(${d.x},${d.y})`);

  // Update hover edge positions (if active)
  hoverEdgeEls
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
}

// ── Hover ─────────────────────────────────────────────────────────────────────
// Modifiers change the traversal direction while hovering a node:
//   (none)       → forward: every node reachable by deviating away from this one
//   Ctrl         → incoming: only the nodes with a direct edge into this one
//   Ctrl+Shift   → ancestors: every node that can eventually reach this one
function currentMode() {
  return ctrlDown ? (shiftDown ? 'ancestors' : 'incoming') : 'descendants';
}

// Build both directions of adjacency from an edge pool so hover can walk either way.
function buildAdjacency(edgePool) {
  const out = new Map(), inn = new Map();
  for (const l of edgePool) {
    if (!out.has(l.source.id)) out.set(l.source.id, []);
    out.get(l.source.id).push(l);
    if (!inn.has(l.target.id)) inn.set(l.target.id, []);
    inn.get(l.target.id).push(l);
  }
  return { out, inn };
}

// BFS over an adjacency map, following each edge toward `endpoint` ('target' or 'source').
function bfsReachable(startId, adj, endpoint) {
  const reachable = new Set([startId]);
  let frontier = [startId];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const l of (adj.get(id) || [])) {
        const nid = l[endpoint].id;
        if (!reachable.has(nid)) { reachable.add(nid); next.push(nid); }
      }
    }
    frontier = next;
  }
  return reachable;
}

function applyHover(d) {
  hoveredNode = d;
  const mode = currentMode();
  const edgePool = showAllEdges ? allLinks : profitLinks;
  const { out, inn } = buildAdjacency(edgePool);

  let reachable, hoverData;
  if (mode === 'incoming') {
    hoverData = inn.get(d.id) || [];
    reachable = new Set([d.id, ...hoverData.map(l => l.source.id)]);
  } else if (mode === 'ancestors') {
    reachable = bfsReachable(d.id, inn, 'source');
    hoverData = edgePool.filter(l => reachable.has(l.source.id) && reachable.has(l.target.id));
  } else {
    reachable = bfsReachable(d.id, out, 'target');
    hoverData = edgePool.filter(l => reachable.has(l.source.id) && reachable.has(l.target.id));
  }

  // Dim nodes outside the reachable set; keep hovered node at full opacity
  nodeEls.attr('opacity', n => reachable.has(n.id) ? 1 : 0.07)
    .style('filter', n => n.id === d.id ? 'drop-shadow(0 0 7px #fff) drop-shadow(0 0 3px #fff)' : null);
  allEdgeEls.attr('stroke-opacity', 0);
  profitEdgeEls.attr('opacity', 0.04);

  hoverEdgeEls = hoverEdgeGroup.selectAll('line')
    .data(hoverData)
    .join('line')
    // Set positions immediately — tick() won't fire if simulation has settled
    .attr('x1', l => l.source.x)
    .attr('y1', l => l.source.y)
    .attr('x2', l => l.target.x)
    .attr('y2', l => l.target.y)
    .attr('stroke', l => l.w === 'A' ? PROFIT_COLOR.A : l.w === 'B' ? PROFIT_COLOR.B : '#94a3b8')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.75)
    .attr('stroke-dasharray', l => l.dashed ? '6,4' : null)
    .attr('marker-end', l => `url(#arrow-hover-${l.w === 'A' ? 'A' : l.w === 'B' ? 'B' : 'C'})`)
    .attr('pointer-events', 'none');
}

function clearHover() {
  hoveredNode = null;
  nodeEls.attr('opacity', 1).style('filter', null);
  allEdgeEls.attr('stroke-opacity', showAllEdges ? 0.3 : 0);
  profitEdgeEls.attr('opacity', 1);
  hoverEdgeGroup.selectAll('*').remove();
  hoverEdgeEls = hoverEdgeGroup.selectAll('line');
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
const MODE_LABEL = {
  incoming: '← direct predecessors <span style="opacity:.6">(Ctrl)</span>',
  ancestors: '⇐ all ancestors <span style="opacity:.6">(Ctrl+Shift)</span>',
};

function showTooltip(d, mode = 'descendants') {
  const w = d.winner;
  const modeHtml = MODE_LABEL[mode]
    ? `<div style="color:var(--accent);font-size:0.72rem;font-weight:600;margin-bottom:0.4rem">${MODE_LABEL[mode]}</div>`
    : '';

  // Group neighbours by outcome, dedup (label + kind) with counts. The label
  // alone isn't unique — reorder and flip on the same matchup share the same
  // "lie X>Y" text, so kind must be part of the grouping key.
  const byOutcome = { A: {}, B: {}, C: {} };
  for (const nb of d.data.minimalNeighbours) {
    const bucket = byOutcome[nb.winner];
    const key = `${nb.label}|${nb.kind}`;
    if (!bucket[key]) bucket[key] = { label: nb.label, kind: nb.kind, count: 0 };
    bucket[key].count++;
  }

  const rows = ['A', 'B', 'C'].map(c => {
    const entries = Object.values(byOutcome[c]);
    if (!entries.length) return '';
    const items = entries.map(e => {
      const countStr = e.count > 1 ? ` ×${e.count}` : '';
      return `<span class="tt-dev-item">${e.label}${countStr} <span class="tt-kind kind-${e.kind}">${e.kind}</span></span>`;
    }).join(' · ');
    return `<div><span style="color:${COLOR[c]};font-weight:700">→${c}</span> <span style="color:var(--muted)">${items}</span></div>`;
  }).join('');

  // Multi-step mode: list every profitable-reachable target with its shortest path
  let multiStepHtml = '';
  if (!showMinimalEdges && d.data.multiStepProfitableDeviations.length) {
    const items = [...d.data.multiStepProfitableDeviations]
      .sort((a, b) => a.hops - b.hops)
      .map(t => {
        const pathStr = t.path.map(p => p.label).join(' → ');
        return `<div><span style="color:${COLOR[t.winner]};font-weight:700">⇢${t.winner}</span> <span style="color:var(--muted)">(${t.hops} hop${t.hops > 1 ? 's' : ''}): ${pathStr}</span></div>`;
      }).join('');
    multiStepHtml = `<div class="tt-devs">${items}</div>`;
  }

  tooltip.innerHTML = `
    ${modeHtml}
    <div class="tt-desc">${d.data.desc}</div>
    <div class="tt-winner" style="color:${COLOR[w]}">winner: ${w} <span style="color:var(--muted);font-weight:400;font-size:0.7rem">${d.data.isCycle ? '[cycle]' : '[CW]'}</span></div>
    ${rows ? `<div class="tt-devs">${rows}</div>` : ''}
    ${multiStepHtml}
  `;
  tooltip.style.display = 'block';
}

function hideTooltip() { tooltip.style.display = 'none'; }

// ── Hover-direction modifier keys ───────────────────────────────────────────────
// Re-apply hover in place when Ctrl/Shift are pressed or released while a node is
// already hovered — mouseenter alone can't see mid-hover key changes.
function onModifierChange(ev) {
  if (ev.key !== 'Control' && ev.key !== 'Shift') return;
  const nextCtrl = ev.ctrlKey, nextShift = ev.shiftKey;
  if (nextCtrl === ctrlDown && nextShift === shiftDown) return;
  ctrlDown = nextCtrl;
  shiftDown = nextShift;
  if (hoveredNode) {
    applyHover(hoveredNode);
    showTooltip(hoveredNode, currentMode());
  }
}
window.addEventListener('keydown', onModifierChange);
window.addEventListener('keyup', onModifierChange);
window.addEventListener('blur', () => {
  if (!ctrlDown && !shiftDown) return;
  ctrlDown = false;
  shiftDown = false;
  if (hoveredNode) {
    applyHover(hoveredNode);
    showTooltip(hoveredNode, currentMode());
  }
});

// ── Toolbar ───────────────────────────────────────────────────────────────────
document.getElementById('toggle-nodes-btn').addEventListener('click', function() {
  showAllNodes = !showAllNodes;
  // active = currently in "all 48" mode; text = what clicking does
  this.textContent = showAllNodes ? 'Show 32 (hide A-wins)' : 'Show all 48';
  this.classList.toggle('active', showAllNodes);
  hoveredNode = null;
  render();
});

document.getElementById('toggle-edges-btn').addEventListener('click', function() {
  showAllEdges = !showAllEdges;
  this.textContent = showAllEdges ? 'Profitable edges only' : 'Show all edges';
  this.classList.toggle('active', showAllEdges);
  if (!hoveredNode) {
    allEdgeEls.attr('stroke-opacity', showAllEdges ? 0.3 : 0);
    profitEdgeEls.attr('stroke-opacity', 1);
  }
});

document.getElementById('toggle-minimal-btn').addEventListener('click', function() {
  showMinimalEdges = !showMinimalEdges;
  this.textContent = showMinimalEdges ? 'Multi step' : 'Single step';
  this.classList.toggle('active', showMinimalEdges);
  hoveredNode = null;
  render();
});

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', render);
window.addEventListener('resize', () => { if (sim) sim.stop(); render(); });
