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
  private countdownInterval: number | null = null;
  private countdownRemaining: number = 0;

  constructor() {
    this.initializeUI();
    this.setupIPCListeners();
    this.loadSettings();
  }

  private initializeUI(): void {
    const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    const stopButton = document.getElementById('stopButton') as HTMLButtonElement;
    const browseButton = document.getElementById('browseButton') as HTMLButtonElement;
    const delayInput = document.getElementById('delay') as HTMLInputElement;

    if (!recordButton || !stopButton) {
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

    if (browseButton) {
      browseButton.addEventListener('click', () => this.browseSavePath());
    }

    if (delayInput) {
      delayInput.addEventListener('change', () => {
        const delay = parseFloat(delayInput.value) || 0;
        this.saveDelay(delay);
      });
    }
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

      // Get screen stream - start with video only for now (audio can be added later)
      // System audio capture in Electron requires special setup and may not work reliably
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
      console.log('Got stream with video');

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
        console.log('ondataavailable fired, data size:', event.data?.size || 0);
        // Accept all chunks, even empty ones initially (MediaRecorder may send empty chunks at start)
        if (event.data) {
          this.recordedChunks.push(event.data);
          console.log('Received chunk, size:', event.data.size, 'Total chunks:', this.recordedChunks.length);
        }
      };

      this.mediaRecorder.onerror = (event: Event) => {
        console.error('MediaRecorder error:', event);
        this.updateStatus('Error recording', false);
        this.isRecording = false;
      };

      this.mediaRecorder.onstart = () => {
        console.log('MediaRecorder started, state:', this.mediaRecorder?.state);
      };

      console.log('Starting MediaRecorder with mimeType:', mimeType);
      const tracks = stream.getTracks();
      console.log('Stream tracks:', tracks.map(t => {
        const settings = t.getSettings();
        return { 
          kind: t.kind, 
          enabled: t.enabled, 
          readyState: t.readyState,
          muted: t.muted,
          settings: settings,
          constraints: t.getConstraints()
        };
      }));
      
      // Verify tracks are actually producing data
      tracks.forEach(track => {
        track.onended = () => {
          console.error('Track ended unexpectedly:', track.kind, 'readyState:', track.readyState);
          if (track.kind === 'video') {
            this.updateStatus('Video track ended - recording failed', false);
            this.isRecording = false;
          }
        };
        track.onmute = () => console.warn('Track muted:', track.kind);
        track.onunmute = () => console.log('Track unmuted:', track.kind);
      });
      
      // Check if video track exists and is valid
      const videoTrack = tracks.find(t => t.kind === 'video');
      if (!videoTrack) {
        throw new Error('No video track in stream');
      }
      if (videoTrack.readyState !== 'live') {
        throw new Error(`Video track not live, state: ${videoTrack.readyState}`);
      }
      
      this.mediaRecorder.start(100); // Collect data every 100ms
      
      // Verify it actually started and wait for first data chunk
      setTimeout(() => {
        if (this.mediaRecorder) {
          console.log('MediaRecorder state after start:', this.mediaRecorder.state);
          if (this.mediaRecorder.state !== 'recording') {
            console.error('MediaRecorder failed to start, state:', this.mediaRecorder.state);
            this.updateStatus('Failed to start recording', false);
            this.isRecording = false;
          } else {
            // Check if we've received any non-empty chunks
            const hasData = this.recordedChunks.some(chunk => chunk.size > 0);
            if (!hasData && this.recordedChunks.length > 0) {
              console.warn('MediaRecorder started but no data chunks yet. This is normal initially.');
            }
          }
        }
      }, 1000);
      
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
        console.warn('Cannot stop: mediaRecorder or isRecording check failed');
        resolve();
        return;
      }

      console.log('Stopping MediaRecorder, state:', this.mediaRecorder.state);
      console.log('Current chunks count:', this.recordedChunks.length);

      this.mediaRecorder.onstop = async () => {
        try {
          console.log('MediaRecorder stopped, final chunks count:', this.recordedChunks.length);
          
          // Wait a bit to ensure all chunks are collected
          await new Promise(resolve => setTimeout(resolve, 200));
          
          console.log('After wait, chunks count:', this.recordedChunks.length);
          
          // Stop the stream
          if (this.stream) {
            this.stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            this.stream = null;
          }

      // Filter out empty chunks and check if we have any data
      const nonEmptyChunks = this.recordedChunks.filter(chunk => chunk.size > 0);
      console.log('Total chunks:', this.recordedChunks.length, 'Non-empty chunks:', nonEmptyChunks.length);
      
      if (nonEmptyChunks.length === 0) {
        console.error('No non-empty chunks collected. MediaRecorder state was:', this.mediaRecorder?.state);
        console.error('All chunks were empty - MediaRecorder may not have had time to encode, or video track not producing frames');
        throw new Error('No video data recorded - try recording for at least 2-3 seconds');
      }

      console.log('Creating blob from', nonEmptyChunks.length, 'non-empty chunks');
      
      // Calculate total size of non-empty chunks
      const totalSize = nonEmptyChunks.reduce((sum, chunk) => sum + chunk.size, 0);
      console.log('Total chunks size:', totalSize, 'bytes');
      
      // Create blob from non-empty chunks only
      const blob = new Blob(nonEmptyChunks, { type: 'video/webm' });
      console.log('Blob created, size:', blob.size);
      
      if (blob.size === 0 || totalSize === 0) {
        throw new Error('Recorded video is empty (no data in chunks)');
      }
          
          const arrayBuffer = await blob.arrayBuffer();
          console.log('ArrayBuffer created, size:', arrayBuffer.byteLength);

          // Generate filename with timestamp (will be converted to MP4 in main process)
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `recording-${timestamp}.webm`;

          // Save via main process (pass ArrayBuffer, convert to MP4 in main)
          const result = await window.electronAPI.saveVideo(arrayBuffer, filename);
          
          if (result.success) {
            this.updateStatus('Recording saved as MP4', false);
          } else {
            this.updateStatus('Error saving recording', false);
          }

          this.isRecording = false;
          this.mediaRecorder = null;
          this.recordedChunks = [];
          resolve();
        } catch (error) {
          console.error('Error saving recording:', error);
          this.updateStatus(`Error: ${(error as Error).message}`, false);
          this.isRecording = false;
          this.mediaRecorder = null;
          this.recordedChunks = [];
          resolve();
        }
      };

      // Ensure we're actually recording
      if (this.mediaRecorder.state === 'recording') {
        // Request all remaining data before stopping
        this.mediaRecorder.requestData();
        // Small delay to ensure requestData is processed
        setTimeout(() => {
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
          }
        }, 50);
      } else {
        console.warn('MediaRecorder not in recording state:', this.mediaRecorder.state);
        // Still try to stop it
        this.mediaRecorder.stop();
      }
    });
  }

  private async startRecording(): Promise<void> {
    try {
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        this.updateStatus('Error: electronAPI not available', false);
        return;
      }

      // Get delay from input and save it first
      const delayInput = document.getElementById('delay') as HTMLInputElement;
      const delay = delayInput ? parseFloat(delayInput.value) || 0 : 0;
      
      // Save delay to ensure main process has the latest value
      await this.saveDelay(delay);

      if (delay > 0) {
        // Start countdown
        this.startCountdown(delay);
      }

      console.log('Starting recording...');
      const result = await window.electronAPI.startRecording();
      if (result.success) {
        console.log('Recording start command sent');
        // Status will be updated when recording actually starts (via IPC)
      } else {
        this.stopCountdown();
        console.error('Recording start failed:', result.error);
        this.updateStatus(`Error: ${result.error}`, false);
      }
    } catch (error) {
      this.stopCountdown();
      console.error('Error in startRecording:', error);
      this.updateStatus(`Error: ${(error as Error).message}`, false);
    }
  }

  private startCountdown(seconds: number): void {
    this.countdownRemaining = Math.ceil(seconds);
    this.updateCountdownDisplay();

    this.countdownInterval = window.setInterval(() => {
      this.countdownRemaining -= 1;
      this.updateCountdownDisplay();

      if (this.countdownRemaining <= 0) {
        this.stopCountdown();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.countdownRemaining = 0;
  }

  private updateCountdownDisplay(): void {
    const statusText = document.getElementById('statusText') as HTMLSpanElement;
    if (statusText && this.countdownRemaining > 0) {
      statusText.textContent = `Starting in ${this.countdownRemaining}...`;
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
    // Stop countdown when status changes
    if (recording) {
      this.stopCountdown();
    }

    const statusText = document.getElementById('statusText') as HTMLSpanElement;
    const statusIndicator = document.getElementById('statusIndicator') as HTMLSpanElement;
    const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    const stopButton = document.getElementById('stopButton') as HTMLButtonElement;

    if (statusText) {
      statusText.textContent = text;
    }
    if (statusIndicator) {
      if (recording) {
        statusIndicator.classList.add('recording');
      } else {
        statusIndicator.classList.remove('recording');
      }
    }

    if (recordButton) recordButton.disabled = recording;
    if (stopButton) stopButton.disabled = !recording;
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

  private async saveDelay(delay: number): Promise<void> {
    try {
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        return;
      }
      await window.electronAPI.setDelay(delay);
      console.log('Delay saved:', delay);
    } catch (error) {
      console.error('Error saving delay:', error);
    }
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

