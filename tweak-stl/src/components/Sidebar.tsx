import { ChangeEvent, useEffect } from 'react';
import {
  Circle,
  Cone,
  Crosshair,
  Cylinder,
  Flame,
  FlipHorizontal2,
  Info,
  Plus,
  Puzzle,
  Ruler,
  Scissors,
  Scale,
  Shapes as ShapesIcon,
  SquarePlus,
  Target,
  Torus as TorusIcon,
  Triangle,
  Box as BoxIcon,
  X,
} from 'lucide-react';
import {
  useAppStore,
  type PlaneAxis,
  type PrimitiveOp,
  type PrimitiveShape,
  type PrimitiveToolState,
  type ToolId,
  type BasicShape,
} from '@/state/useAppStore';
import { THREAD_STANDARDS, THREAD_SYSTEM_LABELS, findThreadStandard, type ThreadSystem } from '@/utils/threadStandards';
import { findPrinterProfile, threadPrintabilityWarning, effectivePrinterProfile } from '@/utils/printerProfiles';
import { mmToDisplay, displayToMM, unitSuffix, type Units } from '@/utils/units';
import { BASIC_SHAPE_LABELS } from '@/utils/shapeGeometry';
import { useNumberInput } from '@/hooks/useNumberInput';

const TOOL_TABS: { id: ToolId; label: string; icon: typeof Info }[] = [
  { id: 'select', label: 'Info', icon: Info },
  { id: 'transform', label: 'Transform', icon: Scale },
  { id: 'hole', label: 'Hole', icon: Circle },
  { id: 'primitive', label: 'Modify', icon: SquarePlus },
  { id: 'shapes', label: 'New Part', icon: ShapesIcon },
  { id: 'planeCut', label: 'Cut', icon: Scissors },
  { id: 'mate', label: 'Mate', icon: Puzzle },
  { id: 'chamfer', label: 'Chamfer', icon: Cone },
  { id: 'counterbore', label: 'C-Bore', icon: Target },
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
  suffix,
  disabled = false,
  kind = 'length',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  disabled?: boolean;
  /** 'length' converts to/from the app's mm/in unit setting; 'plain' passes the value through untouched (degrees, counts, …). */
  kind?: 'length' | 'plain';
}) {
  const units = useAppStore((s) => s.units);
  const displayValue = kind === 'length' ? mmToDisplay(value, units) : value;
  const handleValueChange = (v: number) => onChange(kind === 'length' ? displayToMM(v, units) : v);
  const { text, handleChange, handleFocus, handleBlur } = useNumberInput(displayValue, handleValueChange);
  const resolvedSuffix = suffix ?? (kind === 'length' ? unitSuffix(units) : '');

  return (
    <div className="field-row">
      <label className="text-sm text-slate-300">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="decimal"
          className="num-input disabled:cursor-not-allowed disabled:opacity-40"
          value={text}
          disabled={disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={handleChange}
        />
        {resolvedSuffix && <span className="w-6 text-xs text-slate-500">{resolvedSuffix}</span>}
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
  const nozzleOverrideMM = useAppStore((s) => s.nozzleOverrideMM);
  const profile = effectivePrinterProfile(findPrinterProfile(printerProfileId), nozzleOverrideMM);
  const warning = threadPrintabilityWarning(profile, majorDiameterMM, pitchMM);
  if (!warning) return null;
  return <p className="text-xs text-amber-500">{warning}</p>;
}

/** Read-only reference readout: how far a pending/edited placement sits from the target part's own bounding-box center — matches the cyan centerlines drawn in the viewport. */
function CenterOffsetNote({ centerOffset }: { centerOffset: [number, number, number] | null }) {
  const units = useAppStore((s) => s.units);
  if (!centerOffset) return null;
  const fmt = (mm: number) => `${mmToDisplay(mm, units).toFixed(units === 'in' ? 3 : 2)} ${unitSuffix(units)}`;
  return (
    <p className="text-[11px] text-slate-500">
      Δ from part center — X: {fmt(centerOffset[0])}, Y: {fmt(centerOffset[1])}, Z: {fmt(centerOffset[2])}
    </p>
  );
}

function OffsetAxisInput({
  axis,
  valueMM,
  units,
  onChange,
}: {
  axis: PlaneAxis;
  valueMM: number;
  units: Units;
  onChange: (axis: PlaneAxis, value: number) => void;
}) {
  const displayValue = mmToDisplay(valueMM, units);
  const { text, handleChange, handleFocus, handleBlur } = useNumberInput(displayValue, (v) => onChange(axis, displayToMM(v, units)));
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-slate-500">{axis}</span>
      <input
        type="text"
        inputMode="decimal"
        className="num-input !w-full !text-xs"
        value={text}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
      />
    </div>
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
  const units = useAppStore((s) => s.units);
  if (!localOffset) return null;
  return (
    <div className="space-y-1">
      <div className="panel-label !mb-1">Offset from local origin</div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <OffsetAxisInput key={axis} axis={axis} valueMM={localOffset[i]} units={units} onChange={onChange} />
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
  const units = useAppStore((s) => s.units);
  const buildVolumeWarning = useAppStore((s) => s.buildVolumeWarning);
  return (
    <div className="panel-section">
      <div className="panel-label">Bounding Box</div>
      {hasModel ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="rounded-md border border-base-700 bg-base-900 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{axis}</div>
              <div className="text-sm font-medium text-slate-200">
                {mmToDisplay(dimensions[axis], units).toFixed(units === 'in' ? 3 : 1)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No model loaded.</p>
      )}
      {hasModel && buildVolumeWarning && (
        <p className="mt-2 text-xs text-red-400">
          {buildVolumeWarning} The faint boundary box in the viewport shows the plate's printable envelope.
        </p>
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
  const { transform, dimensions, hasModel, parts, selectedPartId, setTransform, viewportActions } = useAppStore();
  const selectedPart = parts.find((p) => p.id === selectedPartId);
  const transformLocked = !!selectedPart?.locked;

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
            disabled={transformLocked}
            onChange={(e) => setTransform({ uniformScale: e.target.checked })}
          />
        </div>
        <NumberField label="Width (X)" value={dimensions.x} disabled={transformLocked} onChange={(v) => handleAxisChange('x', v)} />
        <NumberField label="Depth (Y)" value={dimensions.y} disabled={transformLocked} onChange={(v) => handleAxisChange('y', v)} />
        <NumberField label="Height (Z)" value={dimensions.z} disabled={transformLocked} onChange={(v) => handleAxisChange('z', v)} />
        <p className="text-[11px] text-slate-500">
          Scaling permanently folds this part's existing Hole/Primitive features into its base shape — see the Parts panel.
        </p>
      </div>

      <div className="panel-section">
        <div className="panel-label">Rotate</div>
        <div className="space-y-1.5">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="field-row">
              <span className="text-sm uppercase text-slate-300">{axis}</span>
              <div className="flex gap-1.5">
                <button className="btn w-20" disabled={!hasModel || transformLocked} onClick={() => viewportActions?.rotateBy(axis, -90)}>
                  −90°
                </button>
                <button className="btn w-20" disabled={!hasModel || transformLocked} onClick={() => viewportActions?.rotateBy(axis, 90)}>
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
            <FreeAngleInput value={transform.freeRotateDegrees} onChange={(v) => setTransform({ freeRotateDegrees: v })} />
            <span className="text-xs text-slate-500">°</span>
          </div>
        </div>
        <button
          className="btn w-full"
          disabled={!hasModel || transformLocked || transform.freeRotateDegrees === 0}
          onClick={() => viewportActions?.rotateBy(transform.freeRotateAxis, transform.freeRotateDegrees)}
        >
          Rotate
        </button>
      </div>

      <MovePanel />
      {transformLocked && <p className="px-4 pb-2 text-[11px] text-amber-500">Part locked — unlock it in the Parts panel to transform or move it.</p>}

      <div className="panel-section space-y-2">
        <div className="panel-label">Mirror</div>
        <div className="grid grid-cols-3 gap-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <button
              key={axis}
              className="btn flex items-center justify-center gap-1"
              disabled={!hasModel || transformLocked}
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

function FreeAngleInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { text, handleChange, handleFocus, handleBlur } = useNumberInput(value, onChange, 2);
  return (
    <input
      type="text"
      inputMode="decimal"
      className="num-input"
      value={text}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
    />
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
          <NumberField label="Diameter" value={hole.diameter} disabled={!!selectedThread} onChange={(v) => setHole({ diameter: v })} />
          <NumberField label="Depth" value={hole.depth} onChange={(v) => setHole({ depth: v })} />
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
  { id: 'chamfer', label: 'Chamfer' },
];

const PRIMITIVE_OPS: { id: PrimitiveOp; label: string }[] = [
  { id: 'union', label: 'Add (Union)' },
  { id: 'subtract', label: 'Cut (Subtract)' },
];

/** Warns when a Quick Chamfer/Counterbore's diameter no longer actually clears the hole it was placed against — shown only when referenceHoleDiameterMM is set (i.e. this primitive was placed via the quick-detect flow, not typed in manually). */
function ReferenceHoleWarning({ primitive }: { primitive: PrimitiveToolState }) {
  const ref = primitive.referenceHoleDiameterMM;
  if (ref == null) return null;
  const clearDiameter = primitive.shape === 'chamfer' ? primitive.innerDiameter : primitive.diameter;
  const label = primitive.shape === 'chamfer' ? 'inner diameter' : 'diameter';
  if (clearDiameter >= ref - 0.001) return null;
  return (
    <p className="text-xs text-amber-500">
      This hole is {ref.toFixed(2)}mm — the {label} here ({clearDiameter.toFixed(2)}mm) is smaller, so it won't fully clear it.
    </p>
  );
}

/**
 * Chamfer and Counterbore aren't tools you configure up front — click near
 * an existing hole and StitchMesh snaps to its true center/axis, reads its
 * diameter, and hands off straight to the Modify panel (shape pre-set,
 * point/normal/diameter already filled in from the hole) so you land right
 * on the fields to check or adjust before Apply. This panel only ever
 * shows the "waiting for that click" state — once it succeeds, the active
 * tool switches to Modify automatically.
 */
function QuickFeaturePanel({ kind }: { kind: 'chamfer' | 'counterbore' }) {
  const hasModel = useAppStore((s) => s.hasModel);
  const label = kind === 'chamfer' ? 'Chamfer' : 'Counterbore';
  return (
    <div className="panel-section space-y-2">
      <div className="panel-label">{label}</div>
      {!hasModel ? (
        <p className="text-sm text-slate-500">Load a model first.</p>
      ) : (
        <>
          <p className="text-sm text-slate-400">
            Click near an existing <strong>Hole</strong> feature's opening — StitchMesh snaps to its true center and axis direction
            automatically, so you don't have to line anything up by hand.
          </p>
          <p className="text-[11px] text-slate-500">
            {kind === 'chamfer'
              ? "Opens the Modify panel with a cone already sized to blend into that hole — Diameter is the wider opening at the surface, Inner Diameter matches the hole exactly, and Depth defaults to a clean 45° bevel. Adjust any of them, or click Apply as-is."
              : 'Opens the Modify panel with a straight recess already centered on that hole, sized for a bolt head to sit in — check Diameter and Depth against your actual hardware, then click Apply.'}
          </p>
          <p className="text-[11px] text-slate-600">Clicking somewhere that isn't close to a hole does nothing — try again closer to its opening.</p>
        </>
      )}
    </div>
  );
}

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
      <div className="panel-label">{isEditing ? 'Edit Modifier' : 'Modify Part'}</div>
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
          <div className="grid grid-cols-4 gap-1">
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
              <NumberField label="Width (X)" value={primitive.width} onChange={(v) => setPrimitive({ width: v })} />
              <NumberField label="Depth (Y)" value={primitive.depth} onChange={(v) => setPrimitive({ depth: v })} />
              <NumberField label="Height (Z)" value={primitive.height} onChange={(v) => setPrimitive({ height: v })} />
            </>
          )}
          {primitive.shape === 'cylinder' && (
            <>
              <ThreadSelect value={primitive.threadId} onChange={handleThreadChange} />
              <NumberField label="Diameter" value={primitive.diameter} disabled={!!selectedThread} onChange={(v) => setPrimitive({ diameter: v })} />
              <NumberField label="Height" value={primitive.height} onChange={(v) => setPrimitive({ height: v })} />
              {selectedThread && (
                <p className="text-xs text-slate-500">
                  {primitive.operation === 'union'
                    ? 'External thread — added to the model as a threaded boss/stud.'
                    : 'Internal thread — cut into the model as a tapped hole.'}
                </p>
              )}
              <ReferenceHoleWarning primitive={primitive} />
            </>
          )}
          {primitive.shape === 'washer' && (
            <>
              <NumberField label="Outer Diameter" value={primitive.diameter} onChange={(v) => setPrimitive({ diameter: v })} />
              <NumberField label="Inner Diameter" value={primitive.innerDiameter} onChange={(v) => setPrimitive({ innerDiameter: v })} />
              <NumberField label="Height" value={primitive.height} onChange={(v) => setPrimitive({ height: v })} />
            </>
          )}
          {primitive.shape === 'chamfer' && (
            <>
              <NumberField label="Diameter" value={primitive.diameter} onChange={(v) => setPrimitive({ diameter: v })} />
              <NumberField label="Inner Diameter" value={primitive.innerDiameter} onChange={(v) => setPrimitive({ innerDiameter: v })} />
              <NumberField label="Depth" value={primitive.height} onChange={(v) => setPrimitive({ height: v })} />
              <p className="text-[11px] text-slate-500">
                A cone from <strong>Diameter</strong> at the surface down to <strong>Inner Diameter</strong> over <strong>Depth</strong> — set
                Inner Diameter to match the hole it opens into for a clean blend, no visible step.
              </p>
              <ReferenceHoleWarning primitive={primitive} />
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

const BASIC_SHAPES: { id: BasicShape; icon: typeof BoxIcon }[] = [
  { id: 'box', icon: BoxIcon },
  { id: 'cylinder', icon: Cylinder },
  { id: 'sphere', icon: Circle },
  { id: 'cone', icon: Cone },
  { id: 'pyramid', icon: Triangle },
  { id: 'torus', icon: TorusIcon },
];

function ShapesPanel() {
  const { shapeTool, hasModel, setShapeTool, viewportActions } = useAppStore();

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Shapes Toolbox</div>
      <p className="text-xs text-slate-500">Adds a brand-new independent part built from a basic solid — not a modifier on the current part.</p>
      <div className="grid grid-cols-3 gap-1.5">
        {BASIC_SHAPES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            className={`btn flex flex-col items-center gap-1 !py-2 ${shapeTool.shape === id ? 'btn-icon-active border' : ''}`}
            onClick={() => setShapeTool({ shape: id })}
          >
            <Icon className="h-4 w-4" />
            <span className="text-[11px]">{BASIC_SHAPE_LABELS[id]}</span>
          </button>
        ))}
      </div>

      {shapeTool.shape === 'box' && (
        <>
          <NumberField label="Width (X)" value={shapeTool.width} onChange={(v) => setShapeTool({ width: v })} />
          <NumberField label="Depth (Y)" value={shapeTool.depth} onChange={(v) => setShapeTool({ depth: v })} />
          <NumberField label="Height (Z)" value={shapeTool.height} onChange={(v) => setShapeTool({ height: v })} />
        </>
      )}
      {(shapeTool.shape === 'cylinder' || shapeTool.shape === 'cone' || shapeTool.shape === 'pyramid') && (
        <>
          <NumberField label="Diameter" value={shapeTool.diameter} onChange={(v) => setShapeTool({ diameter: v })} />
          <NumberField label="Height" value={shapeTool.height} onChange={(v) => setShapeTool({ height: v })} />
        </>
      )}
      {shapeTool.shape === 'sphere' && <NumberField label="Diameter" value={shapeTool.diameter} onChange={(v) => setShapeTool({ diameter: v })} />}
      {shapeTool.shape === 'torus' && (
        <>
          <NumberField label="Outer Diameter" value={shapeTool.diameter} onChange={(v) => setShapeTool({ diameter: v })} />
          <NumberField label="Tube Diameter" value={shapeTool.tubeDiameter} onChange={(v) => setShapeTool({ tubeDiameter: v })} />
        </>
      )}

      <div className="field-row pt-1">
        <label className="text-sm text-slate-300">Split in half on create</label>
        <input
          type="checkbox"
          checked={shapeTool.splitOnCreate}
          onChange={(e) => setShapeTool({ splitOnCreate: e.target.checked })}
        />
      </div>
      {shapeTool.splitOnCreate && (
        <div className="grid grid-cols-3 gap-1">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <button
              key={axis}
              className={`btn ${shapeTool.splitAxis === axis ? 'btn-icon-active border' : ''}`}
              onClick={() => setShapeTool({ splitAxis: axis })}
            >
              {axis.toUpperCase()} axis
            </button>
          ))}
        </div>
      )}

      <button className="btn-primary w-full" onClick={() => viewportActions?.addBasicShape()} disabled={!viewportActions}>
        {hasModel ? 'Add to Scene' : 'Add Shape'}
      </button>
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
          <NumberField label={`${planeCut.axis.toUpperCase()} Height`} value={planeCut.height} onChange={(v) => setPlaneCut({ height: v })} />
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

/** How close two picked features' diameters need to be before Smart Fit offers to treat them as "the same size" (a pin into its hole). */
const SMART_FIT_DIAMETER_TOLERANCE_MM = 0.3;

function MateOffsetFields() {
  const { mate, viewportActions } = useAppStore();
  if (!mate.offsetUV) return null;
  return (
    <div className="space-y-1.5 border-t border-base-700 pt-3">
      <div className="panel-label !mb-1">Offset (B relative to A)</div>
      <p className="text-[11px] text-slate-500">
        Exact position of B within the mated plane, relative to A's picked point. Type a value if you already know where B needs to land — no
        need to eyeball a Flush Edge pick.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="U" value={mate.offsetUV[0]} onChange={(v) => viewportActions?.setMateOffsetU(v)} />
        <NumberField label="V" value={mate.offsetUV[1]} onChange={(v) => viewportActions?.setMateOffsetV(v)} />
      </div>
    </div>
  );
}

function MateBestFitPanel() {
  const { mate, viewportActions } = useAppStore();
  const totalPairs = 1 + mate.extraPairsA.length; // the initial A/B anchor pick always counts as pair #1
  const canCompute = totalPairs >= 3;
  return (
    <div className="space-y-1.5 border-t border-base-700 pt-3">
      <div className="panel-label !mb-1">Best Fit (multipoint)</div>
      <p className="text-[11px] text-slate-500">
        For a mating surface a single flat face can't fully pin down (stepped, irregular, or off-center): pick 3 or more matching point pairs on A
        and B, then compute the rotation + position that best lines them all up at once.
      </p>
      <p className="text-xs text-slate-400">
        {totalPairs} point pair{totalPairs === 1 ? '' : 's'} picked{canCompute ? '' : ` — need ${3 - totalPairs} more`}.
      </p>
      <div className="flex gap-2">
        <button className="btn flex-1" onClick={() => viewportActions?.beginPairPick()}>
          <Plus className="mr-1 inline h-3.5 w-3.5" />
          Add Point Pair
        </button>
        {mate.extraPairsA.length > 0 && (
          <button className="btn-icon" title="Remove last pair" onClick={() => viewportActions?.removeLastPair()}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button className="btn-primary w-full" disabled={!canCompute} onClick={() => viewportActions?.applyBestFit()}>
        <Crosshair className="mr-1 inline h-3.5 w-3.5" />
        Compute Best Fit
      </button>
    </div>
  );
}

function MatePanel() {
  const { hasModel, parts, mate, viewportActions } = useAppStore();

  if (!hasModel) {
    return (
      <div className="panel-section">
        <div className="panel-label">Mate</div>
        <p className="text-sm text-slate-500">Load a model first.</p>
      </div>
    );
  }
  if (parts.length < 2) {
    return (
      <div className="panel-section">
        <div className="panel-label">Mate</div>
        <p className="text-sm text-slate-500">Add a second part (Add Part, Shapes, or Plane Cut) before mating two parts together.</p>
      </div>
    );
  }

  const labelOf = (partId: string | undefined) => parts.find((p) => p.id === partId)?.label ?? '…';
  const axisTag = (anchor: typeof mate.a) =>
    anchor?.isAxis ? <span className="ml-1 text-accent-400">(⌀{anchor.diameterMM?.toFixed(2)}mm axis)</span> : null;

  const canSmartFit =
    !!mate.a?.isAxis && !!mate.b?.isAxis && Math.abs((mate.a.diameterMM ?? 0) - (mate.b.diameterMM ?? 0)) <= SMART_FIT_DIAMETER_TOLERANCE_MM;

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Mate</div>

      {mate.stage === 'pickA' && (
        <p className="text-sm text-slate-400">
          Click a face on the FIRST (stationary) part — or click near a hole or round boss to snap to its own axis instead.
        </p>
      )}
      {mate.stage === 'pickB' && (
        <>
          <p className="text-xs text-slate-500">
            Part A: {labelOf(mate.a?.partId)}
            {axisTag(mate.a)}
          </p>
          <p className="text-sm text-slate-400">Now click a face (or a hole/boss) on the SECOND part to mate to it.</p>
        </>
      )}
      {mate.stage === 'ready' && (
        <>
          <p className="text-xs text-slate-500">
            Part A: {labelOf(mate.a?.partId)}
            {axisTag(mate.a)} · Part B: {labelOf(mate.b?.partId)}
            {axisTag(mate.b)}
          </p>
          <p className="text-sm text-slate-400">
            {mate.fitted ? 'Fitted — B is now flush against A, facing it.' : 'Click Fit to rotate and slide B flush against A, facing it.'}
          </p>
          {canSmartFit && (
            <div className="rounded-md border border-accent-600/40 bg-accent-500/10 p-2">
              <p className="mb-1.5 text-xs text-accent-300">
                Both picks are ⌀{mate.a?.diameterMM?.toFixed(2)}mm / ⌀{mate.b?.diameterMM?.toFixed(2)}mm hole/boss axes — close enough to treat as
                the same size.
              </p>
              <button className="btn-primary w-full" onClick={() => viewportActions?.applyAxisFit()}>
                <Crosshair className="mr-1 inline h-3.5 w-3.5" />
                Smart Fit (make coaxial)
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => viewportActions?.applyMateFit()}>
              {mate.fitted ? 'Re-fit' : 'Fit (flush faces)'}
            </button>
            <button className="btn" onClick={() => viewportActions?.cancelMate()}>
              Start Over
            </button>
          </div>

          {mate.fitted && (
            <>
              <MateOffsetFields />
              <div className="space-y-2 border-t border-base-700 pt-3">
                <div className="panel-label !mb-1">Flush Edge (optional)</div>
                <p className="text-[11px] text-slate-500">
                  Click a reference point near an edge/corner on each part, then Align Edge — slides B within the mated plane so the two points
                  line up.
                </p>
                <button
                  className="btn w-full"
                  onClick={() => useAppStore.getState().setMate({ stage: 'pickEdgeA', edgeA: null, edgeB: null })}
                >
                  Pick Edge Points
                </button>
              </div>
            </>
          )}
          <MateBestFitPanel />
          {mate.fitted && (
            <div className="space-y-2 border-t border-base-700 pt-3">
              <button className="btn-primary w-full" onClick={() => viewportActions?.weldMatedParts()}>
                <Flame className="mr-1 inline h-3.5 w-3.5" />
                Weld
              </button>
              <p className="text-[11px] text-slate-500">
                Weld permanently merges A and B into one part (a real boolean union) — they can no longer be moved independently afterward.
              </p>
            </div>
          )}
        </>
      )}
      {(mate.stage === 'pickEdgeA' || mate.stage === 'pickEdgeB') && (
        <>
          <p className="text-sm text-slate-400">
            {mate.stage === 'pickEdgeA'
              ? `Click a reference point near an edge on Part A (${labelOf(mate.a?.partId)}).`
              : `Now click the matching reference point on Part B (${labelOf(mate.b?.partId)}).`}
          </p>
          <button className="btn w-full" onClick={() => useAppStore.getState().setMate({ stage: 'ready', edgeA: null, edgeB: null })}>
            Cancel Edge Pick
          </button>
        </>
      )}
      {mate.stage === 'edgeReady' && (
        <>
          <p className="text-sm text-slate-400">Both edge points picked.</p>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => viewportActions?.applyFlushEdge()}>
              Align Edge
            </button>
            <button className="btn" onClick={() => useAppStore.getState().setMate({ stage: 'ready', edgeA: null, edgeB: null })}>
              Cancel
            </button>
          </div>
        </>
      )}
      {(mate.stage === 'pickPairA' || mate.stage === 'pickPairB') && (
        <>
          <p className="text-sm text-slate-400">
            {mate.stage === 'pickPairA'
              ? `Click a point pair, starting on Part A (${labelOf(mate.a?.partId)}) — a hole/boss click snaps to its center.`
              : `Now click the matching point on Part B (${labelOf(mate.b?.partId)}).`}
          </p>
          <button className="btn w-full" onClick={() => useAppStore.getState().setMate({ stage: 'ready' })}>
            Cancel
          </button>
        </>
      )}

      {mate.stage === 'pickB' && (
        <button className="btn w-full" onClick={() => viewportActions?.cancelMate()}>
          Start Over
        </button>
      )}
    </div>
  );
}

function MovePanel() {
  const { hasModel, parts, selectedPartId, selectedPartPosition, snapToGrid, snapGridSizeMM, units, setSnapToGrid, viewportActions } =
    useAppStore();

  if (!hasModel) {
    return (
      <div className="panel-section">
        <div className="panel-label">Move</div>
        <p className="text-sm text-slate-500">Load a model first.</p>
      </div>
    );
  }

  const position = selectedPartPosition ?? [0, 0, 0];
  const selectedPart = parts.find((p) => p.id === selectedPartId);
  const nudgeAmountMM = snapToGrid ? snapGridSizeMM : 1;

  const handlePositionChange = (axisIndex: 0 | 1 | 2, value: number) => {
    if (!selectedPartId) return;
    const next: [number, number, number] = [...position] as [number, number, number];
    next[axisIndex] = value;
    viewportActions?.movePartTo(selectedPartId, next[0], next[1], next[2]);
  };

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Move</div>
      {parts.length <= 1 && (
        <p className="text-xs text-slate-500">
          Only one part in the scene — Plane Cut produces two independently movable parts, or use Shapes/Add Part to add another.
        </p>
      )}
      <p className="text-[11px] text-slate-500">
        Drag the arrows on the selected part directly in the viewport, or type exact positions below. A part with Lock to plate on
        (Parts panel) can also be dragged directly — left-click and slide it across the build plate, no arrows needed.
      </p>
      <NumberField label="Position X" value={position[0]} disabled={!!selectedPart?.locked} onChange={(v) => handlePositionChange(0, v)} />
      <NumberField label="Position Y" value={position[1]} disabled={!!selectedPart?.locked} onChange={(v) => handlePositionChange(1, v)} />
      <NumberField label="Position Z" value={position[2]} disabled={!!selectedPart?.lockToPlate || !!selectedPart?.locked} onChange={(v) => handlePositionChange(2, v)} />
      {selectedPart?.locked && <p className="text-[11px] text-amber-500">Part locked — unlock it from the Parts panel before moving or transforming.</p>}
      {selectedPart?.lockToPlate && !selectedPart?.locked && (
        <p className="text-[11px] text-amber-500">Locked to plate — Z stays pinned to the build plate. Toggle it off in the Parts panel to move it.</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button className="btn" disabled={!selectedPartId || !!selectedPart?.locked} onClick={() => viewportActions?.centerToOrigin()}>
          Center to Origin
        </button>
        <button
          className="btn"
          disabled={!selectedPartId || !!selectedPart?.locked}
          title="Sets Z so the part's lowest point rests on the build plate — the fix if scaling or rotating left it floating or clipping through the plate."
          onClick={() => viewportActions?.dropToBuildPlate()}
        >
          Drop to Build Plate
        </button>
      </div>

      <div className="field-row">
        <label className="text-sm text-slate-300">Snap to grid</label>
        <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
      </div>
      {snapToGrid && (
        <p className="text-right text-xs text-slate-500">
          {mmToDisplay(snapGridSizeMM, units).toFixed(units === 'in' ? 3 : 1)} {unitSuffix(units)} grid
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 pt-1">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis} className="flex flex-col items-center gap-1">
            <span className="text-xs uppercase text-slate-500">{axis}</span>
            <div className="flex gap-1">
              <button
                className="btn"
                disabled={!selectedPartId || !!selectedPart?.locked || (axis === 'z' && selectedPart?.lockToPlate)}
                onClick={() => selectedPartId && viewportActions?.nudgePart(selectedPartId, axis, -nudgeAmountMM)}
              >
                −
              </button>
              <button
                className="btn"
                disabled={!selectedPartId || !!selectedPart?.locked || (axis === 'z' && selectedPart?.lockToPlate)}
                onClick={() => selectedPartId && viewportActions?.nudgePart(selectedPartId, axis, nudgeAmountMM)}
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
  const { hasModel, measure, units, viewportActions } = useAppStore();

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
  const fmt = (mm: number) => mmToDisplay(mm, units).toFixed(units === 'in' ? 3 : 2);

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Measure</div>
      {!datum ? (
        <p className="text-sm text-slate-400">Click a point on the model to set the datum (reference origin).</p>
      ) : !point ? (
        <>
          <p className="text-xs text-slate-500">
            Datum: {datum.map((v) => fmt(v)).join(', ')} {unitSuffix(units)}
          </p>
          <p className="text-sm text-slate-400">Click another point to measure from the datum.</p>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Datum: {datum.map((v) => fmt(v)).join(', ')} {unitSuffix(units)}
          </p>
          <div className="rounded-md border border-base-700 bg-base-900 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Distance</div>
            <div className="text-lg font-semibold text-slate-100">
              {fmt(distance!)} {unitSuffix(units)}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {(['ΔX', 'ΔY', 'ΔZ'] as const).map((label, i) => (
              <div key={label} className="rounded-md border border-base-700 bg-base-900 py-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="text-sm font-medium text-slate-200">{fmt(delta![i])}</div>
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
      {activeTool === 'shapes' && <ShapesPanel />}
      {activeTool === 'planeCut' && <PlaneCutPanel />}
      {activeTool === 'mate' && <MatePanel />}
      {activeTool === 'chamfer' && <QuickFeaturePanel kind="chamfer" />}
      {activeTool === 'counterbore' && <QuickFeaturePanel kind="counterbore" />}
      {activeTool === 'measure' && <MeasurePanel />}
    </div>
  );
}
