import fs from 'fs';

const path = 'apps/web/src/lib/db.integration.test.ts';
let content = fs.readFileSync(path, 'utf8');

const importRegex = /import \{[\s\S]*?withMerchantClient,[\s\S]*?\} from '\.\/db';/;
content = content.replace(importRegex, (match) => {
  return match.replace('withMerchantClient,', '');
});

const withMerchantClientDefinition = `
async function withMerchantClient<T>(
  merchantId: number,
  fn: (import_pg.Client) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    // Ensure the non-superuser role exists
    await client.query(\`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'test_app_user') THEN
          CREATE ROLE test_app_user;
        END IF;
      END $$;
    \`);
    await client.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO test_app_user');
    await client.query('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO test_app_user');
    
    // Switch to non-superuser so RLS policies are enforced
    await client.query('SET SESSION AUTHORIZATION test_app_user');
    
    await client.query('SELECT set_config($1, $2, false)', [
      'accensa.merchant_id',
      String(merchantId),
    ]);
    return fn(client);
  });
}
`;

// Insert the definition after the imports
content = content.replace(/(import .*;\n)+/, (match) => {
  return match + "import type * as import_pg from 'pg';\n" + withMerchantClientDefinition;
});

fs.writeFileSync(path, content);
