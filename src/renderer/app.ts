// Type definitions for electronAPI
export {};

declare global {
  interface Window {
    electronAPI: {
      startRecording: () => Promise<{ success: boolean; error?: string }>;
      stopRecording: () => Promise<{ success: boolean; error?: string }>;
      getRecordingStatus: () => Promise<boolean>;
      getSavePath: () => Promise<string>;
      setSavePath: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>;
      getDelay: () => Promise<number>;
      setDelay: (delay: number) => Promise<{ success: boolean }>;
      saveVideo: (arrayBuffer: ArrayBuffer, filename: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      onStartRecording: (callback: (sourceId: string) => void) => void;
      onStopRecording: (callback: () => void) => void;
    };
  }
}

class ScreenRecorderApp {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private isRecording: boolean = false;

  constructor() {
    this.initializeUI();
    this.setupIPCListeners();
    this.loadSettings();
  }

  private initializeUI(): void {
    const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
    const settingsButton = document.getElementById('settingsButton') as HTMLButtonElement;
    const settingsModal = document.getElementById('settingsModal') as HTMLDivElement;
    const closeSettings = document.getElementById('closeSettings') as HTMLButtonElement;
    const saveSettings = document.getElementById('saveSettings') as HTMLButtonElement;
    const browseButton = document.getElementById('browseButton') as HTMLButtonElement;

    if (!recordButton || !stopButton || !settingsButton || !settingsModal) {
      console.error('Failed to find required UI elements');
      return;
    }

    recordButton.addEventListener('click', () => {
      console.log('Record button clicked');
      this.startRecording();
    });
    stopButton.addEventListener('click', () => {
      console.log('Stop button clicked');
      this.stopRecording();
    });
    settingsButton.addEventListener('click', () => {
      console.log('Settings button clicked');
      settingsModal.classList.add('show');
      this.loadSettings();
    });
    closeSettings.addEventListener('click', () => {
      settingsModal.classList.remove('show');
    });
    saveSettings.addEventListener('click', () => this.saveSettings());
    browseButton.addEventListener('click', () => this.browseSavePath());

    // Close modal when clicking outside
    settingsModal.addEventListener('click', (e: MouseEvent) => {
      if (e.target === settingsModal) {
        settingsModal.classList.remove('show');
      }
    });
  }

  private setupIPCListeners(): void {
    // Listen for start recording command from main process
    window.electronAPI.onStartRecording((sourceId: string) => {
      this.doStartRecording(sourceId);
    });

    // Listen for stop recording command from main process
    window.electronAPI.onStopRecording(() => {
      this.doStopRecording();
    });
  }

  private async doStartRecording(sourceId: string): Promise<void> {
    try {
      if (this.isRecording) {
        return;
      }

      // Get screen stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-ignore - Electron-specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          },
        } as MediaTrackConstraints,
      });

      this.stream = stream;
      this.recordedChunks = [];

      // Determine best codec
      let mimeType = 'video/webm';
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
        mimeType = 'video/webm;codecs=vp8';
      }

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
      });

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onerror = (event: Event) => {
        console.error('MediaRecorder error:', event);
        this.updateStatus('Error recording', false);
      };

      this.mediaRecorder.start(100); // Collect data every 100ms
      this.isRecording = true;
      this.updateStatus('Recording...', true);
    } catch (error) {
      console.error('Error starting recording:', error);
      this.updateStatus('Error starting recording', false);
    }
  }

  private async doStopRecording(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || !this.isRecording) {
        resolve();
        return;
      }

      this.mediaRecorder.onstop = async () => {
        try {
          // Stop the stream
          if (this.stream) {
            this.stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            this.stream = null;
          }

          // Create blob from recorded chunks
          const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
          const arrayBuffer = await blob.arrayBuffer();

          // Generate filename with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `recording-${timestamp}.webm`;

          // Save via main process (pass ArrayBuffer, convert to Buffer in main)
          const result = await window.electronAPI.saveVideo(arrayBuffer, filename);
          
          if (result.success) {
            this.updateStatus('Recording saved', false);
          } else {
            this.updateStatus('Error saving recording', false);
          }

          this.isRecording = false;
          this.mediaRecorder = null;
          this.recordedChunks = [];
          resolve();
        } catch (error) {
          console.error('Error saving recording:', error);
          this.updateStatus('Error saving recording', false);
          resolve();
        }
      };

      this.mediaRecorder.stop();
    });
  }

  private async startRecording(): Promise<void> {
    try {
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        this.updateStatus('Error: electronAPI not available', false);
        return;
      }
      console.log('Starting recording...');
      const result = await window.electronAPI.startRecording();
      if (result.success) {
        console.log('Recording start command sent');
        // Status will be updated when recording actually starts (via IPC)
      } else {
        console.error('Recording start failed:', result.error);
        this.updateStatus(`Error: ${result.error}`, false);
      }
    } catch (error) {
      console.error('Error in startRecording:', error);
      this.updateStatus(`Error: ${(error as Error).message}`, false);
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        this.updateStatus('Error: electronAPI not available', false);
        return;
      }
      console.log('Stopping recording...');
      const result = await window.electronAPI.stopRecording();
      if (!result.success) {
        console.error('Recording stop failed:', result.error);
        this.updateStatus(`Error: ${result.error}`, false);
      }
    } catch (error) {
      console.error('Error in stopRecording:', error);
      this.updateStatus(`Error: ${(error as Error).message}`, false);
    }
  }

  private updateStatus(text: string, recording: boolean): void {
    const statusText = document.getElementById('statusText') as HTMLSpanElement;
    const statusIndicator = document.getElementById('statusIndicator') as HTMLSpanElement;
    const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    const stopButton = document.getElementById('stopButton') as HTMLButtonElement;

    statusText.textContent = text;
    if (recording) {
      statusIndicator.classList.add('recording');
    } else {
      statusIndicator.classList.remove('recording');
    }

    recordButton.disabled = recording;
    stopButton.disabled = !recording;
  }

  private async loadSettings(): Promise<void> {
    try {
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        return;
      }
      const savePath = await window.electronAPI.getSavePath();
      const delay = await window.electronAPI.getDelay();

      const savePathInput = document.getElementById('savePath') as HTMLInputElement;
      const delayInput = document.getElementById('delay') as HTMLInputElement;

      if (savePathInput) savePathInput.value = savePath;
      if (delayInput) delayInput.value = delay.toString();
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  private async saveSettings(): Promise<void> {
    const delayInput = document.getElementById('delay') as HTMLInputElement;
    const delay = parseFloat(delayInput.value) || 0;

    await window.electronAPI.setDelay(delay);

    const settingsModal = document.getElementById('settingsModal') as HTMLDivElement;
    settingsModal.classList.remove('show');
  }

  private async browseSavePath(): Promise<void> {
    try {
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        return;
      }
      console.log('Browsing for save path...');
      const result = await window.electronAPI.setSavePath();
      if (result.success && result.path) {
        const savePathInput = document.getElementById('savePath') as HTMLInputElement;
        if (savePathInput) {
          savePathInput.value = result.path;
        }
      }
    } catch (error) {
      console.error('Error browsing save path:', error);
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded fired');
  console.log('window.electronAPI:', window.electronAPI);
  
  // Check if electronAPI is available
  if (typeof window !== 'undefined' && window.electronAPI) {
    console.log('electronAPI is available, initializing app...');
    new ScreenRecorderApp();
  } else {
    console.error('electronAPI is not available. Make sure preload script is loaded correctly.');
    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = 'Error: electronAPI not available';
    }
  }
});

