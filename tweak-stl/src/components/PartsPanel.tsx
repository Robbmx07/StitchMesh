import { useEffect, useRef, useState } from 'react';
import {
  Anchor,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
  Focus,
  Layers,
  Lock,
  LockKeyhole,
  MapPin,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useAppStore, type PartFeature } from '@/state/useAppStore';
import { mmToDisplay, displayToMM, type Units } from '@/utils/units';
import { useNumberInput } from '@/hooks/useNumberInput';

/** Closes an open row menu on any pointerdown outside `ref`'s subtree (which must contain both the menu-toggle button and the menu itself, so toggling isn't fought by this same listener). */
function useCloseMenuOnOutsideClick(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);
  return ref;
}

function OriginAxisInput({ label, valueMM, units, onChange }: { label: string; valueMM: number; units: Units; onChange: (v: number) => void }) {
  const displayValue = mmToDisplay(valueMM, units);
  const { text, handleChange, handleFocus, handleBlur } = useNumberInput(displayValue, (v) => onChange(displayToMM(v, units)));
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-500">{label}</span>
      <input type="text" inputMode="decimal" className="num-input !w-full !text-xs" value={text} onFocus={handleFocus} onBlur={handleBlur} onChange={handleChange} />
    </div>
  );
}

function LocalOriginEditor({ partId, origin }: { partId: string; origin: [number, number, number] }) {
  const viewportActions = useAppStore((s) => s.viewportActions);
  const pickingOrigin = useAppStore((s) => s.pickingOrigin);
  const pickingOriginPartId = useAppStore((s) => s.pickingOriginPartId);
  const units = useAppStore((s) => s.units);
  const isPicking = pickingOrigin && pickingOriginPartId === partId;
  const handleChange = (axisIndex: 0 | 1 | 2, value: number) => {
    const next: [number, number, number] = [...origin] as [number, number, number];
    next[axisIndex] = value;
    viewportActions?.setLocalOrigin(partId, next[0], next[1], next[2]);
  };
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-base-700 bg-base-950 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Reference origin</span>
        <div className="flex gap-1">
          <button className={`btn-icon !h-6 !w-6 ${isPicking ? 'btn-icon-active' : ''}`} title="Click a point on this part to set its origin" onClick={() => (isPicking ? viewportActions?.cancelPickLocalOrigin() : viewportActions?.beginPickLocalOrigin(partId))}>
            <MapPin className="h-3 w-3" />
          </button>
          <button className="btn-icon !h-6 !w-6" title="Reset origin to the part center" onClick={() => viewportActions?.resetLocalOrigin(partId)}>
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
      {isPicking && <p className="text-[11px] text-accent-400">Click a point on this part in the viewport…</p>}
      <div className="grid grid-cols-3 gap-1">
        {(['X', 'Y', 'Z'] as const).map((label, i) => <OriginAxisInput key={label} label={label} valueMM={origin[i]} units={units} onChange={(v) => handleChange(i as 0 | 1 | 2, v)} />)}
      </div>
      <p className="text-[10px] leading-snug text-slate-600">Hole/Primitive placement offsets are measured from this reference.</p>
    </div>
  );
}

function FeatureMenu({ partId, feature, close }: { partId: string; feature: PartFeature; close: () => void }) {
  const viewportActions = useAppStore((s) => s.viewportActions);
  const rename = () => {
    const next = window.prompt('Feature name', feature.label);
    if (next?.trim()) viewportActions?.renameFeature(partId, feature.id, next);
    close();
  };
  return (
    <div className="absolute right-1 top-7 z-50 w-44 rounded-md border border-base-600 bg-base-900 p-1 shadow-xl">
      <button className="menu-item" onClick={() => { viewportActions?.focusFeature(partId, feature.id); close(); }}><Focus className="h-3.5 w-3.5" />Edit / focus</button>
      <button className="menu-item" onClick={rename}><Pencil className="h-3.5 w-3.5" />Rename</button>
      <button className="menu-item" onClick={() => { viewportActions?.setFeatureVisible(partId, feature.id, !feature.visible); close(); }}><Eye className="h-3.5 w-3.5" />{feature.visible ? 'Hide feature' : 'Show feature'}</button>
      <button className="menu-item" onClick={() => { viewportActions?.toggleFeatureLock(partId, feature.id); close(); }}><Lock className="h-3.5 w-3.5" />{feature.locked ? 'Unlock feature' : 'Lock feature'}</button>
      <div className="my-1 border-t border-base-700" />
      <button className="menu-item text-red-400 hover:text-red-300" onClick={() => { viewportActions?.deleteFeature(partId, feature.id); close(); }}><Trash2 className="h-3.5 w-3.5" />Delete feature</button>
    </div>
  );
}

function FeatureRow({ partId, feature, isSelected }: { partId: string; feature: PartFeature; isSelected: boolean }) {
  const viewportActions = useAppStore((s) => s.viewportActions);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  const menuRef = useCloseMenuOnOutsideClick(menuOpen, closeMenu);
  return (
    <div ref={menuRef} className={`relative flex items-center gap-1 rounded px-1.5 py-1 text-xs ${isSelected ? 'bg-accent-500/20 text-accent-200' : 'text-slate-300 hover:bg-base-800'}`} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}>
      <button className="shrink-0 text-slate-500 hover:text-slate-200" title={feature.visible ? 'Hide feature' : 'Show feature'} onClick={() => viewportActions?.setFeatureVisible(partId, feature.id, !feature.visible)}>
        {feature.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
      </button>
      <button className="flex-1 truncate text-left" onDoubleClick={() => { const next = window.prompt('Feature name', feature.label); if (next?.trim()) viewportActions?.renameFeature(partId, feature.id, next); }} onClick={() => viewportActions?.editFeature(partId, feature.id)}>
        {feature.label}
      </button>
      <button className="shrink-0 text-slate-500 hover:text-slate-200" title={feature.locked ? 'Unlock feature' : 'Lock feature'} onClick={() => viewportActions?.toggleFeatureLock(partId, feature.id)}>
        {feature.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>
      <button className="shrink-0 text-slate-500 hover:text-slate-200" title="Feature actions" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}><MoreVertical className="h-3 w-3" /></button>
      {menuOpen && <FeatureMenu partId={partId} feature={feature} close={closeMenu} />}
    </div>
  );
}

function PartMenu({ partId, close }: { partId: string; close: () => void }) {
  const viewportActions = useAppStore((s) => s.viewportActions);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const part = useAppStore((s) => s.parts.find((p) => p.id === partId));
  if (!part) return null;
  const rename = () => { const next = window.prompt('Part name', part.label); if (next?.trim()) viewportActions?.renamePart(partId, next); close(); };
  return (
    <div className="absolute right-1 top-8 z-50 w-52 rounded-md border border-base-600 bg-base-900 p-1 shadow-xl">
      <button className="menu-item" onClick={rename}><Pencil className="h-3.5 w-3.5" />Rename part</button>
      <button className="menu-item" onClick={() => { viewportActions?.duplicatePart(partId); close(); }}><Copy className="h-3.5 w-3.5" />Duplicate</button>
      <button className="menu-item" onClick={() => { viewportActions?.isolatePart(partId); close(); }}><Focus className="h-3.5 w-3.5" />Isolate part</button>
      <button className="menu-item" onClick={() => { viewportActions?.showAllParts(); close(); }}><Layers className="h-3.5 w-3.5" />Show all parts</button>
      <div className="my-1 border-t border-base-700" />
      <button className="menu-item" onClick={() => { viewportActions?.setPartLocked(partId, !part.locked); close(); }}><LockKeyhole className="h-3.5 w-3.5" />{part.locked ? 'Unlock part' : 'Lock part'}</button>
      <button className="menu-item" onClick={() => { viewportActions?.setLockToPlate(partId, !part.lockToPlate); close(); }}><Anchor className="h-3.5 w-3.5" />{part.lockToPlate ? 'Unlock from plate' : 'Lock to plate'}</button>
      <div className="my-1 border-t border-base-700" />
      <button className="menu-item" onClick={() => { setActiveTool('transform'); close(); }}>Transform</button>
      <button className="menu-item" onClick={() => { setActiveTool('hole'); close(); }}>Add hole</button>
      <button className="menu-item" onClick={() => { setActiveTool('primitive'); close(); }}>Modify part</button>
      <div className="my-1 border-t border-base-700" />
      <button className="menu-item text-red-400 hover:text-red-300" onClick={() => { if (window.confirm(`Delete “${part.label}”?`)) viewportActions?.deletePart(partId); close(); }}><Trash2 className="h-3.5 w-3.5" />Delete part</button>
    </div>
  );
}

function PartRow({ partId, label }: { partId: string; label: string }) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const viewportActions = useAppStore((s) => s.viewportActions);
  const selectedPartId = useAppStore((s) => s.selectedPartId);
  const selectedFeatureId = useAppStore((s) => s.selectedFeatureId);
  const features = useAppStore((s) => s.partFeatures[partId] ?? []);
  const part = useAppStore((s) => s.parts.find((p) => p.id === partId));
  const isSelected = selectedPartId === partId;
  const closeMenu = () => setMenuOpen(false);
  const menuRef = useCloseMenuOnOutsideClick(menuOpen, closeMenu);
  return (
    <div className="border-b border-base-800">
      <div ref={menuRef} className={`relative flex cursor-pointer items-center gap-1 px-2 py-2 ${isSelected ? 'bg-base-800' : ''} ${!part?.visible ? 'opacity-55' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }} onClick={() => viewportActions?.selectPart(partId)}>
        <button className="shrink-0 text-slate-500 hover:text-slate-200" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
        <button className="shrink-0 text-slate-500 hover:text-slate-200" title={part?.visible ? 'Hide part' : 'Show part'} onClick={(e) => { e.stopPropagation(); viewportActions?.setPartVisible(partId, !part?.visible); }}>
          {part?.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-600" />}
        </button>
        <Layers className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className={`flex-1 truncate text-sm ${isSelected ? 'font-medium text-slate-100' : 'text-slate-300'}`}>{label}</span>
        {part?.locked && (
          <span title="Part locked">
            <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          </span>
        )}
        <button className="shrink-0 text-slate-500 hover:text-slate-200" title="Part actions" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}><MoreVertical className="h-3.5 w-3.5" /></button>
        {menuOpen && <PartMenu partId={partId} close={closeMenu} />}
      </div>
      <div className="px-2 pb-1.5 pl-8" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          role="switch"
          aria-checked={!!part?.lockToPlate}
          className="flex w-full items-center gap-2 rounded-md border border-base-700 bg-base-950 px-2 py-1.5 text-left transition-colors hover:border-base-600"
          title={part?.lockToPlate ? 'Unlock this part from the build plate' : 'Lock this part to the build plate on the Z axis'}
          onClick={() => viewportActions?.setLockToPlate(partId, !part?.lockToPlate)}
        >
          <span className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${part?.lockToPlate ? 'bg-accent-500' : 'bg-slate-700'}`} aria-hidden="true">
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${part?.lockToPlate ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </span>
          <Anchor className={`h-3.5 w-3.5 shrink-0 ${part?.lockToPlate ? 'text-accent-400' : 'text-slate-500'}`} />
          <span className={`min-w-0 flex-1 text-[11px] ${part?.lockToPlate ? 'text-accent-300' : 'text-slate-400'}`}>Lock to Build Plate (Z)</span>
          <span className={`text-[10px] font-medium ${part?.lockToPlate ? 'text-accent-300' : 'text-slate-600'}`}>{part?.lockToPlate ? 'On' : 'Off'}</span>
        </button>
      </div>
      {expanded && (
        <div className="px-2 pb-2 pl-7">
          {features.length > 0 ? <div className="mb-1 space-y-0.5"><div className="px-1 py-1 text-[10px] uppercase tracking-wide text-slate-600">Features</div>{features.map((f) => <FeatureRow key={f.id} partId={partId} feature={f} isSelected={selectedFeatureId === f.id} />)}</div> : <p className="pb-1 text-[11px] text-slate-600">No modifier features yet.</p>}
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
  const viewportActions = useAppStore((s) => s.viewportActions);
  const hiddenCount = parts.filter((p) => !p.visible).length;
  if (collapsed) return <div className="flex w-9 shrink-0 flex-col items-center border-r border-base-700 bg-base-900 py-2"><button className="btn-icon" title="Show parts list" onClick={() => setCollapsed(false)}><ChevronsRight className="h-4 w-4" /></button></div>;
  return (
    <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
        <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Parts</div><div className="text-[10px] text-slate-600">Persistent object state & history</div></div>
        <div className="flex items-center gap-1">
          {hiddenCount > 0 && <button className="btn-icon !h-6 !w-6" title="Show all parts" onClick={() => viewportActions?.showAllParts()}><Eye className="h-3.5 w-3.5" /></button>}
          <button className="btn-icon" title="Collapse parts list" onClick={() => setCollapsed(true)}><ChevronsLeft className="h-4 w-4" /></button>
        </div>
      </div>
      {!hasModel || parts.length === 0 ? <p className="p-3 text-xs text-slate-500">No parts yet — import an .stl or add a shape to get started.</p> : <div className="flex-1">{parts.map((p) => <PartRow key={p.id} partId={p.id} label={p.label} />)}</div>}
    </div>
  );
}
