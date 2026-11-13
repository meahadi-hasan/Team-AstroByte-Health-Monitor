# AstroByte Health Monitor

Team AstroByte’s NASA Space Apps Challenge 2026 entry for Rajshahi. The app helps a crew member or reviewer log a simulated health observation, understand the alert it triggers, and record a follow-up after reviewing historical ISS radiation measurements. The animated globe on the home page previews the same synthetic scenarios used in the demo.

## Run locally

Install Node.js 24 or newer, extract the ZIP, and open a terminal in the folder that contains `package.json`. The application has no npm dependencies to install.

```sh
npm run dev
```

Open <http://127.0.0.1:3000>. **Try Demo** opens a browser session with fictional crew readings. **Crew Sign In → Open local training admin** opens a separate SQLite training workspace for testing crew records, roles, and audit history.

## Run the judging demo

1. Choose **Multi-signal** and select **Save observation**. The demo selects the combined alert if one fires.
2. Review the listed triggers, then select **Load NASA reference**. Compare the detector peaks and medians, and inspect the time window, units, and source.
3. Add a follow-up note, check **Attach NASA reference to this note**, and select **Save follow-up**. Expand the attached reference in Review history.
4. **Export session** saves the synthetic observations, flags, notes, and evidence as JSON. **Reset demo** clears the session and loads the default preset.

The public demo stores entries in the current page session and resets on reload. The static release uses a labeled snapshot retrieved from NASA RadLab. The Node release queries NASA on the server and falls back to cached data or the packaged snapshot. The separate crew workspace stores authorized observations, alerts, and follow-ups in SQLite. The workspace's Overview includes a local rule-based Shift handover. Optional OpenAI prioritization requires an operator key and is limited to synthetic observations.

## Build and verify

```sh
npm test
npm run check
npm run build
npm run build:judge
node scripts/verify-nasa.mjs
```

`dist/` is the full Node application release. `judge-dist/` is the standalone public demo for an HTTPS static host. Both builds use the same demonstration rules.

## Publish the submission

Put the files from a fresh extraction at the root of a public GitHub repository, including `.gitignore` and `vercel.json`. Use the public repository URL for the source-code field of the submission.

To publish the optional demo, import that repository into a new Vercel project. Keep the root directory at the folder with `vercel.json`. That file sets the build command and output directory. Open the deployed home page and select **Try Demo**. Add the deployed URL to the repository's **About → Website** field.

Use the full Node app for crew accounts and persistent SQLite records. For role setup and persistent HTTPS deployment, see [Deployment guide](docs/DEPLOYMENT_GUIDE.md).

- [NASA data and image credits](docs/NASA_DATA_SOURCES.md)
- [AI usage](docs/AI_USAGE.md)
- [Verification](docs/TEST_RESULTS.md)
- [Rajshahi submission text and video workflow](docs/SUBMISSION.md)

All demonstration rule ranges are illustrative. Historical RadLab measurements describe the detector environment within the chosen ISS window. AstroByte records the reference alongside a simulated alert so reviewers can discuss the signals and context together.

## Team AstroByte

| Member | Role |
|---|---|
| Md. Meahadi Hasan | Team Leader, AI and Full-Stack Developer |
| Md. Shakil Ahmmed Moni | Frontend Developer |
| Suraiya Akter | Researcher |
| Md. Sohanur Rahman | Designer |
| Khandakar Jarin Shova | Documentation and Script Writer |

Application code is MIT licensed. This is an independent team project. Crew sign-in photo credit to NASA.
