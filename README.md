# Hetzner SB Sync Pipeline

## Current Scope (Python DB-first)
This project uses a SQLite-first sync pipeline.

- SQLite is the single source of truth.
- No CSV/JSON artifact files are produced by sync commands.
- Latest-only data model (no historical snapshots).
- Exact CPU name matching between Hetzner and benchmark data.

Default database path:
- `./data/sb.sqlite`

## Commands
Initialize schema:

```bash
python3 scraper.py db-init
```

`db-init` recreates the schema (drops and recreates tables/views).

Sync benchmark dataset (cpubenchmark.net):

```bash
python3 scraper.py bench-sync
```

Sync Hetzner Serverboerse + enrichment:

```bash
python3 scraper.py sb-sync
```

Run full pipeline:

```bash
python3 scraper.py sync-all
```

Use a custom DB path:

```bash
python3 scraper.py sync-all --db-path ./data/custom.sqlite
```

## Schema Overview
Core tables:

- `benchmark_cpu`
  - `bench_id`, `name`, `name_norm`, `cpumark`, `cores`, `logicals`, `cpu_count`
- `sb_server`
  - lean server fields for filtering, pricing, and CPU matching
  - includes derived `region` from datacenter prefix (`FSN`, `NBG`, `HEL`)
  - includes filter-friendly flags:
    - `cpu_vendor` (`AMD`, `Intel`, `Unknown`)
    - `is_ecc`
    - `has_gpu`
    - `has_inic`
  - includes `drive_count` (total drives from Hetzner feed)
  - includes canonical drive columns:
    - `disk_hdd_count`, `disk_hdd_total_gb`
    - `disk_sata_count`, `disk_sata_total_gb`
    - `disk_nvme_count`, `disk_nvme_total_gb`
  - includes passthrough detail JSON columns for expandable frontend rows:
    - `information_json`
    - `description_json`
    - `hdd_arr_json`
    - `dist_json`
- `sb_enrichment`
  - `bench_id` mapping + `price_to_cpu` and `cpu_per_price`
- `dataset_sync`
  - dataset-level sync metadata (`benchmark` and `sb`)

View:

- `servers_enriched`
  - joins server + benchmark + enrichment for frontend/API queries
  - includes `bench_cores`, `bench_threads` (derived from `cores * logicals`), `bench_cpu_count`
  - includes quick drive flags derived from counts: `has_hdd`, `has_sata`, `has_nvme`

## Frontend Plan (Deferred)
Target stack for display layer:

- Next.js frontend + API routes
- SQLite as backend store
- AG Grid Community for table UX

Phase 1 frontend goals:

- Fast table browsing with sorting/filtering/pagination
- Top filter controls (datacenter, price ranges, benchmark ranges, search)
- Metadata display from `dataset_sync`

Not in frontend phase 1:

- Triggering refresh from the app
- Historical comparisons
- Export tooling

Refresh will continue through CLI (`sync-all`) until app-triggered refresh is added.
