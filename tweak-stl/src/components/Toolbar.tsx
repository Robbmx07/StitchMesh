import { useRef } from 'react';
import {
  AlertTriangle,
  Box,
  Download,
  FolderOpen,
  Grid3x3,
  Layers,
  Printer,
  Sparkles,
  SquareStack,
} from 'lucide-react';
import { useAppStore, type OrthoView } from '@/state/useAppStore';
import { PRINTER_PROFILES } from '@/utils/printerProfiles';

const GENERIC_PRINTER_ID = 'generic-fdm-0.4';

const ORTHO_VIEWS: { id: OrthoView; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'iso', label: 'Iso' },
];

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    fileName,
    hasModel,
    viewportActions,
    wireframe,
    flatShading,
    showBoundingBox,
    setWireframe,
    setFlatShading,
    setShowBoundingBox,
    setActiveTool,
    printerProfileId,
    printerProfileConfirmed,
    setPrinterProfileId,
  } = useAppStore();

  const handleOpenClick = async () => {
    if (window.stitchMesh) {
      const opened = await window.stitchMesh.openSTL();
      if (opened) {
        setActiveTool('select');
        viewportActions?.loadSTL(opened.data, opened.fileName);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.arrayBuffer().then((buffer) => {
      setActiveTool('select');
      viewportActions?.loadSTL(buffer, file.name);
    });
    event.target.value = '';
  };

  const handleExportClick = () => {
    if (!printerProfileConfirmed) {
      const proceed = window.confirm(
        "No printer selected yet. Threads will use generic FDM defaults, which may reduce accuracy for your machine.\n\n" +
          'Click OK to export anyway with Generic, or Cancel to pick your printer from the dropdown first.',
      );
      if (!proceed) return;
      setPrinterProfileId(printerProfileId); // confirms the current (Generic) choice so this won't ask again
    }
    viewportActions?.exportSTL();
  };

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-base-700 bg-base-900 px-4">
      <div className="flex items-center gap-2 pr-3">
        <SquareStack className="h-5 w-5 text-accent-500" />
        <span className="text-sm font-semibold tracking-wide text-slate-100">StitchMesh</span>
      </div>

      <div className="h-6 w-px bg-base-700" />

      <button className="btn" onClick={handleOpenClick}>
        <FolderOpen className="h-4 w-4" />
        <span>Open STL</span>
      </button>
      <input ref={fileInputRef} type="file" accept=".stl" className="hidden" onChange={handleFileInputChange} />

      <button className="btn" onClick={handleExportClick} disabled={!hasModel}>
        <Download className="h-4 w-4" />
        <span>Export STL</span>
      </button>

      <div className="h-6 w-px bg-base-700" />

      <div className="flex items-center gap-1">
        {ORTHO_VIEWS.map((view) => (
          <button
            key={view.id}
            className="btn"
            disabled={!hasModel}
            onClick={() => viewportActions?.setOrthoView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-base-700" />

      <div className="flex items-center gap-1.5">
        <Printer className="h-4 w-4 text-slate-400" />
        <select
          className="rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent-500"
          value={printerProfileId}
          onChange={(e) => setPrinterProfileId(e.target.value)}
        >
          {PRINTER_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {printerProfileId === GENERIC_PRINTER_ID && (
          <span
            title="Generic profile — thread accuracy may be reduced without your printer's exact specs. Pick your printer for tuned thread resolution and clearance."
            className="flex items-center text-amber-500"
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
        )}
      </div>

      <div className="h-6 w-px bg-base-700" />

      <div className="flex items-center gap-1">
        <button
          title="Toggle wireframe"
          className={`btn-icon ${wireframe ? 'btn-icon-active' : ''}`}
          disabled={!hasModel}
          onClick={() => setWireframe(!wireframe)}
        >
          <Grid3x3 className="h-4 w-4" />
        </button>
        <button
          title="Toggle flat shading"
          className={`btn-icon ${flatShading ? 'btn-icon-active' : ''}`}
          disabled={!hasModel}
          onClick={() => setFlatShading(!flatShading)}
        >
          <Box className="h-4 w-4" />
        </button>
        <button
          title="Toggle bounding box"
          className={`btn-icon ${showBoundingBox ? 'btn-icon-active' : ''}`}
          disabled={!hasModel}
          onClick={() => setShowBoundingBox(!showBoundingBox)}
        >
          <Layers className="h-4 w-4" />
        </button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {fileName && (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <Sparkles className="h-3.5 w-3.5 text-accent-500" />
            {fileName}
          </span>
        )}
      </div>
    </div>
  );
}
