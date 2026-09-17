import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Layers, Lock, MapPin, RotateCcw, Trash2, Unlock } from 'lucide-react';
import { useAppStore, type PartFeature } from '@/state/useAppStore';

function LocalOriginEditor({ partId, origin }: { partId: string; origin: [number, number, number] }) {
  const viewportActions = useAppStore((s) => s.viewportActions);
  const pickingOrigin = useAppStore((s) => s.pickingOrigin);
  const pickingOriginPartId = useAppStore((s) => s.pickingOriginPartId);
  const isPicking = pickingOrigin && pickingOriginPartId === partId;

  const handleChange = (axisIndex: 0 | 1 | 2, value: number) => {
    const next: [number, number, number] = [...origin] as [number, number, number];
    next[axisIndex] = value;
    viewportActions?.setLocalOrigin(partId, next[0], next[1], next[2]);
  };

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-base-700 bg-base-950 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Local origin</span>
        <div className="flex gap-1">
          <button
            className={`btn-icon !h-6 !w-6 ${isPicking ? 'btn-icon-active' : ''}`}
            title="Click a point on this part to set its origin there"
            onClick={() => (isPicking ? viewportActions?.cancelPickLocalOrigin() : viewportActions?.beginPickLocalOrigin(partId))}
          >
            <MapPin className="h-3 w-3" />
          </button>
          <button
            className="btn-icon !h-6 !w-6"
            title="Reset origin to the part's own center"
            onClick={() => viewportActions?.resetLocalOrigin(partId)}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
      {isPicking && <p className="text-[11px] text-accent-400">Click a point on this part in the viewport…</p>}
      <div className="grid grid-cols-3 gap-1">
        {(['X', 'Y', 'Z'] as const).map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">{label}</span>
            <input
              type="number"
              className="num-input !w-full !text-xs"
              step={0.1}
              value={origin[i]}
              onChange={(e) => handleChange(i as 0 | 1 | 2, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-slate-600">
        Hole/Primitive "Offset from origin" fields are measured from this point.
      </p>
    </div>
  );
}

function FeatureRow({ partId, feature, isSelected }: { partId: string; feature: PartFeature; isSelected: boolean }) {
  const viewportActions = useAppStore((s) => s.viewportActions);
  return (
    <div
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
        isSelected ? 'bg-accent-500/20 text-accent-200' : 'text-slate-300 hover:bg-base-800'
      }`}
    >
      <button className="flex-1 truncate text-left" onClick={() => viewportActions?.editFeature(partId, feature.id)}>
        {feature.label}
      </button>
      <button
        className="shrink-0 text-slate-500 hover:text-slate-200"
        title={feature.locked ? 'Locked — click to unlock' : 'Unlocked — click to lock (prevents edits)'}
        onClick={() => viewportActions?.toggleFeatureLock(partId, feature.id)}
      >
        {feature.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>
      <button
        className="shrink-0 text-slate-500 hover:text-red-400"
        title="Delete this feature"
        onClick={() => viewportActions?.deleteFeature(partId, feature.id)}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function PartRow({ partId, label }: { partId: string; label: string }) {
  const [expanded, setExpanded] = useState(true);
  const viewportActions = useAppStore((s) => s.viewportActions);
  const selectedPartId = useAppStore((s) => s.selectedPartId);
  const selectedFeatureId = useAppStore((s) => s.selectedFeatureId);
  const features = useAppStore((s) => s.partFeatures[partId] ?? []);
  const part = useAppStore((s) => s.parts.find((p) => p.id === partId));
  const isSelected = selectedPartId === partId;

  return (
    <div className="border-b border-base-800">
      <div
        className={`flex cursor-pointer items-center gap-1 px-2 py-2 ${isSelected ? 'bg-base-800' : ''}`}
        onClick={() => viewportActions?.selectPart(partId)}
      >
        <button
          className="shrink-0 text-slate-500 hover:text-slate-200"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Layers className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className={`flex-1 truncate text-sm ${isSelected ? 'font-medium text-slate-100' : 'text-slate-300'}`}>{label}</span>
      </div>
      {expanded && (
        <div className="px-2 pb-2 pl-6">
          {features.length > 0 ? (
            <div className="mb-1 space-y-0.5">
              {features.map((f) => (
                <FeatureRow key={f.id} partId={partId} feature={f} isSelected={selectedFeatureId === f.id} />
              ))}
            </div>
          ) : (
            <p className="pb-1 text-[11px] text-slate-600">No hole/primitive features yet.</p>
          )}
          {part && <LocalOriginEditor partId={partId} origin={part.localOrigin} />}
        </div>
      )}
    </div>
  );
}

export default function PartsPanel() {
  const parts = useAppStore((s) => s.parts);
  const hasModel = useAppStore((s) => s.hasModel);
  const collapsed = useAppStore((s) => s.partsPanelCollapsed);
  const setCollapsed = useAppStore((s) => s.setPartsPanelCollapsed);

  if (collapsed) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-r border-base-700 bg-base-900 py-2">
        <button className="btn-icon" title="Show parts list" onClick={() => setCollapsed(false)}>
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Parts</span>
        <button className="btn-icon" title="Collapse parts list" onClick={() => setCollapsed(true)}>
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>
      {!hasModel || parts.length === 0 ? (
        <p className="p-3 text-xs text-slate-500">No parts yet — import an .stl to get started.</p>
      ) : (
        <div className="flex-1">
          {parts.map((p) => (
            <PartRow key={p.id} partId={p.id} label={p.label} />
          ))}
        </div>
      )}
    </div>
  );
}
