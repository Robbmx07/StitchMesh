import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { createThreadedRodGeometry } from './threadGeometry';
import type { ThreadStandard } from './threadStandards';

const evaluator = new Evaluator();
evaluator.useGroups = false;
// Only compare position/normal — our geometry never carries UVs, and the
// evaluator otherwise crashes when one operand's geometry lacks an
// attribute the other has (see normalizeForCSG below).
evaluator.attributes = ['position', 'normal'];

const previewMaterial = new THREE.MeshStandardMaterial({
  color: 0x3b82f6,
  transparent: true,
  opacity: 0.45,
  roughness: 0.4,
  metalness: 0.1,
  depthWrite: false,
});

// three-bvh-csg's Evaluator requires both operand geometries to expose the
// same set of vertex attributes. Geometry loaded from STL only has
// position/normal, while THREE.BoxGeometry/CylinderGeometry also generate
// uv (and index differently), so mismatched brushes crash the evaluator.
// Only position/normal actually matter for a boolean result, so drop
// everything else before handing geometry to a Brush.
const CSG_ATTRIBUTE_ALLOWLIST = new Set(['position', 'normal']);

function normalizeForCSG(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const normalized = geometry.clone();
  for (const key of Object.keys(normalized.attributes)) {
    if (!CSG_ATTRIBUTE_ALLOWLIST.has(key)) normalized.deleteAttribute(key);
  }
  if (!normalized.getAttribute('normal')) normalized.computeVertexNormals();
  return normalized;
}

/**
 * Runs a CSG boolean between two meshes and returns a brand-new, standalone
 * mesh with baked (world-space) geometry. Both inputs must have up-to-date
 * world matrices (`updateMatrixWorld`) before calling this.
 */
export function performCSG(
  target: THREE.Mesh,
  tool: THREE.Mesh,
  operation: typeof SUBTRACTION | typeof ADDITION,
  resultMaterial: THREE.Material | THREE.Material[],
): THREE.Mesh {
  // Use world matrices, not local ones: `target` is typically parented
  // under a group that carries the model's own position/rotation/scale
  // (e.g. the "drop to build plate" offset applied on load), while `tool`
  // (a raycast-placed cutter) is positioned directly in world space. Using
  // local matrices silently drops that parent offset and evaluates the two
  // operands in mismatched coordinate spaces — the boolean can silently
  // miss entirely if the offset pushes the target outside the cutter.
  target.updateMatrixWorld(true);
  tool.updateMatrixWorld(true);

  const targetBrush = new Brush(normalizeForCSG(target.geometry), resultMaterial as THREE.Material);
  targetBrush.matrix.copy(target.matrixWorld);
  targetBrush.matrixAutoUpdate = false;
  targetBrush.updateMatrixWorld(true);

  const toolBrush = new Brush(normalizeForCSG(tool.geometry), resultMaterial as THREE.Material);
  toolBrush.matrix.copy(tool.matrixWorld);
  toolBrush.matrixAutoUpdate = false;
  toolBrush.updateMatrixWorld(true);

  const result = evaluator.evaluate(targetBrush, toolBrush, operation);
  result.geometry.computeVertexNormals();
  result.geometry.computeBoundingBox();
  result.geometry.computeBoundingSphere();
  result.material = resultMaterial;
  result.matrix.identity();
  result.matrixAutoUpdate = true;
  result.position.set(0, 0, 0);
  result.rotation.set(0, 0, 0);
  result.scale.set(1, 1, 1);

  return result;
}

export { SUBTRACTION, ADDITION };

export interface ThreadRenderOptions {
  thread?: ThreadStandard | null;
  /** Mesh resolution tuned to a target printer; see printerProfiles.ts. */
  resolution?: { radialSegments: number; ringsPerPitch: number };
  /** Diametral clearance added for a printable internal (tapped) thread. */
  clearanceMM?: number;
}

/** Plain smooth cylinder, or a standard 60° V-thread rod when `thread` is given. */
function cylinderOrThreadGeometry(diameter: number, length: number, threadOpts?: ThreadRenderOptions): THREE.BufferGeometry {
  const thread = threadOpts?.thread;
  if (thread) {
    return createThreadedRodGeometry({
      majorDiameterMM: thread.majorDiameterMM + (threadOpts?.clearanceMM ?? 0),
      pitchMM: thread.pitchMM,
      lengthMM: length,
      radialSegments: threadOpts?.resolution?.radialSegments,
      ringsPerPitch: threadOpts?.resolution?.ringsPerPitch,
    });
  }
  const geometry = new THREE.CylinderGeometry(diameter / 2, diameter / 2, length, 48);
  // Cylinder is built along Y by default; orient along local Z so it can be
  // aimed using the surface normal like a drill bit.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * A translucent blue cylinder (or threaded rod, see threadGeometry.ts) used
 * to preview the Hole Modifier cutter. Passing `thread` cuts a standard
 * internal thread — subtracting this rod's exact profile is how a real tap
 * carves a matching female thread into a hole.
 */
export function createHoleCutterMesh(diameter: number, depth: number, threadOpts?: ThreadRenderOptions): THREE.Mesh {
  const geometry = cylinderOrThreadGeometry(diameter, depth, threadOpts);
  const mesh = new THREE.Mesh(geometry, previewMaterial.clone());
  mesh.name = 'HoleCutterPreview';
  return mesh;
}

export function createPrimitiveMesh(
  shape: 'box' | 'cylinder' | 'washer' | 'chamfer',
  params: { width: number; depth: number; height: number; diameter: number; innerDiameter: number },
  threadOpts?: ThreadRenderOptions,
): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  if (shape === 'box') {
    geometry = new THREE.BoxGeometry(params.width, params.depth, params.height);
  } else if (shape === 'cylinder') {
    geometry = cylinderOrThreadGeometry(params.diameter, params.height, threadOpts);
  } else if (shape === 'chamfer') {
    // A frustum, not a plain cylinder: wide (diameter) at the surface end,
    // tapering down to innerDiameter — the diameter of the hole it's meant
    // to blend into — at the buried end. See positionCutterAtSurface: for a
    // subtractive cutter, this geometry's local +Z (built along Y, then
    // rotated) ends up as the shallow/outward end, so radiusTop must be the
    // wide (surface) diameter and radiusBottom the narrow (hole) one.
    geometry = new THREE.CylinderGeometry(params.diameter / 2, params.innerDiameter / 2, params.height, 48);
    geometry.rotateX(Math.PI / 2);
  } else {
    // Washer: outer cylinder minus inner cylinder, baked into one geometry via CSG.
    const outerGeo = new THREE.CylinderGeometry(params.diameter / 2, params.diameter / 2, params.height, 48);
    outerGeo.rotateX(Math.PI / 2);
    const innerGeo = new THREE.CylinderGeometry(
      params.innerDiameter / 2,
      params.innerDiameter / 2,
      params.height + 2,
      48,
    );
    innerGeo.rotateX(Math.PI / 2);

    const outerMesh = new THREE.Mesh(outerGeo, previewMaterial);
    const innerMesh = new THREE.Mesh(innerGeo, previewMaterial);
    const washer = performCSG(outerMesh, innerMesh, SUBTRACTION, previewMaterial.clone());
    washer.name = 'PrimitivePreview';
    return washer;
  }

  const mesh = new THREE.Mesh(geometry, previewMaterial.clone());
  mesh.name = 'PrimitivePreview';
  return mesh;
}

/** Orients a mesh so its local +Z axis points along `normal`, at `point`. */
export function orientToSurface(mesh: THREE.Object3D, point: THREE.Vector3, normal: THREE.Vector3): void {
  mesh.position.copy(point);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  mesh.quaternion.copy(quaternion);
}

/**
 * Orients a cutter/boss mesh (built centered on its own axis, spanning
 * length/2 either side) to a surface point/normal, then shifts it along
 * that normal so the FULL stated length does its job instead of half of
 * it being wasted straddling the surface: mostly *into* the material for
 * a subtractive cutter (a hole/tapped-hole "Depth" of 10mm removes 10mm of
 * material, not 5mm), or mostly *outward* for an additive boss (a "Height"
 * of 10mm protrudes 10mm, not 5mm). A small embed is kept on the buried
 * side so the two solids overlap enough for a clean, non-degenerate CSG
 * result rather than sitting exactly tangent to the surface.
 */
export function positionCutterAtSurface(
  mesh: THREE.Object3D,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  length: number,
  mode: 'subtract' | 'union',
  embedMM = 0.5,
): void {
  orientToSurface(mesh, point, normal);
  const embed = Math.min(embedMM, length / 2);
  const outwardShift = length / 2 - embed;
  const signedShift = mode === 'subtract' ? -outwardShift : outwardShift;
  mesh.position.addScaledVector(normal.clone().normalize(), signedShift);
}

export interface CompositeFeature {
  type: 'hole' | 'primitive';
  point: [number, number, number];
  normal: [number, number, number];
  diameter: number;
  depth: number;
  threadId: string | null;
  shape: 'box' | 'cylinder' | 'washer' | 'chamfer';
  operation: 'union' | 'subtract';
  width: number;
  height: number;
  innerDiameter: number;
  visible?: boolean;
}

/**
 * Composites an ordered list of Hole/Primitive features onto a base
 * geometry, entirely in that geometry's own LOCAL frame — no world matrices
 * involved. Because every feature's point/normal are stored in this same
 * stable local frame, this is safe to re-run from scratch any time a
 * feature is added, edited, deleted, or a part is reloaded from undo
 * history, regardless of how the part itself has since been moved, rotated,
 * or scaled in the scene.
 */
export function rebuildCompositeGeometry(
  baseGeometry: THREE.BufferGeometry,
  features: CompositeFeature[],
  resolveThreadOpts: (threadId: string | null, isInternal: boolean) => ThreadRenderOptions,
  material: THREE.Material | THREE.Material[],
): THREE.BufferGeometry {
  let current = normalizeForCSG(baseGeometry);

  for (const f of features) {
    if (f.visible === false) continue;
    const point = new THREE.Vector3(...f.point);
    const normal = new THREE.Vector3(...f.normal);
    const isHole = f.type === 'hole';
    const length = isHole ? f.depth : f.height;
    const mode: 'subtract' | 'union' = isHole || f.operation === 'subtract' ? 'subtract' : 'union';

    const toolMesh = isHole
      ? createHoleCutterMesh(f.diameter, f.depth, resolveThreadOpts(f.threadId, true))
      : createPrimitiveMesh(f.shape, f, resolveThreadOpts(f.threadId, f.operation === 'subtract'));
    positionCutterAtSurface(toolMesh, point, normal, length, mode);
    toolMesh.updateMatrix();

    const targetBrush = new Brush(current, material as THREE.Material);
    targetBrush.matrixAutoUpdate = false;
    targetBrush.matrix.identity();
    targetBrush.updateMatrixWorld(true);

    const toolBrush = new Brush(normalizeForCSG(toolMesh.geometry), material as THREE.Material);
    toolBrush.matrix.copy(toolMesh.matrix);
    toolBrush.matrixAutoUpdate = false;
    toolBrush.updateMatrixWorld(true);

    const op = mode === 'subtract' ? SUBTRACTION : ADDITION;
    const result = evaluator.evaluate(targetBrush, toolBrush, op);
    current = result.geometry;
  }

  current.computeVertexNormals();
  current.computeBoundingBox();
  current.computeBoundingSphere();
  return current;
}

/** Splits a mesh into two halves along an axis-aligned plane using CSG. */
export function planeCutMesh(
  target: THREE.Mesh,
  axis: 'x' | 'y' | 'z',
  height: number,
  material: THREE.Material | THREE.Material[],
): { upper: THREE.Mesh; lower: THREE.Mesh } {
  target.updateMatrix();
  target.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(target);
  const size = new THREE.Vector3();
  box.getSize(size);
  const padding = Math.max(size.x, size.y, size.z) * 2 + 10;

  const slabSize: [number, number, number] =
    axis === 'x' ? [padding, padding, padding] : axis === 'y' ? [padding, padding, padding] : [padding, padding, padding];

  const makeSlab = (positiveSide: boolean) => {
    const geo = new THREE.BoxGeometry(...slabSize);
    const slab = new THREE.Mesh(geo, material);
    const offset = padding / 2;
    if (axis === 'x') slab.position.set(height + (positiveSide ? offset : -offset), 0, 0);
    if (axis === 'y') slab.position.set(0, height + (positiveSide ? offset : -offset), 0);
    if (axis === 'z') slab.position.set(0, 0, height + (positiveSide ? offset : -offset));
    slab.updateMatrix();
    return slab;
  };

  const upperCutter = makeSlab(false); // keeps everything ABOVE `height`
  const lowerCutter = makeSlab(true); // keeps everything BELOW `height`

  const upper = performCSG(target, upperCutter, SUBTRACTION, material);
  const lower = performCSG(target, lowerCutter, SUBTRACTION, material);
  upper.name = 'CutPieceUpper';
  lower.name = 'CutPieceLower';

  return { upper, lower };
}
