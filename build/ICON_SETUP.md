# Custom Icon Setup Guide

Your Electron app is configured to use custom icons. Follow these steps to add your icons:

## Required Icon Files

Place your icon files in this `build/` directory:

- **Windows**: `icon.ico` (256x256 pixels recommended, multi-size .ico file)
- **macOS**: `icon.icns` (512x512 pixels recommended, multi-size .icns file)
- **Linux**: `icon.png` (512x512 pixels recommended)

## How to Create Icons

### Option 1: Online Tools
1. Start with a square PNG image (at least 512x512 pixels)
2. Use online converters:
   - **Windows (.ico)**: [ConvertICO](https://convertio.co/png-ico/) or [ICO Convert](https://icoconvert.com/)
   - **macOS (.icns)**: [CloudConvert](https://cloudconvert.com/png-to-icns) or use macOS tools

### Option 2: Using ImageMagick (Command Line)
```bash
# Convert PNG to ICO (Windows)
magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# Convert PNG to ICNS (macOS - requires iconutil on macOS)
# First create iconset directory structure, then:
iconutil -c icns icon.iconset
```

### Option 3: Using Electron Icon Generator
```bash
npm install -g electron-icon-maker
electron-icon-maker --input=./your-icon.png --output=./build
```

## Current Configuration

Your `package.json` is already configured:
- Windows: `build/icon.ico`
- macOS: `build/icon.icns`

## After Adding Icons

Once you've placed your icon files in the `build/` directory, rebuild your app:

```bash
npm run package:win    # For Windows
npm run package:mac    # For macOS
```

The icons will be automatically included in your packaged application.

