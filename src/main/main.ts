import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { settings } from "./settings";
import { ScreenRecorder } from "./recorder";

// Set FFmpeg path from the bundled installer
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

let mainWindow: BrowserWindow | null = null;
const recorder = new ScreenRecorder();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 600,
    minWidth: 400,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    resizable: true,
    titleBarStyle: "default",
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle("start-recording", async () => {
  try {
    if (!mainWindow) {
      throw new Error("Main window not available");
    }

    const delay = settings.getDelay();

    if (delay > 0) {
      // Wait for delay before starting
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }

    await recorder.startRecording(mainWindow);
    return { success: true };
  } catch (error) {
    console.error("Error starting recording:", error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle("stop-recording", async () => {
  try {
    if (!mainWindow) {
      throw new Error("Main window not available");
    }

    // No delay for stop - stop immediately
    await recorder.stopRecording(mainWindow);
    return { success: true };
  } catch (error) {
    console.error("Error stopping recording:", error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle("get-recording-status", () => {
  return recorder.getRecordingStatus();
});

ipcMain.handle("get-save-path", () => {
  return settings.getSavePath();
});

ipcMain.handle("set-save-path", async () => {
  if (!mainWindow) {
    return { success: false, error: "Main window not available" };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Save Location",
  });

  if (!result.canceled && result.filePaths.length > 0) {
    settings.setSavePath(result.filePaths[0]);
    return { success: true, path: result.filePaths[0] };
  }

  return { success: false, cancelled: true };
});

ipcMain.handle("get-delay", () => {
  return settings.getDelay();
});

ipcMain.handle("set-delay", (_event, delay: number) => {
  settings.setDelay(delay);
  return { success: true };
});

// Handle video data from renderer
ipcMain.handle(
  "save-video",
  async (_event, arrayBuffer: ArrayBuffer, filename: string) => {
    try {
      const savePath = settings.getSavePath();

      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(arrayBuffer);

      // Ensure directory exists
      if (!fs.existsSync(savePath)) {
        fs.mkdirSync(savePath, { recursive: true });
      }

      // Save temporary WebM file
      const webmPath = path.join(savePath, filename);
      fs.writeFileSync(webmPath, buffer);

      // Verify file was written correctly
      const stats = fs.statSync(webmPath);
      console.log("WebM file saved, size:", stats.size, "bytes");

      if (stats.size === 0) {
        throw new Error("WebM file is empty");
      }

      // Convert to MP4
      const mp4Filename = filename.replace(".webm", ".mp4");
      const mp4Path = path.join(savePath, mp4Filename);

      try {
        // Probe the file to check if it has audio tracks
        let hasAudio = false;
        try {
          const probeData = await new Promise<any>((resolve, reject) => {
            ffmpeg.ffprobe(webmPath, (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          });

          // Check if any stream is an audio stream
          hasAudio =
            probeData.streams?.some(
              (stream: any) => stream.codec_type === "audio"
            ) || false;
          console.log("File has audio:", hasAudio);
        } catch (probeError) {
          console.warn(
            "Failed to probe file for audio, assuming no audio:",
            probeError
          );
          hasAudio = false;
        }

        await new Promise<void>((resolve, reject) => {
          const outputOptions = [
            "-c:v libx264",
            "-preset fast",
            "-crf 23",
            "-movflags +faststart",
          ];

          // Add audio encoding if audio track exists
          if (hasAudio) {
            outputOptions.push("-c:a aac", "-b:a 128k");
            console.log("Including audio encoding in conversion");
          } else {
            console.log("No audio track detected, video-only conversion");
          }

          const ffmpegCommand = ffmpeg(webmPath).outputOptions(outputOptions);

          ffmpegCommand
            .output(mp4Path)
            .on("start", (commandLine) => {
              console.log("FFmpeg started:", commandLine);
            })
            .on("progress", (progress) => {
              const percent = progress.percent
                ? Math.round(progress.percent)
                : "?";
              console.log(
                "FFmpeg progress:",
                percent + "%",
                progress.timemark || ""
              );
            })
            .on("end", () => {
              console.log("FFmpeg conversion completed");
              // Delete temporary WebM file
              try {
                fs.unlinkSync(webmPath);
              } catch (err) {
                console.warn("Failed to delete temporary WebM file:", err);
              }
              resolve();
            })
            .on("error", (err) => {
              console.error("FFmpeg conversion error:", err);
              // If FFmpeg is not found or conversion fails, return the WebM file instead
              if (
                err.message &&
                (err.message.includes("ffmpeg") ||
                  err.message.includes("Invalid data"))
              ) {
                console.warn("FFmpeg conversion failed, keeping WebM file");
                resolve(); // Resolve instead of reject to return WebM file
              } else {
                reject(err);
              }
            })
            .run();
        });

        // Check if MP4 was created, if not, return WebM path
        if (fs.existsSync(mp4Path)) {
          return { success: true, path: mp4Path };
        } else {
          console.warn("MP4 conversion failed, returning WebM file");
          return { success: true, path: webmPath };
        }
      } catch (error) {
        console.error("Conversion error:", error);
        // Return WebM file if conversion fails
        return { success: true, path: webmPath };
      }
    } catch (error) {
      console.error("Error saving video:", error);
      return { success: false, error: (error as Error).message };
    }
  }
);
