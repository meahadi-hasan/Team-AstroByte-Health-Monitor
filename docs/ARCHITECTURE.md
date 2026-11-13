# Architecture

## Components

- `public/` provides the dashboard, crew/mission administration, observation history, charts, alerts, radiation view, exports, and access audit. Views request authenticated JSON APIs and reflect the returned state. User-supplied strings are escaped before rendering. The frontend has no third-party scripts.
- `src/server.mjs` serves allowlisted assets and same-origin APIs. It validates payloads, enforces role and crew access, uses parameterized database queries, and sends restrictive browser headers.
- `src/store.mjs` opens SQLite, applies numbered migrations, manages transactions and sessions, and maintains alert evidence. An observation write and its alert updates commit together. A complete import commits as a batch. Record and alert revisions prevent lost updates from stale forms.
- `src/domain.mjs` validates observations, defines the demonstration rules and CSV format, and creates verified handover statements. Thresholds are centralized in the metric configuration in this module. Changes to threshold policy require a source revision and review of existing alert history.
- `src/radlab.mjs` builds a bounded query for a fixed NASA host, validates columns and rows, and supplies labeled cached or snapshot data during upstream failure. It keeps environmental data separate from health alert calculations.
- `src/insights.mjs` generates findings locally. An optional server-side request can prioritize already generated statements for synthetic data only.

## Data and access

Missions have crew profiles. Readings attach to a crew profile and UTC time, with a unique timestamp per profile, source, numeric values and a note. Crew profiles have a current mission assignment, and reassignment preserves their reading history. Rule-derived alerts attach to readings. Follow-ups retain status changes and notes. Audit entries store event metadata without observation contents. Cache entries track NASA query, fetch time and validated payload.

Admins manage missions, crew and accounts. Reviewers work across crew records and can resolve alerts. Crew accounts can view, log and import readings for their linked profile, edit readings they created, acknowledge alerts and add notes. Reviewers and admins can edit any accessible observation. A corrected observation withdraws flags that no longer apply, while retaining prior follow-up history. Materially changed evidence reopens a flag. Sessions use random tokens, hashed token storage, expiry, and revocation on sign-out. Production cookies use HTTPS, HttpOnly and SameSite restrictions.

## Alert semantics

A watch flag records the indicator, value and configured illustrative range. A review flag groups multiple out-of-range indicators from the same observation. Missing values do not trigger a rule. Local handover text can also compare with the median of up to 14 earlier same-source readings for the same crew profile, using at least three available values. Medians provide context and do not trigger alerts.

## Judging mode

`demo.html` runs with browser-local state and imports the shared domain rules. The Node app exposes a fixed, read-only NASA reference route for the demo. `npm run build:judge` exports the same demo with normalized snapshot data for static hosting. The signed-in workspace lets authorized users attach a server-produced evidence summary to a synthetic alert’s follow-up. Migration 003 adds the nullable evidence column while preserving earlier follow-ups.
