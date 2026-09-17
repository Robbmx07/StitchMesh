import { ChangeEvent, useEffect } from 'react';
import { Circle, FlipHorizontal2, Info, Move, Ruler, Scissors, Scale, SquarePlus } from 'lucide-react';
import {
  useAppStore,
  type PlaneAxis,
  type PrimitiveOp,
  type PrimitiveShape,
  type ToolId,
} from '@/state/useAppStore';
import { THREAD_STANDARDS, THREAD_SYSTEM_LABELS, findThreadStandard, type ThreadSystem } from '@/utils/threadStandards';
import { findPrinterProfile, threadPrintabilityWarning } from '@/utils/printerProfiles';

const TOOL_TABS: { id: ToolId; label: string; icon: typeof Info }[] = [
  { id: 'select', label: 'Info', icon: Info },
  { id: 'transform', label: 'Transform', icon: Scale },
  { id: 'hole', label: 'Hole', icon: Circle },
  { id: 'primitive', label: 'Primitive', icon: SquarePlus },
  { id: 'planeCut', label: 'Cut', icon: Scissors },
  { id: 'move', label: 'Move', icon: Move },
  { id: 'measure', label: 'Measure', icon: Ruler },
];

/** Dropdown for picking which independent object a tool acts on — hidden when there's only one. */
function PartSelector() {
  const parts = useAppStore((s) => s.parts);
  const selectedPartId = useAppStore((s) => s.selectedPartId);
  const viewportActions = useAppStore((s) => s.viewportActions);
  if (parts.length <= 1) return null;

  return (
    <div className="field-row">
      <label className="text-sm text-slate-300">Part</label>
      <select
        className="w-40 rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent-500"
        value={selectedPartId ?? ''}
        onChange={(e) => viewportActions?.selectPart(e.target.value)}
      >
        {parts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  suffix = 'mm',
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = parseFloat(event.target.value);
    onChange(Number.isFinite(next) ? next : 0);
  };
  return (
    <div className="field-row">
      <label className="text-sm text-slate-300">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          className="num-input disabled:cursor-not-allowed disabled:opacity-40"
          value={value}
          step={step}
          min={min}
          disabled={disabled}
          onChange={handleChange}
        />
        <span className="w-6 text-xs text-slate-500">{suffix}</span>
      </div>
    </div>
  );
}

const THREAD_SYSTEM_ORDER: ThreadSystem[] = ['metric', 'unc', 'unf'];

/** Dropdown for picking a standard hardware thread size, or "Smooth" for a plain cylinder. */
function ThreadSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const selected = findThreadStandard(value);
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value || null);

  return (
    <div className="space-y-1">
      <div className="field-row">
        <label className="text-sm text-slate-300">Thread</label>
        <select
          className="w-40 rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent-500"
          value={value ?? ''}
          onChange={handleChange}
        >
          <option value="">Smooth (no thread)</option>
          {THREAD_SYSTEM_ORDER.map((system) => (
            <optgroup key={system} label={THREAD_SYSTEM_LABELS[system]}>
              {THREAD_STANDARDS.filter((t) => t.system === system).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {selected && (
        <>
          <p className="text-right text-xs text-slate-500">
            ⌀{selected.majorDiameterMM.toFixed(3)} mm · {selected.tpi ? `${selected.tpi} TPI` : `${selected.pitchMM.toFixed(2)} mm pitch`}
          </p>
          <ThreadPrintabilityNote majorDiameterMM={selected.majorDiameterMM} pitchMM={selected.pitchMM} />
        </>
      )}
    </div>
  );
}

function ThreadPrintabilityNote({ majorDiameterMM, pitchMM }: { majorDiameterMM: number; pitchMM: number }) {
  const printerProfileId = useAppStore((s) => s.printerProfileId);
  const profile = findPrinterProfile(printerProfileId);
  const warning = threadPrintabilityWarning(profile, majorDiameterMM, pitchMM);
  if (!warning) return null;
  return <p className="text-xs text-amber-500">{warning}</p>;
}

/** Read-only reference readout: how far a pending/edited placement sits from the target part's own bounding-box center — matches the cyan centerlines drawn in the viewport. */
function CenterOffsetNote({ centerOffset }: { centerOffset: [number, number, number] | null }) {
  if (!centerOffset) return null;
  return (
    <p className="text-[11px] text-slate-500">
      Δ from part center — X: {centerOffset[0].toFixed(2)}, Y: {centerOffset[1].toFixed(2)}, Z: {centerOffset[2].toFixed(2)} mm
    </p>
  );
}

/** Numeric X/Y/Z position relative to the target part's own user-defined local origin — an alternative to eyeballing the click point. */
function OffsetFields({
  localOffset,
  onChange,
}: {
  localOffset: [number, number, number] | null;
  onChange: (axis: PlaneAxis, value: number) => void;
}) {
  if (!localOffset) return null;
  return (
    <div className="space-y-1">
      <div className="panel-label !mb-1">Offset from local origin</div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <div key={axis} className="flex items-center gap-1">
            <span className="text-[10px] uppercase text-slate-500">{axis}</span>
            <input
              type="number"
              className="num-input !w-full !text-xs"
              step={0.1}
              value={localOffset[i]}
              onChange={(e) => onChange(axis, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-slate-600">
        Set a part's local origin from the Parts panel. The axis along your click's surface normal is usually best left alone.
      </p>
    </div>
  );
}

function DimensionsReadout() {
  const dimensions = useAppStore((s) => s.dimensions);
  const hasModel = useAppStore((s) => s.hasModel);
  return (
    <div className="panel-section">
      <div className="panel-label">Bounding Box</div>
      {hasModel ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="rounded-md border border-base-700 bg-base-900 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{axis}</div>
              <div className="text-sm font-medium text-slate-200">{dimensions[axis].toFixed(1)}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No model loaded.</p>
      )}
    </div>
  );
}

function SelectPanel() {
  const fileName = useAppStore((s) => s.fileName);
  const hasModel = useAppStore((s) => s.hasModel);
  return (
    <div className="panel-section space-y-2">
      <div className="panel-label">Model</div>
      {hasModel ? (
        <p className="text-sm text-slate-300">{fileName}</p>
      ) : (
        <p className="text-sm text-slate-500">Drag and drop an .stl file into the viewport, or use Open STL.</p>
      )}
      <p className="text-xs text-slate-500">
        Select a tool tab above to transform the model or perform a modification.
      </p>
    </div>
  );
}

function TransformPanel() {
  const { transform, dimensions, hasModel, setTransform, viewportActions } = useAppStore();

  const applyScale = (x: number, y: number, z: number) => {
    setTransform({ scaleX: x, scaleY: y, scaleZ: z });
    viewportActions?.applyScale(x, y, z);
  };

  const handleAxisChange = (axis: 'x' | 'y' | 'z', value: number) => {
    if (transform.uniformScale) {
      const current = { x: dimensions.x, y: dimensions.y, z: dimensions.z }[axis];
      const ratio = current > 0 ? value / current : 1;
      applyScale(dimensions.x * ratio, dimensions.y * ratio, dimensions.z * ratio);
    } else if (axis === 'x') {
      applyScale(value, dimensions.y, dimensions.z);
    } else if (axis === 'y') {
      applyScale(dimensions.x, value, dimensions.z);
    } else {
      applyScale(dimensions.x, dimensions.y, value);
    }
  };

  return (
    <div>
      <div className="panel-section">
        <div className="panel-label">Scale</div>
        <div className="field-row">
          <label className="text-sm text-slate-300">Uniform</label>
          <input
            type="checkbox"
            checked={transform.uniformScale}
            onChange={(e) => setTransform({ uniformScale: e.target.checked })}
          />
        </div>
        <NumberField label="Width (X)" value={dimensions.x} onChange={(v) => handleAxisChange('x', v)} min={0.1} />
        <NumberField label="Depth (Y)" value={dimensions.y} onChange={(v) => handleAxisChange('y', v)} min={0.1} />
        <NumberField label="Height (Z)" value={dimensions.z} onChange={(v) => handleAxisChange('z', v)} min={0.1} />
      </div>

      <div className="panel-section">
        <div className="panel-label">Rotate</div>
        <div className="space-y-1.5">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="field-row">
              <span className="text-sm uppercase text-slate-300">{axis}</span>
              <div className="flex gap-1.5">
                <button className="btn w-20" disabled={!hasModel} onClick={() => viewportActions?.rotateBy(axis, -90)}>
                  −90°
                </button>
                <button className="btn w-20" disabled={!hasModel} onClick={() => viewportActions?.rotateBy(axis, 90)}>
                  +90°
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="field-row pt-2">
          <label className="text-sm text-slate-300">Free angle</label>
          <div className="flex items-center gap-1">
            <select
              className="rounded border border-base-600 bg-base-900 px-1.5 py-1 text-sm text-slate-200 outline-none focus:border-accent-500"
              value={transform.freeRotateAxis}
              onChange={(e) => setTransform({ freeRotateAxis: e.target.value as 'x' | 'y' | 'z' })}
            >
              <option value="x">X</option>
              <option value="y">Y</option>
              <option value="z">Z</option>
            </select>
            <input
              type="number"
              className="num-input"
              value={transform.freeRotateDegrees}
              step={1}
              onChange={(e) => setTransform({ freeRotateDegrees: parseFloat(e.target.value) || 0 })}
            />
            <span className="text-xs text-slate-500">°</span>
          </div>
        </div>
        <button
          className="btn w-full"
          disabled={!hasModel || transform.freeRotateDegrees === 0}
          onClick={() => viewportActions?.rotateBy(transform.freeRotateAxis, transform.freeRotateDegrees)}
        >
          Rotate
        </button>
      </div>

      <div className="panel-section space-y-2">
        <div className="panel-label">Position</div>
        <button className="btn w-full" disabled={!hasModel} onClick={() => viewportActions?.centerToOrigin()}>
          Center to Origin
        </button>
        <button className="btn w-full" disabled={!hasModel} onClick={() => viewportActions?.dropToBuildPlate()}>
          Drop to Build Plate
        </button>
      </div>

      <div className="panel-section space-y-2">
        <div className="panel-label">Mirror</div>
        <div className="grid grid-cols-3 gap-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <button
              key={axis}
              className="btn flex items-center justify-center gap-1"
              disabled={!hasModel}
              onClick={() => viewportActions?.mirror(axis)}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" />
              {axis.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">Flips the selected part across that axis, through its own center.</p>
      </div>
    </div>
  );
}

function HolePanel() {
  const { hole, hasModel, parts, setHole, viewportActions } = useAppStore();
  const selectedThread = findThreadStandard(hole.threadId);
  const targetLabel = parts.length > 1 ? parts.find((p) => p.id === hole.targetPartId)?.label : null;
  const isEditing = !!hole.editingFeatureId;

  const handleThreadChange = (id: string | null) => {
    const thread = findThreadStandard(id);
    setHole({ threadId: id, ...(thread ? { diameter: thread.majorDiameterMM } : {}) });
  };

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">{isEditing ? 'Edit Hole Feature' : 'Hole Modifier'}</div>
      {!hasModel ? (
        <p className="text-sm text-slate-500">Load a model first.</p>
      ) : !hole.placed ? (
        <p className="text-sm text-slate-400">Click a point on the model to place the cutter.</p>
      ) : isEditing && hole.locked ? (
        <>
          <p className="text-sm text-amber-500">This feature is locked. Unlock it from the Parts panel to edit it.</p>
          <button className="btn w-full" onClick={() => viewportActions?.cancelEditFeature()}>
            Close
          </button>
        </>
      ) : (
        <>
          <ThreadSelect value={hole.threadId} onChange={handleThreadChange} />
          <NumberField
            label="Diameter"
            value={hole.diameter}
            step={0.1}
            min={0.1}
            disabled={!!selectedThread}
            onChange={(v) => setHole({ diameter: v })}
          />
          <NumberField label="Depth" value={hole.depth} step={0.5} min={0.1} onChange={(v) => setHole({ depth: v })} />
          {selectedThread && <p className="text-xs text-slate-500">Cuts a standard internal (tapped) thread.</p>}
          {targetLabel && <p className="text-xs text-slate-500">Targeting: {targetLabel}</p>}
          <CenterOffsetNote centerOffset={hole.centerOffset} />
          <OffsetFields localOffset={hole.localOffset} onChange={(axis, v) => viewportActions?.setHoleOffset(axis, v)} />
          <div className="flex gap-2 pt-1">
            <button className="btn-primary flex-1" onClick={() => viewportActions?.applyHoleSubtract()}>
              {isEditing ? 'Save Changes' : 'Apply Boolean Subtract'}
            </button>
            <button className="btn" onClick={() => (isEditing ? viewportActions?.cancelEditFeature() : viewportActions?.cancelHolePlacement())}>
              Cancel
            </button>
          </div>
          {isEditing && (
            <button
              className="btn w-full text-red-400"
              onClick={() => {
                if (hole.targetPartId && hole.editingFeatureId) viewportActions?.deleteFeature(hole.targetPartId, hole.editingFeatureId);
              }}
            >
              Delete Feature
            </button>
          )}
        </>
      )}
    </div>
  );
}

const PRIMITIVE_SHAPES: { id: PrimitiveShape; label: string }[] = [
  { id: 'box', label: 'Block' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'washer', label: 'Washer' },
];

const PRIMITIVE_OPS: { id: PrimitiveOp; label: string }[] = [
  { id: 'union', label: 'Add (Union)' },
  { id: 'subtract', label: 'Cut (Subtract)' },
];

function PrimitivePanel() {
  const { primitive, hasModel, parts, setPrimitive, viewportActions } = useAppStore();
  const selectedThread = findThreadStandard(primitive.threadId);
  const targetLabel = parts.length > 1 ? parts.find((p) => p.id === primitive.targetPartId)?.label : null;
  const isEditing = !!primitive.editingFeatureId;

  const handleThreadChange = (id: string | null) => {
    const thread = findThreadStandard(id);
    setPrimitive({ threadId: id, ...(thread ? { diameter: thread.majorDiameterMM } : {}) });
  };

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">{isEditing ? 'Edit Primitive Feature' : 'Primitive'}</div>
      {!hasModel ? (
        <p className="text-sm text-slate-500">Load a model first.</p>
      ) : isEditing && primitive.locked ? (
        <>
          <p className="text-sm text-amber-500">This feature is locked. Unlock it from the Parts panel to edit it.</p>
          <button className="btn w-full" onClick={() => viewportActions?.cancelEditFeature()}>
            Close
          </button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1">
            {PRIMITIVE_SHAPES.map((s) => (
              <button
                key={s.id}
                className={`btn ${primitive.shape === s.id ? 'btn-icon-active border' : ''}`}
                onClick={() => setPrimitive({ shape: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1">
            {PRIMITIVE_OPS.map((op) => (
              <button
                key={op.id}
                className={`btn ${primitive.operation === op.id ? 'btn-icon-active border' : ''}`}
                onClick={() => setPrimitive({ operation: op.id })}
              >
                {op.label}
              </button>
            ))}
          </div>

          {primitive.shape === 'box' && (
            <>
              <NumberField label="Width (X)" value={primitive.width} min={0.1} onChange={(v) => setPrimitive({ width: v })} />
              <NumberField label="Depth (Y)" value={primitive.depth} min={0.1} onChange={(v) => setPrimitive({ depth: v })} />
              <NumberField label="Height (Z)" value={primitive.height} min={0.1} onChange={(v) => setPrimitive({ height: v })} />
            </>
          )}
          {primitive.shape === 'cylinder' && (
            <>
              <ThreadSelect value={primitive.threadId} onChange={handleThreadChange} />
              <NumberField
                label="Diameter"
                value={primitive.diameter}
                min={0.1}
                disabled={!!selectedThread}
                onChange={(v) => setPrimitive({ diameter: v })}
              />
              <NumberField label="Height" value={primitive.height} min={0.1} onChange={(v) => setPrimitive({ height: v })} />
              {selectedThread && (
                <p className="text-xs text-slate-500">
                  {primitive.operation === 'union'
                    ? 'External thread — added to the model as a threaded boss/stud.'
                    : 'Internal thread — cut into the model as a tapped hole.'}
                </p>
              )}
            </>
          )}
          {primitive.shape === 'washer' && (
            <>
              <NumberField label="Outer Diameter" value={primitive.diameter} min={0.1} onChange={(v) => setPrimitive({ diameter: v })} />
              <NumberField
                label="Inner Diameter"
                value={primitive.innerDiameter}
                min={0.1}
                onChange={(v) => setPrimitive({ innerDiameter: v })}
              />
              <NumberField label="Height" value={primitive.height} min={0.1} onChange={(v) => setPrimitive({ height: v })} />
            </>
          )}

          {targetLabel && <p className="text-xs text-slate-500">Targeting: {targetLabel}</p>}

          {!primitive.placed ? (
            <p className="pt-1 text-sm text-slate-400">Click a point on the model to place the primitive.</p>
          ) : (
            <>
              <CenterOffsetNote centerOffset={primitive.centerOffset} />
              <OffsetFields localOffset={primitive.localOffset} onChange={(axis, v) => viewportActions?.setPrimitiveOffset(axis, v)} />
              <div className="flex gap-2 pt-1">
                <button className="btn-primary flex-1" onClick={() => viewportActions?.applyPrimitive()}>
                  {isEditing ? 'Save Changes' : 'Apply'}
                </button>
                <button
                  className="btn"
                  onClick={() => (isEditing ? viewportActions?.cancelEditFeature() : viewportActions?.cancelPrimitivePlacement())}
                >
                  Cancel
                </button>
              </div>
              {isEditing && (
                <button
                  className="btn w-full text-red-400"
                  onClick={() => {
                    if (primitive.targetPartId && primitive.editingFeatureId)
                      viewportActions?.deleteFeature(primitive.targetPartId, primitive.editingFeatureId);
                  }}
                >
                  Delete Feature
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

const PLANE_AXES: { id: PlaneAxis; label: string }[] = [
  { id: 'x', label: 'X' },
  { id: 'y', label: 'Y' },
  { id: 'z', label: 'Z' },
];

function PlaneCutPanel() {
  const { planeCut, hasModel, setPlaneCut, viewportActions } = useAppStore();

  // A cut height of 0 is only meaningful for a model centered on that axis.
  // Models sit on the build plate at Z=0 (not centered), so re-center the
  // default height to the model's actual midpoint whenever the tool opens
  // or the axis changes — otherwise the default Z cut is a silent no-op.
  useEffect(() => {
    if (hasModel) viewportActions?.centerPlaneCutHeight(planeCut.axis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planeCut.axis, hasModel]);

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Plane Cut</div>
      {!hasModel ? (
        <p className="text-sm text-slate-500">Load a model first.</p>
      ) : (
        <>
          <PartSelector />
          <div className="grid grid-cols-3 gap-1">
            {PLANE_AXES.map((a) => (
              <button
                key={a.id}
                className={`btn ${planeCut.axis === a.id ? 'btn-icon-active border' : ''}`}
                onClick={() => setPlaneCut({ axis: a.id })}
              >
                {a.label}
              </button>
            ))}
          </div>
          <NumberField
            label={`${planeCut.axis.toUpperCase()} Height`}
            value={planeCut.height}
            onChange={(v) => setPlaneCut({ height: v })}
          />
          <p className="text-xs text-slate-500">
            Splits the model into two pieces along the {planeCut.axis.toUpperCase()} axis at the given position.
          </p>
          <button className="btn-primary w-full" onClick={() => viewportActions?.applyPlaneCut()}>
            Apply Cut
          </button>
        </>
      )}
    </div>
  );
}

function MovePanel() {
  const { hasModel, parts, selectedPartId, selectedPartPosition, snapToGrid, snapGridSizeMM, setSnapToGrid, viewportActions } = useAppStore();

  if (!hasModel) {
    return (
      <div className="panel-section">
        <div className="panel-label">Move</div>
        <p className="text-sm text-slate-500">Load a model first.</p>
      </div>
    );
  }

  const position = selectedPartPosition ?? [0, 0, 0];
  const nudgeAmount = snapToGrid ? snapGridSizeMM : 1;

  const handlePositionChange = (axisIndex: 0 | 1 | 2, value: number) => {
    if (!selectedPartId) return;
    const next: [number, number, number] = [...position] as [number, number, number];
    next[axisIndex] = value;
    viewportActions?.movePartTo(selectedPartId, next[0], next[1], next[2]);
  };

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Move</div>
      <PartSelector />
      {parts.length <= 1 && (
        <p className="text-xs text-slate-500">
          Only one part in the scene — Plane Cut produces two independently movable parts, or use Primitive to add another part.
        </p>
      )}
      <NumberField label="Position X" value={position[0]} step={0.5} onChange={(v) => handlePositionChange(0, v)} />
      <NumberField label="Position Y" value={position[1]} step={0.5} onChange={(v) => handlePositionChange(1, v)} />
      <NumberField label="Position Z" value={position[2]} step={0.5} onChange={(v) => handlePositionChange(2, v)} />

      <div className="field-row">
        <label className="text-sm text-slate-300">Snap to grid</label>
        <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
      </div>
      {snapToGrid && <p className="text-right text-xs text-slate-500">{snapGridSizeMM} mm grid</p>}

      <div className="grid grid-cols-3 gap-2 pt-1">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis} className="flex flex-col items-center gap-1">
            <span className="text-xs uppercase text-slate-500">{axis}</span>
            <div className="flex gap-1">
              <button
                className="btn"
                disabled={!selectedPartId}
                onClick={() => selectedPartId && viewportActions?.nudgePart(selectedPartId, axis, -nudgeAmount)}
              >
                −
              </button>
              <button
                className="btn"
                disabled={!selectedPartId}
                onClick={() => selectedPartId && viewportActions?.nudgePart(selectedPartId, axis, nudgeAmount)}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MeasurePanel() {
  const { hasModel, measure, viewportActions } = useAppStore();

  if (!hasModel) {
    return (
      <div className="panel-section">
        <div className="panel-label">Measure</div>
        <p className="text-sm text-slate-500">Load a model first.</p>
      </div>
    );
  }

  const { datum, point } = measure;
  let distance: number | null = null;
  let delta: [number, number, number] | null = null;
  if (datum && point) {
    delta = [point[0] - datum[0], point[1] - datum[1], point[2] - datum[2]];
    distance = Math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2);
  }

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Measure</div>
      {!datum ? (
        <p className="text-sm text-slate-400">Click a point on the model to set the datum (reference origin).</p>
      ) : !point ? (
        <>
          <p className="text-xs text-slate-500">Datum: {datum.map((v) => v.toFixed(2)).join(', ')} mm</p>
          <p className="text-sm text-slate-400">Click another point to measure from the datum.</p>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">Datum: {datum.map((v) => v.toFixed(2)).join(', ')} mm</p>
          <div className="rounded-md border border-base-700 bg-base-900 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Distance</div>
            <div className="text-lg font-semibold text-slate-100">{distance!.toFixed(3)} mm</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(['ΔX', 'ΔY', 'ΔZ'] as const).map((label, i) => (
              <div key={label} className="rounded-md border border-base-700 bg-base-900 py-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="text-sm font-medium text-slate-200">{delta![i].toFixed(2)}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">Click another point to re-measure from the same datum.</p>
        </>
      )}
      {(datum || point) && (
        <button className="btn w-full" onClick={() => viewportActions?.clearMeasure()}>
          Reset Datum
        </button>
      )}
    </div>
  );
}

export default function Sidebar() {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-base-700 bg-base-900">
      <div className="flex flex-wrap gap-1 border-b border-base-700 p-2">
        {TOOL_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`tool-tab flex flex-col items-center gap-1 ${activeTool === tab.id ? 'tool-tab-active' : ''}`}
              onClick={() => setActiveTool(tab.id)}
            >
              <Icon className="mx-auto h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <DimensionsReadout />

      {activeTool === 'select' && <SelectPanel />}
      {activeTool === 'transform' && <TransformPanel />}
      {activeTool === 'hole' && <HolePanel />}
      {activeTool === 'primitive' && <PrimitivePanel />}
      {activeTool === 'planeCut' && <PlaneCutPanel />}
      {activeTool === 'move' && <MovePanel />}
      {activeTool === 'measure' && <MeasurePanel />}
    </div>
  );
}
