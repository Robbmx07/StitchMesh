import * as THREE from 'three';

export interface MeshValidationResult {
  triangleCount: number;
  /** Edges belonging to only one triangle — a hole/open boundary. */
  boundaryEdgeCount: number;
  /** Edges shared by 3+ triangles — not a valid 2-manifold surface. */
  nonManifoldEdgeCount: number;
  /** Faces wound inconsistently with their neighbors (a common "flipped normal" defect). */
  inconsistentWindingCount: number;
  /** The whole mesh reads as inside-out (negative signed volume). */
  globallyInverted: boolean;
}

function weldKey(x: number, y: number, z: number): string {
  // Round to 4 decimal places (0.1 micron) to merge coincident STL vertices,
  // which STLLoader stores as independent, unindexed duplicates per triangle.
  return `${x.toFixed(4)}|${y.toFixed(4)}|${z.toFixed(4)}`;
}

/** Welds a non-indexed geometry's duplicate vertices into a shared index buffer. */
function buildWeldedIndices(geometry: THREE.BufferGeometry): Int32Array {
  const position = geometry.getAttribute('position');
  const vertexCount = position.count;
  const weldMap = new Map<string, number>();
  const welded = new Int32Array(vertexCount);
  let nextId = 0;
  for (let i = 0; i < vertexCount; i++) {
    const key = weldKey(position.getX(i), position.getY(i), position.getZ(i));
    let id = weldMap.get(key);
    if (id === undefined) {
      id = nextId++;
      weldMap.set(key, id);
    }
    welded[i] = id;
  }
  return welded;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  let sum = 0;
  for (let i = 0; i < position.count; i += 3) {
    const ax = position.getX(i), ay = position.getY(i), az = position.getZ(i);
    const bx = position.getX(i + 1), by = position.getY(i + 1), bz = position.getZ(i + 1);
    const cx = position.getX(i + 2), cy = position.getY(i + 2), cz = position.getZ(i + 2);
    // Signed tetrahedron volume from the origin, per triangle; sums to the
    // mesh's enclosed volume (sign flips if winding is globally reversed).
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

interface EdgeEntry {
  triIndex: number;
  /** True if this triangle traverses the edge low-index -> high-index. */
  ascending: boolean;
}

function buildEdgeMap(welded: Int32Array, triangleCount: number): Map<string, EdgeEntry[]> {
  const edges = new Map<string, EdgeEntry[]>();
  const addEdge = (triIndex: number, a: number, b: number) => {
    const key = edgeKey(a, b);
    const entry: EdgeEntry = { triIndex, ascending: a < b };
    const list = edges.get(key);
    if (list) list.push(entry);
    else edges.set(key, [entry]);
  };
  for (let t = 0; t < triangleCount; t++) {
    const i = t * 3;
    const a = welded[i], b = welded[i + 1], c = welded[i + 2];
    addEdge(t, a, b);
    addEdge(t, b, c);
    addEdge(t, c, a);
  }
  return edges;
}

/** Checks an imported mesh for common defects without modifying it. */
export function validateGeometry(geometry: THREE.BufferGeometry): MeshValidationResult {
  const position = geometry.getAttribute('position');
  const triangleCount = position.count / 3;
  const welded = buildWeldedIndices(geometry);
  const edges = buildEdgeMap(welded, triangleCount);

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentWindingCount = 0;
  const inconsistentTriangles = new Set<number>();

  for (const entries of edges.values()) {
    if (entries.length === 1) boundaryEdgeCount++;
    else if (entries.length > 2) nonManifoldEdgeCount++;
    else if (entries[0].ascending === entries[1].ascending) {
      // Two triangles sharing an edge should traverse it in opposite
      // directions if consistently wound; same direction means one of the
      // two has a flipped/inverted normal relative to its neighbor.
      inconsistentTriangles.add(entries[0].triIndex);
      inconsistentTriangles.add(entries[1].triIndex);
    }
  }
  inconsistentWindingCount = inconsistentTriangles.size;

  return {
    triangleCount,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    inconsistentWindingCount,
    globallyInverted: signedVolume(geometry) < 0,
  };
}

export function hasRepairableIssues(result: MeshValidationResult): boolean {
  return result.globallyInverted || result.inconsistentWindingCount > 0;
}

export function hasUnrepairableIssues(result: MeshValidationResult): boolean {
  return result.boundaryEdgeCount > 0 || result.nonManifoldEdgeCount > 0;
}

/**
 * Fixes inconsistent/inverted face winding — the defect that actually
 * breaks StitchMesh's normal-dependent features (click-to-place direction,
 * shading). Does not fill holes or repair non-manifold topology; those are
 * reported by validateGeometry() but left for the user to know about
 * rather than silently altering the mesh's shape.
 */
export function repairWindingConsistency(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const repaired = geometry.clone();
  const position = repaired.getAttribute('position') as THREE.BufferAttribute;
  const triangleCount = position.count / 3;
  const welded = buildWeldedIndices(repaired);
  const edges = buildEdgeMap(welded, triangleCount);

  // Build triangle adjacency: for each 2-triangle edge, note whether the
  // two triangles are consistently wound (opposite direction) or not.
  const adjacency: { neighbor: number; consistent: boolean }[][] = Array.from({ length: triangleCount }, () => []);
  for (const entries of edges.values()) {
    if (entries.length !== 2) continue;
    const [e0, e1] = entries;
    const consistent = e0.ascending !== e1.ascending;
    adjacency[e0.triIndex].push({ neighbor: e1.triIndex, consistent });
    adjacency[e1.triIndex].push({ neighbor: e0.triIndex, consistent });
  }

  // Flood-fill each connected component, classifying triangles into two
  // relative-orientation groups (A = same as the seed, B = flipped).
  const group = new Int8Array(triangleCount).fill(-1);
  for (let seed = 0; seed < triangleCount; seed++) {
    if (group[seed] !== -1) continue;
    group[seed] = 0;
    const queue = [seed];
    while (queue.length > 0) {
      const t = queue.pop()!;
      for (const { neighbor, consistent } of adjacency[t]) {
        const expected = consistent ? group[t] : (1 - group[t]);
        if (group[neighbor] === -1) {
          group[neighbor] = expected;
          queue.push(neighbor);
        }
      }
    }
  }

  // Within each connected component, assume the majority orientation is
  // correct and flip only the minority group.
  const componentOf = new Int32Array(triangleCount).fill(-1);
  const components: number[][] = [];
  const visited = new Uint8Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    if (visited[t]) continue;
    const stack = [t];
    const members: number[] = [];
    visited[t] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const { neighbor } of adjacency[cur]) {
        if (!visited[neighbor]) {
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }
    const componentIndex = components.length;
    components.push(members);
    for (const m of members) componentOf[m] = componentIndex;
  }

  const flip = new Uint8Array(triangleCount);
  for (const members of components) {
    let countA = 0;
    for (const m of members) if (group[m] === 0) countA++;
    const countB = members.length - countA;
    const minorityGroup = countA <= countB ? 0 : 1;
    for (const m of members) if (group[m] === minorityGroup) flip[m] = 1;
  }

  const flipTriangle = (t: number) => {
    const i = t * 3;
    const bx = position.getX(i + 1), by = position.getY(i + 1), bz = position.getZ(i + 1);
    const cx = position.getX(i + 2), cy = position.getY(i + 2), cz = position.getZ(i + 2);
    position.setXYZ(i + 1, cx, cy, cz);
    position.setXYZ(i + 2, bx, by, bz);
  };

  // Pass 1: fix local inconsistencies so every component is uniformly
  // wound (matching its own majority orientation).
  for (let t = 0; t < triangleCount; t++) {
    if (flip[t] === 1) flipTriangle(t);
  }
  position.needsUpdate = true;

  // Pass 2: now that orientation is uniform, a single global check tells
  // us whether that uniform orientation is inward or outward; if inward,
  // the whole (now-consistent) mesh needs one more full flip.
  if (signedVolume(repaired) < 0) {
    for (let t = 0; t < triangleCount; t++) flipTriangle(t);
    position.needsUpdate = true;
  }

  repaired.computeVertexNormals();
  repaired.computeBoundingBox();
  repaired.computeBoundingSphere();
  return repaired;
}

/**
 * Mirrors a geometry across the given local axis, baked into vertex
 * positions with corrected winding (mirroring reverses handedness, so
 * every triangle's winding must flip too, or every face ends up backwards
 * — the same defect repairWindingConsistency() fixes). A group-level
 * negative scale would look fine on screen but export/CSG/raycast wrong;
 * baking it in keeps the result as well-formed as any other operation.
 */
export function mirrorGeometry(geometry: THREE.BufferGeometry, axis: 'x' | 'y' | 'z'): THREE.BufferGeometry {
  const mirrored = geometry.clone();
  const position = mirrored.getAttribute('position') as THREE.BufferAttribute;
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  for (let i = 0; i < position.count; i++) {
    const v = [position.getX(i), position.getY(i), position.getZ(i)];
    v[axisIndex] = -v[axisIndex];
    position.setXYZ(i, v[0], v[1], v[2]);
  }

  const triangleCount = position.count / 3;
  for (let t = 0; t < triangleCount; t++) {
    const i = t * 3;
    const bx = position.getX(i + 1), by = position.getY(i + 1), bz = position.getZ(i + 1);
    const cx = position.getX(i + 2), cy = position.getY(i + 2), cz = position.getZ(i + 2);
    position.setXYZ(i + 1, cx, cy, cz);
    position.setXYZ(i + 2, bx, by, bz);
  }

  position.needsUpdate = true;
  mirrored.computeVertexNormals();
  mirrored.computeBoundingBox();
  mirrored.computeBoundingSphere();
  return mirrored;
}
