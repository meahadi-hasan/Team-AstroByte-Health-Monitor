# AstroByte Health Monitor

**Final local submission · NASA Space Apps Challenge 2026**  
**Challenge** · Create Health Monitoring Software for Astronauts on Space Missions  
**Team** · Team AstroByte, Rajshahi, Bangladesh 

[Watch the final judging video (3:49)](https://youtu.be/dbgMfhto2KM)

## Project overview

AstroByte Health Monitor helps astronaut crews and reviewers record health observations, understand why an alert fired, and document what to verify next during long-duration missions. The application shows which readings triggered each rule and lets a reviewer attach historical ISS radiation measurements from NASA OSDR RadLab to a follow-up note.

## What you can try

| Public judging demo | Full crew workspace |
| --- | --- |
| Enter simulated heart rate, oxygen saturation (SpO₂), temperature, sleep duration, and fatigue readings, or choose a scenario preset. | Sign in as an administrator, reviewer, or crew member to access the records and actions permitted for that role. |
| Review individual and combined rule-based alerts and the readings that triggered them. | Log observations, view trends, review and resolve alerts, record follow-ups, and view a rule-based shift handover. |
| Compare historical ISS radiation readings by detector and attach the reference to a follow-up note. | Query NASA RadLab and save observations, alert history, and follow-ups in SQLite. |
| Export the current session as JSON. Reloading the page resets the session. | Manage missions, crew assignments, and accounts. Authorized users can access the audit log. |

## Run locally

Install **Node.js 24 or later**, then open a terminal in the folder containing `package.json`. The project uses HTML, CSS, JavaScript, Node.js, and Node.js's built-in SQLite module. It has no npm dependencies to install.

```sh
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

- **Explore the demo** opens the public workflow without an account.
- **Crew Sign In → Open local training admin** opens the local training workspace with fictional crew records. The app creates the training database on startup. For hosted crew accounts and persistent storage, see the [deployment guide](docs/DEPLOYMENT_GUIDE.md).

## Walk through the judging demo

1. Select **Explore the demo → Multi-signal → Save observation**.
2. Review the combined alert and the readings that triggered it.
3. Select **Load NASA reference**. Compare the two detectors' median and peak dose rates, then check the time window and data source.
4. Enter a follow-up note, tick **Attach NASA reference to this note**, and select **Save follow-up**.
5. Open **Attached NASA reference** under **Review history**, or select **Export session** to save a JSON copy.

## NASA data and provenance

The radiation reference contains **180 historical ISS measurements** from **DosTel1** and **DosTel2**, from **1 April 2022 at 23:00 UTC** to **2 April 2022 at 01:05 UTC**, exclusive. The interface reports absorbed dose rates in **µGy/h** and preserves the detector, time window, and source.

- **Public Vercel demo** uses a labeled snapshot captured from NASA RadLab.
- **Full Node.js workspace** can query NASA RadLab and use a labeled cache or packaged snapshot when applicable.
- **Crew alerts** use the health readings. In the judging demo those readings are simulated. The RadLab data provides environmental context alongside the alert.

[NASA RadLab Data API](https://visualization.osdr.nasa.gov/radlab/gui/data-api/) · [Dataset and asset attribution](docs/NASA_DATA_SOURCES.md)

## Test and build

```sh
npm test
npm run check
npm run build
npm run build:judge
```

`npm run build` assembles the full Node.js release in `dist/`. The repository's Vercel configuration runs `npm run build:judge` and serves the account-free demo from `judge-dist/`. The full crew workspace uses a Node.js host with persistent storage.

To verify a direct RadLab request when the service is reachable, run `node scripts/verify-nasa.mjs`. See the [test results](docs/TEST_RESULTS.md) and [architecture](docs/ARCHITECTURE.md).

## AI use and validation

OpenAI Codex assisted with implementation, testing, documentation, and demo narration scripting. Health alerts and the default shift handover use deterministic rules. The full workspace can optionally ask OpenAI to prioritize rule-generated findings from synthetic observations when an operator configures a server-side API key. See [AI usage](docs/AI_USAGE.md).

This hackathon application demonstrates an alert review workflow. Its health thresholds are illustrative and require validation against appropriate mission data before use in operational or clinical decisions.

## Team AstroByte

| Member | Role |
| --- | --- |
| Md. Meahadi Hasan | Team Leader, AI & Full-Stack Developer |
| Md. Shakil Ahmmed Moni | Frontend Developer |
| Suraiya Akter | Researcher |
| Md. Sohanur Rahman | Designer |
| Khandakar Jarin Shova | Documentation & Script Writer |

## License

Application code is available under the [MIT License](LICENSE). AstroByte Health Monitor is an independent Team AstroByte project. NASA RadLab and NASA imagery are credited in the [data sources and attribution notes](docs/NASA_DATA_SOURCES.md).
