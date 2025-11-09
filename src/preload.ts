import { contextBridge, ipcRenderer } from 'electron';

console.log('Preload script loaded');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getRecordingStatus: () => ipcRenderer.invoke('get-recording-status'),
  getSavePath: () => ipcRenderer.invoke('get-save-path'),
  setSavePath: () => ipcRenderer.invoke('set-save-path'),
  getDelay: () => ipcRenderer.invoke('get-delay'),
  setDelay: (delay: number) => ipcRenderer.invoke('set-delay', delay),
  saveVideo: (arrayBuffer: ArrayBuffer, filename: string) => ipcRenderer.invoke('save-video', arrayBuffer, filename),
  
  // Listen for messages from main process
  onStartRecording: (callback: (sourceId: string) => void) => {
    ipcRenderer.on('start-recording', (_event, sourceId) => callback(sourceId));
  },
  onStopRecording: (callback: () => void) => {
    ipcRenderer.on('stop-recording', () => callback());
  },
});

