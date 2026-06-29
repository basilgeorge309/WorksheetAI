/**
 * Scribbl app icon generator.
 *
 * Renders the pencil icon (white rounded square, yellow hex pencil rotated -30°,
 * pink eraser, dark graphite tip) to PNGs at every size the app stores need.
 *
 * Usage: node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CANVAS = 1024; // SVG is authored at 1024; rx = 1024 * 0.13 stays proportional
const OUT_DIR = path.join(__dirname, '..', 'assets');

// Palette
const WHITE = '#FFFFFF';
const BODY = '#F5C842'; // yellow body
const BODY_SHADE = '#E3B43C'; // darker right facet for depth
const WOOD_PALE = '#F2DD8E'; // sharpened wood (light facet)
const ERASER = '#E8B4B4'; // pink eraser
const FERRULE = '#EFE6C9'; // band between eraser and body
const TIP = '#2A2A2A'; // dark graphite tip

// Pencil geometry, authored vertically and then rotated -30° about the center.
function buildSvg() {
  const cx = CANVAS / 2; // 512
  const rx = Math.round(CANVAS * 0.13); // 133

  const halfW = 76;
  const left = cx - halfW; // 436
  const right = cx + halfW; // 588
  const mid = cx; // 512

  const eraserTop = 160;
  const ferruleTop = 234;
  const bodyTop = 254;
  const bodyBottom = 724; // also the top of the sharpened cone
  const tipY = 884; // the pencil's point
  const facetLeft = cx + 12; // right facet starts a bit right of center

  // Graphite triangle near the very point.
  const graphiteTop = 828;
  const coneH = tipY - bodyBottom; // 160
  const gWidthHalf = (halfW * (tipY - graphiteTop)) / coneH; // proportional cone width
  const gLeft = mid - gWidthHalf;
  const gRight = mid + gWidthHalf;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <rect x="0" y="0" width="${CANVAS}" height="${CANVAS}" rx="${rx}" ry="${rx}" fill="${WHITE}"/>
  <g transform="rotate(-30 ${cx} ${cx})">
    <!-- eraser -->
    <rect x="${left}" y="${eraserTop}" width="${halfW * 2}" height="${ferruleTop - eraserTop + 6}" rx="22" fill="${ERASER}"/>
    <!-- ferrule band -->
    <rect x="${left}" y="${ferruleTop}" width="${halfW * 2}" height="${bodyTop - ferruleTop}" fill="${FERRULE}"/>
    <!-- body -->
    <rect x="${left}" y="${bodyTop}" width="${halfW * 2}" height="${bodyBottom - bodyTop}" fill="${BODY}"/>
    <!-- right facet (depth) -->
    <polygon points="${facetLeft},${bodyTop} ${right},${bodyTop} ${right},${bodyBottom} ${facetLeft},${bodyBottom}" fill="${BODY_SHADE}"/>
    <!-- sharpened cone: pale wood (left) + shaded wood (right) -->
    <polygon points="${left},${bodyBottom} ${mid},${bodyBottom} ${mid},${tipY}" fill="${WOOD_PALE}"/>
    <polygon points="${mid},${bodyBottom} ${right},${bodyBottom} ${mid},${tipY}" fill="${BODY_SHADE}"/>
    <!-- graphite tip -->
    <polygon points="${gLeft},${graphiteTop} ${gRight},${graphiteTop} ${mid},${tipY}" fill="${TIP}"/>
  </g>
</svg>`;
}

const TARGETS = [
  { size: 1024, file: 'icon.png' }, // App Store / Expo icon
  { size: 180, file: 'icon-180.png' }, // iPhone @3x
  { size: 120, file: 'icon-120.png' }, // iPhone @2x
  { size: 167, file: 'icon-167.png' }, // iPad Pro
  { size: 152, file: 'icon-152.png' }, // iPad @2x
  { size: 1024, file: 'adaptive-icon.png' }, // Android adaptive foreground
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const svg = Buffer.from(buildSvg());

  for (const { size, file } of TARGETS) {
    const out = path.join(OUT_DIR, file);
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log(`wrote ${path.relative(process.cwd(), out)} (${size}x${size})`);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error('Icon generation failed:', e);
  process.exit(1);
});
