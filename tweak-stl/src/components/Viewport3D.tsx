import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import {
  ADDITION,
  createHoleCutterMesh,
  createPrimitiveMesh,
  performCSG,
  planeCutMesh,
  positionCutterAtSurface,
  rebuildCompositeGeometry,
  type ThreadRenderOptions,
} from '@/utils/csgOperations';
import { createBasicShapeGeometry, BASIC_SHAPE_LABELS } from '@/utils/shapeGeometry';
import { findThreadStandard } from '@/utils/threadStandards';
import { findPrinterProfile, recommendedThreadResolution, effectivePrinterProfile, buildVolumeWarning as computeBuildVolumeWarning } from '@/utils/printerProfiles';
import { validateGeometry, repairWindingConsistency, mirrorGeometry, hasRepairableIssues, hasUnrepairableIssues } from '@/utils/meshRepair';
import { kabschFit, type Vec3 } from '@/utils/rigidFit';
import {
  useAppStore,
  type OrthoView,
  type PlaneAxis,
  type MeshIssues,
  type PartFeature,
  type PartInfo,
  type MateAnchor,
} from '@/state/useAppStore';

const MODEL_COLOR = 0x9ca3af;
const MAX_HISTORY = 25;
const HISTORY_COALESCE_MS = 1200;
const SCALE_EPSILON = 1e-6;

function makeModelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: MODEL_COLOR,
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
}

function toTuple3(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

/** Deterministic orthonormal (U, V) basis perpendicular to `normal` — the same two axes every time for a given normal, so a Mate offset typed as "U=5" means the same physical direction before and after re-fitting. */
function planeBasisFromNormal(normal: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const n = normal.clone().normalize();
  const arbitrary = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(arbitrary, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return [u, v];
}

function cloneFeature(f: PartFeature): PartFeature {
  return { ...f, point: [...f.point] as [number, number, number], normal: [...f.normal] as [number, number, number] };
}

/** A hole cuts a cylindrical bore; only 'cylinder' and 'washer' primitives are round (a box isn't). */
function isCylindricalFeature(f: PartFeature): boolean {
  return f.type === 'hole' || (f.type === 'primitive' && (f.shape === 'cylinder' || f.shape === 'washer'));
}

const CYLINDER_SNAP_TOLERANCE_MM = 1.5;

/**
 * If `localPoint` (already converted into the part's own local frame) lies
 * near a hole/cylinder/washer feature's cylindrical wall, returns that
 * feature's true axis (its stored surface point + extrusion direction) and
 * effective diameter — so a Mate pick can snap to "the middle of this
 * hole/pin", not an arbitrary point on its wall, and a coaxial Smart Fit
 * has a diameter to compare. A washer picks whichever of its two walls
 * (inner bore vs outer rim) the click landed closer to. Returns null when
 * the point isn't close enough to any cylindrical feature.
 */
interface CylindricalSnapResult {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  diameterMM: number;
  /** The feature's own axial length (its Hole depth, or a primitive's height). */
  lengthMM: number;
}

function findCylindricalFeatureNear(
  features: PartFeature[],
  localPoint: THREE.Vector3,
  /** Restrict to Hole features only — used by Quick Chamfer/Counterbore, which only make sense at a hole's opening (not a solid boss/pin). */
  holesOnly = false,
): CylindricalSnapResult | null {
  let best: { distToWall: number; point: THREE.Vector3; normal: THREE.Vector3; diameterMM: number; lengthMM: number } | null = null;

  for (const f of features) {
    if (f.visible === false || !isCylindricalFeature(f)) continue;
    if (holesOnly && f.type !== 'hole') continue;
    const axisPoint = new THREE.Vector3(...f.point);
    const axisDir = new THREE.Vector3(...f.normal).normalize();
    const length = f.type === 'hole' ? f.depth : f.height;
    // Holes cut INTO the material (negative along normal from the surface
    // point); primitives extrude OUTWARD (positive) — see positionCutterAtSurface.
    const axisSign = f.type === 'hole' ? -1 : 1;
    const margin = 0.75; // a little slack past either end of the feature's own length

    const toPoint = localPoint.clone().sub(axisPoint);
    const alongAxis = toPoint.dot(axisDir);
    const withinAxialRange =
      axisSign < 0 ? alongAxis <= margin && alongAxis >= -length - margin : alongAxis >= -margin && alongAxis <= length + margin;
    if (!withinAxialRange) continue;

    const radialVec = toPoint.clone().sub(axisDir.clone().multiplyScalar(alongAxis));
    const radialDist = radialVec.length();

    const walls: number[] = [f.diameter];
    if (f.type === 'primitive' && f.shape === 'washer') walls.push(f.innerDiameter);
    for (const wallDiameter of walls) {
      const distToWall = Math.abs(radialDist - wallDiameter / 2);
      if (distToWall > CYLINDER_SNAP_TOLERANCE_MM) continue;
      if (!best || distToWall < best.distToWall) {
        best = { distToWall, point: axisPoint.clone(), normal: axisDir.clone(), diameterMM: wallDiameter, lengthMM: length };
      }
    }
  }

  return best ? { point: best.point, normal: best.normal, diameterMM: best.diameterMM, lengthMM: best.lengthMM } : null;
}

let partIdCounter = 0;
function generatePartId(): string {
  partIdCounter += 1;
  return `part-${Date.now()}-${partIdCounter}`;
}

let featureIdCounter = 0;
function generateFeatureId(): string {
  featureIdCounter += 1;
  return `feature-${Date.now()}-${featureIdCounter}`;
}


/**
 * Per-part authoring state, kept outside React/Zustand: a stable "base"
 * geometry (the imported shape, or the shape as of the last destructive
 * rebase — see commitScaleIfNeeded/mirror/repair below) plus an ordered
 * list of Hole/Primitive features composited on top of it. Every
 * point/normal in `features` and `localOrigin` lives in this SAME stable
 * local frame, so it stays correct no matter how the part's own mesh is
 * later moved, rotated, or scaled — CSG recompute never touches world
 * matrices at all (see rebuildCompositeGeometry).
 */
interface PartMeta {
  baseGeometry: THREE.BufferGeometry;
  features: PartFeature[];
  localOrigin: THREE.Vector3;
  lockToPlate: boolean;
  visible: boolean;
  locked: boolean;
}

interface HistoryMeshSnapshot {
  partId: string;
  partLabel: string;
  baseGeometry: THREE.BufferGeometry;
  features: PartFeature[];
  localOrigin: [number, number, number];
  lockToPlate: boolean;
  visible: boolean;
  locked: boolean;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

function freshPartMeta(baseGeometry: THREE.BufferGeometry): PartMeta {
  return { baseGeometry, features: [], localOrigin: new THREE.Vector3(0, 0, 0), lockToPlate: false, visible: true, locked: false };
}

interface HistorySnapshot {
  meshes: HistoryMeshSnapshot[];
  fileName: string | null;
  hasModel: boolean;
}

export default function Viewport3D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group>(new THREE.Group());
  const materialRef = useRef<THREE.MeshStandardMaterial>(makeModelMaterial());
  const boxHelperRef = useRef<THREE.Box3Helper | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const centerlineGroupRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const fileNameRef = useRef<string>('model.stl');
  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);
  const historyCoalesceKeyRef = useRef<string | null>(null);
  const historyCoalesceTimeRef = useRef(0);
  const datumMarkerRef = useRef<THREE.Object3D | null>(null);
  const pointMarkerRef = useRef<THREE.Object3D | null>(null);
  const measureLineRef = useRef<THREE.Line | null>(null);
  const partMetaRef = useRef<Map<string, PartMeta>>(new Map());
  const mateMarkerARef = useRef<THREE.Object3D | null>(null);
  const mateMarkerBRef = useRef<THREE.Object3D | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const gizmoSceneRef = useRef<THREE.Scene | null>(null);
  const gizmoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const plateGridRef = useRef<THREE.GridHelper | null>(null);
  const buildVolumeBoxRef = useRef<THREE.LineSegments | null>(null);

  // ---- part bookkeeping (each mesh carries userData.partId/partLabel) --
  const getAllPartMeshes = (): THREE.Mesh[] =>
    modelGroupRef.current.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

  const getPartMeshes = (partId: string): THREE.Mesh[] =>
    getAllPartMeshes().filter((m) => m.userData.partId === partId);

  const getPartLabel = (partId: string): string | null => {
    const mesh = getPartMeshes(partId)[0];
    return mesh ? (mesh.userData.partLabel as string) : null;
  };

  const getPartMeta = (partId: string): PartMeta | undefined => partMetaRef.current.get(partId);

  const getActivePartId = (): string | null => {
    const selected = useAppStore.getState().selectedPartId;
    if (selected && getPartMeshes(selected).length > 0) return selected;
    return getAllPartMeshes()[0]?.userData.partId ?? null;
  };

  const removePartMeshes = (partId: string) => {
    const group = modelGroupRef.current;
    [...group.children].forEach((child) => {
      if (child instanceof THREE.Mesh && child.userData.partId === partId) {
        group.remove(child);
        child.geometry.dispose();
      }
    });
  };

  const addPartMesh = (partId: string, label: string, mesh: THREE.Mesh) => {
    mesh.userData.partId = partId;
    mesh.userData.partLabel = label;
    const meta = getPartMeta(partId);
    mesh.visible = meta?.visible ?? true;
    modelGroupRef.current.add(mesh);
  };

  // ---- local <-> world conversions (a part's own mesh transform) ------
  const toLocalPoint = (mesh: THREE.Mesh, worldPoint: THREE.Vector3): THREE.Vector3 => {
    mesh.updateMatrixWorld(true);
    return mesh.worldToLocal(worldPoint.clone());
  };
  const toLocalNormal = (mesh: THREE.Mesh, worldNormal: THREE.Vector3): THREE.Vector3 => {
    mesh.updateMatrixWorld(true);
    const invQuat = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
    return worldNormal.clone().applyQuaternion(invQuat).normalize();
  };
  const toWorldPoint = (mesh: THREE.Mesh, localPoint: THREE.Vector3): THREE.Vector3 => {
    mesh.updateMatrixWorld(true);
    return mesh.localToWorld(localPoint.clone());
  };
  const toWorldNormal = (mesh: THREE.Mesh, localNormal: THREE.Vector3): THREE.Vector3 => {
    mesh.updateMatrixWorld(true);
    const quat = mesh.getWorldQuaternion(new THREE.Quaternion());
    return localNormal.clone().applyQuaternion(quat).normalize();
  };

  const syncPartFeaturesToStore = (partId: string) => {
    const meta = getPartMeta(partId);
    useAppStore.getState().setPartFeatures(partId, meta ? meta.features.map(cloneFeature) : []);
  };

  const updateSelectedPartPosition = () => {
    const partId = useAppStore.getState().selectedPartId;
    const mesh = partId ? getPartMeshes(partId)[0] : null;
    useAppStore.getState().setSelectedPartPosition(mesh ? (mesh.position.toArray() as [number, number, number]) : null);
  };

  /** Selected part's own bounding box drives the "Bounding Box" readout and Scale panel — not the whole scene. */
  const updateDimensions = () => {
    const scene = sceneRef.current;
    const partId = getActivePartId();
    const mesh = partId ? getPartMeshes(partId)[0] : null;
    if (!mesh) {
      useAppStore.getState().setDimensions({ x: 0, y: 0, z: 0 });
      if (scene && boxHelperRef.current) {
        scene.remove(boxHelperRef.current);
        boxHelperRef.current = null;
      }
      updateBuildVolumeWarning();
      refreshMateOffsetDisplay();
      return;
    }
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    useAppStore.getState().setDimensions({ x: size.x, y: size.y, z: size.z });

    if (scene) {
      if (boxHelperRef.current) scene.remove(boxHelperRef.current);
      const helper = new THREE.Box3Helper(box, new THREE.Color(0x3b82f6));
      helper.visible = useAppStore.getState().showBoundingBox;
      helper.name = 'BoundingBoxHelper';
      scene.add(helper);
      boxHelperRef.current = helper;
    }
    updateBuildVolumeWarning();
    refreshMateOffsetDisplay();
  };

  const updateParts = () => {
    const seen = new Map<string, string>();
    getAllPartMeshes().forEach((m) => {
      if (m.userData.partId) seen.set(m.userData.partId, m.userData.partLabel ?? m.userData.partId);
    });
    const parts: PartInfo[] = Array.from(seen.entries()).map(([id, label]) => {
      const meta = getPartMeta(id);
      const origin = meta?.localOrigin ?? new THREE.Vector3(0, 0, 0);
      return { id, label, localOrigin: toTuple3(origin), lockToPlate: meta?.lockToPlate ?? false, visible: meta?.visible ?? true, locked: meta?.locked ?? false };
    });
    useAppStore.getState().setParts(parts);
    seen.forEach((_, id) => syncPartFeaturesToStore(id));

    const currentSelected = useAppStore.getState().selectedPartId;
    if (!currentSelected || !seen.has(currentSelected)) {
      useAppStore.getState().setSelectedPartId(parts[0]?.id ?? null);
    }
    updateSelectedPartPosition();
    updateDimensions();
  };

  const clearPreview = () => {
    const scene = sceneRef.current;
    if (previewMeshRef.current && scene) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.geometry.dispose();
    }
    previewMeshRef.current = null;
  };

  const clearCenterlines = () => {
    const scene = sceneRef.current;
    if (centerlineGroupRef.current) {
      centerlineGroupRef.current.traverse((obj) => {
        if (obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      if (scene) scene.remove(centerlineGroupRef.current);
    }
    centerlineGroupRef.current = null;
  };

  /** Two dashed reference lines through the target part's own center, on the two axes NOT aligned with the click normal — shows how far off-center a hole/primitive placement is. */
  const showCenterlines = (mesh: THREE.Mesh, normal: THREE.Vector3) => {
    const scene = sceneRef.current;
    if (!scene) return;
    clearCenterlines();

    const box = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const margin = Math.max(size.x, size.y, size.z) * 0.15 + 2;

    const absN: Record<'x' | 'y' | 'z', number> = { x: Math.abs(normal.x), y: Math.abs(normal.y), z: Math.abs(normal.z) };
    const dominant = (['x', 'y', 'z'] as const).reduce((a, b) => (absN[a] >= absN[b] ? a : b));
    const axes = (['x', 'y', 'z'] as const).filter((a) => a !== dominant);

    const group = new THREE.Group();
    group.name = 'CenterlineOverlay';
    axes.forEach((axis) => {
      const half = size[axis] / 2 + margin;
      const a = center.clone();
      const b = center.clone();
      a[axis] -= half;
      b[axis] += half;
      const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
      const material = new THREE.LineDashedMaterial({
        color: 0x22d3ee,
        dashSize: 3,
        gapSize: 1.5,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 997;
      group.add(line);
    });

    scene.add(group);
    centerlineGroupRef.current = group;
  };

  const clearMateMarkers = () => {
    const scene = sceneRef.current;
    [mateMarkerARef, mateMarkerBRef].forEach((ref) => {
      if (ref.current && scene) scene.remove(ref.current);
      ref.current = null;
    });
  };

  /** `axisDirection` given (a snapped hole/boss pick) also draws a short centerline through the marker — the "you picked this feature's axis, not just a surface point" cue. */
  const showMateMarker = (which: 'a' | 'b', point: THREE.Vector3, axisDirection?: THREE.Vector3) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ref = which === 'a' ? mateMarkerARef : mateMarkerBRef;
    if (ref.current) scene.remove(ref.current);
    const color = which === 'a' ? 0x8b5cf6 : 0xf59e0b;
    const group = new THREE.Group();
    const marker = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 16), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    marker.position.copy(point);
    marker.renderOrder = 999;
    group.add(marker);
    if (axisDirection) {
      const half = axisDirection.clone().normalize().multiplyScalar(9);
      const lineGeom = new THREE.BufferGeometry().setFromPoints([point.clone().sub(half), point.clone().add(half)]);
      const line = new THREE.Line(lineGeom, new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 1, depthTest: false }));
      line.computeLineDistances();
      line.renderOrder = 998;
      group.add(line);
    }
    scene.add(group);
    ref.current = group;
  };

  /** Redraws both mate markers at their anchors' CURRENT world position — call after any fit/offset action that moves part B, so the markers keep showing where the two anchors actually are instead of going stale at their pre-fit spot. */
  const refreshMateMarkers = () => {
    const { a, b } = useAppStore.getState().mate;
    if (!a || !b) return;
    const meshA = getPartMeshes(a.partId)[0];
    const meshB = getPartMeshes(b.partId)[0];
    if (meshA) showMateMarker('a', toWorldPoint(meshA, new THREE.Vector3(...a.point)), a.isAxis ? toWorldNormal(meshA, new THREE.Vector3(...a.normal)) : undefined);
    if (meshB) showMateMarker('b', toWorldPoint(meshB, new THREE.Vector3(...b.point)), b.isAxis ? toWorldNormal(meshB, new THREE.Vector3(...b.normal)) : undefined);
  };

  const computeCenterOffset = (mesh: THREE.Mesh, worldPoint: THREE.Vector3): [number, number, number] => {
    const box = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    return toTuple3(worldPoint.clone().sub(center));
  };

  const computeLocalOffset = (mesh: THREE.Mesh, worldPoint: THREE.Vector3, localOrigin: THREE.Vector3): [number, number, number] => {
    const local = toLocalPoint(mesh, worldPoint);
    return toTuple3(local.sub(localOrigin));
  };

  const updatePlacementReadouts = (tool: 'hole' | 'primitive', mesh: THREE.Mesh, worldPoint: THREE.Vector3, partId: string) => {
    const meta = getPartMeta(partId);
    const centerOffset = computeCenterOffset(mesh, worldPoint);
    const localOffset = meta ? computeLocalOffset(mesh, worldPoint, meta.localOrigin) : null;
    if (tool === 'hole') useAppStore.getState().setHole({ centerOffset, localOffset });
    else useAppStore.getState().setPrimitive({ centerOffset, localOffset });
  };

  /** Resolves the current thread selection into render options tuned for the active printer profile. */
  const getThreadRenderOptions = (threadId: string | null, isInternal: boolean): ThreadRenderOptions => {
    const thread = findThreadStandard(threadId);
    if (!thread) return { thread: null };
    const state = useAppStore.getState();
    const profile = effectivePrinterProfile(findPrinterProfile(state.printerProfileId), state.nozzleOverrideMM);
    return {
      thread,
      resolution: recommendedThreadResolution(profile, thread.majorDiameterMM, thread.pitchMM),
      clearanceMM: isInternal ? profile.internalThreadClearanceMM : 0,
    };
  };

  /**
   * (Re)builds the build-plate grid and the printable-volume boundary box
   * to match the selected printer's working area, so the environment is
   * scaled to the machine — a Bambu A1 mini's 180mm plate looks and is
   * sized differently from a Voron 2.4's 350mm one. X/Y are centered on
   * the origin (matching the grid's existing convention); Z runs from the
   * plate (0) up to the machine's max height, matching "drop to build
   * plate" / Lock to Plate's Z=0 convention.
   */
  const rebuildPlateForProfile = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const profile = findPrinterProfile(useAppStore.getState().printerProfileId);
    const { x: volX, y: volY, z: volZ } = profile.buildVolumeMM;

    if (plateGridRef.current) {
      scene.remove(plateGridRef.current);
      plateGridRef.current.geometry.dispose();
      (plateGridRef.current.material as THREE.Material).dispose();
    }
    // A square grid covering the larger footprint dimension so a non-square
    // bed (e.g. Prusa MK4's 250x210) still shows full X/Y coverage.
    const gridSpan = Math.max(volX, volY);
    const divisions = Math.max(4, Math.round(gridSpan / 10)); // ~10mm squares
    const grid = new THREE.GridHelper(gridSpan, divisions, 0x343b49, 0x252a35);
    grid.rotateX(Math.PI / 2);
    scene.add(grid);
    plateGridRef.current = grid;

    if (buildVolumeBoxRef.current) {
      scene.remove(buildVolumeBoxRef.current);
      buildVolumeBoxRef.current.geometry.dispose();
      (buildVolumeBoxRef.current.material as THREE.Material).dispose();
    }
    const boxGeometry = new THREE.BoxGeometry(volX, volY, volZ);
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeometry),
      // Amber, matching the warning color used elsewhere once a part
      // exceeds this envelope — distinct from the grid and from the
      // selected-part bounding box (blue), and visible against both.
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    box.position.set(0, 0, volZ / 2); // base on the plate (Z=0), box extends up
    box.name = 'BuildVolumeBoundary';
    scene.add(box);
    buildVolumeBoxRef.current = box;
  };

  /** Combined bounding box of every visible part, for the build-volume fit check (not just the selected part). Checks actual plate position, not just overall size. */
  const updateBuildVolumeWarning = () => {
    const meshes = getAllPartMeshes().filter((m) => m.visible);
    if (meshes.length === 0) {
      useAppStore.getState().setBuildVolumeWarning(null);
      return;
    }
    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));
    const profile = findPrinterProfile(useAppStore.getState().printerProfileId);
    useAppStore.getState().setBuildVolumeWarning(
      computeBuildVolumeWarning(profile, {
        minX: box.min.x,
        maxX: box.max.x,
        minY: box.min.y,
        maxY: box.max.y,
        minZ: box.min.z,
        maxZ: box.max.z,
      }),
    );
  };

  /** Recomputes the Mate panel's live "offset B from A" (U, V) readout from actual mesh positions — called any time a part's transform could have changed while a mate is active. */
  const refreshMateOffsetDisplay = () => {
    const { a, b, stage, offsetUV } = useAppStore.getState().mate;
    const active = !!a && !!b && (stage === 'ready' || stage === 'edgeReady');
    if (!active) {
      if (offsetUV !== null) useAppStore.getState().setMate({ offsetUV: null });
      return;
    }
    const meshA = getPartMeshes(a!.partId)[0];
    const meshB = getPartMeshes(b!.partId)[0];
    if (!meshA || !meshB) return;
    const worldNormalA = toWorldNormal(meshA, new THREE.Vector3(...a!.normal));
    const [uAxis, vAxis] = planeBasisFromNormal(worldNormalA);
    const worldPointA = toWorldPoint(meshA, new THREE.Vector3(...a!.point));
    const worldPointB = toWorldPoint(meshB, new THREE.Vector3(...b!.point));
    const delta = worldPointB.clone().sub(worldPointA);
    useAppStore.getState().setMate({ offsetUV: [delta.dot(uAxis), delta.dot(vAxis)] });
  };

  const maybeSnap = (value: number): number => {
    const { snapToGrid, snapGridSizeMM } = useAppStore.getState();
    if (!snapToGrid || snapGridSizeMM <= 0) return value;
    return Math.round(value / snapGridSizeMM) * snapGridSizeMM;
  };

  const recordMeshIssues = (partId: string, partLabel: string, geometry: THREE.BufferGeometry) => {
    const result = validateGeometry(geometry);
    const entry: MeshIssues = {
      partId,
      partLabel,
      boundaryEdgeCount: result.boundaryEdgeCount,
      nonManifoldEdgeCount: result.nonManifoldEdgeCount,
      inconsistentWindingCount: result.inconsistentWindingCount,
      globallyInverted: result.globallyInverted,
      repairable: hasRepairableIssues(result),
    };
    const state = useAppStore.getState();
    if (hasUnrepairableIssues(result)) {
      useAppStore.getState().setMeshIssues([...state.meshIssues.filter((i) => i.partId !== partId), entry]);
    } else {
      useAppStore.getState().setMeshIssues(state.meshIssues.filter((i) => i.partId !== partId));
    }
  };

  /** Validates + auto-repairs winding on import; unfixable defects (holes, non-manifold) are just reported. */
  const validateAndAutoRepair = (geometry: THREE.BufferGeometry, partId: string, label: string): THREE.BufferGeometry => {
    const initial = validateGeometry(geometry);
    const fixed = hasRepairableIssues(initial) ? repairWindingConsistency(geometry) : geometry;
    recordMeshIssues(partId, label, fixed);
    return fixed;
  };

  /** Recomposites a part's base geometry + its feature list (in local space) and assigns the result to its mesh. */
  const rebuildPart = (partId: string) => {
    const meta = getPartMeta(partId);
    const mesh = getPartMeshes(partId)[0];
    if (!meta || !mesh) return;
    const compiled = rebuildCompositeGeometry(meta.baseGeometry, meta.features, getThreadRenderOptions, materialRef.current);
    mesh.geometry.dispose();
    mesh.geometry = compiled;
    syncPartFeaturesToStore(partId);
    updateDimensions();
  };

  /** Replaces a part's displayed (and optionally base) geometry directly — used by Mirror/Repair, which flatten the current shape rather than editing it as a feature. */
  const setPartGeometry = (partId: string, newGeometry: THREE.BufferGeometry, resetFeatures: boolean) => {
    const mesh = getPartMeshes(partId)[0];
    const meta = getPartMeta(partId);
    if (!mesh || !meta) return;
    mesh.geometry.dispose();
    mesh.geometry = newGeometry;
    if (resetFeatures) {
      meta.baseGeometry.dispose();
      meta.baseGeometry = newGeometry.clone();
      meta.features = [];
      syncPartFeaturesToStore(partId);
    }
  };

  /**
   * A new feature's diameter/depth are typed as real-world mm, but features
   * composite in the part's own LOCAL frame — correct only while the part's
   * live scale is 1:1. If the part has been scaled, bake that scale into the
   * base geometry first (folding any earlier features into the new base,
   * since they're no longer separable from the now-permanent scale change)
   * so a freshly-added feature's dimensions come out right in world space.
   */
  const commitScaleIfNeeded = (partId: string) => {
    const mesh = getPartMeshes(partId)[0];
    const meta = getPartMeta(partId);
    if (!mesh || !meta) return;
    const { x: sx, y: sy, z: sz } = mesh.scale;
    if (Math.abs(sx - 1) < SCALE_EPSILON && Math.abs(sy - 1) < SCALE_EPSILON && Math.abs(sz - 1) < SCALE_EPSILON) return;

    const baked = mesh.geometry.clone();
    baked.scale(sx, sy, sz);
    baked.computeVertexNormals();
    baked.computeBoundingBox();
    baked.computeBoundingSphere();

    mesh.geometry.dispose();
    mesh.geometry = baked;
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);

    meta.baseGeometry.dispose();
    meta.baseGeometry = baked.clone();
    meta.features = [];
    meta.localOrigin.set(0, 0, 0);
    syncPartFeaturesToStore(partId);
  };

  /** Merges a part's (usually single) meshes into one, for operations that still need a plain THREE.Mesh — Plane Cut only. */
  const getMergedPartMesh = (partId: string): THREE.Mesh | null => {
    const meshes = getPartMeshes(partId);
    if (meshes.length === 0) return null;
    let result = meshes[0];
    for (let i = 1; i < meshes.length; i++) {
      result = performCSG(result, meshes[i], ADDITION, materialRef.current);
    }
    return result;
  };

  /**
   * Splits a part into two independent parts along an axis-aligned plane —
   * shared by the Plane Cut tool and the Shapes toolbox's "split on create"
   * option. Assumes history has already been pushed by the caller.
   */
  const splitPart = (partId: string, axis: PlaneAxis, height: number): string | null => {
    const target = getMergedPartMesh(partId);
    if (!target) return null;
    const label = getPartLabel(partId) ?? 'Part';
    const { upper, lower } = planeCutMesh(target, axis, height, materialRef.current);
    upper.name = 'ModelPiece';
    lower.name = 'ModelPiece';

    removePartMeshes(partId);
    partMetaRef.current.delete(partId);

    const upperId = generatePartId();
    const lowerId = generatePartId();
    partMetaRef.current.set(upperId, freshPartMeta(upper.geometry.clone()));
    partMetaRef.current.set(lowerId, freshPartMeta(lower.geometry.clone()));
    addPartMesh(upperId, `${label} (upper)`, upper);
    addPartMesh(lowerId, `${label} (lower)`, lower);
    return upperId;
  };

  // ---- undo/redo history ---------------------------------------------
  const captureSnapshot = (): HistorySnapshot => ({
    meshes: getAllPartMeshes().map((m) => {
      const partId = m.userData.partId as string;
      const meta = getPartMeta(partId);
      return {
        partId,
        partLabel: m.userData.partLabel,
        baseGeometry: (meta?.baseGeometry ?? m.geometry).clone(),
        features: meta ? meta.features.map(cloneFeature) : [],
        localOrigin: meta ? toTuple3(meta.localOrigin) : [0, 0, 0],
        lockToPlate: meta?.lockToPlate ?? false,
        visible: meta?.visible ?? true,
        locked: meta?.locked ?? false,
        position: m.position.toArray() as [number, number, number],
        quaternion: m.quaternion.toArray() as [number, number, number, number],
        scale: m.scale.toArray() as [number, number, number],
      };
    }),
    fileName: useAppStore.getState().fileName,
    hasModel: useAppStore.getState().hasModel,
  });

  const restoreSnapshot = (snap: HistorySnapshot) => {
    const group = modelGroupRef.current;
    [...group.children].forEach((child) => {
      group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    partMetaRef.current.forEach((meta) => meta.baseGeometry.dispose());
    partMetaRef.current.clear();
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);

    snap.meshes.forEach((ms) => {
      const meta: PartMeta = {
        baseGeometry: ms.baseGeometry.clone(),
        features: ms.features.map(cloneFeature),
        localOrigin: new THREE.Vector3(...ms.localOrigin),
        lockToPlate: ms.lockToPlate,
        visible: ms.visible ?? true,
        locked: ms.locked ?? false,
      };
      partMetaRef.current.set(ms.partId, meta);
      const compiled = rebuildCompositeGeometry(meta.baseGeometry, meta.features, getThreadRenderOptions, materialRef.current);
      const mesh = new THREE.Mesh(compiled, materialRef.current);
      mesh.name = 'ModelPiece';
      mesh.position.fromArray(ms.position);
      mesh.quaternion.fromArray(ms.quaternion);
      mesh.scale.fromArray(ms.scale);
      addPartMesh(ms.partId, ms.partLabel, mesh);
    });
    clearPreview();
    clearCenterlines();
    useAppStore.getState().setFileName(snap.fileName);
    useAppStore.getState().setHasModel(snap.hasModel);
    useAppStore.getState().setSelectedFeatureId(null);
    updateParts();
    useAppStore.getState().setTransform({ scaleX: 100, scaleY: 100, scaleZ: 100 });
  };

  const syncUndoRedoFlags = () => {
    useAppStore.getState().setCanUndoRedo(undoStackRef.current.length > 0, redoStackRef.current.length > 0);
  };

  const pushHistory = () => {
    undoStackRef.current.push(captureSnapshot());
    if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
    redoStackRef.current = [];
    historyCoalesceKeyRef.current = null;
    syncUndoRedoFlags();
  };

  const pushHistoryCoalesced = (key: string) => {
    const now = Date.now();
    if (key !== historyCoalesceKeyRef.current || now - historyCoalesceTimeRef.current > HISTORY_COALESCE_MS) {
      undoStackRef.current.push(captureSnapshot());
      if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
      redoStackRef.current = [];
      syncUndoRedoFlags();
    }
    historyCoalesceKeyRef.current = key;
    historyCoalesceTimeRef.current = now;
  };

  const resetHistory = () => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    historyCoalesceKeyRef.current = null;
    syncUndoRedoFlags();
  };

  // ---- one-time scene setup -----------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111318);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    camera.position.set(120, -160, 120);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // Only middle-drag orbits (re-targeted to whatever's under the cursor
    // at mousedown, below); right still pans. Left is deliberately left
    // unbound here — it's reserved for tool click-to-place (Hole,
    // Primitive, Mate, Measure, origin-pick) and for dragging a
    // lock-to-plate part across the build plate (see onPointerDown/Move).
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controlsRef.current = controls;

    // Viewport drag handle for the selected part (Move tool only — see the
    // reactive attach/detach effect below). Translate-only: rotate/scale
    // stay in the Transform panel's numeric fields.
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.enabled = false;
    const transformControlsHelper = transformControls.getHelper();
    transformControlsHelper.visible = false;
    scene.add(transformControlsHelper);
    transformControlsRef.current = transformControls;

    transformControls.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value;
      if (event.value) {
        pushHistory();
      } else {
        updateDimensions();
        updateSelectedPartPosition();
      }
    });
    transformControls.addEventListener('objectChange', () => {
      const obj = transformControls.object;
      if (!obj) return;
      const partId = obj.userData.partId as string | undefined;
      const part = partId ? useAppStore.getState().parts.find((p) => p.id === partId) : undefined;
      if (part?.lockToPlate) {
        const box = new THREE.Box3().setFromObject(obj);
        obj.position.z -= box.min.z;
      }
      updateDimensions();
      updateSelectedPartPosition();
    });

    const hemi = new THREE.HemisphereLight(0xffffff, 0x1a1c22, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(150, -200, 300);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-150, 200, -100);
    scene.add(fill);

    rebuildPlateForProfile();

    const AXIS_LENGTH = 40;
    const axes = new THREE.AxesHelper(AXIS_LENGTH);
    scene.add(axes);

    // Label the tip of each world-axis line (X+/Y+/Z+) so the viewport's
    // orientation is legible without having to infer it from color alone.
    // Sprites always billboard to face the camera, and depthTest is off so
    // the labels stay readable even when a part is in front of the axis tip.
    const makeAxisLabelTexture = (text: string, colorHex: string): THREE.CanvasTexture => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(11,13,18,0.95)';
      ctx.strokeText(text, 64, 34);
      ctx.fillStyle = colorHex;
      ctx.fillText(text, 64, 34);
      return new THREE.CanvasTexture(canvas);
    };
    const makeAxisLabel = (text: string, colorHex: string, position: THREE.Vector3): THREE.Sprite => {
      const sprite = new THREE.Sprite(
        // sizeAttenuation: false keeps the label a constant size on screen
        // regardless of camera distance — a world-space scale would blow up
        // to fill the screen whenever a framing preset (e.g. Top) happens
        // to put the camera close to the label's position.
        new THREE.SpriteMaterial({ map: makeAxisLabelTexture(text, colorHex), depthTest: false, transparent: true, sizeAttenuation: false }),
      );
      sprite.scale.set(0.09, 0.045, 1);
      sprite.position.copy(position);
      sprite.renderOrder = 998;
      return sprite;
    };
    const axisLabels = new THREE.Group();
    axisLabels.add(makeAxisLabel('X+', '#ff3b3b', new THREE.Vector3(AXIS_LENGTH + 5, 0, 0)));
    axisLabels.add(makeAxisLabel('Y+', '#4ade80', new THREE.Vector3(0, AXIS_LENGTH + 5, 0)));
    axisLabels.add(makeAxisLabel('Z+', '#60a5fa', new THREE.Vector3(0, 0, AXIS_LENGTH + 5)));
    scene.add(axisLabels);

    scene.add(modelGroupRef.current);

    // ---- orientation trihedron: a rotating labeled cube (bottom-left) --
    // Same idea as a PC-DMIS-style orientation cube: a static cube sits in
    // its own mini scene, and the mini camera mirrors the main camera's
    // rotation every frame (see renderGizmo below) — visually identical to
    // the cube itself rotating with the view, but far simpler to keep in
    // sync than re-deriving the cube's own orientation each frame.
    const makeCubeFaceTexture = (label: string, bgHex: string, textHex: string, bold: boolean): THREE.CanvasTexture => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = bgHex;
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 124, 124);
      ctx.fillStyle = textHex;
      ctx.font = `${bold ? 'bold ' : ''}${bold ? 54 : 32}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 64, 68);
      return new THREE.CanvasTexture(canvas);
    };

    const faceMaterial = (label: string, bgHex: string, textHex: string, bold: boolean) =>
      new THREE.MeshBasicMaterial({ map: makeCubeFaceTexture(label, bgHex, textHex, bold) });

    // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
    const cubeMaterials = [
      faceMaterial('X', '#ef4444', '#0b0d12', true),
      faceMaterial('-X', '#7f1d1d', '#e5e7eb', false),
      faceMaterial('Y', '#22c55e', '#0b0d12', true),
      faceMaterial('-Y', '#14532d', '#e5e7eb', false),
      faceMaterial('Z', '#3b82f6', '#0b0d12', true),
      faceMaterial('-Z', '#1e3a8a', '#e5e7eb', false),
    ];
    const cubeGeometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const gizmoCube = new THREE.Mesh(cubeGeometry, cubeMaterials);
    const cubeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cubeGeometry),
      new THREE.LineBasicMaterial({ color: 0x0b0d12 }),
    );
    gizmoCube.add(cubeEdges);

    const gizmoScene = new THREE.Scene();
    gizmoScene.background = new THREE.Color(0x1a1d26);
    gizmoScene.add(gizmoCube);
    gizmoSceneRef.current = gizmoScene;

    const gizmoCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
    gizmoCameraRef.current = gizmoCamera;

    const GIZMO_SIZE = 108;
    const GIZMO_MARGIN = 14;
    const gizmoForward = new THREE.Vector3();
    const renderGizmo = () => {
      gizmoForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      gizmoCamera.position.copy(gizmoForward).multiplyScalar(-3);
      gizmoCamera.quaternion.copy(camera.quaternion);
      gizmoCamera.up.copy(camera.up);

      renderer.setScissorTest(true);
      renderer.setViewport(GIZMO_MARGIN, GIZMO_MARGIN, GIZMO_SIZE, GIZMO_SIZE);
      renderer.setScissor(GIZMO_MARGIN, GIZMO_MARGIN, GIZMO_SIZE, GIZMO_SIZE);
      renderer.clearDepth();
      renderer.render(gizmoScene, gizmoCamera);
      renderer.setScissorTest(false);
    };

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.setViewport(0, 0, container.clientWidth, container.clientHeight);
      renderer.render(scene, camera);
      renderGizmo();
    };
    animate();

    // ---- pointer interaction for hole / primitive / measure / origin-pick --
    const getIntersection = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycasterRef.current.setFromCamera(ndc, camera);
      // Three.js raycasting ignores `.visible` entirely, so a hidden part
      // (Parts panel eye toggle) would otherwise still catch clicks for
      // hole/primitive placement, dragging, origin-picking, and selection.
      const hits = raycasterRef.current.intersectObjects(getAllPartMeshes().filter((m) => m.visible), false);
      return hits[0] ?? null;
    };

    // Middle-click-drag should orbit around whatever's under the cursor,
    // not OrbitControls' existing (possibly far-away) target. Re-target on
    // mousedown, in the capture phase so this runs before OrbitControls'
    // own pointerdown handler reads controls.target to start its drag.
    const onMiddleClickRetarget = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault(); // stop the browser's middle-click autoscroll cursor
      const hit = getIntersection(event);
      if (hit) controls.target.copy(hit.point);
    };
    renderer.domElement.addEventListener('pointerdown', onMiddleClickRetarget, { capture: true });

    // ---- left-click-drag: slide a lock-to-plate part across the build --
    // plate directly (no need to grab the Move gizmo's arrows). Only
    // engages for parts with lockToPlate on, where the drag is unambiguous
    // (X/Y only, Z always stays pinned) — everything else needs the
    // gizmo/numeric fields, since a screen-space drag can't otherwise tell
    // which plane you mean to move a free part in.
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let draggingPartId: string | null = null;
    let dragStartGround: THREE.Vector3 | null = null;
    let dragStartPosition: THREE.Vector3 | null = null;
    const dragScratch = new THREE.Vector3();

    const beginPlateDrag = (event: PointerEvent): boolean => {
      const tool = useAppStore.getState().activeTool;
      if (event.button !== 0 || (tool !== 'select' && tool !== 'transform')) return false;
      if (transformControlsRef.current?.dragging) return false; // let the gizmo handle its own drag
      const hit = getIntersection(event);
      if (!hit) return false;
      const partId = hit.object.userData.partId as string | undefined;
      if (!partId) return false;
      const part = useAppStore.getState().parts.find((p) => p.id === partId);
      if (!part?.lockToPlate || part.locked) return false;

      const mesh = hit.object as THREE.Mesh;
      const ground = new THREE.Vector3();
      if (!raycasterRef.current.ray.intersectPlane(dragPlane, ground)) return false;

      pushHistory();
      draggingPartId = partId;
      dragStartGround = ground;
      dragStartPosition = mesh.position.clone();
      useAppStore.getState().setSelectedPartId(partId);
      updateSelectedPartPosition();
      updateDimensions();
      return true;
    };

    const updateCutterPreview = (point: THREE.Vector3, normal: THREE.Vector3) => {
      const tool = useAppStore.getState().activeTool;
      const scene = sceneRef.current;
      if (!scene) return;

      if (tool === 'hole') {
        const { diameter, depth, threadId } = useAppStore.getState().hole;
        if (!previewMeshRef.current || previewMeshRef.current.name !== 'HoleCutterPreview') {
          clearPreview();
          previewMeshRef.current = createHoleCutterMesh(diameter, depth, getThreadRenderOptions(threadId, true));
          scene.add(previewMeshRef.current);
        }
        positionCutterAtSurface(previewMeshRef.current, point, normal, depth, 'subtract');
      } else if (tool === 'primitive') {
        const p = useAppStore.getState().primitive;
        if (!previewMeshRef.current || previewMeshRef.current.name !== 'PrimitivePreview') {
          clearPreview();
          previewMeshRef.current = createPrimitiveMesh(p.shape, p, getThreadRenderOptions(p.threadId, p.operation === 'subtract'));
          scene.add(previewMeshRef.current);
        }
        positionCutterAtSurface(previewMeshRef.current, point, normal, p.height, p.operation === 'subtract' ? 'subtract' : 'union');
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (draggingPartId && dragStartGround && dragStartPosition) {
        const rect = renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycasterRef.current.setFromCamera(ndc, camera);
        if (raycasterRef.current.ray.intersectPlane(dragPlane, dragScratch)) {
          const mesh = getPartMeshes(draggingPartId)[0];
          if (mesh) {
            const delta = dragScratch.clone().sub(dragStartGround);
            mesh.position.set(dragStartPosition.x + delta.x, dragStartPosition.y + delta.y, dragStartPosition.z);
            updateDimensions();
            updateSelectedPartPosition();
          }
        }
        return;
      }

      const tool = useAppStore.getState().activeTool;
      if (tool !== 'hole' && tool !== 'primitive') return;
      const placed = tool === 'hole' ? useAppStore.getState().hole.placed : useAppStore.getState().primitive.placed;
      if (placed) return;

      const hit = getIntersection(event);
      if (!hit || !hit.face) return;
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      updateCutterPreview(hit.point, worldNormal);
      const partId = (hit.object.userData.partId as string) ?? null;
      const hitMesh = hit.object as THREE.Mesh;

      if (partId) showCenterlines(hitMesh, worldNormal);

      if (tool === 'hole') {
        useAppStore.getState().setHole({
          point: [hit.point.x, hit.point.y, hit.point.z],
          normal: [worldNormal.x, worldNormal.y, worldNormal.z],
          targetPartId: partId,
        });
      } else {
        useAppStore.getState().setPrimitive({
          point: [hit.point.x, hit.point.y, hit.point.z],
          normal: [worldNormal.x, worldNormal.y, worldNormal.z],
          targetPartId: partId,
        });
      }
      if (partId) updatePlacementReadouts(tool, hitMesh, hit.point, partId);
    };

    const onPointerDown = (event: PointerEvent) => {
      const { pickingOrigin, pickingOriginPartId } = useAppStore.getState();
      if (pickingOrigin && pickingOriginPartId) {
        const hit = getIntersection(event);
        if (hit && hit.object.userData.partId === pickingOriginPartId) {
          const mesh = hit.object as THREE.Mesh;
          const meta = getPartMeta(pickingOriginPartId);
          if (meta) {
            meta.localOrigin.copy(toLocalPoint(mesh, hit.point));
            updateParts();
          }
        }
        useAppStore.getState().setPickingOrigin(false, null);
        return;
      }

      const tool = useAppStore.getState().activeTool;
      if (tool === 'measure') {
        const hit = getIntersection(event);
        if (!hit) return;
        const { datum } = useAppStore.getState().measure;
        if (!datum) {
          useAppStore.getState().setMeasure({ datum: [hit.point.x, hit.point.y, hit.point.z], point: null });
        } else {
          useAppStore.getState().setMeasure({ point: [hit.point.x, hit.point.y, hit.point.z] });
        }
        return;
      }

      if (tool === 'mate') {
        const hit = getIntersection(event);
        if (!hit || !hit.face) return;
        const partId = hit.object.userData.partId as string | undefined;
        if (!partId) return;
        const mesh = hit.object as THREE.Mesh;
        const worldNormal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
        const state = useAppStore.getState().mate;
        const localPoint = toLocalPoint(mesh, hit.point);
        const meta = getPartMeta(partId);
        const cylSnap = meta ? findCylindricalFeatureNear(meta.features, localPoint) : null;

        const makeAnchor = (): MateAnchor =>
          cylSnap
            ? { partId, point: toTuple3(cylSnap.point), normal: toTuple3(cylSnap.normal), isAxis: true, diameterMM: cylSnap.diameterMM }
            : { partId, point: toTuple3(localPoint), normal: toTuple3(toLocalNormal(mesh, worldNormal)) };

        const markerAxis = cylSnap ? toWorldNormal(mesh, cylSnap.normal) : undefined;

        if (state.stage === 'pickA') {
          useAppStore.getState().setMate({ a: makeAnchor(), stage: 'pickB' });
          showMateMarker('a', cylSnap ? toWorldPoint(mesh, cylSnap.point) : hit.point, markerAxis);
        } else if (state.stage === 'pickB') {
          if (partId === state.a?.partId) return; // must mate to a different part
          useAppStore.getState().setMate({ b: makeAnchor(), stage: 'ready' });
          showMateMarker('b', cylSnap ? toWorldPoint(mesh, cylSnap.point) : hit.point, markerAxis);
        } else if (state.stage === 'pickEdgeA') {
          if (partId !== state.a?.partId) return;
          useAppStore.getState().setMate({ edgeA: toTuple3(localPoint), stage: 'pickEdgeB' });
          showMateMarker('a', hit.point);
        } else if (state.stage === 'pickEdgeB') {
          if (partId !== state.b?.partId) return;
          useAppStore.getState().setMate({ edgeB: toTuple3(localPoint), stage: 'edgeReady' });
          showMateMarker('b', hit.point);
        } else if (state.stage === 'pickPairA') {
          if (partId !== state.a?.partId) return;
          const pairPoint = cylSnap ? cylSnap.point : localPoint;
          useAppStore.getState().setMate({ extraPairsA: [...state.extraPairsA, toTuple3(pairPoint)], stage: 'pickPairB' });
          showMateMarker('a', cylSnap ? toWorldPoint(mesh, cylSnap.point) : hit.point, markerAxis);
        } else if (state.stage === 'pickPairB') {
          if (partId !== state.b?.partId) return;
          const pairPoint = cylSnap ? cylSnap.point : localPoint;
          useAppStore.getState().setMate({ extraPairsB: [...state.extraPairsB, toTuple3(pairPoint)], stage: 'ready' });
          showMateMarker('b', cylSnap ? toWorldPoint(mesh, cylSnap.point) : hit.point, markerAxis);
        }
        return;
      }

      if (tool === 'chamfer' || tool === 'counterbore') {
        const cylHit = getIntersection(event);
        if (!cylHit) return;
        const partId = cylHit.object.userData.partId as string | undefined;
        if (!partId) return;
        const mesh = cylHit.object as THREE.Mesh;
        const meta = getPartMeta(partId);
        const snap = meta ? findCylindricalFeatureNear(meta.features, toLocalPoint(mesh, cylHit.point), true) : null;
        if (!snap) return; // no hole found close enough to the click — do nothing (see the panel's instructions)

        const worldPoint = toWorldPoint(mesh, snap.point);
        const worldNormal = toWorldNormal(mesh, snap.normal);
        const common = {
          operation: 'subtract' as const,
          threadId: null,
          point: toTuple3(worldPoint),
          normal: toTuple3(worldNormal),
          targetPartId: partId,
          placed: true,
          editingFeatureId: null,
          referenceHoleDiameterMM: snap.diameterMM,
        };

        if (tool === 'counterbore') {
          // A bit wider than the hole (room for a screw head) and no deeper
          // than roughly half the hole itself, so a shallow/blind hole
          // doesn't get counterbored all the way through.
          const diameter = Math.round(snap.diameterMM * 1.6 * 10) / 10;
          const depthCap = Math.max(1, snap.lengthMM * 0.5);
          const height = Math.round(Math.min(4, depthCap) * 10) / 10;
          useAppStore.getState().setPrimitive({ ...common, shape: 'cylinder', diameter, height });
        } else {
          // Inner diameter matches the hole exactly (a clean blend, no
          // step); depth is set so the diameter difference forms a 45°
          // bevel by construction (radius delta == depth).
          const innerDiameter = snap.diameterMM;
          const outerDiameter = Math.round((innerDiameter + 2) * 10) / 10;
          const height = Math.round(((outerDiameter - innerDiameter) / 2) * 10) / 10;
          useAppStore.getState().setPrimitive({ ...common, shape: 'chamfer', diameter: outerDiameter, innerDiameter, height });
        }

        updatePlacementReadouts('primitive', mesh, worldPoint, partId);
        useAppStore.getState().setActiveTool('primitive');
        return;
      }

      if (tool !== 'hole' && tool !== 'primitive') {
        beginPlateDrag(event);
        return;
      }
      const hit = getIntersection(event);
      if (!hit || !hit.face) return;

      if (tool === 'hole') {
        useAppStore.getState().setHole({ placed: true });
      } else {
        useAppStore.getState().setPrimitive({ placed: true });
      }
    };

    const onPointerUp = () => {
      draggingPartId = null;
      dragStartGround = null;
      dragStartPosition = null;
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);

    // ---- keyboard shortcuts --------------------------------------------
    const onKeyDown = (event: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) viewportActionsRef.current?.redo();
        else viewportActionsRef.current?.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        viewportActionsRef.current?.redo();
        return;
      }
      if (!useAppStore.getState().hasModel) return;
      if (event.key === '1') viewportActionsRef.current?.setOrthoView('top');
      else if (event.key === '2') viewportActionsRef.current?.setOrthoView('front');
      else if (event.key === '3') viewportActionsRef.current?.setOrthoView('side');
      else if (event.key === '4') viewportActionsRef.current?.setOrthoView('iso');
      else if (event.key.toLowerCase() === 'w') useAppStore.getState().setWireframe(!useAppStore.getState().wireframe);
      else if (event.key.toLowerCase() === 'b') useAppStore.getState().setShowBoundingBox(!useAppStore.getState().showBoundingBox);
    };
    window.addEventListener('keydown', onKeyDown);

    // Ref indirection so the keydown handler (registered once) always calls
    // the latest set of actions, since setViewportActions below replaces
    // the object registered in the store but this closure only runs once.
    const viewportActionsRef: { current: import('@/state/useAppStore').ViewportActions | null } = { current: null };

    // ---- register imperative actions consumed by Toolbar/Sidebar ------
    const actions: import('@/state/useAppStore').ViewportActions = {
      loadSTL: (data, name) => {
        const loader = new STLLoader();
        let geometry = loader.parse(data);
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingBox();

        [...modelGroupRef.current.children].forEach((child) => {
          modelGroupRef.current.remove(child);
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        partMetaRef.current.forEach((meta) => meta.baseGeometry.dispose());
        partMetaRef.current.clear();
        useAppStore.getState().setMeshIssues([]);
        useAppStore.getState().setPickingOrigin(false, null);
        resetHistory();

        const partId = generatePartId();
        geometry = validateAndAutoRepair(geometry, partId, name);
        partMetaRef.current.set(partId, freshPartMeta(geometry.clone()));

        const mesh = new THREE.Mesh(geometry, materialRef.current);
        mesh.name = 'ModelPiece';
        addPartMesh(partId, name, mesh);

        const box = new THREE.Box3().setFromObject(mesh);
        mesh.position.set(0, 0, -box.min.z); // drop to build plate
        clearPreview();

        fileNameRef.current = name;
        useAppStore.getState().setFileName(name);
        useAppStore.getState().setHasModel(true);
        useAppStore.getState().setTransform({ scaleX: 100, scaleY: 100, scaleZ: 100 });
        useAppStore.getState().setSelectedPartId(partId);
        updateParts();

        const fitBox = new THREE.Box3().setFromObject(modelGroupRef.current);
        const fitSize = new THREE.Vector3();
        fitBox.getSize(fitSize);
        const maxDim = Math.max(fitSize.x, fitSize.y, fitSize.z, 10);
        camera.position.set(maxDim * 1.1, -maxDim * 1.5, maxDim * 1.1);
        controls.target.set(0, 0, fitSize.z / 2);
        controls.update();
      },

      importAdditionalPart: (data, name) => {
        if (modelGroupRef.current.children.length === 0) {
          actions.loadSTL(data, name);
          return;
        }
        const loader = new STLLoader();
        let geometry = loader.parse(data);
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingBox();

        pushHistory();

        const partId = generatePartId();
        geometry = validateAndAutoRepair(geometry, partId, name);
        partMetaRef.current.set(partId, freshPartMeta(geometry.clone()));

        const newSize = new THREE.Vector3();
        geometry.boundingBox!.getSize(newSize);
        const existingBox = new THREE.Box3().setFromObject(modelGroupRef.current);
        const gap = 10;
        const offsetX = existingBox.max.x + gap + newSize.x / 2;
        const offsetZ = newSize.z / 2; // drop to build plate

        const mesh = new THREE.Mesh(geometry, materialRef.current);
        mesh.name = 'ModelPiece';
        mesh.position.set(offsetX, 0, offsetZ);
        addPartMesh(partId, name, mesh);

        useAppStore.getState().setSelectedPartId(partId);
        updateParts();
        useAppStore.getState().setActiveTool('select');
      },

      newModel: () => {
        [...modelGroupRef.current.children].forEach((child) => {
          modelGroupRef.current.remove(child);
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        partMetaRef.current.forEach((meta) => meta.baseGeometry.dispose());
        partMetaRef.current.clear();
        modelGroupRef.current.position.set(0, 0, 0);
        modelGroupRef.current.rotation.set(0, 0, 0);
        modelGroupRef.current.scale.set(1, 1, 1);
        clearPreview();
        clearCenterlines();
        resetHistory();
        useAppStore.getState().setMeshIssues([]);
        useAppStore.getState().setPickingOrigin(false, null);
        useAppStore.getState().setSelectedFeatureId(null);
        useAppStore.getState().setFileName(null);
        useAppStore.getState().setHasModel(false);
        useAppStore.getState().setActiveTool('select');
        useAppStore.getState().setTransform({ scaleX: 100, scaleY: 100, scaleZ: 100 });
        updateParts();
      },

      exportSTL: () => {
        const group = modelGroupRef.current;
        if (group.children.length === 0) return;
        const exporter = new STLExporter();
        const result = exporter.parse(group, { binary: true }) as unknown as DataView;
        const buffer = (result as unknown as ArrayBufferView).buffer.slice(0) as ArrayBuffer;

        const suggested = fileNameRef.current.replace(/\.stl$/i, '') + '-modified.stl';
        const bridge = (window as unknown as { stitchMesh?: { saveSTL: (b: ArrayBuffer, n: string) => Promise<string | null> } }).stitchMesh;
        if (bridge) {
          bridge.saveSTL(buffer, suggested);
        } else {
          const blob = new Blob([buffer], { type: 'model/stl' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = suggested;
          a.click();
          URL.revokeObjectURL(url);
        }
      },

      setOrthoView: (view: OrthoView) => {
        const box = new THREE.Box3().setFromObject(modelGroupRef.current);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const dist = Math.max(size.x, size.y, size.z, 10) * 2;

        controls.target.copy(center);
        if (view === 'top') camera.position.set(center.x, center.y, center.z + dist);
        if (view === 'front') camera.position.set(center.x, center.y - dist, center.z);
        if (view === 'side') camera.position.set(center.x + dist, center.y, center.z);
        if (view === 'iso') camera.position.set(center.x + dist * 0.7, center.y - dist * 0.7, center.z + dist * 0.7);
        camera.up.set(0, 0, 1);
        controls.update();
      },

      setWireframe: (on) => {
        materialRef.current.wireframe = on;
      },

      setFlatShading: (on) => {
        materialRef.current.flatShading = on;
        materialRef.current.needsUpdate = true;
      },

      applyScale: (x, y, z) => {
        const meta = getPartMeta(getActivePartId() ?? '');
        if (meta?.locked) return;
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const mesh = getPartMeshes(activePartId)[0];
        if (!mesh) return;
        pushHistoryCoalesced('scale-' + activePartId);
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const base = new THREE.Vector3();
        mesh.geometry.boundingBox!.getSize(base);
        mesh.scale.set(x / Math.max(base.x, 1e-6), y / Math.max(base.y, 1e-6), z / Math.max(base.z, 1e-6));
        updateDimensions();
      },

      rotateBy: (axis, degrees) => {
        const meta = getPartMeta(getActivePartId() ?? '');
        if (meta?.locked) return;
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const mesh = getPartMeshes(activePartId)[0];
        if (!mesh) return;
        pushHistory();
        const rad = THREE.MathUtils.degToRad(degrees);
        mesh.rotation[axis] += rad;
        mesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.position.z -= box.min.z;
        updateDimensions();
      },

      centerToOrigin: () => {
        const meta = getPartMeta(getActivePartId() ?? '');
        if (meta?.locked) return;
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const mesh = getPartMeshes(activePartId)[0];
        if (!mesh) return;
        pushHistory();
        const box = new THREE.Box3().setFromObject(mesh);
        const center = new THREE.Vector3();
        box.getCenter(center);
        mesh.position.sub(center);
        updateDimensions();
      },

      dropToBuildPlate: () => {
        const meta = getPartMeta(getActivePartId() ?? '');
        if (meta?.locked) return;
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const mesh = getPartMeshes(activePartId)[0];
        if (!mesh) return;
        pushHistory();
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.position.z -= box.min.z;
        updateDimensions();
      },

      mirror: (axis: PlaneAxis) => {
        const meta = getPartMeta(getActivePartId() ?? '');
        if (meta?.locked) return;
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const mesh = getPartMeshes(activePartId)[0];
        if (!mesh) return;
        pushHistory();
        const mirrored = mirrorGeometry(mesh.geometry, axis);
        setPartGeometry(activePartId, mirrored, true);
        updateDimensions();
      },

      applyHoleSubtract: () => {
        const { diameter, depth, point, normal, threadId, targetPartId, editingFeatureId } = useAppStore.getState().hole;
        const partId = targetPartId ?? getActivePartId();
        if (!partId || !point || !normal) return;
        const mesh = getPartMeshes(partId)[0];
        const meta = getPartMeta(partId);
        if (!mesh || !meta || meta.locked) return;

        pushHistory();

        if (editingFeatureId) {
          const idx = meta.features.findIndex((f) => f.id === editingFeatureId);
          if (idx === -1) return;
          if (meta.features[idx].locked) return;
          const localPoint = toLocalPoint(mesh, new THREE.Vector3(...point));
          const localNormal = toLocalNormal(mesh, new THREE.Vector3(...normal));
          meta.features[idx] = { ...meta.features[idx], diameter, depth, threadId, point: toTuple3(localPoint), normal: toTuple3(localNormal) };
        } else {
          commitScaleIfNeeded(partId);
          const localPoint = toLocalPoint(mesh, new THREE.Vector3(...point));
          const localNormal = toLocalNormal(mesh, new THREE.Vector3(...normal));
          const holeCount = meta.features.filter((f) => f.type === 'hole').length + 1;
          meta.features.push({
            id: generateFeatureId(),
            type: 'hole',
            label: `Hole ${holeCount}`,
            locked: false,
            visible: true,
            point: toTuple3(localPoint),
            normal: toTuple3(localNormal),
            diameter,
            depth,
            threadId,
            shape: 'cylinder',
            operation: 'subtract',
            width: 0,
            height: depth,
            innerDiameter: 0,
          });
        }

        rebuildPart(partId);
        clearPreview();
        useAppStore.getState().resetHole();
        useAppStore.getState().setSelectedFeatureId(null);
        useAppStore.getState().setActiveTool('select');
      },

      cancelHolePlacement: () => {
        clearPreview();
        useAppStore.getState().resetHole();
        useAppStore.getState().setSelectedFeatureId(null);
      },

      applyPrimitive: () => {
        const p = useAppStore.getState().primitive;
        const partId = p.targetPartId ?? getActivePartId();
        if (!partId || !p.point || !p.normal) return;
        const mesh = getPartMeshes(partId)[0];
        const meta = getPartMeta(partId);
        if (!mesh || !meta || meta.locked) return;

        pushHistory();

        if (p.editingFeatureId) {
          const idx = meta.features.findIndex((f) => f.id === p.editingFeatureId);
          if (idx === -1) return;
          if (meta.features[idx].locked) return;
          const localPoint = toLocalPoint(mesh, new THREE.Vector3(...p.point));
          const localNormal = toLocalNormal(mesh, new THREE.Vector3(...p.normal));
          meta.features[idx] = {
            ...meta.features[idx],
            diameter: p.diameter,
            depth: p.depth,
            height: p.height,
            width: p.width,
            innerDiameter: p.innerDiameter,
            threadId: p.threadId,
            shape: p.shape,
            operation: p.operation,
            point: toTuple3(localPoint),
            normal: toTuple3(localNormal),
          };
        } else {
          commitScaleIfNeeded(partId);
          const localPoint = toLocalPoint(mesh, new THREE.Vector3(...p.point));
          const localNormal = toLocalNormal(mesh, new THREE.Vector3(...p.normal));
          const count = meta.features.filter((f) => f.type === 'primitive').length + 1;
          meta.features.push({
            id: generateFeatureId(),
            type: 'primitive',
            label: `${p.operation === 'union' ? 'Add' : 'Cut'} ${p.shape} ${count}`,
            locked: false,
            visible: true,
            point: toTuple3(localPoint),
            normal: toTuple3(localNormal),
            diameter: p.diameter,
            depth: p.depth,
            threadId: p.threadId,
            shape: p.shape,
            operation: p.operation,
            width: p.width,
            height: p.height,
            innerDiameter: p.innerDiameter,
          });
        }

        rebuildPart(partId);
        clearPreview();
        useAppStore.getState().resetPrimitivePlacement();
        useAppStore.getState().setSelectedFeatureId(null);
        useAppStore.getState().setActiveTool('select');
      },

      cancelPrimitivePlacement: () => {
        clearPreview();
        useAppStore.getState().resetPrimitivePlacement();
        useAppStore.getState().setSelectedFeatureId(null);
      },

      applyPlaneCut: () => {
        const { axis, height } = useAppStore.getState().planeCut;
        const activePartId = getActivePartId();
        if (!activePartId) return;

        pushHistory();
        // Split into two independently selectable/movable parts, rather
        // than one part with two co-located meshes — otherwise there's no
        // way to actually separate the pieces afterward (see Move tool).
        const upperId = splitPart(activePartId, axis, height);
        if (!upperId) return;

        updateParts();
        useAppStore.getState().setSelectedPartId(upperId);
        updateDimensions();
        useAppStore.getState().setActiveTool('select');
      },

      centerPlaneCutHeight: (axis) => {
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const meshes = getPartMeshes(activePartId);
        if (meshes.length === 0) return;
        const box = new THREE.Box3();
        meshes.forEach((m) => box.union(new THREE.Box3().setFromObject(m)));
        const center = new THREE.Vector3();
        box.getCenter(center);
        useAppStore.getState().setPlaneCut({ height: center[axis] });
      },

      selectPart: (partId) => {
        useAppStore.getState().setSelectedPartId(partId);
        updateSelectedPartPosition();
        updateDimensions();
      },

      movePartTo: (partId, x, y, z) => {
        if (getPartMeta(partId)?.locked) return;
        const meshes = getPartMeshes(partId);
        if (meshes.length === 0) return;
        pushHistoryCoalesced('move-' + partId);
        const sx = maybeSnap(x);
        const sy = maybeSnap(y);
        const sz = maybeSnap(z);
        // A part can be made of multiple meshes (rare after this session's
        // design, but keep it correct): move them together as a rigid group
        // by applying the same delta to each.
        const anchor = meshes[0].position.clone();
        const delta = new THREE.Vector3(sx, sy, sz).sub(anchor);
        meshes.forEach((m) => m.position.add(delta));
        updateDimensions();
        updateSelectedPartPosition();
      },

      nudgePart: (partId, axis, deltaMM) => {
        if (getPartMeta(partId)?.locked) return;
        const meshes = getPartMeshes(partId);
        if (meshes.length === 0) return;
        pushHistory();
        meshes.forEach((m) => {
          m.position[axis] += deltaMM;
        });
        updateDimensions();
        updateSelectedPartPosition();
      },

      clearMeasure: () => {
        useAppStore.getState().setMeasure({ datum: null, point: null });
      },

      repairSelectedPart: () => {
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const mesh = getPartMeshes(activePartId)[0];
        if (!mesh) return;
        pushHistory();
        const repaired = repairWindingConsistency(mesh.geometry);
        setPartGeometry(activePartId, repaired, true);
        recordMeshIssues(activePartId, getPartLabel(activePartId) ?? 'Model', repaired);
        updateDimensions();
      },

      undo: () => {
        if (undoStackRef.current.length === 0) return;
        redoStackRef.current.push(captureSnapshot());
        const prev = undoStackRef.current.pop()!;
        restoreSnapshot(prev);
        historyCoalesceKeyRef.current = null;
        syncUndoRedoFlags();
      },

      redo: () => {
        if (redoStackRef.current.length === 0) return;
        undoStackRef.current.push(captureSnapshot());
        const next = redoStackRef.current.pop()!;
        restoreSnapshot(next);
        historyCoalesceKeyRef.current = null;
        syncUndoRedoFlags();
      },

      setHoleOffset: (axis, value) => {
        const { targetPartId, point, normal } = useAppStore.getState().hole;
        if (!targetPartId || !point) return;
        const mesh = getPartMeshes(targetPartId)[0];
        const meta = getPartMeta(targetPartId);
        if (!mesh || !meta) return;
        const currentLocal = toLocalPoint(mesh, new THREE.Vector3(...point));
        currentLocal[axis] = meta.localOrigin[axis] + value;
        const worldPoint = toWorldPoint(mesh, currentLocal);
        useAppStore.getState().setHole({ point: toTuple3(worldPoint) });
        updatePlacementReadouts('hole', mesh, worldPoint, targetPartId);
        const n = normal ? new THREE.Vector3(...normal) : new THREE.Vector3(0, 0, 1);
        updateCutterPreview(worldPoint, n);
        showCenterlines(mesh, n);
      },

      setPrimitiveOffset: (axis, value) => {
        const { targetPartId, point, normal } = useAppStore.getState().primitive;
        if (!targetPartId || !point) return;
        const mesh = getPartMeshes(targetPartId)[0];
        const meta = getPartMeta(targetPartId);
        if (!mesh || !meta) return;
        const currentLocal = toLocalPoint(mesh, new THREE.Vector3(...point));
        currentLocal[axis] = meta.localOrigin[axis] + value;
        const worldPoint = toWorldPoint(mesh, currentLocal);
        useAppStore.getState().setPrimitive({ point: toTuple3(worldPoint) });
        updatePlacementReadouts('primitive', mesh, worldPoint, targetPartId);
        const n = normal ? new THREE.Vector3(...normal) : new THREE.Vector3(0, 0, 1);
        updateCutterPreview(worldPoint, n);
        showCenterlines(mesh, n);
      },

      editFeature: (partId, featureId) => {
        const meta = getPartMeta(partId);
        const mesh = getPartMeshes(partId)[0];
        const feature = meta?.features.find((f) => f.id === featureId);
        if (!meta || !mesh || !feature) return;

        const worldPoint = toWorldPoint(mesh, new THREE.Vector3(...feature.point));
        const worldNormal = toWorldNormal(mesh, new THREE.Vector3(...feature.normal));

        clearPreview();
        useAppStore.getState().setSelectedFeatureId(featureId);

        if (feature.type === 'hole') {
          useAppStore.getState().setActiveTool('hole');
          useAppStore.getState().setHole({
            placed: true,
            diameter: feature.diameter,
            depth: feature.depth,
            threadId: feature.threadId,
            point: toTuple3(worldPoint),
            normal: toTuple3(worldNormal),
            targetPartId: partId,
            editingFeatureId: featureId,
            locked: feature.locked,
          });
        } else {
          useAppStore.getState().setActiveTool('primitive');
          useAppStore.getState().setPrimitive({
            placed: true,
            shape: feature.shape,
            operation: feature.operation,
            width: feature.width,
            depth: feature.depth,
            height: feature.height,
            diameter: feature.diameter,
            innerDiameter: feature.innerDiameter,
            threadId: feature.threadId,
            point: toTuple3(worldPoint),
            normal: toTuple3(worldNormal),
            targetPartId: partId,
            editingFeatureId: featureId,
            locked: feature.locked,
          });
        }

        updateCutterPreview(worldPoint, worldNormal);
        showCenterlines(mesh, worldNormal);
        updatePlacementReadouts(feature.type, mesh, worldPoint, partId);
      },

      cancelEditFeature: () => {
        clearPreview();
        clearCenterlines();
        useAppStore.getState().resetHole();
        useAppStore.getState().resetPrimitivePlacement();
        useAppStore.getState().setSelectedFeatureId(null);
        useAppStore.getState().setActiveTool('select');
      },

      deleteFeature: (partId, featureId) => {
        const meta = getPartMeta(partId);
        if (!meta) return;
        pushHistory();
        meta.features = meta.features.filter((f) => f.id !== featureId);
        rebuildPart(partId);
        if (useAppStore.getState().selectedFeatureId === featureId) {
          useAppStore.getState().setSelectedFeatureId(null);
          if (useAppStore.getState().activeTool === 'hole' || useAppStore.getState().activeTool === 'primitive') {
            actions.cancelEditFeature();
          }
        }
      },

      toggleFeatureLock: (partId, featureId) => {
        const meta = getPartMeta(partId);
        const feature = meta?.features.find((f) => f.id === featureId);
        if (!meta || !feature) return;
        pushHistory();
        feature.locked = !feature.locked;
        syncPartFeaturesToStore(partId);
        if (useAppStore.getState().selectedFeatureId === featureId) {
          if (useAppStore.getState().activeTool === 'hole') useAppStore.getState().setHole({ locked: feature.locked });
          if (useAppStore.getState().activeTool === 'primitive') useAppStore.getState().setPrimitive({ locked: feature.locked });
        }
      },

      beginPickLocalOrigin: (partId) => {
        useAppStore.getState().setPickingOrigin(true, partId);
      },

      cancelPickLocalOrigin: () => {
        useAppStore.getState().setPickingOrigin(false, null);
      },

      resetLocalOrigin: (partId) => {
        const meta = getPartMeta(partId);
        if (!meta) return;
        meta.localOrigin.set(0, 0, 0);
        updateParts();
      },

      setLocalOrigin: (partId, x, y, z) => {
        const meta = getPartMeta(partId);
        if (!meta) return;
        meta.localOrigin.set(x, y, z);
        updateParts();
      },

      setPartVisible: (partId, visible) => {
        const meta = getPartMeta(partId);
        if (!meta) return;
        meta.visible = visible;
        getPartMeshes(partId).forEach((m) => { m.visible = visible; });
        updateParts();
      },

      setPartLocked: (partId, locked) => {
        const meta = getPartMeta(partId);
        if (!meta) return;
        meta.locked = locked;
        updateParts();
      },

      renamePart: (partId, label) => {
        const next = label.trim();
        if (!next) return;
        pushHistory();
        getPartMeshes(partId).forEach((m) => { m.userData.partLabel = next; });
        updateParts();
      },

      duplicatePart: (partId) => {
        const source = getPartMeshes(partId)[0];
        const meta = getPartMeta(partId);
        if (!source || !meta) return;
        pushHistory();
        const newId = generatePartId();
        const geometry = source.geometry.clone();
        const mesh = new THREE.Mesh(geometry, materialRef.current);
        mesh.name = 'ModelPiece';
        mesh.position.copy(source.position);
        mesh.quaternion.copy(source.quaternion);
        mesh.scale.copy(source.scale);
        const labelBase = String(source.userData.partLabel ?? 'Part');
        const existing = getAllPartMeshes().filter((m) => String(m.userData.partLabel ?? '').startsWith(labelBase)).length;
        const label = `${labelBase} copy${existing > 1 ? ` ${existing}` : ''}`;
        partMetaRef.current.set(newId, {
          baseGeometry: meta.baseGeometry.clone(),
          features: meta.features.map(cloneFeature),
          localOrigin: meta.localOrigin.clone(),
          lockToPlate: meta.lockToPlate,
          visible: meta.visible,
          locked: false,
        });
        mesh.position.x += 10;
        mesh.userData.partId = newId;
        mesh.userData.partLabel = label;
        mesh.visible = meta.visible;
        modelGroupRef.current.add(mesh);
        useAppStore.getState().setSelectedPartId(newId);
        updateParts();
      },

      deletePart: (partId) => {
        const meshes = getPartMeshes(partId);
        if (meshes.length === 0) return;
        pushHistory();
        removePartMeshes(partId);
        const meta = getPartMeta(partId);
        meta?.baseGeometry.dispose();
        partMetaRef.current.delete(partId);
        const remaining = getAllPartMeshes();
        useAppStore.getState().setSelectedPartId(remaining[0]?.userData.partId ?? null);
        if (remaining.length === 0) {
          useAppStore.getState().setHasModel(false);
          useAppStore.getState().setFileName(null);
        }
        updateParts();
      },

      isolatePart: (partId) => {
        partMetaRef.current.forEach((meta, id) => { meta.visible = id === partId; });
        getAllPartMeshes().forEach((m) => { m.visible = m.userData.partId === partId; });
        useAppStore.getState().setSelectedPartId(partId);
        updateParts();
      },

      showAllParts: () => {
        partMetaRef.current.forEach((meta) => { meta.visible = true; });
        getAllPartMeshes().forEach((m) => { m.visible = true; });
        updateParts();
      },

      renameFeature: (partId, featureId, label) => {
        const meta = getPartMeta(partId);
        const feature = meta?.features.find((f) => f.id === featureId);
        const next = label.trim();
        if (!feature || !next) return;
        pushHistory();
        feature.label = next;
        syncPartFeaturesToStore(partId);
      },

      setFeatureVisible: (partId, featureId, visible) => {
        const meta = getPartMeta(partId);
        const feature = meta?.features.find((f) => f.id === featureId);
        if (!feature) return;
        pushHistory();
        feature.visible = visible;
        rebuildPart(partId);
      },

      focusFeature: (partId, featureId) => {
        const meta = getPartMeta(partId);
        if (!meta) return;
        const feature = meta.features.find((f) => f.id === featureId);
        if (!feature) return;
        meta.visible = true;
        getAllPartMeshes().forEach((m) => { m.visible = m.userData.partId === partId; });
        useAppStore.getState().setSelectedPartId(partId);
        viewportActionsRef.current?.editFeature(partId, featureId);
        updateParts();
      },

      setLockToPlate: (partId, locked) => {
        const meta = getPartMeta(partId);
        const mesh = getPartMeshes(partId)[0];
        if (!meta) return;
        meta.lockToPlate = locked;
        if (locked && mesh) {
          const box = new THREE.Box3().setFromObject(mesh);
          mesh.position.z -= box.min.z;
          updateDimensions();
        }
        updateParts();
      },

      addBasicShape: () => {
        const s = useAppStore.getState().shapeTool;
        const geometry = createBasicShapeGeometry(s.shape, s);
        geometry.center();
        geometry.computeBoundingBox();

        const isFirst = modelGroupRef.current.children.length === 0;
        if (isFirst) resetHistory();
        else pushHistory();

        const partId = generatePartId();
        partMetaRef.current.set(partId, freshPartMeta(geometry.clone()));

        const mesh = new THREE.Mesh(geometry, materialRef.current);
        mesh.name = 'ModelPiece';

        if (isFirst) {
          const box = new THREE.Box3().setFromObject(mesh);
          mesh.position.set(0, 0, -box.min.z);
        } else {
          const newSize = new THREE.Vector3();
          geometry.boundingBox!.getSize(newSize);
          const existingBox = new THREE.Box3().setFromObject(modelGroupRef.current);
          const offsetX = existingBox.max.x + 10 + newSize.x / 2;
          mesh.position.set(offsetX, 0, newSize.z / 2);
        }
        const shapeName = BASIC_SHAPE_LABELS[s.shape];
        const priorCount = getAllPartMeshes().filter((m) => (m.userData.partLabel as string)?.startsWith(shapeName + ' ')).length;
        addPartMesh(partId, `${shapeName} ${priorCount + 1}`, mesh);

        let finalPartId = partId;
        if (s.splitOnCreate) {
          const meshBox = new THREE.Box3().setFromObject(mesh);
          const center = new THREE.Vector3();
          meshBox.getCenter(center);
          const upperId = splitPart(partId, s.splitAxis, center[s.splitAxis]);
          if (upperId) finalPartId = upperId;
        }

        if (!useAppStore.getState().fileName) {
          useAppStore.getState().setFileName('Shapes');
          fileNameRef.current = 'shapes.stl';
        }
        useAppStore.getState().setHasModel(true);
        useAppStore.getState().setSelectedPartId(finalPartId);
        updateParts();
        useAppStore.getState().setActiveTool('select');
      },

      cancelMate: () => {
        clearMateMarkers();
        useAppStore.getState().setMate({ stage: 'pickA', a: null, b: null, fitted: false, edgeA: null, edgeB: null });
      },

      applyMateFit: () => {
        const { a, b } = useAppStore.getState().mate;
        if (!a || !b) return;
        const meshA = getPartMeshes(a.partId)[0];
        const meshB = getPartMeshes(b.partId)[0];
        if (!meshA || !meshB) return;

        pushHistory();

        // Rotate B so its picked face points opposite A's, then slide B
        // along A's normal only, until the two face planes touch — this
        // preserves wherever B ended up in the other two (in-plane)
        // directions, which Flush Edge (below) can then align precisely.
        const worldNormalA = toWorldNormal(meshA, new THREE.Vector3(...a.normal));
        const worldNormalB = toWorldNormal(meshB, new THREE.Vector3(...b.normal));
        const targetNormalB = worldNormalA.clone().negate();
        const rotQuat = new THREE.Quaternion().setFromUnitVectors(worldNormalB, targetNormalB);
        meshB.quaternion.premultiply(rotQuat);
        meshB.updateMatrixWorld(true);

        const worldPointA = toWorldPoint(meshA, new THREE.Vector3(...a.point));
        const worldPointBAfterRotate = toWorldPoint(meshB, new THREE.Vector3(...b.point));
        const signedDistance = worldPointBAfterRotate.clone().sub(worldPointA).dot(worldNormalA);
        meshB.position.addScaledVector(worldNormalA, -signedDistance);
        meshB.updateMatrixWorld(true);

        updateDimensions();
        updateSelectedPartPosition();
        refreshMateMarkers();
        useAppStore.getState().setMate({ fitted: true });
      },

      applyFlushEdge: () => {
        const { a, b, edgeA, edgeB } = useAppStore.getState().mate;
        if (!a || !b || !edgeA || !edgeB) return;
        const meshA = getPartMeshes(a.partId)[0];
        const meshB = getPartMeshes(b.partId)[0];
        if (!meshA || !meshB) return;

        pushHistory();

        // Slide B within the mated plane only (never along A's normal,
        // which would break the flush contact Fit already established).
        const worldNormalA = toWorldNormal(meshA, new THREE.Vector3(...a.normal));
        const worldEdgeA = toWorldPoint(meshA, new THREE.Vector3(...edgeA));
        const worldEdgeB = toWorldPoint(meshB, new THREE.Vector3(...edgeB));
        const delta = worldEdgeA.clone().sub(worldEdgeB);
        const inPlaneDelta = delta.clone().sub(worldNormalA.clone().multiplyScalar(delta.dot(worldNormalA)));
        meshB.position.add(inPlaneDelta);
        meshB.updateMatrixWorld(true);

        updateDimensions();
        updateSelectedPartPosition();
        clearMateMarkers();
        useAppStore.getState().setMate({ stage: 'ready', edgeA: null, edgeB: null });
      },

      setMateOffsetU: (mm) => {
        const { a, b, offsetUV } = useAppStore.getState().mate;
        if (!a || !b || !offsetUV) return;
        const meshA = getPartMeshes(a.partId)[0];
        const meshB = getPartMeshes(b.partId)[0];
        if (!meshA || !meshB) return;
        pushHistoryCoalesced('mate-offset-u');
        const worldNormalA = toWorldNormal(meshA, new THREE.Vector3(...a.normal));
        const [uAxis] = planeBasisFromNormal(worldNormalA);
        meshB.position.addScaledVector(uAxis, mm - offsetUV[0]);
        meshB.updateMatrixWorld(true);
        updateDimensions();
        updateSelectedPartPosition();
        refreshMateMarkers();
      },

      setMateOffsetV: (mm) => {
        const { a, b, offsetUV } = useAppStore.getState().mate;
        if (!a || !b || !offsetUV) return;
        const meshA = getPartMeshes(a.partId)[0];
        const meshB = getPartMeshes(b.partId)[0];
        if (!meshA || !meshB) return;
        pushHistoryCoalesced('mate-offset-v');
        const worldNormalA = toWorldNormal(meshA, new THREE.Vector3(...a.normal));
        const [, vAxis] = planeBasisFromNormal(worldNormalA);
        meshB.position.addScaledVector(vAxis, mm - offsetUV[1]);
        meshB.updateMatrixWorld(true);
        updateDimensions();
        updateSelectedPartPosition();
        refreshMateMarkers();
      },

      beginPairPick: () => {
        const { a, b } = useAppStore.getState().mate;
        if (!a || !b) return;
        useAppStore.getState().setMate({ stage: 'pickPairA' });
      },

      removeLastPair: () => {
        const { extraPairsA, extraPairsB } = useAppStore.getState().mate;
        useAppStore.getState().setMate({ extraPairsA: extraPairsA.slice(0, -1), extraPairsB: extraPairsB.slice(0, -1) });
      },

      applyBestFit: () => {
        const { a, b, extraPairsA, extraPairsB } = useAppStore.getState().mate;
        if (!a || !b) return;
        const meshA = getPartMeshes(a.partId)[0];
        const meshB = getPartMeshes(b.partId)[0];
        if (!meshA || !meshB) return;
        // The initial anchor pick always counts as pair #1; extraPairsA/B add more.
        const pairsA = [a.point, ...extraPairsA];
        const pairsB = [b.point, ...extraPairsB];
        if (pairsA.length < 3) return; // need 3+ total to solve a full rigid transform from points alone

        // Kabsch solves in one shared space — bring both parts' LOCAL pick
        // points into A's CURRENT world frame (not B's, since B is the one
        // about to move) before fitting.
        const worldPairsA: Vec3[] = pairsA.map((p) => toWorldPoint(meshA, new THREE.Vector3(...p)).toArray() as Vec3);
        const worldPairsB: Vec3[] = pairsB.map((p) => toWorldPoint(meshB, new THREE.Vector3(...p)).toArray() as Vec3);

        const fit = kabschFit(worldPairsA, worldPairsB);
        if (!fit) return; // collinear pick points — rotation genuinely underdetermined, refuse rather than guess

        pushHistory();

        const rotMatrix = new THREE.Matrix4().set(
          fit.rotation[0][0], fit.rotation[0][1], fit.rotation[0][2], 0,
          fit.rotation[1][0], fit.rotation[1][1], fit.rotation[1][2], 0,
          fit.rotation[2][0], fit.rotation[2][1], fit.rotation[2][2], 0,
          0, 0, 0, 1,
        );
        const rotQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

        // kabschFit solved for the rigid transform that maps B's CURRENT
        // world-space pick points onto A's — i.e. an additional transform
        // to apply on top of B's existing world matrix (new_world_point =
        // R*old_world_point + t), not a replacement for it. Composing it
        // that way (rather than overwriting position/quaternion outright)
        // is what keeps B's existing scale intact.
        meshB.updateMatrixWorld(true);
        const fitMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(...fit.translation),
          rotQuat,
          new THREE.Vector3(1, 1, 1),
        );
        const newMatrix = fitMatrix.multiply(meshB.matrix);
        newMatrix.decompose(meshB.position, meshB.quaternion, meshB.scale);
        meshB.updateMatrixWorld(true);

        updateDimensions();
        updateSelectedPartPosition();
        refreshMateMarkers();
        useAppStore.getState().setMate({ fitted: true, stage: 'ready' });
      },

      applyAxisFit: () => {
        const { a, b } = useAppStore.getState().mate;
        if (!a || !b || !a.isAxis || !b.isAxis) return;
        const meshA = getPartMeshes(a.partId)[0];
        const meshB = getPartMeshes(b.partId)[0];
        if (!meshA || !meshB) return;

        pushHistory();

        const worldAxisA = toWorldNormal(meshA, new THREE.Vector3(...a.normal)).normalize();
        const worldAxisB = toWorldNormal(meshB, new THREE.Vector3(...b.normal)).normalize();
        // Only the shared LINE matters for coaxial alignment, not which way
        // each feature's normal happens to point — pick whichever sign
        // needs the smaller rotation from B's current orientation, so a
        // Smart Fit never flips the part further than necessary.
        const targetDir = worldAxisB.dot(worldAxisA) >= 0 ? worldAxisA.clone() : worldAxisA.clone().negate();
        const rotQuat = new THREE.Quaternion().setFromUnitVectors(worldAxisB, targetDir);
        meshB.quaternion.premultiply(rotQuat);
        meshB.updateMatrixWorld(true);

        // Bring the axes into coincidence (radially) while leaving B's
        // position along that shared axis exactly where it was — how far a
        // pin is inserted into a hole is a real choice, not something to
        // silently reset to zero.
        const worldPointA = toWorldPoint(meshA, new THREE.Vector3(...a.point));
        const worldPointB = toWorldPoint(meshB, new THREE.Vector3(...b.point));
        const toA = worldPointA.clone().sub(worldPointB);
        const alongAxis = toA.dot(targetDir);
        const radialCorrection = toA.clone().sub(targetDir.clone().multiplyScalar(alongAxis));
        meshB.position.add(radialCorrection);
        meshB.updateMatrixWorld(true);

        updateDimensions();
        updateSelectedPartPosition();
        refreshMateMarkers();
        useAppStore.getState().setMate({ fitted: true });
      },

      weldMatedParts: () => {
        const { a, b } = useAppStore.getState().mate;
        if (!a || !b) return;
        const meshA = getPartMeshes(a.partId)[0];
        const meshB = getPartMeshes(b.partId)[0];
        if (!meshA || !meshB) return;

        pushHistory();
        const labelA = getPartLabel(a.partId) ?? 'Part';
        const labelB = getPartLabel(b.partId) ?? 'Part';
        const merged = performCSG(meshA, meshB, ADDITION, materialRef.current);
        merged.name = 'ModelPiece';

        removePartMeshes(a.partId);
        removePartMeshes(b.partId);
        partMetaRef.current.delete(a.partId);
        partMetaRef.current.delete(b.partId);

        const newId = generatePartId();
        partMetaRef.current.set(newId, freshPartMeta(merged.geometry.clone()));
        addPartMesh(newId, `${labelA} + ${labelB}`, merged);

        clearMateMarkers();
        useAppStore.getState().setMate({ stage: 'pickA', a: null, b: null, fitted: false, edgeA: null, edgeB: null });
        updateParts();
        useAppStore.getState().setSelectedPartId(newId);
        updateDimensions();
        useAppStore.getState().setActiveTool('select');
      },
    };

    viewportActionsRef.current = actions;
    useAppStore.getState().setViewportActions(actions);

    // ---- measurement markers -------------------------------------------
    const clearMeasureMarkers = () => {
      [datumMarkerRef, pointMarkerRef].forEach((ref) => {
        if (ref.current) {
          scene.remove(ref.current);
          ref.current = null;
        }
      });
      if (measureLineRef.current) {
        scene.remove(measureLineRef.current);
        measureLineRef.current.geometry.dispose();
        measureLineRef.current = null;
      }
    };
    const makeMarker = (color: number) =>
      new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 16), new THREE.MeshBasicMaterial({ color, depthTest: false }));

    const measureUnsub = useAppStore.subscribe((state, prev) => {
      if (state.measure === prev.measure) return;
      clearMeasureMarkers();
      if (state.measure.datum) {
        const marker = makeMarker(0x22c55e);
        marker.position.set(...state.measure.datum);
        marker.renderOrder = 999;
        scene.add(marker);
        datumMarkerRef.current = marker;
      }
      if (state.measure.point) {
        const marker = makeMarker(0xf59e0b);
        marker.position.set(...state.measure.point);
        marker.renderOrder = 999;
        scene.add(marker);
        pointMarkerRef.current = marker;
      }
      if (state.measure.datum && state.measure.point) {
        const lineGeom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...state.measure.datum),
          new THREE.Vector3(...state.measure.point),
        ]);
        const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
        line.renderOrder = 998;
        scene.add(line);
        measureLineRef.current = line;
      }
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerdown', onMiddleClickRetarget, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
      measureUnsub();
      clearMeasureMarkers();
      clearMateMarkers();
      transformControls.dispose();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      useAppStore.getState().setViewportActions(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- reactive: bounding box visibility -----------------------------
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.showBoundingBox !== prev.showBoundingBox && boxHelperRef.current) {
        boxHelperRef.current.visible = state.showBoundingBox;
      }
    });
    return unsub;
  }, []);

  // ---- reactive: rescale the plate grid + build-volume box, and re-check
  // the current scene against it, whenever the printer selection changes --
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.printerProfileId === prev.printerProfileId) return;
      rebuildPlateForProfile();
      updateBuildVolumeWarning();
    });
    return unsub;
  }, []);

  // ---- reactive: live cutter preview size + centerline cleanup on tool switch --
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      if (state.activeTool !== 'mate') clearMateMarkers();
      if (state.activeTool !== 'hole' && state.activeTool !== 'primitive') {
        clearCenterlines();
        return;
      }
      const preview = previewMeshRef.current;
      if (!preview) return;
      if (state.activeTool === 'hole' && state.hole.placed && preview.name === 'HoleCutterPreview') {
        const scene = sceneRef.current;
        if (!scene) return;
        const point = state.hole.point ? new THREE.Vector3(...state.hole.point) : preview.position.clone();
        const normal = state.hole.normal ? new THREE.Vector3(...state.hole.normal) : new THREE.Vector3(0, 0, 1);
        scene.remove(preview);
        preview.geometry.dispose();
        const fresh = createHoleCutterMesh(state.hole.diameter, state.hole.depth, getThreadRenderOptions(state.hole.threadId, true));
        positionCutterAtSurface(fresh, point, normal, state.hole.depth, 'subtract');
        scene.add(fresh);
        previewMeshRef.current = fresh;
      } else if (state.activeTool === 'primitive' && state.primitive.placed && preview.name === 'PrimitivePreview') {
        const scene = sceneRef.current;
        if (!scene) return;
        const point = state.primitive.point ? new THREE.Vector3(...state.primitive.point) : preview.position.clone();
        const normal = state.primitive.normal ? new THREE.Vector3(...state.primitive.normal) : new THREE.Vector3(0, 0, 1);
        scene.remove(preview);
        preview.geometry.dispose();
        const fresh = createPrimitiveMesh(
          state.primitive.shape,
          state.primitive,
          getThreadRenderOptions(state.primitive.threadId, state.primitive.operation === 'subtract'),
        );
        positionCutterAtSurface(fresh, point, normal, state.primitive.height, state.primitive.operation === 'subtract' ? 'subtract' : 'union');
        scene.add(fresh);
        previewMeshRef.current = fresh;
      }
    });
    return unsub;
  }, []);

  // ---- reactive: attach/detach the viewport drag gizmo to the selected part --
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.selectedPartId === prev.selectedPartId && state.activeTool === prev.activeTool && state.parts === prev.parts) return;
      const tc = transformControlsRef.current;
      if (!tc) return;

      if (state.activeTool === 'transform' && state.selectedPartId) {
        const part = state.parts.find((p) => p.id === state.selectedPartId);
        const mesh = getPartMeshes(state.selectedPartId)[0];
        if (mesh && !part?.locked) {
          tc.attach(mesh);
          tc.getHelper().visible = true;
          tc.enabled = true;
          tc.showZ = !part?.lockToPlate;
          return;
        }
      }
      tc.getHelper().visible = false;
      tc.enabled = false;
      tc.detach();
    });
    return unsub;
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
