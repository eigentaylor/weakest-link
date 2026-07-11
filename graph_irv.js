'use strict';

import {
  winner, stateKey,
  allStates, stateData,
} from './irv.js';

const COLOR = { A: '#60a5fa', B: '#fbbf24', C: '#f87171' };
const PROFIT_COLOR = { A: '#34d399', B: '#fde68a' };

// ── State ─────────────────────────────────────────────────────────────────────
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
  return allStates;
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

  // All deviation edges — always the atomic single-step (neighboursMinimal) graph.
  allLinks = [];
  for (const n of nodes) {
    for (const nb of n.data.minimalNeighbours) {
      const target = nodeById.get(nb.key);
      if (target) allLinks.push({ source: n, target, label: nb.label, w: nb.winner });
    }
  }

  // Profitable edges (string IDs → forceLink resolves them). Single step = direct
  // one-hop improvements; multi step = monotone (never-worse) chains that end in a
  // strict improvement. For IRV, the reference model (irv_graph_test.py) found
  // multi-step never exceeds single-step, so these two sets coincide exactly —
  // the toggle is kept for UI parity with the minimax graph page.
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

// Dash pattern encodes the 3-way state tag: cycle / center-squeeze / CW-wins.
function dashForTag(tag) {
  if (tag === '[cyc]') return '4,3';
  if (tag === '[SQZ]') return '1,2.5';
  return null;
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

  const zoom = d3.zoom().scaleExtent([0.15, 5])
    .on('zoom', ({ transform }) => g.attr('transform', transform));
  svg.call(zoom);
  svg.on('click', () => { if (hoveredNode) { clearHover(); hideTooltip(); } });

  const g = svg.append('g');

  const allEdgeGroup  = g.append('g');
  const profitEdgeGroup = g.append('g');
  hoverEdgeGroup = g.append('g');
  const nodeGroup = g.append('g');

  allEdgeEls = allEdgeGroup.selectAll('line')
    .data(allLinks)
    .join('line')
    .attr('stroke', '#3d4466')
    .attr('stroke-width', 0.8)
    .attr('stroke-opacity', showAllEdges ? 0.3 : 0)
    .attr('pointer-events', 'none');

  profitEdgeEls = profitEdgeGroup.selectAll('line')
    .data(profitLinks)
    .join('line')
    .attr('stroke', d => PROFIT_COLOR[d.w])
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 1)
    .attr('stroke-dasharray', d => d.dashed ? '6,4' : null)
    .attr('marker-end', d => `url(#arrow-${d.w})`)
    .attr('pointer-events', 'none');

  hoverEdgeEls = hoverEdgeGroup.selectAll('line');

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
    .on('mouseleave', () => { clearHover(); hideTooltip(); })
    .on('click', (ev) => { ev.stopPropagation(); });

  // Shapes
  nodeEls.each(function(d) {
    const el = d3.select(this);
    const r = d.aWins ? 9 : 6;
    const dash = dashForTag(d.data.tag);
    const isReal = !!d.data.realExample;
    const strokeColor = isReal ? '#818cf8' : '#0a0d18';
    const strokeWidth = isReal ? 2.5 : (d.profitable ? 1.5 : 1);
    if (d.profitable) {
      const s = r * 1.7;
      el.append('polygon')
        .attr('points', `0,${-s} ${s},0 0,${s} ${-s},0`)
        .attr('fill', COLOR[d.winner])
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-dasharray', dash);
    } else {
      el.append('circle')
        .attr('r', r)
        .attr('fill', COLOR[d.winner])
        .attr('fill-opacity', d.aWins ? 0.85 : 0.5)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('stroke-dasharray', dash);
    }
  });

  // Labels for nodes that map onto a real-world election
  nodeEls.filter(d => d.data.realExample)
    .append('text')
    .attr('dy', -14)
    .attr('text-anchor', 'middle')
    .attr('fill', '#a5b4fc')
    .attr('font-size', '9px')
    .attr('font-family', 'monospace')
    .attr('font-weight', 700)
    .attr('pointer-events', 'none')
    .text(d => d.data.realExample.name);

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

  hoverEdgeEls
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
}

// ── Hover ─────────────────────────────────────────────────────────────────────
function currentMode() {
  return ctrlDown ? (shiftDown ? 'ancestors' : 'incoming') : 'descendants';
}

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

  nodeEls.attr('opacity', n => reachable.has(n.id) ? 1 : 0.07)
    .style('filter', n => n.id === d.id ? 'drop-shadow(0 0 7px #fff) drop-shadow(0 0 3px #fff)' : null);
  allEdgeEls.attr('stroke-opacity', 0);
  profitEdgeEls.attr('opacity', 0.04);

  hoverEdgeEls = hoverEdgeGroup.selectAll('line')
    .data(hoverData)
    .join('line')
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

const TAG_LABEL = {
  '[cyc]': '[cycle]',
  '[SQZ]': '[center squeeze — CW eliminated]',
  '[CW ]': '[CW wins]',
};

function showTooltip(d, mode = 'descendants') {
  const w = d.winner;
  const modeHtml = MODE_LABEL[mode]
    ? `<div style="color:var(--accent);font-size:0.72rem;font-weight:600;margin-bottom:0.4rem">${MODE_LABEL[mode]}</div>`
    : '';

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

  const realExample = d.data.realExample;
  const realExampleHtml = realExample
    ? `<div style="margin-bottom:0.5rem;padding:0.4rem 0.6rem;background:rgba(129,140,248,0.12);border:1px solid rgba(129,140,248,0.3);border-radius:6px;font-size:0.78rem">` +
      `<b style="color:var(--accent)">📍 ${realExample.name}</b><br>` +
      `<span style="color:var(--muted)">${Object.entries(realExample.candidates).map(([g, name]) => `${g}=${name}`).join('  ·  ')}</span>` +
      `</div>`
    : '';

  tooltip.innerHTML = `
    ${modeHtml}
    ${realExampleHtml}
    <div class="tt-desc">
      <div>${d.data.descVotes}</div>
      <div style="margin-top:0.25rem">${d.data.descTournament}</div>
    </div>
    <div class="tt-winner" style="color:${COLOR[w]}">winner: ${w} <span style="color:var(--muted);font-weight:400;font-size:0.7rem">${TAG_LABEL[d.data.tag]}</span></div>
    ${rows ? `<div class="tt-devs">${rows}</div>` : ''}
    ${multiStepHtml}
  `;
  tooltip.style.display = 'block';
}

function hideTooltip() { tooltip.style.display = 'none'; }

// ── Hover-direction modifier keys ───────────────────────────────────────────────
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
