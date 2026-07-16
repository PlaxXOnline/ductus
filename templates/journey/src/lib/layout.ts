/**
 * Deterministic graph layout algorithm (NFR2) for the journey detail page.
 *
 * Level assignment via BFS from startNodeId (fallback: nodes with in-degree 0,
 * otherwise smallest id), fixed column/row grid following the geometry of the
 * design reference (cards 150×64, diamonds 52×52). Bezier edges with an
 * anchor-side heuristic based on relative position (edgeGeo in the design as
 * reference), arrowheads at the curve end, label chips at the curve midpoint
 * (t = 0.5).
 */

import type { Journey, JourneyEdge } from './types';

export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdgeGeo {
  /** SVG path (cubic Bezier curve) */
  d: string;
  /** transform of the arrowhead: translate(bx,by) rotate(angle) */
  arrowTransform: string;
  /** chip position: curve point at t = 0.5 */
  labelX: number;
  labelY: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: Record<string, NodeRect>;
  edges: Record<string, EdgeGeo>;
}

// Grid constants (following the design geometry).
export const CARD_W = 150;
export const CARD_H = 64;
export const DECISION_SIZE = 52;
const COL_PITCH = 216; // 150 card width + 66 column gap
const ROW_PITCH = 148; // 64 card height + room for chips/curves
const PAD_X = 24;
const PAD_TOP = 44;
const PAD_BOTTOM = 96; // room for back edges routed along the bottom + legend

type Side = 'l' | 'r' | 't' | 'b';

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function center(r: NodeRect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Anchor point on a node side with an offset along the side. */
function anchor(r: NodeRect, side: Side, off = 0): [number, number] {
  if (side === 'r') return [r.x + r.w, r.y + r.h / 2 + off];
  if (side === 'l') return [r.x, r.y + r.h / 2 + off];
  if (side === 't') return [r.x + r.w / 2 + off, r.y];
  return [r.x + r.w / 2 + off, r.y + r.h];
}

/** Direction vector perpendicular to the side (pointing outward). */
function dirV(side: Side): [number, number] {
  return side === 'r' ? [1, 0] : side === 'l' ? [-1, 0] : side === 't' ? [0, -1] : [0, 1];
}

/** Point of a cubic Bezier curve at t = 0.5: (a + 3·c1 + 3·c2 + b) / 8. */
function bezierMid(a: [number, number], c1: [number, number], c2: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + 3 * c1[0] + 3 * c2[0] + b[0]) / 8, (a[1] + 3 * c1[1] + 3 * c2[1] + b[1]) / 8];
}

interface EdgePlan {
  edge: JourneyEdge;
  sa: Side;
  sb: Side;
  /** fixed control points (only for routed-around back edges) */
  c1?: [number, number];
  c2?: [number, number];
  oa: number;
  ob: number;
  /** fixed chip height (back edges routed along the bottom: below the cards) */
  labelY?: number;
}

export function layoutGraph(journey: Journey): GraphLayout {
  const nodes = journey.nodes;
  const edges = journey.edges;
  const rects: Record<string, NodeRect> = {};
  const geos: Record<string, EdgeGeo> = {};
  if (nodes.length === 0) {
    return { width: PAD_X * 2 + CARD_W, height: PAD_TOP + PAD_BOTTOM, nodes: rects, edges: geos };
  }

  // ── Levels via BFS ─────────────────────────────────────────────────────────
  const ids = nodes.map((n) => n.id);
  const inDegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from !== e.to && inDegree.has(e.to)) inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    const list = outgoing.get(e.from) ?? [];
    list.push(e.to); // edges are sorted by id ⇒ deterministic expansion
    outgoing.set(e.from, list);
  }
  let roots: string[];
  if (journey.startNodeId !== null && inDegree.has(journey.startNodeId)) {
    roots = [journey.startNodeId];
  } else {
    roots = ids.filter((id) => inDegree.get(id) === 0);
    if (roots.length === 0) roots = [ids[0]];
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r, 0);
    queue.push(r);
  }
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const d = depth.get(id) ?? 0;
    for (const to of outgoing.get(id) ?? []) {
      if (!depth.has(to) && inDegree.has(to)) {
        depth.set(to, d + 1);
        queue.push(to);
      }
    }
  }
  // Unreachable nodes go into an extra column on the right.
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const unreachedDepth = depth.size < ids.length ? maxDepth + 1 : maxDepth;
  for (const id of ids) if (!depth.has(id)) depth.set(id, unreachedDepth);
  maxDepth = Math.max(maxDepth, unreachedDepth);

  // ── Columns/rows (ids are sorted ⇒ stable row order) ──────────────────────
  const columns: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of ids) columns[depth.get(id) ?? 0].push(id);
  const maxRows = Math.max(...columns.map((c) => c.length));
  const height = PAD_TOP + maxRows * ROW_PITCH - (ROW_PITCH - CARD_H) + PAD_BOTTOM;
  const width = PAD_X * 2 + (maxDepth + 1) * COL_PITCH - (COL_PITCH - CARD_W);

  for (let c = 0; c < columns.length; c += 1) {
    const col = columns[c];
    // Center the column vertically in the grid (half slot steps, deterministic).
    const startY = PAD_TOP + Math.round(((maxRows - col.length) * ROW_PITCH) / 2);
    for (let r = 0; r < col.length; r += 1) {
      const id = col[r];
      const node = nodes.find((n) => n.id === id);
      const isDecision = node?.type === 'decision';
      const w = isDecision ? DECISION_SIZE : CARD_W;
      const h = isDecision ? DECISION_SIZE : CARD_H;
      rects[id] = {
        x: PAD_X + c * COL_PITCH + (isDecision ? Math.round((CARD_W - DECISION_SIZE) / 2) : 0),
        y: startY + r * ROW_PITCH + (isDecision ? Math.round((CARD_H - DECISION_SIZE) / 2) : 0),
        w,
        h,
      };
    }
  }

  // ── Anchor-side heuristic per edge ────────────────────────────────────────
  const plans: EdgePlan[] = [];
  let backLane = 0; // offsets bottom-routed back edges against each other
  for (const edge of edges) {
    const ra = rects[edge.from];
    const rb = rects[edge.to];
    if (!ra || !rb) continue;
    const da = depth.get(edge.from) ?? 0;
    const db = depth.get(edge.to) ?? 0;
    const ca = center(ra);
    const cb = center(rb);
    let plan: EdgePlan;
    if (edge.from === edge.to) {
      // Self-loop: exit on the right, re-enter at the top.
      plan = {
        edge,
        sa: 'r',
        sb: 't',
        c1: [ra.x + ra.w + 56, ca.y],
        c2: [ca.x + 24, ra.y - 56],
        oa: 0,
        ob: 12,
      };
    } else if (db > da) {
      plan = { edge, sa: 'r', sb: 'l', oa: 0, ob: 0 }; // forward
    } else if (db === da) {
      // same column: connect vertically
      plan = cb.y > ca.y ? { edge, sa: 'b', sb: 't', oa: 0, ob: 0 } : { edge, sa: 't', sb: 'b', oa: 0, ob: 0 };
    } else if (db === da - 1 && Math.abs(cb.y - ca.y) < ROW_PITCH) {
      // short back edge at a similar height: route over the top (cf. e6 in the design)
      const loopY = Math.min(ra.y, rb.y) - 64;
      plan = { edge, sa: 't', sb: 't', c1: [ca.x + 26, loopY], c2: [cb.x + 26, loopY], oa: 0, ob: 40 };
    } else {
      // long back edge: route around the bottom of the graph (cf. e7/e8 in the
      // design); chip fixed at the loop's height so it never covers any cards.
      const loopY = height - PAD_BOTTOM + 58 + backLane * 22;
      backLane += 1;
      plan = {
        edge,
        sa: 'b',
        sb: 'b',
        c1: [ca.x + 26, loopY],
        c2: [cb.x - 37, loopY],
        oa: 0,
        ob: -32,
        labelY: loopY - 22,
      };
    }
    plans.push(plan);
  }

  // Multiple edges on the same node side: fan out anchors along the side.
  const bySide = new Map<string, EdgePlan[]>();
  for (const p of plans) {
    const key = `${p.edge.from}|${p.sa}`;
    const list = bySide.get(key) ?? [];
    list.push(p);
    bySide.set(key, list);
  }
  for (const list of bySide.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => cmp(a.edge.id, b.edge.id));
    for (let i = 0; i < sorted.length; i += 1) {
      sorted[i].oa = Math.round((i - (sorted.length - 1) / 2) * 24);
    }
  }

  // ── Geometry per edge (Bezier, arrow angle, chip at t = 0.5) ──────────────
  for (const p of plans) {
    const ra = rects[p.edge.from];
    const rb = rects[p.edge.to];
    const a = anchor(ra, p.sa, p.oa);
    const b = anchor(rb, p.sb, p.ob);
    const dva = dirV(p.sa);
    const dvb = dirV(p.sb);
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ext = Math.max(42, dist * 0.42);
    const c1: [number, number] = p.c1 ?? [a[0] + dva[0] * ext, a[1] + dva[1] * ext];
    const c2: [number, number] = p.c2 ?? [b[0] + dvb[0] * ext, b[1] + dvb[1] * ext];
    const angle = (Math.atan2(b[1] - c2[1], b[0] - c2[0]) * 180) / Math.PI;
    const mid = bezierMid(a, c1, c2, b);
    geos[p.edge.id] = {
      d: `M${a[0]},${a[1]} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${b[0]},${b[1]}`,
      arrowTransform: `translate(${b[0]},${b[1]}) rotate(${angle.toFixed(1)})`,
      labelX: Math.round(mid[0]),
      labelY: p.labelY ?? Math.round(mid[1]),
    };
  }

  return { width, height, nodes: rects, edges: geos };
}
