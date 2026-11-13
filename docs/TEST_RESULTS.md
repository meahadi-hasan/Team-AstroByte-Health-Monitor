# AstroByte 1.2.0 verification

| Check | Result |
|---|---|
| JavaScript and build | Source syntax checks, Node release assembly, and the Vercel-configured static build passed locally. |
| Automated tests | Eight tests passed. They cover observation validation, CSV, combined rules, all three workspace roles, persistence, local Shift handover, saved NASA context, NASA parser and fallback, detector-level statistics, and optional AI output handling. |
| NASA RadLab | The Node verification command returned HTTP 200, `mode=fetched`, and 180 historical ISS DosTel records. |
| Desktop browser | Observed scenario values change on the animated landing page, tested pause and resume, and saved a simulated alert follow-up with the directly fetched NASA evidence. |
| Static browser | Checked the globe and demo at a 375 CSS pixel viewport. Saved a simulated observation and attached the labeled 180-measurement NASA snapshot to a follow-up. |
| Live OpenAI | The optional provider is covered with controlled responses. A live request requires an operator key. |
| Hosting | The Vercel build and its output were checked locally. The full Node workspace requires durable storage on its host. |
