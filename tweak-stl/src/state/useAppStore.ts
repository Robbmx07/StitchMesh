import { create } from 'zustand';
import { GENERIC_PRINTER_ID } from '@/utils/printerProfiles';
import type { Units } from '@/utils/units';

export type ToolId = 'select' | 'transform' | 'hole' | 'primitive' | 'planeCut' | 'measure' | 'mate' | 'shapes' | 'chamfer' | 'counterbore';
export type PrimitiveShape = 'box' | 'cylinder' | 'washer' | 'chamfer';
export type PrimitiveOp = 'union' | 'subtract';
export type PlaneAxis = 'x' | 'y' | 'z';
export type OrthoView = 'top' | 'front' | 'side' | 'iso';
export type FeatureType = 'hole' | 'primitive';
export type BasicShape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'pyramid' | 'torus';

export interface Dimensions {
  x: number;
  y: number;
  z: number;
}

export interface HoleToolState {
  /** True once the user has clicked a point on the model to anchor the cutter. */
  placed: boolean;
  diameter: number;
  depth: number;
  point: [number, number, number] | null;
  normal: [number, number, number] | null;
  /** ThreadStandard id, or null for a plain smooth hole. */
  threadId: string | null;
  /** Which part was actually clicked — determined automatically by the raycast hit, not user-picked. */
  targetPartId: string | null;
  /** Offset of `point` from the target part's own center, on all 3 axes — shown as a reference readout. */
  centerOffset: [number, number, number] | null;
  /** Offset of `point` from the target part's user-defined local origin — editable, drives numeric placement. */
  localOffset: [number, number, number] | null;
  /** Set while editing an existing feature (from the Parts panel) instead of placing a new one. */
  editingFeatureId: string | null;
  locked: boolean;
}

export interface PrimitiveToolState {
  shape: PrimitiveShape;
  operation: PrimitiveOp;
  width: number;
  depth: number;
  height: number;
  diameter: number;
  innerDiameter: number;
  placed: boolean;
  point: [number, number, number] | null;
  normal: [number, number, number] | null;
  /** ThreadStandard id, or null for a plain smooth cylinder. Only applies to the cylinder shape. */
  threadId: string | null;
  /** Which part was actually clicked — determined automatically by the raycast hit, not user-picked. */
  targetPartId: string | null;
  centerOffset: [number, number, number] | null;
  localOffset: [number, number, number] | null;
  editingFeatureId: string | null;
  locked: boolean;
  /** Set by Quick Chamfer/Counterbore when this primitive was placed by snapping to an existing hole — the hole's own diameter, shown as a reference and used to warn if the new diameter no longer clears it. Null otherwise (a manually-placed primitive has no such reference). */
  referenceHoleDiameterMM: number | null;
}

export interface PlaneCutState {
  axis: PlaneAxis;
  height: number;
  keepBoth: boolean;
}

export interface TransformState {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  uniformScale: boolean;
  /** Free-angle rotation input (degrees), alongside the ±90° snap buttons. */
  freeRotateAxis: PlaneAxis;
  freeRotateDegrees: number;
}

export interface MeasureToolState {
  datum: [number, number, number] | null;
  point: [number, number, number] | null;
}

/** One click-picked reference on a part, used by the Mate tool. */
export interface MateAnchor {
  partId: string;
  point: [number, number, number];
  normal: [number, number, number];
  /** True when this pick snapped to a recognized cylindrical hole/boss feature's own axis (point = feature's surface center, normal = its axis direction) rather than the raw clicked surface point/local-face-normal. */
  isAxis?: boolean;
  /** That feature's diameter — set only when isAxis is true. Used to offer Smart Fit when A's and B's diameters match closely. */
  diameterMM?: number;
}

export type MateStage = 'pickA' | 'pickB' | 'ready' | 'pickEdgeA' | 'pickEdgeB' | 'edgeReady' | 'pickPairA' | 'pickPairB';

export interface MateToolState {
  stage: MateStage;
  a: MateAnchor | null;
  b: MateAnchor | null;
  fitted: boolean;
  edgeA: [number, number, number] | null;
  edgeB: [number, number, number] | null;
  /**
   * Extra corresponding point pairs for multipoint Best Fit, in addition to
   * the initial a/b anchor points (which always count as pair #1) — local
   * frame, part A's and part B's own. 3+ total pairs (so 2+ here) lets
   * applyBestFit() solve the full rotation+translation from points alone,
   * for mating surfaces a single face-normal can't fully constrain (e.g. a
   * stepped or irregular contact face).
   */
  extraPairsA: [number, number, number][];
  extraPairsB: [number, number, number][];
  /**
   * Current in-plane offset between A's and B's anchor points, resolved
   * into a stable (U, V) basis derived from A's mate normal — null outside
   * a fitted mate. Lets the Mate panel show and accept an exact typed
   * offset instead of only a click-based Flush Edge gesture.
   */
  offsetUV: [number, number] | null;
}

export interface ShapeToolState {
  shape: BasicShape;
  width: number;
  depth: number;
  height: number;
  diameter: number;
  tubeDiameter: number;
  splitOnCreate: boolean;
  splitAxis: PlaneAxis;
}

/** One independent object in the scene (the loaded model, or an added part) — its own movable/scalable layer. */
export interface PartInfo {
  id: string;
  label: string;
  /** User-defined reference point, in the part's own stable local frame (default 0,0,0 = its centroid). */
  localOrigin: [number, number, number];
  /** When true, the part's viewport drag gizmo is constrained to X/Y — it can't be dragged off the build plate in Z. */
  lockToPlate: boolean;
  /** Part is visible in the viewport. */
  visible: boolean;
  /** Prevents direct movement/transform of the part until unlocked. */
  locked: boolean;
}

/**
 * One non-destructive Hole/Primitive operation applied to a part — its own
 * editable "layer" within that part, stored in the part's local frame so it
 * stays correct regardless of how the part has been moved/rotated/scaled.
 */
export interface PartFeature {
  id: string;
  type: FeatureType;
  label: string;
  /** Prevents further edits (including diameter/thread) until unlocked. */
  locked: boolean;
  /** Whether the feature is currently enabled in the composite preview. */
  visible: boolean;
  point: [number, number, number];
  normal: [number, number, number];
  diameter: number;
  /** Hole extrusion depth. */
  depth: number;
  threadId: string | null;
  shape: PrimitiveShape;
  operation: PrimitiveOp;
  width: number;
  /** Primitive extrusion length (cylinder/washer height, or the box's Z dimension). */
  height: number;
  innerDiameter: number;
}

export interface MeshIssues {
  partId: string;
  partLabel: string;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  inconsistentWindingCount: number;
  globallyInverted: boolean;
  /** True if repairWindingConsistency() would change anything (winding/inversion, not holes). */
  repairable: boolean;
}

/**
 * Imperative bridge to the live Three.js scene. Viewport3D registers these
 * once it mounts; Toolbar/Sidebar call them in response to user actions
 * instead of owning any three.js objects themselves.
 */
export interface ViewportActions {
  loadSTL: (data: ArrayBuffer, fileName: string) => void;
  importAdditionalPart: (data: ArrayBuffer, fileName: string) => void;
  newModel: () => void;
  exportSTL: () => void;
  setOrthoView: (view: OrthoView) => void;
  setWireframe: (on: boolean) => void;
  setFlatShading: (on: boolean) => void;
  applyScale: (x: number, y: number, z: number) => void;
  rotateBy: (axis: PlaneAxis, degrees: number) => void;
  centerToOrigin: () => void;
  dropToBuildPlate: () => void;
  mirror: (axis: PlaneAxis) => void;
  applyHoleSubtract: () => void;
  cancelHolePlacement: () => void;
  applyPrimitive: () => void;
  cancelPrimitivePlacement: () => void;
  applyPlaneCut: () => void;
  /** Defaults planeCut.height to the model's current bounding-box center on the given axis, so the default cut isn't a no-op on a build-plate-dropped model. */
  centerPlaneCutHeight: (axis: PlaneAxis) => void;
  selectPart: (partId: string) => void;
  movePartTo: (partId: string, x: number, y: number, z: number) => void;
  nudgePart: (partId: string, axis: PlaneAxis, deltaMM: number) => void;
  clearMeasure: () => void;
  repairSelectedPart: () => void;
  undo: () => void;
  redo: () => void;

  /** Sets a part's numeric offset from its own local origin along one axis, moving the pending hole/primitive placement. */
  setHoleOffset: (axis: PlaneAxis, value: number) => void;
  setPrimitiveOffset: (axis: PlaneAxis, value: number) => void;
  /** Loads an existing feature's params into the Hole/Primitive panel for editing. */
  editFeature: (partId: string, featureId: string) => void;
  cancelEditFeature: () => void;
  deleteFeature: (partId: string, featureId: string) => void;
  toggleFeatureLock: (partId: string, featureId: string) => void;

  beginPickLocalOrigin: (partId: string) => void;
  cancelPickLocalOrigin: () => void;
  resetLocalOrigin: (partId: string) => void;
  setLocalOrigin: (partId: string, x: number, y: number, z: number) => void;
  setLockToPlate: (partId: string, locked: boolean) => void;
  setPartVisible: (partId: string, visible: boolean) => void;
  setPartLocked: (partId: string, locked: boolean) => void;
  renamePart: (partId: string, label: string) => void;
  duplicatePart: (partId: string) => void;
  deletePart: (partId: string) => void;
  isolatePart: (partId: string) => void;
  showAllParts: () => void;
  renameFeature: (partId: string, featureId: string, label: string) => void;
  setFeatureVisible: (partId: string, featureId: string, visible: boolean) => void;
  focusFeature: (partId: string, featureId: string) => void;

  /** Adds a new independent part built from the current Shapes-tool selection. */
  addBasicShape: () => void;

  /** Clears Mate tool markers/state without leaving the tool. */
  cancelMate: () => void;
  /** Rotates+moves part B so its picked face sits flush against part A's, facing it. */
  applyMateFit: () => void;
  /** Slides part B within the mated plane so the two flush-edge reference points line up. */
  applyFlushEdge: () => void;
  /** Real CSG union of the two mated parts into a single merged part. */
  weldMatedParts: () => void;
  /** Sets B's in-plane offset from A (along the stable U or V basis derived from A's mate normal) to an exact typed value. */
  setMateOffsetU: (mm: number) => void;
  setMateOffsetV: (mm: number) => void;
  /** Starts (or continues) picking an additional corresponding point pair for multipoint Best Fit. */
  beginPairPick: () => void;
  /** Removes the most recently added extra point pair. */
  removeLastPair: () => void;
  /** Rotation+translation least-squares best fit (Kabsch) of B onto A from all picked point pairs (needs 3+ total). */
  applyBestFit: () => void;
  /** Coaxially aligns B's axis to A's, for two anchors that both snapped to a cylindrical hole/boss feature — see MateAnchor.isAxis. */
  applyAxisFit: () => void;
}

interface AppState {
  fileName: string | null;
  hasModel: boolean;
  isBusy: boolean;
  busyMessage: string | null;
  dimensions: Dimensions;
  units: Units;

  wireframe: boolean;
  flatShading: boolean;
  showBoundingBox: boolean;
  snapToGrid: boolean;
  snapGridSizeMM: number;

  /** Target printer profile id (printerProfiles.ts) — tunes thread mesh resolution and internal-thread clearance. */
  printerProfileId: string;
  /** True once the user has actively picked a profile from the dropdown (Generic included) — false means it's still just the unconfirmed default. */
  printerProfileConfirmed: boolean;
  /** User-picked nozzle diameter overriding the selected profile's stock nozzle, or null to use the stock size. Reset whenever the printer changes. */
  nozzleOverrideMM: number | null;
  /** Set by the viewport whenever the scene's combined bounding box no longer fits the selected printer's build volume; null when everything fits. */
  buildVolumeWarning: string | null;

  activeTool: ToolId;

  transform: TransformState;
  hole: HoleToolState;
  primitive: PrimitiveToolState;
  planeCut: PlaneCutState;
  measure: MeasureToolState;
  mate: MateToolState;
  shapeTool: ShapeToolState;

  parts: PartInfo[];
  selectedPartId: string | null;
  /** World position of the currently selected part, for the Move panel's live fields. */
  selectedPartPosition: [number, number, number] | null;
  /** Feature ("layer") list per part id, newest-applied last. */
  partFeatures: Record<string, PartFeature[]>;
  selectedFeatureId: string | null;
  partsPanelCollapsed: boolean;
  /** True while waiting for a viewport click to set a part's local origin. */
  pickingOrigin: boolean;
  pickingOriginPartId: string | null;

  meshIssues: MeshIssues[];

  canUndo: boolean;
  canRedo: boolean;

  viewportActions: ViewportActions | null;

  setViewportActions: (actions: ViewportActions | null) => void;
  setFileName: (name: string | null) => void;
  setHasModel: (has: boolean) => void;
  setBusy: (busy: boolean, message?: string | null) => void;
  setDimensions: (dims: Dimensions) => void;
  setUnits: (units: Units) => void;

  setWireframe: (on: boolean) => void;
  setFlatShading: (on: boolean) => void;
  setShowBoundingBox: (on: boolean) => void;
  setSnapToGrid: (on: boolean) => void;
  setPrinterProfileId: (id: string) => void;
  setNozzleOverrideMM: (mm: number | null) => void;
  setBuildVolumeWarning: (warning: string | null) => void;

  setActiveTool: (tool: ToolId) => void;

  setTransform: (partial: Partial<TransformState>) => void;
  setHole: (partial: Partial<HoleToolState>) => void;
  resetHole: () => void;
  setPrimitive: (partial: Partial<PrimitiveToolState>) => void;
  resetPrimitivePlacement: () => void;
  setPlaneCut: (partial: Partial<PlaneCutState>) => void;
  setMeasure: (partial: Partial<MeasureToolState>) => void;
  setMate: (partial: Partial<MateToolState>) => void;
  setShapeTool: (partial: Partial<ShapeToolState>) => void;

  setParts: (parts: PartInfo[]) => void;
  setSelectedPartId: (id: string | null) => void;
  setSelectedPartPosition: (position: [number, number, number] | null) => void;
  setPartFeatures: (partId: string, features: PartFeature[]) => void;
  setSelectedFeatureId: (id: string | null) => void;
  setPartsPanelCollapsed: (collapsed: boolean) => void;
  setPickingOrigin: (on: boolean, partId?: string | null) => void;
  setMeshIssues: (issues: MeshIssues[]) => void;
  dismissMeshIssue: (partId: string) => void;
  setCanUndoRedo: (canUndo: boolean, canRedo: boolean) => void;
}

const defaultHole: HoleToolState = {
  placed: false,
  diameter: 4,
  depth: 10,
  point: null,
  normal: null,
  threadId: null,
  targetPartId: null,
  centerOffset: null,
  localOffset: null,
  editingFeatureId: null,
  locked: false,
};

const defaultPrimitive: PrimitiveToolState = {
  shape: 'cylinder',
  operation: 'subtract',
  width: 10,
  depth: 10,
  height: 10,
  diameter: 8,
  innerDiameter: 4,
  placed: false,
  point: null,
  normal: null,
  threadId: null,
  targetPartId: null,
  centerOffset: null,
  localOffset: null,
  editingFeatureId: null,
  locked: false,
  referenceHoleDiameterMM: null,
};

const defaultPlaneCut: PlaneCutState = {
  axis: 'z',
  height: 0,
  keepBoth: true,
};

const defaultTransform: TransformState = {
  scaleX: 100,
  scaleY: 100,
  scaleZ: 100,
  uniformScale: true,
  freeRotateAxis: 'z',
  freeRotateDegrees: 0,
};

const defaultMeasure: MeasureToolState = {
  datum: null,
  point: null,
};

const defaultMate: MateToolState = {
  stage: 'pickA',
  a: null,
  b: null,
  fitted: false,
  edgeA: null,
  edgeB: null,
  extraPairsA: [],
  extraPairsB: [],
  offsetUV: null,
};

const defaultShapeTool: ShapeToolState = {
  shape: 'box',
  width: 20,
  depth: 20,
  height: 20,
  diameter: 20,
  tubeDiameter: 5,
  splitOnCreate: false,
  splitAxis: 'z',
};

export const useAppStore = create<AppState>((set) => ({
  fileName: null,
  hasModel: false,
  isBusy: false,
  busyMessage: null,
  dimensions: { x: 0, y: 0, z: 0 },
  units: 'mm',

  wireframe: false,
  flatShading: false,
  showBoundingBox: true,
  snapToGrid: false,
  snapGridSizeMM: 1,
  printerProfileId: GENERIC_PRINTER_ID,
  printerProfileConfirmed: false,
  nozzleOverrideMM: null,
  buildVolumeWarning: null,

  activeTool: 'select',

  transform: defaultTransform,
  hole: defaultHole,
  primitive: defaultPrimitive,
  planeCut: defaultPlaneCut,
  measure: defaultMeasure,
  mate: defaultMate,
  shapeTool: defaultShapeTool,

  parts: [],
  selectedPartId: null,
  selectedPartPosition: null,
  partFeatures: {},
  selectedFeatureId: null,
  partsPanelCollapsed: false,
  pickingOrigin: false,
  pickingOriginPartId: null,
  meshIssues: [],

  canUndo: false,
  canRedo: false,

  viewportActions: null,

  setViewportActions: (actions) => set({ viewportActions: actions }),
  setFileName: (name) => set({ fileName: name }),
  setHasModel: (has) => set({ hasModel: has }),
  setBusy: (busy, message = null) => set({ isBusy: busy, busyMessage: message }),
  setDimensions: (dims) => set({ dimensions: dims }),
  setUnits: (units) => set({ units }),

  setWireframe: (on) => set({ wireframe: on }),
  setFlatShading: (on) => set({ flatShading: on }),
  setShowBoundingBox: (on) => set({ showBoundingBox: on }),
  setSnapToGrid: (on) => set({ snapToGrid: on }),
  // A stale nozzle override could silently carry over to a printer that
  // doesn't offer that size, or misrepresent one that does but at a
  // different stock default — always reset it on a printer change.
  setPrinterProfileId: (id) => set({ printerProfileId: id, printerProfileConfirmed: true, nozzleOverrideMM: null }),
  setNozzleOverrideMM: (mm) => set({ nozzleOverrideMM: mm }),
  setBuildVolumeWarning: (warning) => set({ buildVolumeWarning: warning }),

  setActiveTool: (tool) =>
    set((state) => ({
      activeTool: tool,
      hole: tool === 'hole' ? state.hole : { ...defaultHole },
      primitive:
        tool === 'primitive'
          ? state.primitive
          : { ...defaultPrimitive, shape: state.primitive.shape, operation: state.primitive.operation, threadId: state.primitive.threadId },
      measure: tool === 'measure' ? state.measure : { ...defaultMeasure },
      mate: tool === 'mate' ? state.mate : { ...defaultMate },
      selectedFeatureId: tool === 'hole' || tool === 'primitive' ? state.selectedFeatureId : null,
    })),

  setTransform: (partial) => set((state) => ({ transform: { ...state.transform, ...partial } })),

  setHole: (partial) => set((state) => ({ hole: { ...state.hole, ...partial } })),
  resetHole: () => set({ hole: { ...defaultHole } }),

  setPrimitive: (partial) => set((state) => ({ primitive: { ...state.primitive, ...partial } })),
  resetPrimitivePlacement: () =>
    set((state) => ({
      primitive: { ...state.primitive, placed: false, point: null, normal: null, editingFeatureId: null, referenceHoleDiameterMM: null },
    })),

  setPlaneCut: (partial) => set((state) => ({ planeCut: { ...state.planeCut, ...partial } })),
  setMeasure: (partial) => set((state) => ({ measure: { ...state.measure, ...partial } })),
  setMate: (partial) => set((state) => ({ mate: { ...state.mate, ...partial } })),
  setShapeTool: (partial) => set((state) => ({ shapeTool: { ...state.shapeTool, ...partial } })),

  setParts: (parts) => set({ parts }),
  setSelectedPartId: (id) => set({ selectedPartId: id }),
  setSelectedPartPosition: (position) => set({ selectedPartPosition: position }),
  setPartFeatures: (partId, features) => set((state) => ({ partFeatures: { ...state.partFeatures, [partId]: features } })),
  setSelectedFeatureId: (id) => set({ selectedFeatureId: id }),
  setPartsPanelCollapsed: (collapsed) => set({ partsPanelCollapsed: collapsed }),
  setPickingOrigin: (on, partId = null) => set({ pickingOrigin: on, pickingOriginPartId: on ? partId : null }),
  setMeshIssues: (issues) => set({ meshIssues: issues }),
  dismissMeshIssue: (partId) => set((state) => ({ meshIssues: state.meshIssues.filter((i) => i.partId !== partId) })),
  setCanUndoRedo: (canUndo, canRedo) => set({ canUndo, canRedo }),
}));
