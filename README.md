# Hetzner Serverboerse Explorer

SQLite-first pipeline + Next.js UI for exploring Hetzner Serverboerse offers with CPU benchmark enrichment.

## What This Does
- Syncs Hetzner Serverboerse data into SQLite.
- Syncs CPU benchmark data (cpubenchmark.net) into SQLite.
- Enriches servers with benchmark metrics (`cpumark`, cores/threads, value ratios).
- Provides a local frontend with:
  - fast filters/sorting/pagination
  - drive-type and drive-size filtering
  - expandable per-row details
  - value scatter plot (price vs CPU/€)
  - pricing toggles for VAT (+19%) and fixed IPv4 fee (+2.02 EUR)

No CSV/JSON output artifacts are produced by the sync commands. SQLite is the system of record.

## Repo Layout
- `scraper.py`: CLI sync pipeline (SQLite write path)
- `frontend/`: Next.js app (SQLite read path)
- `data/`: local DB (ignored by git)

## Requirements
- Python 3.11+ (3.10+ may also work)
- Node.js 20+ and npm

## Quick Start
1. Initialize and sync data:
```bash
python3 scraper.py sync-all
```

2. Start frontend:
```bash
cd frontend
npm install
npm run dev
```

3. Open:
- [http://localhost:3000](http://localhost:3000)

## CLI Commands
Default DB path for all commands:
- `./data/sb.sqlite`

Initialize schema:
```bash
python3 scraper.py db-init
```

Sync CPU benchmark dataset:
```bash
python3 scraper.py bench-sync
```

Sync Hetzner Serverboerse + enrichment:
```bash
python3 scraper.py sb-sync
```

Run both in sequence:
```bash
python3 scraper.py sync-all
```

Use a custom DB path:
```bash
python3 scraper.py sync-all --db-path ./data/custom.sqlite
```

## SQLite Schema (High Level)
- `benchmark_cpu`: benchmark catalog (`name_norm`, `cpumark`, cores/logicals/cpu_count)
- `sb_server`: normalized Hetzner server snapshot + derived filter fields
- `sb_enrichment`: server-to-benchmark join + value metrics
- `dataset_sync`: dataset-level sync metadata (`benchmark`, `sb`)
- `servers_enriched` (view): frontend read model combining all of the above

## Data Quality Warnings During Sync
`sb-sync` prints warnings for:
- unmatched CPUs (exact normalized name match failed)
- unrecognized datacenter->region mapping
- unknown CPU vendor parsing (not AMD/Intel)
- missing/invalid prices affecting value metrics

These are warning-only; sync still completes.

## Frontend Notes
- Frontend reads SQLite in read-only mode from `../data/sb.sqlite`.
- Optional override:
```bash
SB_DB_PATH=/absolute/path/to/sb.sqlite npm run dev
```
- The refresh button reloads data from DB in-app (`router.refresh()`), without full browser reload.
- It does not trigger scraper sync itself; run scraper commands separately.

## Data Sources
- Hetzner Serverboerse feed:  
  `https://www.hetzner.com/_resources/app/data/app/live_data_sb_EUR.json`
- CPU benchmark:  
  `https://www.cpubenchmark.net/CPU_mega_page.html`  
  `https://www.cpubenchmark.net/data/`

Use of external data should comply with each provider's terms/licensing.

