import fs from 'fs';

const path = 'apps/web/src/lib/db.integration.test.ts';
let content = fs.readFileSync(path, 'utf8');

// Fix the txHash length bugs
content = content.replace(/'b'\.repeat\(64\)/g, "'b'.repeat(63)");
content = content.replace(/'c'\.repeat\(64\)/g, "'c'.repeat(63)");

fs.writeFileSync(path, content);
