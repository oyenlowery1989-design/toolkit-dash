import type { GraphEdge, GraphNode } from "./types";

// ---------------------------------------------------------------------------
// Deterministic hand-rolled force simulation for the Flow Graph tab.
//
// No d3-force dependency, no Math.random() — initial positions are derived
// from a stable string hash of each node's id so the same graph always lays
// out the same way (important for a graph the user re-opens repeatedly).
// ---------------------------------------------------------------------------

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
}

export type Point = { x: number; y: number };

const REST_LENGTH = 80; // preferred edge length (spring rest length)
const SPRING_K = 0.02; // spring stiffness
const REPULSION_K = 4000; // Coulomb repulsion constant
const GRAVITY_K = 0.01; // pull toward center
const DAMPING = 0.85; // velocity damping per iteration
const MIN_DISTANCE = 1; // floor to avoid divide-by-zero / explosion
const MAX_STEP = 20; // clamp per-iteration displacement to keep the sim stable

/** Small deterministic string hash (djb2 variant). Always non-negative. */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33) ^ s.charCodeAt(i);
  }
  return hash >>> 0; // force unsigned
}

/** Deterministic seed position on a circle, derived from the node id. */
function seedPosition(id: string, width: number, height: number): Point {
  const h = hashString(id);
  const angle = (h % 360) * (Math.PI / 180);
  // Vary radius a bit using a second slice of the hash so nodes don't all
  // start on a single ring (which the spring/repulsion forces would then
  // have to untangle from a degenerate symmetric state).
  const radiusFraction = 0.25 + ((h >>> 8) % 1000) / 1000 / 2; // 0.25 .. 0.75
  const radius = radiusFraction * (Math.min(width, height) / 2);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/**
 * Lays out a graph in a rectangle of size {width, height} using a simple
 * velocity-based force simulation:
 *   - O(n^2) Coulomb repulsion between every pair of nodes
 *   - Spring attraction along edges toward REST_LENGTH
 *   - Mild gravity pulling every node toward the center
 * Runs synchronously for `iterations` steps (default 300) and returns final
 * positions keyed by node id. Deterministic: same nodes/edges -> same layout.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: LayoutOptions,
): Map<string, Point> {
  const { width, height, iterations = 300 } = opts;
  const positions = new Map<string, Point>();
  const velocities = new Map<string, Point>();

  for (const node of nodes) {
    positions.set(node.id, seedPosition(node.id, width, height));
    velocities.set(node.id, { x: 0, y: 0 });
  }

  if (nodes.length === 0) return positions;

  const cx = width / 2;
  const cy = height / 2;

  // Only keep edges whose both endpoints are actually in this node set.
  const validEdges = edges.filter((e) => positions.has(e.source) && positions.has(e.target));

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, Point>();
    for (const node of nodes) forces.set(node.id, { x: 0, y: 0 });

    // Coulomb repulsion, every pair.
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const pa = positions.get(a.id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const pb = positions.get(b.id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < MIN_DISTANCE) distSq = MIN_DISTANCE;
        const dist = Math.sqrt(distSq);
        const force = REPULSION_K / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fa = forces.get(a.id)!;
        fa.x += fx;
        fa.y += fy;
        const fb = forces.get(b.id)!;
        fb.x -= fx;
        fb.y -= fy;
      }
    }

    // Spring attraction along edges.
    for (const edge of validEdges) {
      const pa = positions.get(edge.source)!;
      const pb = positions.get(edge.target)!;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_DISTANCE) dist = MIN_DISTANCE;
      const displacement = dist - REST_LENGTH;
      const force = SPRING_K * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fa = forces.get(edge.source)!;
      fa.x += fx;
      fa.y += fy;
      const fb = forces.get(edge.target)!;
      fb.x -= fx;
      fb.y -= fy;
    }

    // Mild gravity toward center.
    for (const node of nodes) {
      const p = positions.get(node.id)!;
      const f = forces.get(node.id)!;
      f.x += (cx - p.x) * GRAVITY_K;
      f.y += (cy - p.y) * GRAVITY_K;
    }

    // Integrate (velocity-Verlet-ish: apply force as acceleration, damp, move).
    for (const node of nodes) {
      const v = velocities.get(node.id)!;
      const f = forces.get(node.id)!;
      v.x = (v.x + f.x) * DAMPING;
      v.y = (v.y + f.y) * DAMPING;
      // Clamp step size for stability on the first few high-force iterations.
      const stepX = Math.max(-MAX_STEP, Math.min(MAX_STEP, v.x));
      const stepY = Math.max(-MAX_STEP, Math.min(MAX_STEP, v.y));
      const p = positions.get(node.id)!;
      p.x += stepX;
      p.y += stepY;
    }
  }

  return positions;
}
