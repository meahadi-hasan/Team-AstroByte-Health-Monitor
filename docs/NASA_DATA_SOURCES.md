# NASA data sources

The application uses NASA OSDR RadLab for historical absorbed radiation dose rate from ISS DosTel instruments. It uses the [RadLab Data API](https://visualization.osdr.nasa.gov/radlab/gui/data-api/) and links each query in the UI.

| Data field | Interpretation |
|---|---|
| timestamp | Observation time, interpreted as UTC |
| instrument_id | DosTel1 or DosTel2 |
| spacecraft | ISS |
| absorbed_dose_rate | Absorbed dose rate in µGy/h |

The reference query starts 1 April 2022 at 23:00 UTC and ends 2 April 2022 at 01:05 UTC, exclusive. The API returned JSON split format with columns and row arrays. The adapter maps columns by name, accepts object rows, validates the expected time window, instrument and numeric dose, and removes duplicate detector/timestamp pairs. The UI shows each detector separately.

`data/radlab-iss-dostel.json` is the original NASA API response for that interval, with 180 rows. The companion metadata records the source query and retrieval timestamp. The app labels direct retrieval, cached data, stale cache, packaged snapshot, and unavailable data separately. Snapshot fallback only applies within the recorded window. Cache retention is capped at 100 queries, with a six-hour freshness window. Upstream failures and empty responses do not generate sample measurements.

Physiological readings have separate provenance labels for synthetic or user-entered data. Environmental observations do not enter the health rules. The application does not integrate astronaut medical records or wearables. New challenge resources can be integrated as a distinct adapter when released and verified.

## Alert review and public release

The in-alert ISS reference is available for synthetic observations. AstroByte groups measurements by detector and calculates the median and peak absorbed dose rate for the reference window. The workspace can persist the selected reference and its provenance with a review note. The standalone public demo uses the same rules and evidence view with the validated packaged snapshot.

Image credit: NASA photograph iss062e147835, Andrew Morgan in the ISS cupola, April 12, 2020. Source: https://www.nasa.gov/image-article/nasa-astronaut-andrew-morgan-photographs-earth-below/
