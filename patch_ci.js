

const oldTestWebSteps = `      - name: Test web
        working-directory: ./apps/web
        env:
          DATABASE_URL: postgres://postgres:password@localhost:5432/accensa_test
        run: pnpm test`;