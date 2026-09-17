import { ChangeEvent } from 'react';
import { Circle, Info, Scissors, Scale, SquarePlus } from 'lucide-react';
import {
  useAppStore,
  type PlaneAxis,
  type PrimitiveOp,
  type PrimitiveShape,
  type ToolId,
} from '@/state/useAppStore';
import { THREAD_STANDARDS, THREAD_SYSTEM_LABELS, findThreadStandard, type ThreadSystem } from '@/utils/threadStandards';

const TOOL_TABS: { id: ToolId; label: string; icon: typeof Info }[] = [
  { id: 'select', label: 'Info', icon: Info },
  { id: 'transform', label: 'Transform', icon: Scale },
  { id: 'hole', label: 'Hole', icon: Circle },
  { id: 'primitive', label: 'Primitive', icon: SquarePlus },
  { id: 'planeCut', label: 'Cut', icon: Scissors },
];

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
        <p className="text-right text-xs text-slate-500">
          ⌀{selected.majorDiameterMM.toFixed(3)} mm · {selected.tpi ? `${selected.tpi} TPI` : `${selected.pitchMM.toFixed(2)} mm pitch`}
        </p>
      )}
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
        <div className="grid grid-cols-3 gap-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="flex flex-col items-center gap-1">
              <span className="text-xs uppercase text-slate-500">{axis}</span>
              <div className="flex gap-1">
                <button className="btn" disabled={!hasModel} onClick={() => viewportActions?.rotateBy(axis, -90)}>
                  -90°
                </button>
                <button className="btn" disabled={!hasModel} onClick={() => viewportActions?.rotateBy(axis, 90)}>
                  +90°
                </button>
              </div>
            </div>
          ))}
        </div>
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
    </div>
  );
}

function HolePanel() {
  const { hole, hasModel, setHole, viewportActions } = useAppStore();
  const selectedThread = findThreadStandard(hole.threadId);

  const handleThreadChange = (id: string | null) => {
    const thread = findThreadStandard(id);
    setHole({ threadId: id, ...(thread ? { diameter: thread.majorDiameterMM } : {}) });
  };

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Hole Modifier</div>
      {!hasModel ? (
        <p className="text-sm text-slate-500">Load a model first.</p>
      ) : !hole.placed ? (
        <p className="text-sm text-slate-400">Click a point on the model to place the cutter.</p>
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
          <div className="flex gap-2 pt-1">
            <button className="btn-primary flex-1" onClick={() => viewportActions?.applyHoleSubtract()}>
              Apply Boolean Subtract
            </button>
            <button className="btn" onClick={() => viewportActions?.cancelHolePlacement()}>
              Cancel
            </button>
          </div>
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
  const { primitive, hasModel, setPrimitive, viewportActions } = useAppStore();
  const selectedThread = findThreadStandard(primitive.threadId);

  const handleThreadChange = (id: string | null) => {
    const thread = findThreadStandard(id);
    setPrimitive({ threadId: id, ...(thread ? { diameter: thread.majorDiameterMM } : {}) });
  };

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Primitive</div>
      {!hasModel ? (
        <p className="text-sm text-slate-500">Load a model first.</p>
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

          {!primitive.placed ? (
            <p className="pt-1 text-sm text-slate-400">Click a point on the model to place the primitive.</p>
          ) : (
            <div className="flex gap-2 pt-1">
              <button className="btn-primary flex-1" onClick={() => viewportActions?.applyPrimitive()}>
                Apply
              </button>
              <button className="btn" onClick={() => viewportActions?.cancelPrimitivePlacement()}>
                Cancel
              </button>
            </div>
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

  return (
    <div className="panel-section space-y-3">
      <div className="panel-label">Plane Cut</div>
      {!hasModel ? (
        <p className="text-sm text-slate-500">Load a model first.</p>
      ) : (
        <>
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

export default function Sidebar() {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-base-700 bg-base-900">
      <div className="flex gap-1 border-b border-base-700 p-2">
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
    </div>
  );
}
