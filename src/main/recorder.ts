import { desktopCapturer, DesktopCapturerSource, BrowserWindow } from 'electron';
import * as os from 'os';

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

  async getAudioSource(): Promise<DesktopCapturerSource | null> {
    // Only attempt audio capture on Windows
    if (os.platform() !== 'win32') {
      return null;
    }

    try {
      // On Windows, get sources that support audio
      // We need to query for screen sources that may have audio capability
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      });

      // On Windows, the screen source itself can capture system audio
      // Return the first screen source as it can be used for audio capture
      if (sources.length > 0) {
        return sources[0];
      }
    } catch (error) {
      console.warn('Failed to get audio source:', error);
    }

    return null;
  }

  async startRecording(window: BrowserWindow): Promise<string> {
    if (this.isRecording) {
      throw new Error('Recording is already in progress');
    }

    const videoSource = await this.getScreenSource();
    const audioSource = await this.getAudioSource();
    
    // Send both source IDs to renderer to start recording
    // On Windows, audioSource will be the same as videoSource for system audio
    // On other platforms, audioSource will be null
    window.webContents.send('start-recording', {
      videoSourceId: videoSource.id,
      audioSourceId: audioSource?.id || null,
    });
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

