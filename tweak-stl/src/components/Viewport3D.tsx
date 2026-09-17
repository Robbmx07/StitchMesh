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
  orientToSurface,
  performCSG,
  planeCutMesh,
  type ThreadRenderOptions,
} from '@/utils/csgOperations';
import { findThreadStandard } from '@/utils/threadStandards';
import { findPrinterProfile, recommendedThreadResolution } from '@/utils/printerProfiles';
import { useAppStore, type OrthoView } from '@/state/useAppStore';

const MODEL_COLOR = 0x9ca3af;

function makeModelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: MODEL_COLOR,
    roughness: 0.55,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
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

  const replaceModelMeshes = (meshes: THREE.Mesh[]) => {
    const group = modelGroupRef.current;
    [...group.children].forEach((child) => {
      group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    meshes.forEach((mesh) => group.add(mesh));
    updateDimensions();
  };

  const getMergedTargetMesh = (): THREE.Mesh | null => {
    const group = modelGroupRef.current;
    const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    if (meshes.length === 0) return null;
    if (meshes.length === 1) return meshes[0];

    let result = meshes[0];
    for (let i = 1; i < meshes.length; i++) {
      result = performCSG(result, meshes[i], ADDITION, materialRef.current);
    }
    return result;
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

    // ---- pointer interaction for hole / primitive placement ----------
    const getIntersection = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycasterRef.current.setFromCamera(ndc, camera);
      const meshes = modelGroupRef.current.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
      const hits = raycasterRef.current.intersectObjects(meshes, false);
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
        orientToSurface(previewMeshRef.current, point, normal);
      } else if (tool === 'primitive') {
        const p = useAppStore.getState().primitive;
        if (!previewMeshRef.current || previewMeshRef.current.name !== 'PrimitivePreview') {
          clearPreview();
          previewMeshRef.current = createPrimitiveMesh(p.shape, p, getThreadRenderOptions(p.threadId, p.operation === 'subtract'));
          scene.add(previewMeshRef.current);
        }
        orientToSurface(previewMeshRef.current, point, normal);
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

      if (tool === 'hole') {
        useAppStore.getState().setHole({
          point: [hit.point.x, hit.point.y, hit.point.z],
          normal: [worldNormal.x, worldNormal.y, worldNormal.z],
        });
      } else {
        useAppStore.getState().setPrimitive({
          point: [hit.point.x, hit.point.y, hit.point.z],
          normal: [worldNormal.x, worldNormal.y, worldNormal.z],
        });
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const tool = useAppStore.getState().activeTool;
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

    // ---- register imperative actions consumed by Toolbar/Sidebar ------
    useAppStore.getState().setViewportActions({
      loadSTL: (data, name) => {
        const loader = new STLLoader();
        const geometry = loader.parse(data);
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingBox();

        const mesh = new THREE.Mesh(geometry, materialRef.current);
        mesh.name = 'ModelPiece';
        replaceModelMeshes([mesh]);
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

        const fitBox = new THREE.Box3().setFromObject(modelGroupRef.current);
        const fitSize = new THREE.Vector3();
        fitBox.getSize(fitSize);
        const maxDim = Math.max(fitSize.x, fitSize.y, fitSize.z, 10);
        camera.position.set(maxDim * 1.1, -maxDim * 1.5, maxDim * 1.1);
        controls.target.set(0, 0, fitSize.z / 2);
        controls.update();
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
        const base = baseSizeRef.current;
        modelGroupRef.current.scale.set(
          x / Math.max(base.x, 1e-6),
          y / Math.max(base.y, 1e-6),
          z / Math.max(base.z, 1e-6),
        );
        updateDimensions();
      },

      rotateBy: (axis, degrees) => {
        const rad = THREE.MathUtils.degToRad(degrees);
        modelGroupRef.current.rotation[axis] += rad;
        modelGroupRef.current.position.z -= new THREE.Box3().setFromObject(modelGroupRef.current).min.z;
        updateDimensions();
      },

      centerToOrigin: () => {
        const box = new THREE.Box3().setFromObject(modelGroupRef.current);
        const center = new THREE.Vector3();
        box.getCenter(center);
        modelGroupRef.current.position.x -= center.x;
        modelGroupRef.current.position.y -= center.y;
        modelGroupRef.current.position.z -= center.z;
        updateDimensions();
      },

      dropToBuildPlate: () => {
        const box = new THREE.Box3().setFromObject(modelGroupRef.current);
        modelGroupRef.current.position.z -= box.min.z;
        updateDimensions();
      },

      applyHoleSubtract: () => {
        const { diameter, depth, point, normal, threadId } = useAppStore.getState().hole;
        const target = getMergedTargetMesh();
        if (!target || !point || !normal) return;

        const cutter = createHoleCutterMesh(diameter, depth, getThreadRenderOptions(threadId, true));
        orientToSurface(cutter, new THREE.Vector3(...point), new THREE.Vector3(...normal));
        cutter.updateMatrix();

        const result = performCSG(target, cutter, SUBTRACTION, materialRef.current);
        result.name = 'ModelPiece';
        replaceModelMeshes([result]);
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
        const target = getMergedTargetMesh();
        if (!target || !p.point || !p.normal) return;

        const primitiveMesh = createPrimitiveMesh(p.shape, p, getThreadRenderOptions(p.threadId, p.operation === 'subtract'));
        orientToSurface(primitiveMesh, new THREE.Vector3(...p.point), new THREE.Vector3(...p.normal));
        primitiveMesh.updateMatrix();

        const op = p.operation === 'union' ? ADDITION : SUBTRACTION;
        const result = performCSG(target, primitiveMesh, op, materialRef.current);
        result.name = 'ModelPiece';
        replaceModelMeshes([result]);
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
        const target = getMergedTargetMesh();
        if (!target) return;

        const { upper, lower } = planeCutMesh(target, axis, height, materialRef.current);
        replaceModelMeshes([upper, lower]);
        bakeGroupTransformToIdentity();
        useAppStore.getState().setActiveTool('select');
      },
    });

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerdown', onMiddleClickRetarget, { capture: true });
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
        orientToSurface(fresh, point, normal);
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
        orientToSurface(fresh, point, normal);
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
