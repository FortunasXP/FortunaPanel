// Generate FortunaPanel icon — white "F" on black rounded-rect background
// Run: node scripts/generate-icon.js
// No external dependencies — uses raw pixel data + built-in zlib

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Pixel drawing helpers ───────────────────────────────────────────
function createBuffer(size) {
    const buf = Buffer.alloc(size * size * 4, 0);
    // Fill with background #0a0a0a
    for (let i = 0; i < size * size; i++) {
        const off = i * 4;
        buf[off] = 10; buf[off + 1] = 10; buf[off + 2] = 10; buf[off + 3] = 255;
    }
    return buf;
}

function setPixel(buf, size, x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const off = (y * size + x) * 4;
    if (a < 255) {
        // Alpha blend
        const oldR = buf[off], oldG = buf[off + 1], oldB = buf[off + 2];
        const alpha = a / 255;
        buf[off] = Math.round(r * alpha + oldR * (1 - alpha));
        buf[off + 1] = Math.round(g * alpha + oldG * (1 - alpha));
        buf[off + 2] = Math.round(b * alpha + oldB * (1 - alpha));
        buf[off + 3] = 255;
    } else {
        buf[off] = r; buf[off + 1] = g; buf[off + 2] = b; buf[off + 3] = 255;
    }
}

function fillRect(buf, size, x0, y0, w, h, r, g, b) {
    for (let y = y0; y < y0 + h && y < size; y++) {
        for (let x = x0; x < x0 + w && x < size; x++) {
            setPixel(buf, size, x, y, r, g, b);
        }
    }
}

function fillRoundedRect(buf, size, x0, y0, w, h, radius, r, g, b) {
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            // Check corners
            let inside = true;
            const corners = [
                [x0 + radius, y0 + radius],           // top-left
                [x0 + w - radius - 1, y0 + radius],   // top-right
                [x0 + radius, y0 + h - radius - 1],   // bottom-left
                [x0 + w - radius - 1, y0 + h - radius - 1] // bottom-right
            ];

            for (const [cx, cy] of corners) {
                const inCornerX = (x < x0 + radius && cx === corners[0][0]) || (x > x0 + w - radius - 1 && cx === corners[1][0]);
                const inCornerY = (y < y0 + radius && cy === corners[0][1]) || (y > y0 + h - radius - 1 && cy === corners[2][1]);

                if (inCornerX && inCornerY) {
                    const dx = x - cx;
                    const dy = y - cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > radius + 0.5) {
                        inside = false;
                    } else if (dist > radius - 0.5) {
                        // Anti-alias the edge
                        const alpha = Math.round((radius + 0.5 - dist) * 255);
                        setPixel(buf, size, x, y, r, g, b, alpha);
                        inside = false;
                    }
                    break;
                }
            }

            if (inside) {
                setPixel(buf, size, x, y, r, g, b);
            }
        }
    }
}

function drawIcon(size) {
    const buf = Buffer.alloc(size * size * 4, 0); // Start transparent

    const radius = Math.round(size * 0.15);

    // Black rounded-rect background
    fillRoundedRect(buf, size, 0, 0, size, size, radius, 10, 10, 10);

    // Subtle border (1px lighter line along the rounded-rect edge)
    // Draw a slightly larger rounded rect behind with border color, then overwrite with main
    // For simplicity, just draw the F

    // "F" letter parameters — proportional to size
    const margin = Math.round(size * 0.22);
    const strokeW = Math.max(2, Math.round(size * 0.09));
    const fLeft = margin;
    const fTop = Math.round(size * 0.18);
    const fWidth = size - margin * 2 + Math.round(size * 0.04);
    const fHeight = size - fTop - Math.round(size * 0.18);

    // Vertical bar of F
    fillRect(buf, size, fLeft, fTop, strokeW, fHeight, 250, 250, 250);
    // Top horizontal bar of F
    fillRect(buf, size, fLeft, fTop, fWidth, strokeW, 250, 250, 250);
    // Middle horizontal bar of F (slightly shorter, at ~45% of height)
    const midY = fTop + Math.round(fHeight * 0.40);
    const midWidth = Math.round(fWidth * 0.72);
    fillRect(buf, size, fLeft, midY, midWidth, strokeW, 250, 250, 250);

    return buf;
}

// ── PNG encoder ─────────────────────────────────────────────────────
function crc32(buf) {
    let crc = 0xffffffff;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crcBuf]);
}

function createPNG(size, rgbaBuffer) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

    const rawData = Buffer.alloc(size * (1 + size * 4));
    for (let y = 0; y < size; y++) {
        const rowOff = y * (1 + size * 4);
        rawData[rowOff] = 0; // filter: None
        rgbaBuffer.copy(rawData, rowOff + 1, y * size * 4, (y + 1) * size * 4);
    }

    const compressed = zlib.deflateSync(rawData, { level: 9 });

    return Buffer.concat([
        signature,
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', compressed),
        makeChunk('IEND', Buffer.alloc(0))
    ]);
}

// ── Multi-size ICO encoder ──────────────────────────────────────────
function createMultiSizeICO(pngBuffers, sizes) {
    const count = pngBuffers.length;

    // ICO header: 6 bytes
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);     // reserved
    header.writeUInt16LE(1, 2);     // type: ICO
    header.writeUInt16LE(count, 4); // number of images

    // Directory entries: 16 bytes each
    const entries = [];
    let dataOffset = 6 + count * 16;

    for (let i = 0; i < count; i++) {
        const entry = Buffer.alloc(16);
        entry[0] = sizes[i] < 256 ? sizes[i] : 0; // width
        entry[1] = sizes[i] < 256 ? sizes[i] : 0; // height
        entry[2] = 0;                               // color palette
        entry[3] = 0;                               // reserved
        entry.writeUInt16LE(1, 4);                   // color planes
        entry.writeUInt16LE(32, 6);                  // bits per pixel
        entry.writeUInt32LE(pngBuffers[i].length, 8);
        entry.writeUInt32LE(dataOffset, 12);
        dataOffset += pngBuffers[i].length;
        entries.push(entry);
    }

    return Buffer.concat([header, ...entries, ...pngBuffers]);
}

// ── Generate all icons ──────────────────────────────────────────────
const electronDir = path.join(__dirname, '..', 'electron');
const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(electronDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

// Sizes for ICO (Windows needs multiple sizes)
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = [];

for (const size of icoSizes) {
    const pixels = drawIcon(size);
    const png = createPNG(size, pixels);
    pngBuffers.push(png);
    console.log(`  Generated ${size}x${size} icon layer`);
}

// Save 256x256 PNG for Electron window/tray
const mainPng = pngBuffers[pngBuffers.length - 1]; // 256x256
const pngPath = path.join(electronDir, 'icon.png');
fs.writeFileSync(pngPath, mainPng);
console.log(`Created ${pngPath} (256x256 PNG)`);

// Save multi-size ICO for installer
const icoBuffer = createMultiSizeICO(pngBuffers, icoSizes);
const icoPath = path.join(buildDir, 'icon.ico');
fs.writeFileSync(icoPath, icoBuffer);
console.log(`Created ${icoPath} (multi-size ICO: ${icoSizes.join(', ')})`);

// Also copy ICO to electron/ for BrowserWindow icon on Windows
const electronIcoPath = path.join(electronDir, 'icon.ico');
fs.writeFileSync(electronIcoPath, icoBuffer);
console.log(`Created ${electronIcoPath}`);

console.log('\nDone! All icon files generated.');
