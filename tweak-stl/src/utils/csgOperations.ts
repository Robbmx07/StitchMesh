import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';

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
  target.updateMatrix();
  tool.updateMatrix();

  const targetBrush = new Brush(normalizeForCSG(target.geometry), resultMaterial as THREE.Material);
  targetBrush.matrix.copy(target.matrix);
  targetBrush.matrixAutoUpdate = false;
  targetBrush.updateMatrixWorld(true);

  const toolBrush = new Brush(normalizeForCSG(tool.geometry), resultMaterial as THREE.Material);
  toolBrush.matrix.copy(tool.matrix);
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

/** A translucent blue cylinder used to preview the Hole Modifier cutter. */
export function createHoleCutterMesh(diameter: number, depth: number): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(diameter / 2, diameter / 2, depth, 48);
  // Cylinder is built along Y by default; orient along local Z so it can be
  // aimed using the surface normal like a drill bit.
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, previewMaterial.clone());
  mesh.name = 'HoleCutterPreview';
  return mesh;
}

export function createPrimitiveMesh(
  shape: 'box' | 'cylinder' | 'washer',
  params: { width: number; depth: number; height: number; diameter: number; innerDiameter: number },
): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  if (shape === 'box') {
    geometry = new THREE.BoxGeometry(params.width, params.depth, params.height);
  } else if (shape === 'cylinder') {
    geometry = new THREE.CylinderGeometry(params.diameter / 2, params.diameter / 2, params.height, 48);
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
