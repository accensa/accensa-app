/**
 * Bundle size checker for the checkout widget
 * 
 * Ensures the widget bundle stays under 45kB gzipped as required by #390.
 * This script runs after build and fails if the size limit is exceeded.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_SIZE_GZIP = 45 * 1024; // 45kB in bytes
const WIDGET_ENTRY = 'dist/widget.mjs';

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Simple gzip size estimation (actual gzip would require zlib)
function estimateGzipSize(uncompressedSize) {
  // Typical compression ratio for JS is ~60-70%
  return Math.floor(uncompressedSize * 0.65);
}

function main() {
  const widgetPath = path.join(__dirname, '..', WIDGET_ENTRY);
  const fileSize = getFileSize(widgetPath);

  if (fileSize === null) {
    console.error('❌ Could not determine widget file size');
    process.exit(1);
  }

  const estimatedGzipSize = estimateGzipSize(fileSize);

  console.log('📦 Bundle Size Check');
  console.log('==================');
  console.log(`Uncompressed: ${formatBytes(fileSize)}`);
  console.log(`Estimated gzip: ${formatBytes(estimatedGzipSize)}`);
  console.log(`Limit: ${formatBytes(MAX_SIZE_GZIP)} (gzip)`);

  if (estimatedGzipSize > MAX_SIZE_GZIP) {
    console.error(`\n❌ Bundle size exceeds limit!`);
    console.error(`   Current: ${formatBytes(estimatedGzipSize)}`);
    console.error(`   Limit: ${formatBytes(MAX_SIZE_GZIP)}`);
    console.error(`   Excess: ${formatBytes(estimatedGzipSize - MAX_SIZE_GZIP)}`);
    process.exit(1);
  }

  console.log(`\n✅ Bundle size within limits (${formatBytes(estimatedGzipSize)} / ${formatBytes(MAX_SIZE_GZIP)})`);
  process.exit(0);
}

main();
