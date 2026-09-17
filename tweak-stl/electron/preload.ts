import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedSTL {
  filePath: string;
  fileName: string;
  data: ArrayBuffer;
}

const api = {
  openSTL: (): Promise<OpenedSTL | null> => ipcRenderer.invoke('dialog:openSTL'),
  saveSTL: (buffer: ArrayBuffer, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveSTL', buffer, suggestedName),
};

contextBridge.exposeInMainWorld('tweakStl', api);

export type TweakStlBridge = typeof api;
