'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  allStates, stateData, stateKey, winner, PREF, encodeState,
} from './minimax.js';

const COLOR = { A: '#60a5fa', B: '#fbbf24', C: '#f87171' };
const PROFIT_COLOR = { A: '#34d399', B: '#fde68a' };

// Coarse structural layer spacing and fine winner-quality "bump" scale — tuned
// so the 7 structural layers stay visually distinct while a profitable
// deviation to a better winner still pops relative to its structural peers.
const LAYER_SPACING = 15;
const BUMP_SCALE = 6;

// ── State ─────────────────────────────────────────────────────────────────────
let showAllNodes = true;
let showAllEdges = true;
let showMinimalEdges = true;
let hoveredId = null;

// ── Data ──────────────────────────────────────────────────────────────────────
let nodes = [];
let allLinks = [];
let profitLinks = [];
let nodeMeshes = new Map();

// ── Three.js state ────────────────────────────────────────────────────────────
let scene, camera, renderer, controls, raycaster, mouse;
let nodeGroup, allEdgeGroup, profitEdgeGroup, hoverEdgeGroup, surfaceMesh;
let defaultCameraPos = new THREE.Vector3();
let defaultTarget = new THREE.Vector3();

const container = document.getElementById('graph-container');
const tooltip = document.getElementById('tooltip');

function getVisible() {
  return showAllNodes ? allStates : allStates.filter(s => winner(s) !== 'A');
}

// ── Height: SCC condensation + longest-path-to-sink layering ─────────────────
// Groups mutually-reachable states (a cycle you can walk both ways through)
// into one height, matching "nodes you can go between are the same height".
// Tarjan's algorithm emits SCCs in reverse-topological order, so by the time
// an SCC is processed every SCC it points to already has a known height.
function computeHeights(keys, adjFn) {
  let index = 0;
  const indices = new Map(), low = new Map(), onStack = new Map(), stack = [];
  const sccOf = new Map();
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.set(v, true);
    for (const w of adjFn(v)) {
      if (!indices.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.get(w)) {
        low.set(v, Math.min(low.get(v), indices.get(w)));
      }
    }
    if (low.get(v) === indices.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.set(w, false);
        comp.push(w);
        sccOf.set(w, sccs.length);
      } while (w !== v);
      sccs.push(comp);
    }
  }
  for (const k of keys) if (!indices.has(k)) strongconnect(k);

  const condAdj = sccs.map(() => new Set());
  for (const k of keys) {
    const a = sccOf.get(k);
    for (const nb of adjFn(k)) {
      const b = sccOf.get(nb);
      if (a !== b) condAdj[a].add(b);
    }
  }

  const height = new Array(sccs.length).fill(0);
  for (let i = 0; i < sccs.length; i++) {
    let h = 0;
    for (const b of condAdj[i]) h = Math.max(h, height[b] + 1);
    height[i] = h;
  }

  const nodeHeight = new Map();
  for (const k of keys) nodeHeight.set(k, height[sccOf.get(k)]);
  return nodeHeight;
}

// ── Data build ────────────────────────────────────────────────────────────────
function buildData() {
  const visible = getVisible();
  const visibleKeys = new Set(visible.map(s => stateKey(s)));

  const adjFn = (k) => stateData.get(k).minimalNeighbours
    .map(nb => nb.key)
    .filter(nk => visibleKeys.has(nk));

  const nodeHeight = computeHeights([...visibleKeys], adjFn);
  const maxHeight = Math.max(0, ...nodeHeight.values());

  nodes = visible.map(s => {
    const key = stateKey(s);
    const data = stateData.get(key);
    const profitable = showMinimalEdges
      ? data.anyMinimalProfitable
      : data.multiStepProfitableDeviations.length > 0;
    const h = nodeHeight.get(key);
    const bump = (PREF[winner(s)] / 2) * BUMP_SCALE;
    return {
      id: key,
      state: s,
      data,
      winner: winner(s),
      profitable,
      aWins: winner(s) === 'A',
      height: h,
      y: h * LAYER_SPACING + bump,
    };
  });

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  allLinks = [];
  for (const n of nodes) {
    for (const nb of n.data.minimalNeighbours) {
      const target = nodeById.get(nb.key);
      if (target) allLinks.push({ source: n, target, w: nb.winner });
    }
  }

  profitLinks = [];
  for (const n of nodes) {
    const devs = showMinimalEdges ? n.data.minimalProfitableDeviations : n.data.multiStepProfitableDeviations;
    for (const dev of devs) {
      const target = nodeById.get(dev.key);
      if (target) profitLinks.push({ source: n, target, w: dev.winner, hops: dev.hops, dashed: dev.hops > 1 });
    }
  }

  return { maxHeight };
}

// ── Planar (x/z) layout: bake a one-shot D3-force simulation, independent of
// the height (y) axis, so connected states cluster horizontally. ────────────
function bakeLayout(W, H) {
  const r = Math.min(W, H) * 0.36 || 200;
  const layoutNodes = nodes.map((n, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    return {
      id: n.id,
      x: r * Math.cos(angle) + (Math.random() - 0.5) * 20,
      y: r * Math.sin(angle) + (Math.random() - 0.5) * 20,
    };
  });
  const linkData = allLinks.map(l => ({ source: l.source.id, target: l.target.id }));

  const sim = d3.forceSimulation(layoutNodes)
    .force('link', d3.forceLink(linkData).id(d => d.id).distance(70).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-260).distanceMax(500))
    .force('cx', d3.forceX(0).strength(0.04))
    .force('cy', d3.forceY(0).strength(0.04))
    .force('collide', d3.forceCollide(16))
    .stop();

  for (let i = 0; i < 300; i++) sim.tick();

  const byId = new Map(layoutNodes.map(n => [n.id, n]));
  for (const n of nodes) {
    const ln = byId.get(n.id);
    n.px = ln.x;
    n.pz = ln.y;
  }
}

// ── Scene setup ───────────────────────────────────────────────────────────────
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1117);

  const W = container.clientWidth || 900, H = container.clientHeight || 600;
  camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 5000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(100, 200, 100);
  scene.add(dirLight);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('mouseleave', clearHover);

  window.addEventListener('resize', onResize);

  animate();
}

function onResize() {
  const W = container.clientWidth, H = container.clientHeight;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ── Mesh builders ─────────────────────────────────────────────────────────────
function buildSurfaceMesh() {
  const points = nodes.map(n => [n.px, n.pz]);
  const delaunay = d3.Delaunay.from(points);
  const tris = delaunay.triangles;

  const positions = new Float32Array(nodes.length * 3);
  const colors = new Float32Array(nodes.length * 3);
  nodes.forEach((n, i) => {
    positions[i * 3] = n.px;
    positions[i * 3 + 1] = n.y;
    positions[i * 3 + 2] = n.pz;
    const c = new THREE.Color(COLOR[n.winner]);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(tris), 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  surfaceMesh = new THREE.Mesh(geo, mat);
}

function buildNodes() {
  for (const n of nodes) {
    const radius = n.aWins ? 3.2 : 2.2;
    const geo = n.profitable
      ? new THREE.OctahedronGeometry(radius * 1.5, 0)
      : new THREE.SphereGeometry(radius, 16, 16);
    const baseOpacity = n.aWins ? 0.95 : 0.65;
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR[n.winner],
      transparent: true,
      opacity: baseOpacity,
      emissive: n.profitable ? new THREE.Color(COLOR[n.winner]) : new THREE.Color(0x000000),
      emissiveIntensity: n.profitable ? 0.35 : 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(n.px, n.y, n.pz);
    mesh.userData.nodeId = n.id;
    mesh.userData.baseOpacity = baseOpacity;
    nodeGroup.add(mesh);
    nodeMeshes.set(n.id, mesh);
  }
}

function buildAllEdges() {
  const positions = [];
  for (const l of allLinks) {
    positions.push(l.source.px, l.source.y, l.source.pz, l.target.px, l.target.y, l.target.pz);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x3d4466, transparent: true, opacity: showAllEdges ? 0.25 : 0 });
  const lines = new THREE.LineSegments(geo, mat);
  allEdgeGroup.add(lines);
  allEdgeGroup.userData.material = mat;
}

function buildProfitEdges() {
  const solidPositions = [], solidColors = [];
  for (const l of profitLinks) {
    const c = new THREE.Color(PROFIT_COLOR[l.w] || '#94a3b8');
    const src = new THREE.Vector3(l.source.px, l.source.y, l.source.pz);
    const dst = new THREE.Vector3(l.target.px, l.target.y, l.target.pz);

    if (l.dashed) {
      const geo = new THREE.BufferGeometry().setFromPoints([src, dst]);
      const mat = new THREE.LineDashedMaterial({ color: c, dashSize: 3, gapSize: 2, transparent: true, opacity: 1 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      profitEdgeGroup.add(line);
    } else {
      solidPositions.push(src.x, src.y, src.z, dst.x, dst.y, dst.z);
      solidColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    // Arrowhead cone near the target end
    const dir = dst.clone().sub(src);
    if (dir.length() > 0.001) {
      dir.normalize();
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 2.4, 8),
        new THREE.MeshBasicMaterial({ color: c })
      );
      cone.position.copy(dst.clone().sub(dir.clone().multiplyScalar(2.5)));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      profitEdgeGroup.add(cone);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(solidPositions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(solidColors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
  profitEdgeGroup.add(new THREE.LineSegments(geo, mat));
}

// ── Main render (full rebuild — mirrors graph.js's render()) ──────────────────
function render() {
  const { maxHeight } = buildData();
  const W = container.clientWidth || 900, H = container.clientHeight || 600;
  bakeLayout(W, H);

  if (nodeGroup) scene.remove(nodeGroup);
  if (allEdgeGroup) scene.remove(allEdgeGroup);
  if (profitEdgeGroup) scene.remove(profitEdgeGroup);
  if (hoverEdgeGroup) scene.remove(hoverEdgeGroup);
  if (surfaceMesh) scene.remove(surfaceMesh);

  nodeGroup = new THREE.Group();
  allEdgeGroup = new THREE.Group();
  profitEdgeGroup = new THREE.Group();
  hoverEdgeGroup = new THREE.Group();
  nodeMeshes = new Map();
  hoveredId = null;

  buildSurfaceMesh();
  buildAllEdges();
  buildProfitEdges();
  buildNodes();

  scene.add(surfaceMesh);
  scene.add(allEdgeGroup);
  scene.add(profitEdgeGroup);
  scene.add(hoverEdgeGroup);
  scene.add(nodeGroup);

  const midY = (maxHeight * LAYER_SPACING) / 2;
  const spread = Math.min(W, H) * 0.36 || 200;
  defaultCameraPos.set(spread * 1.3, maxHeight * LAYER_SPACING * 1.1 + 60, spread * 1.3);
  defaultTarget.set(0, midY, 0);
  camera.position.copy(defaultCameraPos);
  controls.target.copy(defaultTarget);
  controls.update();

  hideTooltip();
}

function resetCamera() {
  camera.position.copy(defaultCameraPos);
  controls.target.copy(defaultTarget);
  controls.update();
}

// ── Hover ─────────────────────────────────────────────────────────────────────
function onMouseMove(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(nodeGroup.children);
  if (intersects.length) {
    const id = intersects[0].object.userData.nodeId;
    if (hoveredId !== id) applyHover(id);
  } else if (hoveredId) {
    clearHover();
  }
}

function onClick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(nodeGroup.children);
  if (!intersects.length) return;
  const node = nodes.find(n => n.id === intersects[0].object.userData.nodeId);
  if (!node) return;
  const hash = encodeState(node.state);
  sessionStorage.setItem('explorerHash', hash);
  window.location.href = `index.html#${hash}`;
}

function applyHover(id) {
  hoveredId = id;
  const node = nodes.find(n => n.id === id);
  if (!node) return;

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const reachable = new Set([id]);
  const queue = [node];
  while (queue.length) {
    const curr = queue.shift();
    const neighboursList = showAllEdges
      ? curr.data.minimalNeighbours
      : (showMinimalEdges ? curr.data.minimalProfitableDeviations : curr.data.multiStepProfitableDeviations);
    for (const nb of neighboursList) {
      if (!reachable.has(nb.key) && nodeById.has(nb.key)) {
        reachable.add(nb.key);
        queue.push(nodeById.get(nb.key));
      }
    }
  }

  for (const [nid, mesh] of nodeMeshes) {
    const inSet = reachable.has(nid);
    mesh.material.opacity = inSet ? (nid === id ? 1 : mesh.userData.baseOpacity) : 0.06;
    mesh.scale.setScalar(nid === id ? 1.6 : 1);
  }
  if (allEdgeGroup.userData.material) allEdgeGroup.userData.material.opacity = 0;
  profitEdgeGroup.children.forEach(c => { c.material.opacity = 0.05; });

  rebuildHoverEdges(reachable);
  showTooltip(node);
}

function clearHover() {
  if (!hoveredId) return;
  hoveredId = null;
  for (const [, mesh] of nodeMeshes) {
    mesh.material.opacity = mesh.userData.baseOpacity;
    mesh.scale.setScalar(1);
  }
  if (allEdgeGroup.userData.material) allEdgeGroup.userData.material.opacity = showAllEdges ? 0.25 : 0;
  profitEdgeGroup.children.forEach(c => { c.material.opacity = 1; });
  hoverEdgeGroup.clear();
  hideTooltip();
}

function rebuildHoverEdges(reachable) {
  hoverEdgeGroup.clear();
  const edgePool = showAllEdges ? allLinks : profitLinks;
  const positions = [], colors = [];
  for (const l of edgePool) {
    if (reachable.has(l.source.id) && reachable.has(l.target.id)) {
      const c = new THREE.Color(l.w === 'A' ? PROFIT_COLOR.A : l.w === 'B' ? PROFIT_COLOR.B : '#94a3b8');
      positions.push(l.source.px, l.source.y, l.source.pz, l.target.px, l.target.y, l.target.pz);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
  hoverEdgeGroup.add(new THREE.LineSegments(geo, mat));
}

// ── Tooltip (same fixed bottom-right panel/markup as graph.js) ───────────────
function showTooltip(d) {
  const w = d.winner;

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

  tooltip.innerHTML = `
    <div class="tt-desc">${d.data.desc}</div>
    <div class="tt-winner" style="color:${COLOR[w]}">winner: ${w} <span style="color:var(--muted);font-weight:400;font-size:0.7rem">${d.data.isCycle ? '[cycle]' : '[CW]'}</span></div>
    <div style="color:var(--muted);font-size:0.75rem;margin-bottom:0.4rem">height: ${d.height}</div>
    ${rows ? `<div class="tt-devs">${rows}</div>` : ''}
    ${multiStepHtml}
  `;
  tooltip.style.display = 'block';
}

function hideTooltip() { tooltip.style.display = 'none'; }

// ── Toolbar ───────────────────────────────────────────────────────────────────
document.getElementById('toggle-nodes-btn').addEventListener('click', function() {
  showAllNodes = !showAllNodes;
  this.textContent = showAllNodes ? 'Show 32 (hide A-wins)' : 'Show all 48';
  this.classList.toggle('active', showAllNodes);
  render();
});

document.getElementById('toggle-edges-btn').addEventListener('click', function() {
  showAllEdges = !showAllEdges;
  this.textContent = showAllEdges ? 'Profitable edges only' : 'Show all edges';
  this.classList.toggle('active', showAllEdges);
  if (!hoveredId && allEdgeGroup.userData.material) {
    allEdgeGroup.userData.material.opacity = showAllEdges ? 0.25 : 0;
  }
});

document.getElementById('toggle-minimal-btn').addEventListener('click', function() {
  showMinimalEdges = !showMinimalEdges;
  this.textContent = showMinimalEdges ? 'Multi step' : 'Single step';
  this.classList.toggle('active', showMinimalEdges);
  render();
});

document.getElementById('reset-camera-btn').addEventListener('click', resetCamera);

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initScene();
  render();
});
