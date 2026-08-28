import fs from 'fs';

const path = '.github/workflows/ci.yml';
let content = fs.readFileSync(path, 'utf8');

const oldTestWebSteps = `      - name: Test web
        working-directory: ./apps/web
        env:
          DATABASE_URL: postgres://postgres:password@localhost:5432/accensa_test
        run: pnpm test`;

const newTestWebSteps = `      - name: Test web
        working-directory: ./apps/web
        env:
          DATABASE_URL: postgres://app_user:password@localhost:5432/accensa_test
        run: |
          psql postgres://postgres:password@localhost:5432/accensa_test -c "CREATE USER app_user WITH PASSWORD 'password'; GRANT ALL PRIVILEGES ON DATABASE accensa_test TO app_user;"
          psql postgres://postgres:password@localhost:5432/accensa_test -c "ALTER SCHEMA public OWNER TO app_user;"
          pnpm test`;

content = content.replace(oldTestWebSteps, newTestWebSteps);

fs.writeFileSync(path, content);
