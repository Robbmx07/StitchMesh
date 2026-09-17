import { create } from 'zustand';
import { GENERIC_PRINTER_ID } from '@/utils/printerProfiles';

export type ToolId = 'select' | 'transform' | 'hole' | 'primitive' | 'planeCut';
export type PrimitiveShape = 'box' | 'cylinder' | 'washer';
export type PrimitiveOp = 'union' | 'subtract';
export type PlaneAxis = 'x' | 'y' | 'z';
export type OrthoView = 'top' | 'front' | 'side' | 'iso';

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
}

/**
 * Imperative bridge to the live Three.js scene. Viewport3D registers these
 * once it mounts; Toolbar/Sidebar call them in response to user actions
 * instead of owning any three.js objects themselves.
 */
export interface ViewportActions {
  loadSTL: (data: ArrayBuffer, fileName: string) => void;
  exportSTL: () => void;
  setOrthoView: (view: OrthoView) => void;
  setWireframe: (on: boolean) => void;
  setFlatShading: (on: boolean) => void;
  applyScale: (x: number, y: number, z: number) => void;
  rotateBy: (axis: PlaneAxis, degrees: number) => void;
  centerToOrigin: () => void;
  dropToBuildPlate: () => void;
  applyHoleSubtract: () => void;
  cancelHolePlacement: () => void;
  applyPrimitive: () => void;
  cancelPrimitivePlacement: () => void;
  applyPlaneCut: () => void;
  /** Defaults planeCut.height to the model's current bounding-box center on the given axis, so the default cut isn't a no-op on a build-plate-dropped model. */
  centerPlaneCutHeight: (axis: PlaneAxis) => void;
}

interface AppState {
  fileName: string | null;
  hasModel: boolean;
  isBusy: boolean;
  busyMessage: string | null;
  dimensions: Dimensions;

  wireframe: boolean;
  flatShading: boolean;
  showBoundingBox: boolean;

  /** Target printer profile id (printerProfiles.ts) — tunes thread mesh resolution and internal-thread clearance. */
  printerProfileId: string;
  /** True once the user has actively picked a profile from the dropdown (Generic included) — false means it's still just the unconfirmed default. */
  printerProfileConfirmed: boolean;

  activeTool: ToolId;

  transform: TransformState;
  hole: HoleToolState;
  primitive: PrimitiveToolState;
  planeCut: PlaneCutState;

  viewportActions: ViewportActions | null;

  setViewportActions: (actions: ViewportActions | null) => void;
  setFileName: (name: string | null) => void;
  setHasModel: (has: boolean) => void;
  setBusy: (busy: boolean, message?: string | null) => void;
  setDimensions: (dims: Dimensions) => void;

  setWireframe: (on: boolean) => void;
  setFlatShading: (on: boolean) => void;
  setShowBoundingBox: (on: boolean) => void;
  setPrinterProfileId: (id: string) => void;

  setActiveTool: (tool: ToolId) => void;

  setTransform: (partial: Partial<TransformState>) => void;
  setHole: (partial: Partial<HoleToolState>) => void;
  resetHole: () => void;
  setPrimitive: (partial: Partial<PrimitiveToolState>) => void;
  resetPrimitivePlacement: () => void;
  setPlaneCut: (partial: Partial<PlaneCutState>) => void;
}

const defaultHole: HoleToolState = {
  placed: false,
  diameter: 4,
  depth: 10,
  point: null,
  normal: null,
  threadId: null,
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
};

export const useAppStore = create<AppState>((set) => ({
  fileName: null,
  hasModel: false,
  isBusy: false,
  busyMessage: null,
  dimensions: { x: 0, y: 0, z: 0 },

  wireframe: false,
  flatShading: false,
  showBoundingBox: true,
  printerProfileId: GENERIC_PRINTER_ID,
  printerProfileConfirmed: false,

  activeTool: 'select',

  transform: defaultTransform,
  hole: defaultHole,
  primitive: defaultPrimitive,
  planeCut: defaultPlaneCut,

  viewportActions: null,

  setViewportActions: (actions) => set({ viewportActions: actions }),
  setFileName: (name) => set({ fileName: name }),
  setHasModel: (has) => set({ hasModel: has }),
  setBusy: (busy, message = null) => set({ isBusy: busy, busyMessage: message }),
  setDimensions: (dims) => set({ dimensions: dims }),

  setWireframe: (on) => set({ wireframe: on }),
  setFlatShading: (on) => set({ flatShading: on }),
  setShowBoundingBox: (on) => set({ showBoundingBox: on }),
  setPrinterProfileId: (id) => set({ printerProfileId: id, printerProfileConfirmed: true }),

  setActiveTool: (tool) =>
    set((state) => ({
      activeTool: tool,
      hole: tool === 'hole' ? state.hole : { ...defaultHole },
      primitive:
        tool === 'primitive'
          ? state.primitive
          : { ...defaultPrimitive, shape: state.primitive.shape, operation: state.primitive.operation, threadId: state.primitive.threadId },
    })),

  setTransform: (partial) => set((state) => ({ transform: { ...state.transform, ...partial } })),

  setHole: (partial) => set((state) => ({ hole: { ...state.hole, ...partial } })),
  resetHole: () => set({ hole: { ...defaultHole } }),

  setPrimitive: (partial) => set((state) => ({ primitive: { ...state.primitive, ...partial } })),
  resetPrimitivePlacement: () =>
    set((state) => ({
      primitive: { ...state.primitive, placed: false, point: null, normal: null },
    })),

  setPlaneCut: (partial) => set((state) => ({ planeCut: { ...state.planeCut, ...partial } })),
}));
