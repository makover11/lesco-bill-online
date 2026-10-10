// generate-icons.js
// Generates standard PNG icons (16, 32, 48, 128 px) for Check LESCO Online Bill extension.
// Uses pure Node.js (zlib + Buffer) with zero external dependencies.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, drawFn) {
  // RGBA buffer
  const imgData = new Uint8ClampedArray(width * height * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 4;
    // Alpha blending with existing pixel
    const bgA = imgData[idx + 3] / 255;
    const fgA = a / 255;
    const outA = fgA + bgA * (1 - fgA);
    if (outA === 0) return;

    imgData[idx] = Math.round((r * fgA + imgData[idx] * bgA * (1 - fgA)) / outA);
    imgData[idx + 1] = Math.round((g * fgA + imgData[idx + 1] * bgA * (1 - fgA)) / outA);
    imgData[idx + 2] = Math.round((b * fgA + imgData[idx + 2] * bgA * (1 - fgA)) / outA);
    imgData[idx + 3] = Math.round(outA * 255);
  }

  drawFn(width, height, setPixel);

  // Build scanlines (1 filter byte (0) per row + width * 4 bytes RGBA)
  const scanlineLength = width * 4 + 1;
  const rawData = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = rowOffset + 1 + x * 4;
      rawData[dstIdx] = imgData[srcIdx];
      rawData[dstIdx + 1] = imgData[srcIdx + 1];
      rawData[dstIdx + 2] = imgData[srcIdx + 2];
      rawData[dstIdx + 3] = imgData[srcIdx + 3];
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // PNG Signature
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const toCrc = Buffer.concat([typeBuf, data]);
  const crc = zlib.crc32(toCrc);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, toCrc, crcBuf]);
}

// Draw LESCO electricity bill badge icon
function drawLescoIcon(size, setPixel) {
  const s = size;
  const radius = Math.max(2, Math.floor(s * 0.22));

  // Helper: check if point inside rounded rect
  function inRoundedRect(x, y, rx, ry, rw, rh, r) {
    if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
    const dx = Math.min(x - rx, rx + rw - 1 - x);
    const dy = Math.min(y - ry, ry + rh - 1 - y);
    if (dx < r && dy < r) {
      return (r - dx) * (r - dx) + (r - dy) * (r - dy) <= r * r;
    }
    return true;
  }

  // 1. Background: rounded badge with electric blue gradient
  const pad = Math.max(0, Math.floor(s * 0.04));
  const bw = s - pad * 2;
  const bh = s - pad * 2;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (inRoundedRect(x, y, pad, pad, bw, bh, radius)) {
        // Linear gradient: #1159af -> #0a3672
        const factor = (y - pad) / bh;
        const r = Math.round(17 - 7 * factor);
        const g = Math.round(89 - 35 * factor);
        const b = Math.round(175 - 61 * factor);
        setPixel(x, y, r, g, b, 255);
      }
    }
  }

  // 2. White bill sheet in background
  const billX = Math.round(s * 0.18);
  const billY = Math.round(s * 0.14);
  const billW = Math.round(s * 0.64);
  const billH = Math.round(s * 0.72);
  const billR = Math.max(1, Math.floor(s * 0.08));

  for (let y = billY; y < billY + billH; y++) {
    for (let x = billX; x < billX + billW; x++) {
      if (inRoundedRect(x, y, billX, billY, billW, billH, billR)) {
        setPixel(x, y, 255, 255, 255, 240);
      }
    }
  }

  // 3. Document text lines on bill
  const linePad = Math.round(billW * 0.16);
  const lineStartX = billX + linePad;
  const lineEndX = billX + billW - linePad;
  const lineH = Math.max(1, Math.floor(s * 0.035));

  const lineY1 = Math.round(s * 0.26);
  const lineY2 = Math.round(s * 0.35);
  const lineY3 = Math.round(s * 0.44);

  // Line 1 (Header line, LESCO green/blue)
  for (let y = lineY1; y < lineY1 + lineH + 1; y++) {
    for (let x = lineStartX; x < lineStartX + Math.round(billW * 0.4); x++) {
      setPixel(x, y, 17, 89, 175, 255);
    }
  }

  // Line 2 (Sub line)
  for (let y = lineY2; y < lineY2 + lineH; y++) {
    for (let x = lineStartX; x < lineEndX; x++) {
      setPixel(x, y, 148, 163, 184, 255);
    }
  }

  // Line 3 (Data line)
  for (let y = lineY3; y < lineY3 + lineH; y++) {
    for (let x = lineStartX; x < lineStartX + Math.round(billW * 0.5); x++) {
      setPixel(x, y, 148, 163, 184, 255);
    }
  }

  // 4. Vibrant Golden Lightning Bolt (LESCO electric symbol) in bottom-right
  // Polygon coordinates relative to size
  const pts = [
    [0.58, 0.42], // top
    [0.44, 0.65], // inner left
    [0.55, 0.65], // step right
    [0.42, 0.90], // bottom tip
    [0.68, 0.61], // outer right
    [0.56, 0.61]  // step left
  ].map(([px, py]) => [px * s, py * s]);

  // Point in polygon test (Ray casting)
  function inPoly(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i][0], yi = points[i][1];
      const xj = points[j][0], yj = points[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Draw bolt with glow/border
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // Glow/shadow
      if (inPoly(x - 0.5, y - 0.5, pts) || inPoly(x + 0.5, y + 0.5, pts)) {
        setPixel(x, y, 245, 158, 11, 230); // Amber 500
      }
      if (inPoly(x, y, pts)) {
        setPixel(x, y, 251, 191, 36, 255); // Amber 400
      }
    }
  }
}

// Generate all standard icon sizes
const SIZES = [16, 32, 48, 128];
const targetDir = path.resolve(__dirname, 'icons');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

console.log('Generating extension icons in:', targetDir);
for (const sz of SIZES) {
  const pngBuf = createPng(sz, sz, (w, h, setPix) => drawLescoIcon(sz, setPix));
  const outPath = path.join(targetDir, `icon${sz}.png`);
  fs.writeFileSync(outPath, pngBuf);
  console.log(`  ✓ Generated icon${sz}.png (${sz}x${sz}, ${pngBuf.length} bytes)`);
}

console.log('\nAll icons successfully generated!\n');
