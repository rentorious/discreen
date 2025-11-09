import { desktopCapturer, DesktopCapturerSource, BrowserWindow } from 'electron';

export class ScreenRecorder {
  private isRecording: boolean = false;
  private delayTimeout: NodeJS.Timeout | null = null;

  async getScreenSource(): Promise<DesktopCapturerSource> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });

    if (sources.length === 0) {
      throw new Error('No screen sources available');
    }

    // Get the primary screen (usually the first one)
    return sources[0];
  }

  async startRecording(window: BrowserWindow): Promise<string> {
    if (this.isRecording) {
      throw new Error('Recording is already in progress');
    }

    const source = await this.getScreenSource();
    
    // Send source ID to renderer to start recording
    window.webContents.send('start-recording', source.id);
    this.isRecording = true;
    
    return 'Recording started';
  }

  async stopRecording(window: BrowserWindow): Promise<void> {
    if (!this.isRecording) {
      throw new Error('No recording in progress');
    }

    // Send stop command to renderer
    window.webContents.send('stop-recording');
    this.isRecording = false;
  }

  getRecordingStatus(): boolean {
    return this.isRecording;
  }

  cancelDelay(): void {
    if (this.delayTimeout) {
      clearTimeout(this.delayTimeout);
      this.delayTimeout = null;
    }
  }
}

