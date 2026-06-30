'use strict';

import {
  MATCHUPS, PAIRS, SINCERE, PREF,
  winner, isCycle, desc, stateKey,
  allStates, stateData,
  encodeState,
} from './minimax.js';

const COLOR = { A: '#60a5fa', B: '#fbbf24', C: '#f87171' };
const PROFIT_COLOR = { A: '#34d399', B: '#fde68a' };

// ── State ─────────────────────────────────────────────────────────────────────
let showAllNodes = true;    // toggle: all 48 vs 32 non-A-wins (default: show all)
let showAllEdges = true;    // toggle: show all deviation edges (default on)
let hoveredNode = null;

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
    return {
      id: key,
      state: s,
      data,
      winner: winner(s),
      profitable: data.anyProfitable,
      aWins: winner(s) === 'A',
    };
  });

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // All deviation edges (direct refs for independent tick updates)
  allLinks = [];
  for (const n of nodes) {
    for (const nb of n.data.allNeighbours) {
      const target = nodeById.get(nb.key);
      if (target) allLinks.push({ source: n, target, label: nb.label, w: nb.winner });
    }
  }

  // Profitable edges (string IDs → forceLink resolves them)
  profitLinks = [];
  for (const n of nodes) {
    for (const dev of n.data.profitableDeviations) {
      if (visibleKeys.has(dev.key)) {
        profitLinks.push({ source: n.id, target: dev.key, w: dev.winner });
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
    .on('mouseenter', (ev, d) => { ev.stopPropagation(); applyHover(d); showTooltip(d); })
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

  // Archetype labels
  nodeEls.filter(d => d.profitable)
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
      .id(d => d.id).distance(90).strength(0.6))
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
function applyHover(d) {
  hoveredNode = d;

  // BFS through all deviation edges to find every reachable node
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const reachable = new Set([d.id]);
  const queue = [d];
  while (queue.length) {
    const curr = queue.shift();
    for (const nb of curr.data.allNeighbours) {
      if (!reachable.has(nb.key) && nodeById.has(nb.key)) {
        reachable.add(nb.key);
        queue.push(nodeById.get(nb.key));
      }
    }
  }

  // Dim nodes outside the reachable set; keep hovered node at full opacity
  nodeEls.attr('opacity', n => reachable.has(n.id) ? 1 : 0.07)
    .style('filter', n => n.id === d.id ? 'drop-shadow(0 0 7px #fff) drop-shadow(0 0 3px #fff)' : null);
  allEdgeEls.attr('stroke-opacity', 0);
  profitEdgeEls.attr('opacity', 0.04);

  // Show all edges whose both endpoints are reachable from d
  const hoverData = allLinks.filter(l => reachable.has(l.source.id) && reachable.has(l.target.id));

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
function showTooltip(d) {
  const w = d.winner;

  // Group neighbours by outcome, dedup labels with counts
  const byOutcome = { A: {}, B: {}, C: {} };
  for (const nb of d.data.allNeighbours) {
    const bucket = byOutcome[nb.winner];
    bucket[nb.label] = (bucket[nb.label] || 0) + 1;
  }

  const rows = ['A', 'B', 'C'].map(c => {
    const entries = Object.entries(byOutcome[c]);
    if (!entries.length) return '';
    const labels = entries.map(([lbl, n]) => n > 1 ? `${lbl}×${n}` : lbl).join(' · ');
    return `<div><span style="color:${COLOR[c]};font-weight:700">→${c}</span> <span style="color:var(--muted)">${labels}</span></div>`;
  }).join('');

  tooltip.innerHTML = `
    <div class="tt-desc">${d.data.desc}</div>
    <div class="tt-winner" style="color:${COLOR[w]}">winner: ${w} <span style="color:var(--muted);font-weight:400;font-size:0.7rem">${d.data.isCycle ? '[cycle]' : '[CW]'}</span></div>
    ${rows ? `<div class="tt-devs">${rows}</div>` : ''}
  `;
  tooltip.style.display = 'block';
}

function hideTooltip() { tooltip.style.display = 'none'; }

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

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', render);
window.addEventListener('resize', () => { if (sim) sim.stop(); render(); });
