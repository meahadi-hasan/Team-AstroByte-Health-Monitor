# Deployment guide

Run a single Node.js 24+ process behind HTTPS on a new VM or container host with persistent storage. Use a distinct domain/service for this release. SQLite uses WAL and a filesystem-backed volume. Typical serverless function filesystems are ephemeral, so use a durable host for this build.

## Native process

1. Extract the release. Place the application under a dedicated OS account. Give that account ownership of a persistent data directory with mode 0700.
2. Set `DB_PATH` to an absolute database path inside that directory. Create the first administrator using a password supplied on standard input. The command can also reset an existing administrator password and revoke its sessions.

   ```sh
   export DB_PATH=/srv/astrobyte-data/astrobyte.sqlite
   read -rs ASTRO_ADMIN_PASSWORD
   printf '%s\n' "$ASTRO_ADMIN_PASSWORD" | npm run admin -- mission-admin
   unset ASTRO_ADMIN_PASSWORD
   ```

3. Configure an HTTPS reverse proxy to the app's loopback port. Preserve the public origin. Set the final public origin without a trailing slash.

   ```sh
   NODE_ENV=production APP_ORIGIN=https://astrobyte.example.org HOST=127.0.0.1 PORT=3000 npm start
   ```

4. Visit the HTTPS domain, sign in, then create the mission and crew profiles. Production starts with an empty database and no public training entry. If enabling `TRUST_PROXY=1`, prevent direct backend access and ensure the immediate proxy supplies the rightmost X-Forwarded-For entry with the actual client address. Default request limits are process-local.
5. For optional AI ordering, provide `OPENAI_API_KEY` as a host secret. `OPENAI_MODEL` is optional. Allow outbound HTTPS to NASA RadLab and, if configured, OpenAI. On Node deployments requiring an HTTP proxy, configure the host proxy and Node's standard environment-proxy support.
6. Verify `/healthz`, authenticate, create a fictional reading, check alert access from a crew account, and restart to verify persistence. Verify source mode after selecting **Refresh from NASA**. Use regular SQLite-aware backups, or stop the app before making a file copy. Protect stored records, backups and exported reports using host permissions and disk encryption.

## Container

Build with `docker build -t astrobyte-health-monitor .`. Create a durable volume and bootstrap an administrator using the same volume. Use an interactive host shell to enter the password.

```sh
docker volume create astrobyte-data
read -rs ASTRO_ADMIN_PASSWORD
printf '%s\n' "$ASTRO_ADMIN_PASSWORD" | docker run --rm -i \
  -v astrobyte-data:/app/var astrobyte-health-monitor node scripts/admin.mjs mission-admin
unset ASTRO_ADMIN_PASSWORD
docker run -d --name astrobyte-final --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v astrobyte-data:/app/var \
  -e APP_ORIGIN=https://astrobyte.example.org astrobyte-health-monitor
```

Terminate HTTPS at the reverse proxy. Inject any OpenAI secret through the hosting platform's secret configuration. The Dockerfile runs as the Node user and exposes an HTTP health check for the host.

## Competition packaging

The Rajshahi Local Lead's permission to start early was reported by the team. The supplied global GO Team announcement and Participant FAQ describe a separate restriction on starting project work before the hackathon. Preserve actual development dates and clarify eligibility for global judging with the organizer before submission. This package contains only application development deliverables.

## Public demo

The repository includes `vercel.json`. In Vercel, import the GitHub repository into a new project and select the folder that contains that configuration as the root directory. The configuration selects Other as the framework, skips dependency installation, runs `npm run build:judge`, and publishes `judge-dist/`. Select Node.js 24.x in Vercel if the project uses a different version. No environment variables are needed for this demo.

After deployment, open the home page, select **Try Demo**, save a Multi-signal observation, and load the NASA reference. The static site uses the bundled, labeled NASA snapshot and keeps demo observations in the browser session. Use the full Node process for private crew sign-in and persistent data. Keep local development mode on your own machine.
