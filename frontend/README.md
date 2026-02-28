# Frontend

Minimal Next.js frontend for browsing `servers_enriched` from local SQLite.

## Requirements

- Node.js + npm
- Synced DB at `../data/sb.sqlite` (from the Python scraper)

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database Path

Default DB path:

- `../data/sb.sqlite` (resolved from the `frontend/` directory)

Override:

```bash
SB_DB_PATH=/absolute/path/to/sb.sqlite npm run dev
```

## Data Flow

1. `src/lib/db.ts` opens SQLite in read-only mode.
2. `src/lib/queries.ts` loads `servers_enriched` + `dataset_sync`.
3. `src/app/page.tsx` (server component) fetches snapshot data and passes it to the client dashboard.
4. `src/components/server-dashboard.tsx` provides filters, sorting, pagination, and expandable details.
