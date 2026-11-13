# AI usage

## Application features

Health rules and local handover text are deterministic JavaScript. They identify the source, record the measured value and illustrative threshold, and report earlier same-source medians when enough measurements exist. They do not run a trained diagnostic or forecasting model.

If the operator sets `OPENAI_API_KEY`, the user can explicitly request OpenAI prioritization for synthetic observations. The server sends locally generated findings, without crew names, raw record IDs, timestamps or user notes. The prompt requests the zero-based indices of three findings to prioritize for handover. The server validates those indices and only displays locally generated statements, with a label identifying the optional AI ordering. User-entered data remains local. Failed, unavailable, or unconfigured calls fall back to local ordering.

## Development assistance

OpenAI Codex generated and revised application code, UI, tests and documentation based on the Team AstroByte master brief and the team's prescreening prototype. The supplied brief requested a functional astronaut monitoring workflow, verifiable NASA data provenance, persistence, role enforcement, and a deployable package. The code and results are provided for team review and attribution.
