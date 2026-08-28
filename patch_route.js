import fs from 'fs';

const path = 'apps/web/src/app/api/sync/route.ts';
let content = fs.readFileSync(path, 'utf8');

const conflict = `<<<<<<< HEAD
 * CRON_SECRET, checked with a constant-time compare in isAuthorizedCronRequest
 * (@/lib/cron-auth) - both senders pass it as a bearer token - so the
 * endpoint cannot be driven by arbitrary callers. An unset CRON_SECRET fails
 * closed: middleware.ts already denies this path before it reaches here, and
 * this check denies it too, since no caller should ever run a sync against a
 * deployment with no secret configured. No cooldown: a scheduled run is
 * already rate limited by its schedule.
 */
export async function GET(request: Request) {
 if (!isAuthorizedCronRequest(request.headers.get('authorization'))) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }
=======
 * CRON_SECRET when set - both senders pass it as a bearer token - so the
 * endpoint cannot be driven by arbitrary callers. No cooldown: a scheduled run
 * is already rate limited by its schedule.
 *
 * Sweeps every configured merchant in turn, each with its own cursor - a
 * merchant with no activity still has its cursor advanced (see runSync),
 * which is precisely the fix for the outage that motivated this workflow's
 * checks in the first place.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== \`Bearer \${secret}\`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
>>>>>>> origin/main`;

const replacement = ` * CRON_SECRET, checked with a constant-time compare in isAuthorizedCronRequest
 * (@/lib/cron-auth) - both senders pass it as a bearer token - so the
 * endpoint cannot be driven by arbitrary callers. An unset CRON_SECRET fails
 * closed: middleware.ts already denies this path before it reaches here, and
 * this check denies it too, since no caller should ever run a sync against a
 * deployment with no secret configured. No cooldown: a scheduled run is
 * already rate limited by its schedule.
 *
 * Sweeps every configured merchant in turn, each with its own cursor - a
 * merchant with no activity still has its cursor advanced (see runSync),
 * which is precisely the fix for the outage that motivated this workflow's
 * checks in the first place.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }`;

content = content.replace(conflict, replacement);
fs.writeFileSync(path, content);
