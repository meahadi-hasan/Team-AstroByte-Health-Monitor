# Deployment guide

AstroByte Health Monitor 1.2.0 uses Node.js 24 or later. Run commands from the directory containing `package.json`. The project has no npm dependencies to install.

| Mode | Use it to |
| --- | --- |
| Local training | Try the judging demo and the Crew Workspace with fictional records on your computer. |
| Vercel | Publish the judging demo with the bundled NASA RadLab snapshot. Visitors can use it without an account. |
| Node.js host | Run the Crew Workspace with role-based sign-in, persistent SQLite records, and direct historical RadLab queries. |

## Local training

```sh
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Select **Explore the demo** to try the account-free workflow, or choose **Crew Sign In → Open local training admin** to use the training workspace. The app creates the local training database at `var/training.sqlite`. Use this mode on your own computer.

## Publish the judging demo on Vercel

1. Import the GitHub repository into Vercel. Set the project root to the directory containing `vercel.json`.
2. Use the repository's build configuration.

   | Setting | Value |
   | --- | --- |
   | Framework preset | Other |
   | Node.js | 24.x |
   | Build command | `npm run build:judge` |
   | Output directory | `judge-dist` |
   | Install command | Skipped by `vercel.json` |
   | Environment variables | Leave empty |

3. Deploy and open the published URL in a private browser window. Select **Explore the demo → Multi-signal → Save observation**.
4. Select **Load NASA reference**, enter a follow-up note, tick **Attach NASA reference to this note**, and select **Save follow-up**. Open the attachment in **Review history**.

The Vercel build publishes the demo with a labeled snapshot of 180 historical NASA RadLab measurements. Demo observations stay in the current page session. To use **Crew Sign In** and persist records, deploy the full Node.js workspace as described below.

[Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json) · [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

## Deploy the full Crew Workspace

Run one Node.js process behind HTTPS. Give the service a persistent directory for the SQLite database and its write-ahead log. Use fictional records for a judging workspace. Keep `.env` files, database files, and credentials out of the repository.

### Option A · Node.js on a Linux host

1. Place the application under a dedicated service account. Create a persistent directory owned by that account with permissions `0700`. The commands below use `/srv/astrobyte-data`.
2. From an interactive Bash shell under that account, create the first administrator. Enter a password of at least 12 characters when prompted.

   ```bash
   export DB_PATH=/srv/astrobyte-data/astrobyte.sqlite
   read -rsp 'Administrator password: ' ASTRO_ADMIN_PASSWORD
   printf '\n'
   printf '%s\n' "$ASTRO_ADMIN_PASSWORD" | npm run admin -- mission-admin
   unset ASTRO_ADMIN_PASSWORD
   ```

3. Configure an HTTPS reverse proxy to `127.0.0.1:3000`. Set `APP_ORIGIN` to the exact public HTTPS origin, with no trailing slash. Run the process with the same database path used to create the administrator.

   ```bash
   NODE_ENV=production DEMO_MODE=0 APP_ORIGIN=https://astrobyte.example.org \
     DB_PATH=/srv/astrobyte-data/astrobyte.sqlite HOST=127.0.0.1 PORT=3000 npm start
   ```

   Keep the process running under your service manager. The app applies the database migrations at startup.

### Option B · Docker on a host with persistent storage

Build the image and create a named volume from an interactive Bash shell.

```bash
docker build -t astrobyte-health-monitor .
docker volume create astrobyte-data
docker run --rm --user 0 -v astrobyte-data:/app/var astrobyte-health-monitor \
  sh -c 'chown node:node /app/var && chmod 700 /app/var'
```

Create the first administrator and start the service using that same volume. Replace the example HTTPS origin with your own.

```bash
read -rsp 'Administrator password: ' ASTRO_ADMIN_PASSWORD
printf '\n'
printf '%s\n' "$ASTRO_ADMIN_PASSWORD" | docker run --rm -i \
  -v astrobyte-data:/app/var astrobyte-health-monitor node scripts/admin.mjs mission-admin
unset ASTRO_ADMIN_PASSWORD

docker run -d --name astrobyte-final --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v astrobyte-data:/app/var \
  -e APP_ORIGIN=https://astrobyte.example.org -e DEMO_MODE=0 astrobyte-health-monitor
```

The Dockerfile runs the app as the `node` user and writes the database to `/app/var/astrobyte.sqlite`. Configure the host's HTTPS reverse proxy to forward requests to the published loopback port. On a managed container platform, use its HTTPS endpoint and mount a writable persistent volume at `/app/var`.

### Configure and verify the hosted workspace

1. Open `/healthz` and verify that it returns `{"ok":true}`. Open **Crew Sign In** and sign in as `mission-admin`.
2. Create a mission and a fictional crew profile. Create a separate **Reviewer** account if judges need to test the signed-in workflow. Share that account's credentials through the agreed judging channel.
3. Record a simulated observation, review its alert, and save a follow-up. Restart the service and confirm the record persists. In **NASA RadLab**, select **Refresh from NASA** and check the displayed data source.
4. For optional AI prioritization of synthetic findings, set `OPENAI_API_KEY` through the host's secrets settings. `OPENAI_MODEL` is optional. Allow outbound HTTPS to NASA RadLab and, if enabled, OpenAI. The default handover uses local rules.
5. Use SQLite-aware backups for the database. If you enable `TRUST_PROXY=1`, restrict direct access to the backend and configure the immediate proxy to set the rightmost `X-Forwarded-For` entry to the client address.

See the [architecture](ARCHITECTURE.md), [NASA data sources](NASA_DATA_SOURCES.md), and [test results](TEST_RESULTS.md).
