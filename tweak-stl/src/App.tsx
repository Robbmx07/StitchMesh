import { useCallback, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import Toolbar from '@/components/Toolbar';
import Sidebar from '@/components/Sidebar';
import Viewport3D from '@/components/Viewport3D';
import { useAppStore } from '@/state/useAppStore';

export default function App() {
  const [isDragging, setIsDragging] = useState(false);
  const viewportActions = useAppStore((s) => s.viewportActions);
  const setActiveTool = useAppStore((s) => s.setActiveTool);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file || !file.name.toLowerCase().endsWith('.stl')) return;
      file.arrayBuffer().then((buffer) => {
        setActiveTool('select');
        viewportActions?.loadSTL(buffer, file.name);
      });
    },
    [viewportActions, setActiveTool],
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base-950">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <div
          className="relative min-w-0 flex-1"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Viewport3D />
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 border-4 border-dashed border-accent-500 bg-base-950/80">
              <UploadCloud className="h-10 w-10 text-accent-500" />
              <p className="text-sm font-medium text-slate-200">Drop .stl file to load</p>
            </div>
          )}
        </div>
        <Sidebar />
      </div>
    </div>
  );
}
