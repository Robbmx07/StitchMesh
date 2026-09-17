/// <reference types="vite/client" />

interface Window {
  stitchMesh?: {
    openSTL: () => Promise<{ filePath: string; fileName: string; data: ArrayBuffer } | null>;
    saveSTL: (buffer: ArrayBuffer, suggestedName: string) => Promise<string | null>;
  };
}
