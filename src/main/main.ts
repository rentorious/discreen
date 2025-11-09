import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { settings } from './settings';
import { ScreenRecorder } from './recorder';

let mainWindow: BrowserWindow | null = null;
const recorder = new ScreenRecorder();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 600,
    minWidth: 400,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    resizable: true,
    titleBarStyle: 'default',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('start-recording', async () => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }
    
    const delay = settings.getDelay();
    
    if (delay > 0) {
      // Wait for delay before starting
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }
    
    await recorder.startRecording(mainWindow);
    return { success: true };
  } catch (error) {
    console.error('Error starting recording:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('stop-recording', async () => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }
    
    // No delay for stop - stop immediately
    await recorder.stopRecording(mainWindow);
    return { success: true };
  } catch (error) {
    console.error('Error stopping recording:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('get-recording-status', () => {
  return recorder.getRecordingStatus();
});

ipcMain.handle('get-save-path', () => {
  return settings.getSavePath();
});

ipcMain.handle('set-save-path', async () => {
  if (!mainWindow) {
    return { success: false, error: 'Main window not available' };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Save Location',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    settings.setSavePath(result.filePaths[0]);
    return { success: true, path: result.filePaths[0] };
  }

  return { success: false, cancelled: true };
});

ipcMain.handle('get-delay', () => {
  return settings.getDelay();
});

ipcMain.handle('set-delay', (_event, delay: number) => {
  settings.setDelay(delay);
  return { success: true };
});

// Handle video data from renderer
ipcMain.handle('save-video', async (_event, arrayBuffer: ArrayBuffer, filename: string) => {
  try {
    const savePath = settings.getSavePath();
    
    // Convert ArrayBuffer to Buffer
    const buffer = Buffer.from(arrayBuffer);
    
    // Ensure directory exists
    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, { recursive: true });
    }

    const filePath = path.join(savePath, filename);
    fs.writeFileSync(filePath, buffer);
    
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving video:', error);
    return { success: false, error: (error as Error).message };
  }
});

