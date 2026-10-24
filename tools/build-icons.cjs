/* Packaging only. Renders the editable SVG master into the required PNG sizes.
   Runtime extension code has no third-party dependencies.
   Run after installing sharp locally: node tools/build-icons.cjs */
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const directory = path.resolve(__dirname, '../icons');

(async () => {
  const master = path.join(directory, 'logo.svg');
  if (!fs.existsSync(master)) throw new Error('Missing SVG source logo.svg');
  await sharp(master, { density: 144 }).resize(1024, 1024).png().toFile(path.join(directory, 'logo.png'));
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    await sharp(master, { density: 144 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toFile(path.join(directory, 'icon' + size + '.png'));
  }
  console.log('Rendered SVG logo.png and icon sizes: 16, 24, 32, 48, 64, 128, 256.');
})().catch(error => { console.error(error); process.exitCode = 1; });
