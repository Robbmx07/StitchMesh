import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import {
  ADDITION,
  SUBTRACTION,
  createHoleCutterMesh,
  createPrimitiveMesh,
  performCSG,
  planeCutMesh,
  positionCutterAtSurface,
  type ThreadRenderOptions,
} from '@/utils/csgOperations';
import { findThreadStandard } from '@/utils/threadStandards';
import { findPrinterProfile, recommendedThreadResolution } from '@/utils/printerProfiles';
import { validateGeometry, repairWindingConsistency, mirrorGeometry, hasRepairableIssues, hasUnrepairableIssues } from '@/utils/meshRepair';
import { useAppStore, type OrthoView, type PlaneAxis, type MeshIssues } from '@/state/useAppStore';

const MODEL_COLOR = 0x9ca3af;
const MAX_HISTORY = 25;
const HISTORY_COALESCE_MS = 1200;

function makeModelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: MODEL_COLOR,
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
}

let partIdCounter = 0;
function generatePartId(): string {
  partIdCounter += 1;
  return `part-${Date.now()}-${partIdCounter}`;
}

interface HistoryMeshSnapshot {
  partId: string;
  partLabel: string;
  geometry: THREE.BufferGeometry;
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
  const baseSizeRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));
  const boxHelperRef = useRef<THREE.Box3Helper | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const fileNameRef = useRef<string>('model.stl');
  const undoStackRef = useRef<HistorySnapshot[]>([]);
  const redoStackRef = useRef<HistorySnapshot[]>([]);
  const historyCoalesceKeyRef = useRef<string | null>(null);
  const historyCoalesceTimeRef = useRef(0);
  const datumMarkerRef = useRef<THREE.Object3D | null>(null);
  const pointMarkerRef = useRef<THREE.Object3D | null>(null);
  const measureLineRef = useRef<THREE.Line | null>(null);

  // ---- part bookkeeping (each mesh carries userData.partId/partLabel) --
  const getAllPartMeshes = (): THREE.Mesh[] =>
    modelGroupRef.current.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

  const getPartMeshes = (partId: string): THREE.Mesh[] =>
    getAllPartMeshes().filter((m) => m.userData.partId === partId);

  const getPartLabel = (partId: string): string | null => {
    const mesh = getPartMeshes(partId)[0];
    return mesh ? (mesh.userData.partLabel as string) : null;
  };

  const updateSelectedPartPosition = () => {
    const partId = useAppStore.getState().selectedPartId;
    const mesh = partId ? getPartMeshes(partId)[0] : null;
    useAppStore.getState().setSelectedPartPosition(mesh ? (mesh.position.toArray() as [number, number, number]) : null);
  };

  const updateParts = () => {
    const seen = new Map<string, string>();
    getAllPartMeshes().forEach((m) => {
      if (m.userData.partId) seen.set(m.userData.partId, m.userData.partLabel ?? m.userData.partId);
    });
    const parts = Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
    useAppStore.getState().setParts(parts);
    const currentSelected = useAppStore.getState().selectedPartId;
    if (!currentSelected || !seen.has(currentSelected)) {
      useAppStore.getState().setSelectedPartId(parts[0]?.id ?? null);
    }
    updateSelectedPartPosition();
  };

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

  const updateDimensions = () => {
    const group = modelGroupRef.current;
    if (group.children.length === 0) {
      useAppStore.getState().setDimensions({ x: 0, y: 0, z: 0 });
      return;
    }
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);
    useAppStore.getState().setDimensions({ x: size.x, y: size.y, z: size.z });

    const scene = sceneRef.current;
    if (scene) {
      if (boxHelperRef.current) scene.remove(boxHelperRef.current);
      const helper = new THREE.Box3Helper(box, new THREE.Color(0x3b82f6));
      helper.visible = useAppStore.getState().showBoundingBox;
      helper.name = 'BoundingBoxHelper';
      scene.add(helper);
      boxHelperRef.current = helper;
    }
  };

  const clearPreview = () => {
    const scene = sceneRef.current;
    if (previewMeshRef.current && scene) {
      scene.remove(previewMeshRef.current);
      previewMeshRef.current.geometry.dispose();
    }
    previewMeshRef.current = null;
  };

  const replacePartMeshes = (partId: string, label: string, meshes: THREE.Mesh[]) => {
    removePartMeshes(partId);
    meshes.forEach((mesh) => addPartMesh(partId, label, mesh));
    updateDimensions();
    updateParts();
  };

  const getMergedPartMesh = (partId: string): THREE.Mesh | null => {
    const meshes = getPartMeshes(partId);
    if (meshes.length === 0) return null;
    let result = meshes[0];
    for (let i = 1; i < meshes.length; i++) {
      result = performCSG(result, meshes[i], ADDITION, materialRef.current);
    }
    return result;
  };

  /** Bakes a part's full world transform into a standalone geometry (safe regardless of Move-tool offsets). */
  const getBakedPartGeometry = (partId: string): THREE.BufferGeometry | null => {
    const merged = getMergedPartMesh(partId);
    if (!merged) return null;
    merged.updateMatrixWorld(true);
    const baked = merged.geometry.clone();
    baked.applyMatrix4(merged.matrixWorld);
    return baked;
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

  // performCSG bakes each operand's full WORLD transform into the result's
  // vertex positions, so the result must be shown with an identity parent
  // transform or the group's own position/rotation/scale (e.g. the
  // "drop to build plate" offset applied on load, or a Transform-panel
  // scale) would be applied a second time on top of the already-baked
  // geometry. Call this right after adding a CSG result to the group.
  const bakeGroupTransformToIdentity = () => {
    const group = modelGroupRef.current;
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    group.updateMatrixWorld(true);
    updateDimensions();

    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);
    baseSizeRef.current = size.clone();
    useAppStore.getState().setTransform({ scaleX: 100, scaleY: 100, scaleZ: 100 });
  };

  // ---- undo/redo history ---------------------------------------------
  const captureSnapshot = (): HistorySnapshot => ({
    meshes: getAllPartMeshes().map((m) => ({
      partId: m.userData.partId,
      partLabel: m.userData.partLabel,
      geometry: m.geometry.clone(),
      position: m.position.toArray() as [number, number, number],
      quaternion: m.quaternion.toArray() as [number, number, number, number],
      scale: m.scale.toArray() as [number, number, number],
    })),
    fileName: useAppStore.getState().fileName,
    hasModel: useAppStore.getState().hasModel,
  });

  const restoreSnapshot = (snap: HistorySnapshot) => {
    const group = modelGroupRef.current;
    [...group.children].forEach((child) => {
      group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    snap.meshes.forEach((ms) => {
      const mesh = new THREE.Mesh(ms.geometry.clone(), materialRef.current);
      mesh.name = 'ModelPiece';
      mesh.position.fromArray(ms.position);
      mesh.quaternion.fromArray(ms.quaternion);
      mesh.scale.fromArray(ms.scale);
      addPartMesh(ms.partId, ms.partLabel, mesh);
    });
    clearPreview();
    useAppStore.getState().setFileName(snap.fileName);
    useAppStore.getState().setHasModel(snap.hasModel);
    updateDimensions();
    updateParts();

    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);
    baseSizeRef.current = size.clone();
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

    // ---- pointer interaction for hole / primitive / measure placement --
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
    };

    const onPointerDown = (event: PointerEvent) => {
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
        useAppStore.getState().setMeshIssues([]);
        resetHistory();

        const partId = generatePartId();
        geometry = validateAndAutoRepair(geometry, partId, name);

        const mesh = new THREE.Mesh(geometry, materialRef.current);
        mesh.name = 'ModelPiece';
        addPartMesh(partId, name, mesh);
        useAppStore.getState().setSelectedPartId(partId);
        clearPreview();

        const box = new THREE.Box3().setFromObject(modelGroupRef.current);
        const size = new THREE.Vector3();
        box.getSize(size);
        baseSizeRef.current = size.clone();
        modelGroupRef.current.scale.set(1, 1, 1);
        modelGroupRef.current.position.set(0, 0, -box.min.z);
        modelGroupRef.current.rotation.set(0, 0, 0);

        fileNameRef.current = name;
        useAppStore.getState().setFileName(name);
        useAppStore.getState().setHasModel(true);
        useAppStore.getState().setTransform({ scaleX: 100, scaleY: 100, scaleZ: 100 });
        updateDimensions();
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

        updateDimensions();
        updateParts();
        useAppStore.getState().setSelectedPartId(partId);
        useAppStore.getState().setActiveTool('select');
      },

      newModel: () => {
        [...modelGroupRef.current.children].forEach((child) => {
          modelGroupRef.current.remove(child);
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
        modelGroupRef.current.position.set(0, 0, 0);
        modelGroupRef.current.rotation.set(0, 0, 0);
        modelGroupRef.current.scale.set(1, 1, 1);
        clearPreview();
        resetHistory();
        useAppStore.getState().setMeshIssues([]);
        useAppStore.getState().setFileName(null);
        useAppStore.getState().setHasModel(false);
        useAppStore.getState().setActiveTool('select');
        useAppStore.getState().setTransform({ scaleX: 100, scaleY: 100, scaleZ: 100 });
        updateDimensions();
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
        pushHistoryCoalesced('scale');
        const base = baseSizeRef.current;
        modelGroupRef.current.scale.set(
          x / Math.max(base.x, 1e-6),
          y / Math.max(base.y, 1e-6),
          z / Math.max(base.z, 1e-6),
        );
        updateDimensions();
      },

      rotateBy: (axis, degrees) => {
        pushHistory();
        const rad = THREE.MathUtils.degToRad(degrees);
        modelGroupRef.current.rotation[axis] += rad;
        modelGroupRef.current.position.z -= new THREE.Box3().setFromObject(modelGroupRef.current).min.z;
        updateDimensions();
      },

      centerToOrigin: () => {
        pushHistory();
        const box = new THREE.Box3().setFromObject(modelGroupRef.current);
        const center = new THREE.Vector3();
        box.getCenter(center);
        modelGroupRef.current.position.x -= center.x;
        modelGroupRef.current.position.y -= center.y;
        modelGroupRef.current.position.z -= center.z;
        updateDimensions();
      },

      dropToBuildPlate: () => {
        pushHistory();
        const box = new THREE.Box3().setFromObject(modelGroupRef.current);
        modelGroupRef.current.position.z -= box.min.z;
        updateDimensions();
      },

      mirror: (axis: PlaneAxis) => {
        const activePartId = getActivePartId();
        if (!activePartId) return;
        const baked = getBakedPartGeometry(activePartId);
        if (!baked) return;
        pushHistory();
        const mirroredGeometry = mirrorGeometry(baked, axis);
        const result = new THREE.Mesh(mirroredGeometry, materialRef.current);
        result.name = 'ModelPiece';
        replacePartMeshes(activePartId, getPartLabel(activePartId) ?? 'Model', [result]);
        bakeGroupTransformToIdentity();
      },

      applyHoleSubtract: () => {
        const { diameter, depth, point, normal, threadId, targetPartId } = useAppStore.getState().hole;
        const partId = targetPartId ?? getActivePartId();
        if (!partId || !point || !normal) return;
        const target = getMergedPartMesh(partId);
        if (!target) return;

        pushHistory();
        const cutter = createHoleCutterMesh(diameter, depth, getThreadRenderOptions(threadId, true));
        positionCutterAtSurface(cutter, new THREE.Vector3(...point), new THREE.Vector3(...normal), depth, 'subtract');
        cutter.updateMatrix();

        const result = performCSG(target, cutter, SUBTRACTION, materialRef.current);
        result.name = 'ModelPiece';
        replacePartMeshes(partId, getPartLabel(partId) ?? 'Model', [result]);
        bakeGroupTransformToIdentity();
        clearPreview();
        useAppStore.getState().resetHole();
        useAppStore.getState().setActiveTool('select');
      },

      cancelHolePlacement: () => {
        clearPreview();
        useAppStore.getState().resetHole();
      },

      applyPrimitive: () => {
        const p = useAppStore.getState().primitive;
        const partId = p.targetPartId ?? getActivePartId();
        if (!partId || !p.point || !p.normal) return;
        const target = getMergedPartMesh(partId);
        if (!target) return;

        pushHistory();
        const primitiveMesh = createPrimitiveMesh(p.shape, p, getThreadRenderOptions(p.threadId, p.operation === 'subtract'));
        positionCutterAtSurface(
          primitiveMesh,
          new THREE.Vector3(...p.point),
          new THREE.Vector3(...p.normal),
          p.height,
          p.operation === 'subtract' ? 'subtract' : 'union',
        );
        primitiveMesh.updateMatrix();

        const op = p.operation === 'union' ? ADDITION : SUBTRACTION;
        const result = performCSG(target, primitiveMesh, op, materialRef.current);
        result.name = 'ModelPiece';
        replacePartMeshes(partId, getPartLabel(partId) ?? 'Model', [result]);
        bakeGroupTransformToIdentity();
        clearPreview();
        useAppStore.getState().resetPrimitivePlacement();
        useAppStore.getState().setActiveTool('select');
      },

      cancelPrimitivePlacement: () => {
        clearPreview();
        useAppStore.getState().resetPrimitivePlacement();
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
        const upperId = generatePartId();
        const lowerId = generatePartId();
        addPartMesh(upperId, `${label} (upper)`, upper);
        addPartMesh(lowerId, `${label} (lower)`, lower);
        bakeGroupTransformToIdentity();
        updateParts();
        useAppStore.getState().setSelectedPartId(upperId);
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
        const baked = getBakedPartGeometry(activePartId);
        if (!baked) return;
        pushHistory();
        const label = getPartLabel(activePartId) ?? 'Model';
        const repaired = repairWindingConsistency(baked);
        const result = new THREE.Mesh(repaired, materialRef.current);
        result.name = 'ModelPiece';
        replacePartMeshes(activePartId, label, [result]);
        bakeGroupTransformToIdentity();
        recordMeshIssues(activePartId, label, repaired);
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

  // ---- reactive: live cutter preview size while adjusting sliders ---
  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
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
