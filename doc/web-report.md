# Web server and report

The backend contract is implemented in `src/webserver.js`, `src/webservice.js`, `src/webquery.js`, and `src/webdata.js`. The frontend component map and development commands are in [web/README.md](../web/README.md); [design-spec.md](../design-spec.md) is the visual and interaction authority.

## Snapshot lifecycle

`toksight web` preloads the committed SQLite snapshot. Its first launch without a snapshot collects agent data once and creates one. GET requests filter that snapshot without rescanning agents. `toksight refresh` and `POST /api/refresh` rescan and transactionally replace it; a failed refresh leaves the previous data available. SQLite `data_version` notices changes committed by another process. Cursor CSV imports update the report without rescanning other clients and survive refresh.

## HTTP and scope

The server binds `127.0.0.1` by default. Static assets under `web/out/_next/` use immutable caching; other static responses use `no-cache`. Traversal outside the static directory returns 403. If `web/out/index.html` is missing, `/` serves a setup page while the API remains available.

`GET` and `HEAD /api/data` read the snapshot. `POST /api/refresh`, `POST /api/prices/update`, `POST /api/import/cursor`, and `POST /api/import/db` are write routes; `GET` and `HEAD /api/export/db` download a standalone SQLite backup. Other `/api/*` paths return JSON 404. A loopback-bound server rejects these API requests when the Host is not a localhost name, and write routes reject cross-origin browser requests. Explicit `--host 0.0.0.0` opts out of the loopback Host restriction. Do not add agent-configuration write routes.

`/api/data` accepts `period=all/today/7d/30d/month/custom`, `client`, `since`, and `until`. `src/webquery.js` validates parameters, rejects invalid or duplicate values, and intersects every query with the startup scope. No request can widen it. `scopeRange` reports the startup scope's activity bounds regardless of the requested period. Historical `selection` charts use at most the last 366 days; totals and comparison still cover the complete selected period. With no start date, comparison uses seven days ending at the selected end date or today; it is unavailable when the previous window falls outside startup scope.

## Web payload additions

`GET /api/data` preserves the CLI JSON fields and adds `heatmap`, `trend`, `trend7`,
`trend90`, `trendByAgent` (7, 30, and 90 days), `hourly`, `today`, `last7Days`,
`last30Days`, `thisMonth`, `activeDays`, `streaks`, `peakDay`, `topSessions`,
`longestSession`, `activityRange`, and `timezone`. `longestSession` ranks by `activeMs`,
which caps idle gaps between requests at five minutes.

The service also adds `snapshot` (committed refresh time and row count), `view`
(server date and selected/startup scope), `scopeRange`, `selection`, `costCoverage`
(reported, estimated, and unpriced coverage), and `comparison` (adjacent periods,
contributions, and explicit unavailable states). See [Data contracts](data-contracts.md)
for the underlying CLI payload and pricing provenance.

## Report data flow

The page requests one local calendar month or year at a time using `period=custom&since=<first day>&until=<last day>`. It derives heatmap cells from `daily`, agent totals from `clients`, and each agent's model rows from `models`. Tokens and cost are displayed together; the table header selects sorting only. `useReport` cancels or sequence-checks stale requests and keeps the previous period's payload visible during loading.

Double-clicking the heatmap opens `ExpandedHeatmap` as a sheet outside `.report`; the card hides in place so the report does not shift. `useDayReport` requests one day with `since=until=<day>` and uses that payload's `totals`, `hourly`, `clients`, `models`, and `topSessions`; it does not replace the main report payload. `DayDeck` pages hours, agents, a flat cross-agent model table, and sessions by available height. Stepping outside the current period moves the report period. Export captures `.report` minus `.no-export`; the selected-day ring is hidden during export. Day keys use local `YYYY-MM-DD` parts, never `toISOString()`.
