import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
import { findThreadStandard } from '@/utils/threadStandards';
import { findPrinterProfile, recommendedThreadResolution } from '@/utils/printerProfiles';
import { validateGeometry, repairWindingConsistency, mirrorGeometry, hasRepairableIssues, hasUnrepairableIssues } from '@/utils/meshRepair';
import {
  useAppStore,
  type OrthoView,
  type PlaneAxis,
  type MeshIssues,
  type PartFeature,
  type PartInfo,
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

function cloneFeature(f: PartFeature): PartFeature {
  return { ...f, point: [...f.point] as [number, number, number], normal: [...f.normal] as [number, number, number] };
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
}

interface HistoryMeshSnapshot {
  partId: string;
  partLabel: string;
  baseGeometry: THREE.BufferGeometry;
  features: PartFeature[];
  localOrigin: [number, number, number];
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
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
  };

  const updateParts = () => {
    const seen = new Map<string, string>();
    getAllPartMeshes().forEach((m) => {
      if (m.userData.partId) seen.set(m.userData.partId, m.userData.partLabel ?? m.userData.partId);
    });
    const parts: PartInfo[] = Array.from(seen.entries()).map(([id, label]) => {
      const origin = getPartMeta(id)?.localOrigin ?? new THREE.Vector3(0, 0, 0);
      return { id, label, localOrigin: toTuple3(origin) };
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
    const profile = findPrinterProfile(useAppStore.getState().printerProfileId);
    return {
      thread,
      resolution: recommendedThreadResolution(profile, thread.majorDiameterMM, thread.pitchMM),
      clearanceMM: isInternal ? profile.internalThreadClearanceMM : 0,
    };
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
    // Middle-drag orbits (re-targeted to whatever's under the cursor at
    // mousedown, below); left keeps its default rotate too, right still pans.
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x1a1c22, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(150, -200, 300);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-150, 200, -100);
    scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, 0x343b49, 0x252a35);
    grid.rotateX(Math.PI / 2);
    scene.add(grid);

    const axes = new THREE.AxesHelper(40);
    scene.add(axes);

    scene.add(modelGroupRef.current);

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
      renderer.render(scene, camera);
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
      const hits = raycasterRef.current.intersectObjects(getAllPartMeshes(), false);
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
      if (tool !== 'hole' && tool !== 'primitive') return;
      const hit = getIntersection(event);
      if (!hit || !hit.face) return;

      if (tool === 'hole') {
        useAppStore.getState().setHole({ placed: true });
      } else {
        useAppStore.getState().setPrimitive({ placed: true });
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

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
        partMetaRef.current.set(partId, { baseGeometry: geometry.clone(), features: [], localOrigin: new THREE.Vector3(0, 0, 0) });

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
        partMetaRef.current.set(partId, { baseGeometry: geometry.clone(), features: [], localOrigin: new THREE.Vector3(0, 0, 0) });

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
        if (!mesh || !meta) return;

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
        if (!mesh || !meta) return;

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
        const target = getMergedPartMesh(activePartId);
        if (!target) return;

        pushHistory();
        const label = getPartLabel(activePartId) ?? 'Model';
        const { upper, lower } = planeCutMesh(target, axis, height, materialRef.current);
        upper.name = 'ModelPiece';
        lower.name = 'ModelPiece';

        // Split into two independently selectable/movable parts, rather
        // than one part with two co-located meshes — otherwise there's no
        // way to actually separate the pieces afterward (see Move tool).
        removePartMeshes(activePartId);
        partMetaRef.current.delete(activePartId);

        const upperId = generatePartId();
        const lowerId = generatePartId();
        partMetaRef.current.set(upperId, { baseGeometry: upper.geometry.clone(), features: [], localOrigin: new THREE.Vector3(0, 0, 0) });
        partMetaRef.current.set(lowerId, { baseGeometry: lower.geometry.clone(), features: [], localOrigin: new THREE.Vector3(0, 0, 0) });
        addPartMesh(upperId, `${label} (upper)`, upper);
        addPartMesh(lowerId, `${label} (lower)`, lower);

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
      renderer.domElement.removeEventListener('pointerdown', onMiddleClickRetarget, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
      measureUnsub();
      clearMeasureMarkers();
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

  // ---- reactive: live cutter preview size + centerline cleanup on tool switch --
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
