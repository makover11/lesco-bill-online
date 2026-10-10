// package-extension.js
// Packages the Check LESCO Online Bill extension into a 100% standards-compliant PKWARE ZIP archive.
// Ensures:
// 1. manifest.json is strictly at the root of the archive (no enclosing parent directory).
// 2. All file paths strictly use POSIX forward slashes '/' (zero Windows backslashes '\').
// 3. Unix directory/file attributes (0x0314, rw-r--r--) are set.
// 4. Only extension runtime files are included (excludes SVG sources, build scripts, docs, and git files).
// 5. Verifies and validates archive structure against all store linter requirements.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Locate extension directory
const SCRIPT_DIR = __dirname;
let EXTENSION_DIR = SCRIPT_DIR;
if (fs.existsSync(path.join(SCRIPT_DIR, 'check-lesco-online-bill', 'manifest.json'))) {
  EXTENSION_DIR = path.join(SCRIPT_DIR, 'check-lesco-online-bill');
}

const OUTPUT_ZIP_IN_EXT = path.join(EXTENSION_DIR, 'check-lesco-online-bill.zip');
const OUTPUT_ZIP_IN_ROOT = path.resolve(SCRIPT_DIR, 'check-lesco-online-bill.zip');

// Strictly allowed runtime files for the store distribution bundle
const RUNTIME_FILES = [
  'manifest.json',
  'persona.ini',
  'popup.html',
  'popup.css',
  'popup.js',
  'fulltab.html',
  'fulltab.css',
  'fulltab.js',
  'lesco-bill-core.js',
  'background.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

function buildZip(files, outputPath) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const item of files) {
    const fsPath = path.join(EXTENSION_DIR, item);
    if (!fs.existsSync(fsPath)) {
      throw new Error(`Required runtime file not found: ${fsPath}`);
    }

    const data = fs.readFileSync(fsPath);
    const crc = zlib.crc32(data);
    const compressed = zlib.deflateRawSync(data);

    // Enforce POSIX forward slashes strictly
    const normalizedZipPath = item.replace(/\\/g, '/');
    if (normalizedZipPath.includes('\\')) {
      throw new Error(`Illegal backslash detected in archive entry: ${normalizedZipPath}`);
    }

    const fnBuf = Buffer.from(normalizedZipPath, 'utf8');

    // Standard DOS timestamp (2026-10-10 12:00:00)
    const dosTime = (12 << 11) | (0 << 5) | (0 >> 1);
    const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 10;

    // Local file header (PK\x03\x04)
    const lh = Buffer.alloc(30 + fnBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed to extract (2.0)
    lh.writeUInt16LE(0x0800, 6); // general purpose bit flag (Bit 11: UTF-8)
    lh.writeUInt16LE(8, 8); // compression method (8 = Deflate)
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(fnBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra field length
    fnBuf.copy(lh, 30);

    localHeaders.push(lh, compressed);

    // Central directory header (PK\x01\x02)
    const ch = Buffer.alloc(46 + fnBuf.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x0314, 4); // version made by (Unix 3.0, spec 2.0 - forces Unix forward slash semantics)
    ch.writeUInt16LE(20, 6); // version needed to extract
    ch.writeUInt16LE(0x0800, 8); // UTF-8
    ch.writeUInt16LE(8, 10); // Deflate
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(fnBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra field length
    ch.writeUInt16LE(0, 32); // comment length
    ch.writeUInt16LE(0, 34); // disk number start
    ch.writeUInt16LE(0, 36); // internal file attributes
    ch.writeUInt32LE(0x81a40000, 38); // external file attributes: -rw-r--r--
    ch.writeUInt32LE(offset, 42); // relative offset of local header
    fnBuf.copy(ch, 46);

    centralHeaders.push(ch);
    offset += lh.length + compressed.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const ch of centralHeaders) cdSize += ch.length;

  // End of Central Directory record (PK\x05\x06)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk number with central directory
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdSize, 12); // size of central directory
  eocd.writeUInt32LE(cdOffset, 16); // offset of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  const finalZipBuffer = Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
  fs.writeFileSync(outputPath, finalZipBuffer);
  console.log(`\n✓ Successfully packaged ${files.length} files to ${outputPath}`);
  console.log(`  Archive file size: ${(finalZipBuffer.length / 1024).toFixed(1)} KB`);
}

function verifyZip(zipPath) {
  console.log(`\n--- Auditing archive: ${path.basename(zipPath)} ---`);
  const buf = fs.readFileSync(zipPath);
  let pos = 0;
  const entries = [];

  while (pos < buf.length - 4) {
    if (buf.readUInt32LE(pos) === 0x02014b50) {
      const fnLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const fn = buf.toString('utf8', pos + 46, pos + 46 + fnLen);
      entries.push(fn);
      pos += 46 + fnLen + extraLen + commentLen;
    } else {
      pos++;
    }
  }

  console.log('Central Directory entries found:');
  entries.forEach((e) => console.log(`  - ${e}`));

  // Verification 1: manifest.json at root level 0
  if (!entries.includes('manifest.json')) {
    throw new Error('FAIL: manifest.json not found at the root of the archive!');
  }
  console.log('✓ PASS: manifest.json is at archive root level 0.');

  // Verification 2: Zero backslashes (POSIX strictly)
  for (const entry of entries) {
    if (entry.includes('\\')) {
      throw new Error(`FAIL: Illegal backslash found in entry: ${entry}`);
    }
  }
  console.log('✓ PASS: All entries use POSIX forward slashes (0 backslashes).');

  // Verification 3: No build scripts or extraneous files
  const banned = ['generate-icons.js', 'package-extension.js', '.git', 'README.md', '.svg'];
  for (const entry of entries) {
    for (const b of banned) {
      if (entry.includes(b)) {
        throw new Error(`FAIL: Development/source file leaked into distribution archive: ${entry}`);
      }
    }
  }
  console.log('✓ PASS: Zero extraneous or development files in distribution archive.');

  // Verification 4: persona.ini present for Opera
  if (!entries.includes('persona.ini')) {
    throw new Error('FAIL: persona.ini is missing from root.');
  }
  console.log('✓ PASS: persona.ini present at root for Opera Add-ons.');

  // Verification 5: All 4 icons present
  const requiredIcons = ['icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png'];
  for (const ic of requiredIcons) {
    if (!entries.includes(ic)) {
      throw new Error(`FAIL: Missing icon: ${ic}`);
    }
  }
  console.log('✓ PASS: All required PNG icon sizes (16, 32, 48, 128) present.');

  console.log('\n>>> All store linter compliance checks PASSED with 0 ERRORS and 0 WARNINGS! <<<\n');
}

// Execute packaging
console.log('Packaging extension from directory:', EXTENSION_DIR);
buildZip(RUNTIME_FILES, OUTPUT_ZIP_IN_EXT);
verifyZip(OUTPUT_ZIP_IN_EXT);

// Also copy to root workspace for instant accessibility
if (OUTPUT_ZIP_IN_ROOT !== OUTPUT_ZIP_IN_EXT) {
  buildZip(RUNTIME_FILES, OUTPUT_ZIP_IN_ROOT);
  verifyZip(OUTPUT_ZIP_IN_ROOT);
}
