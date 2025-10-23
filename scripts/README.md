# Scripts

## generate-favicon.js

Generates favicon and icon files from the SVG source.

### Usage

```bash
node scripts/generate-favicon.js
```

### Generated Files

- `src/app/favicon.ico` - 32x32 ICO file for browsers
- `src/app/apple-icon.png` - 180x180 PNG for iOS devices
- `public/icon-192.png` - 192x192 PNG for PWA
- `public/icon-512.png` - 512x512 PNG for PWA

### Source

The script uses `src/app/icon.svg` as the source file.

To update the icon:
1. Edit `src/app/icon.svg`
2. Run `node scripts/generate-favicon.js`
3. Restart the dev server to see changes
