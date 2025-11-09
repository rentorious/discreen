import Store from 'electron-store';
import { app } from 'electron';
import path from 'path';

interface SettingsSchema {
  savePath: string;
  delay: number; // in seconds
}

const defaultSettings: SettingsSchema = {
  savePath: app.getPath('videos'), // Default to Videos folder
  delay: 0, // No delay by default
};

const store = new Store<SettingsSchema>({
  defaults: defaultSettings,
});

export const settings = {
  getSavePath(): string {
    return store.get('savePath', defaultSettings.savePath);
  },

  setSavePath(path: string): void {
    store.set('savePath', path);
  },

  getDelay(): number {
    return store.get('delay', defaultSettings.delay);
  },

  setDelay(delay: number): void {
    store.set('delay', Math.max(0, delay)); // Ensure non-negative
  },

  getAll(): SettingsSchema {
    return {
      savePath: this.getSavePath(),
      delay: this.getDelay(),
    };
  },
};


