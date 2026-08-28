import fs from 'fs';

const path = 'apps/web/src/lib/db.integration.test.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('fn: (import_pg.Client) => Promise<T>,', 'fn: (client: import_pg.Client) => Promise<T>,');

fs.writeFileSync(path, content);
