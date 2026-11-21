# Rolling back a deployment

Roll back when the post-deploy check returns **200** for either
`/batches/999` (which must return 404) or `/api/sync` (which must reject an
unauthenticated request). These are the failure signals described in
[`DEPLOYMENT.md`](../DEPLOYMENT.md#verifying-a-deploy). Roll back rather than
debugging forward when either signal appears; a successful response from
either endpoint can mean the deployment is misconfigured or serving the wrong
route.

## Procedure

1. List deployments and identify the last known-good deployment URL before the
   failing deployment:

   ```bash
   vercel ls
   ```

2. Move the production alias back. `vercel deploy --prod` does not move this
   alias, so explicitly point it to the previous deployment:

   ```bash
   vercel alias set <previous-deployment-url> accensa-dashboard.vercel.app
   ```

3. Pause the sync workflow so its in-progress loop cannot keep sending requests
   while the deployment is being checked:

   ```bash
   gh workflow disable "Trigger Indexer Sync"
   ```

4. Run the existing deploy verification against the production alias:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/
   curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/dashboard
   curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/verify
   curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/batches/1
   curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/batches/999  # expect 404
   curl -s https://accensa-dashboard.vercel.app/api/sync                                      # expect Unauthorized
   ```

   The `/batches/999` request must return 404, and `/api/sync` must reject the
   unauthenticated request. A 200 from either means the rollback has not
   restored a healthy deployment.

5. Once the alias is serving the previous deployment and both failure signals
   are clear, resume indexing:

   ```bash
   gh workflow enable "Trigger Indexer Sync"
   ```

## Partial rollbacks

The alias and sync workflow are independent controls. If the alias moved back
but sync was not paused, the running sync loop may still be reaching the
deployment through `SYNC_URL`; disable the workflow to prevent future runs and
allow any already-running loop to exit before treating sync as paused. If sync
was paused but the alias did not move, the bad deployment is still live.
`vercel deploy --prod` alone does not move `accensa-dashboard.vercel.app`;
confirm the alias with `vercel ls` and set it explicitly to the previous
deployment URL.

## When not to roll back

Do not use a code rollback to recover ledgers already lost beyond the Soroban
RPC retention window; a previous deployment cannot reconstruct missing events.
Likewise, if the release includes a database change that the previous
deployment cannot safely use, or if the same failure is present on the previous
deployment, rolling back the application is not a safe remedy. Treat those as
incidents and investigate the data or compatibility issue before changing the
alias.
