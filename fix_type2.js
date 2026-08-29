import fs from 'fs';

const path = 'apps/web/src/lib/db.integration.test.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace("import type * as import_pg from 'pg';", "import { Client } from 'pg';");
content = content.replace('fn: (client: import_pg.Client) => Promise<T>,', 'fn: (client: Client) => Promise<T>,');

fs.writeFileSync(path, content);
