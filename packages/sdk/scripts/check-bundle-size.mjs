/**
 * Bundle size checker for the checkout widget
 *
 * Ensures the widget bundle stays under 45kB gzipped as required by #390.
 * This script runs after build and fails if the size limit is exceeded.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_SIZE_GZIP = 45 * 1024; // 45kB in bytes
const WIDGET_ENTRY = 'dist/widget.mjs';

/**
 * Measures actual gzip size (level 9) of the file at filePath.
 * Returns { rawBytes, gzippedBytes, limit, passed }.
 */
export function checkBundleSize(filePath) {
  const buf = fs.readFileSync(filePath);
  const rawBytes = buf.length;
  const gzippedBytes = gzipSync(buf, { level: 9 }).length;
  const limit = MAX_SIZE_GZIP;
  const passed = gzippedBytes <= limit;
  return { rawBytes, gzippedBytes, limit, passed };
}

function main() {
  const widgetPath = path.join(__dirname, '..', WIDGET_ENTRY);

  let result;
  try {
    result = checkBundleSize(widgetPath);
  } catch (error) {
    console.error(`❌ Could not read widget file: ${error.message}`);
    process.exit(1);
  }

  const { rawBytes, gzippedBytes, limit } = result;

  console.log('📦 Bundle Size Check');
  console.log('==================');
  console.log(`Raw:     ${rawBytes} bytes`);
  console.log(`Gzipped: ${gzippedBytes} bytes`);
  console.log(`Limit:   ${limit} bytes`);

  if (!result.passed) {
    console.error(`\n❌ Bundle size exceeds limit!`);
    console.error(`   Gzipped: ${gzippedBytes} bytes`);
    console.error(`   Limit:   ${limit} bytes`);
    console.error(`   Excess:  ${gzippedBytes - limit} bytes`);
    process.exit(1);
  }

  console.log(`\n✅ Bundle size within limits (${gzippedBytes} / ${limit} bytes gzip)`);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
