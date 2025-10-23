const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateFavicon() {
  const svgPath = path.join(__dirname, '../src/app/icon.svg');
  const icoPath = path.join(__dirname, '../src/app/favicon.ico');

  try {
    // Read the SVG file
    const svgBuffer = fs.readFileSync(svgPath);

    // Generate multiple sizes for the ICO file
    const sizes = [16, 32, 48];
    const pngBuffers = [];

    console.log('Generating favicon from SVG...');

    // Generate PNG for each size
    for (const size of sizes) {
      const pngBuffer = await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toBuffer();
      pngBuffers.push(pngBuffer);
      console.log(`✓ Generated ${size}x${size} PNG`);
    }

    // For ICO, we'll use the 32x32 version as the main favicon
    await sharp(svgBuffer)
      .resize(32, 32)
      .toFile(icoPath);

    console.log('✓ Favicon generated successfully!');
    console.log(`  Location: ${icoPath}`);

    // Also generate PNG versions for modern browsers
    await sharp(svgBuffer)
      .resize(192, 192)
      .png()
      .toFile(path.join(__dirname, '../public/icon-192.png'));
    console.log('✓ Generated 192x192 PNG icon');

    await sharp(svgBuffer)
      .resize(512, 512)
      .png()
      .toFile(path.join(__dirname, '../public/icon-512.png'));
    console.log('✓ Generated 512x512 PNG icon');

  } catch (error) {
    console.error('Error generating favicon:', error);
    process.exit(1);
  }
}

generateFavicon();
