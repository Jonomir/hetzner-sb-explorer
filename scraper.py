#!/usr/bin/env python3
"""SQLite-first Hetzner + CPU benchmark sync pipeline."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from urllib import error, request
import http.cookiejar

HETZNER_SB_EUR_URL = "https://www.hetzner.com/_resources/app/data/app/live_data_sb_EUR.json"
CPUBENCH_INIT_URL = "https://www.cpubenchmark.net/CPU_mega_page.html"
CPUBENCH_DATA_URL = "https://www.cpubenchmark.net/data/"
BENCHMARK_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) "
    "Gecko/20100101 Firefox/147.0"
)
DEFAULT_DB_PATH = "./data/sb.sqlite"

CLOCK_RE = re.compile(r"@\s*\d+(?:\.\d+)?\s*ghz|\b\d+(?:\.\d+)?\s*ghz\b")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
REGION_RE = re.compile(r"^([A-Z]{3})\d")


SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS benchmark_cpu (
    bench_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL UNIQUE,
    cpumark REAL,
    cores REAL,
    logicals REAL,
    cpu_count REAL
);

CREATE TABLE IF NOT EXISTS sb_server (
    server_id INTEGER PRIMARY KEY,
    "key" INTEGER,
    name TEXT,
    cpu TEXT,
    cpu_norm TEXT,
    cpu_vendor TEXT,
    datacenter TEXT,
    region TEXT,
    price REAL,
    setup_price REAL,
    hourly_price REAL,
    ram_size REAL,
    drive_count INTEGER,
    disk_hdd_count INTEGER,
    disk_hdd_total_gb REAL,
    disk_sata_count INTEGER,
    disk_sata_total_gb REAL,
    disk_nvme_count INTEGER,
    disk_nvme_total_gb REAL,
    traffic TEXT,
    bandwidth INTEGER,
    is_ecc INTEGER,
    has_gpu INTEGER,
    has_inic INTEGER,
    is_highio INTEGER,
    information_json TEXT,
    description_json TEXT,
    hdd_arr_json TEXT,
    dist_json TEXT
);

CREATE TABLE IF NOT EXISTS sb_enrichment (
    server_id INTEGER PRIMARY KEY,
    bench_id INTEGER,
    price_to_cpu REAL,
    cpu_per_price REAL,
    FOREIGN KEY(server_id) REFERENCES sb_server(server_id) ON DELETE CASCADE,
    FOREIGN KEY(bench_id) REFERENCES benchmark_cpu(bench_id)
);

CREATE TABLE IF NOT EXISTS dataset_sync (
    dataset TEXT PRIMARY KEY,
    synced_at_utc TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    unmatched_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_benchmark_cpu_name_norm ON benchmark_cpu(name_norm);
CREATE INDEX IF NOT EXISTS idx_sb_server_cpu_norm ON sb_server(cpu_norm);
CREATE INDEX IF NOT EXISTS idx_sb_server_cpu_vendor ON sb_server(cpu_vendor);
CREATE INDEX IF NOT EXISTS idx_sb_server_datacenter ON sb_server(datacenter);
CREATE INDEX IF NOT EXISTS idx_sb_server_region ON sb_server(region);
CREATE INDEX IF NOT EXISTS idx_sb_server_price ON sb_server(price);
CREATE INDEX IF NOT EXISTS idx_sb_server_is_ecc ON sb_server(is_ecc);
CREATE INDEX IF NOT EXISTS idx_sb_server_has_gpu ON sb_server(has_gpu);
CREATE INDEX IF NOT EXISTS idx_sb_server_has_inic ON sb_server(has_inic);
CREATE INDEX IF NOT EXISTS idx_sb_server_drive_count ON sb_server(drive_count);
CREATE INDEX IF NOT EXISTS idx_sb_server_disk_hdd_count ON sb_server(disk_hdd_count);
CREATE INDEX IF NOT EXISTS idx_sb_server_disk_sata_count ON sb_server(disk_sata_count);
CREATE INDEX IF NOT EXISTS idx_sb_server_disk_nvme_count ON sb_server(disk_nvme_count);
CREATE INDEX IF NOT EXISTS idx_sb_enrichment_bench_id ON sb_enrichment(bench_id);
CREATE INDEX IF NOT EXISTS idx_sb_enrichment_cpu_per_price ON sb_enrichment(cpu_per_price);
"""


VIEW_SQL = """
DROP VIEW IF EXISTS servers_enriched;

CREATE VIEW servers_enriched AS
SELECT
    s.server_id,
    s."key",
    s.name,
    s.cpu,
    s.cpu_vendor,
    s.datacenter,
    s.region,
    s.price,
    s.setup_price,
    s.hourly_price,
    s.ram_size,
    s.drive_count,
    s.disk_hdd_count,
    s.disk_hdd_total_gb,
    s.disk_sata_count,
    s.disk_sata_total_gb,
    s.disk_nvme_count,
    s.disk_nvme_total_gb,
    CASE WHEN s.disk_hdd_count > 0 THEN 1 ELSE 0 END AS has_hdd,
    CASE WHEN s.disk_sata_count > 0 THEN 1 ELSE 0 END AS has_sata,
    CASE WHEN s.disk_nvme_count > 0 THEN 1 ELSE 0 END AS has_nvme,
    s.traffic,
    s.bandwidth,
    s.is_ecc,
    s.has_gpu,
    s.has_inic,
    s.is_highio,
    s.information_json,
    s.description_json,
    s.hdd_arr_json,
    s.dist_json,
    b.cpumark AS bench_cpumark,
    b.cores AS bench_cores,
    CASE
        WHEN b.cores IS NOT NULL AND b.logicals IS NOT NULL THEN b.cores * b.logicals
        ELSE NULL
    END AS bench_threads,
    b.cpu_count AS bench_cpu_count,
    e.price_to_cpu,
    e.cpu_per_price
FROM sb_server s
LEFT JOIN sb_enrichment e ON e.server_id = s.server_id
LEFT JOIN benchmark_cpu b ON b.bench_id = e.bench_id;
"""


class ScraperError(Exception):
    """Expected domain failure for sync pipeline."""


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def normalize_cpu_name(value: Any) -> str:
    if value is None:
        return ""

    text = html.unescape(str(value)).lower()
    text = CLOCK_RE.sub("", text)
    text = NON_ALNUM_RE.sub("", text)
    return text.strip()


def parse_numeric(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    if text.upper() == "NA":
        return None

    text = text.replace(",", "")

    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value: Any) -> int | None:
    num = parse_numeric(value)
    if num is None:
        return None
    return int(num)


def parse_bool_int(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0

    if isinstance(value, (int, float)):
        return 1 if value else 0

    if value is None:
        return 0

    text = str(value).strip().lower()
    if text in {"1", "true", "yes"}:
        return 1
    return 0


def serialize_json_array(value: Any) -> str:
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    return "[]"


def http_get_text(
    url: str,
    headers: dict[str, str] | None = None,
    opener: request.OpenerDirector | None = None,
) -> str:
    req = request.Request(url, headers=headers or {})

    try:
        if opener is not None:
            response = opener.open(req)
        else:
            response = request.urlopen(req)
    except error.HTTPError as exc:
        raise ScraperError(f"HTTP {exc.code} for {url}") from exc
    except error.URLError as exc:
        raise ScraperError(f"Network error for {url}: {exc.reason}") from exc

    with response:
        raw = response.read()
        content_type = response.headers.get("Content-Type", "")

    charset = "utf-8"
    if "charset=" in content_type:
        charset = content_type.split("charset=", 1)[1].split(";", 1)[0].strip()

    return raw.decode(charset or "utf-8", errors="replace")


def fetch_json(
    url: str,
    headers: dict[str, str] | None = None,
    opener: request.OpenerDirector | None = None,
) -> Any:
    body = http_get_text(url=url, headers=headers, opener=opener)
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ScraperError(f"Invalid JSON response from {url}") from exc


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.executescript(VIEW_SQL)


def open_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def upsert_dataset_sync(
    conn: sqlite3.Connection,
    dataset: str,
    row_count: int,
    unmatched_count: int,
    source: str,
) -> None:
    conn.execute(
        """
        INSERT INTO dataset_sync (dataset, synced_at_utc, row_count, unmatched_count, source)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(dataset) DO UPDATE SET
            synced_at_utc=excluded.synced_at_utc,
            row_count=excluded.row_count,
            unmatched_count=excluded.unmatched_count,
            source=excluded.source
        """,
        (dataset, utc_now_iso(), row_count, unmatched_count, source),
    )


def fetch_cpubenchmark_dataset() -> list[dict[str, Any]]:
    cookie_jar = http.cookiejar.CookieJar()
    opener = request.build_opener(request.HTTPCookieProcessor(cookie_jar))

    http_get_text(
        CPUBENCH_INIT_URL,
        headers={"User-Agent": BENCHMARK_UA},
        opener=opener,
    )

    payload = fetch_json(
        CPUBENCH_DATA_URL,
        headers={
            "User-Agent": BENCHMARK_UA,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": CPUBENCH_INIT_URL,
            "Accept": "application/json, text/javascript, */*; q=0.01",
        },
        opener=opener,
    )

    if not isinstance(payload, dict):
        raise ScraperError("CPU benchmark payload must be a JSON object")

    data = payload.get("data")
    if not isinstance(data, list) or not data:
        raise ScraperError("CPU benchmark payload has empty or invalid .data array")

    rows: list[dict[str, Any]] = []
    for item in data:
        if isinstance(item, dict):
            rows.append(item)

    if not rows:
        raise ScraperError("CPU benchmark payload has no valid row objects")

    return rows


def fetch_hetzner_servers() -> list[dict[str, Any]]:
    payload = fetch_json(
        HETZNER_SB_EUR_URL,
        headers={
            "User-Agent": BENCHMARK_UA,
            "Accept": "application/json, text/javascript, */*; q=0.01",
        },
    )

    if not isinstance(payload, dict):
        raise ScraperError("Hetzner payload must be a JSON object")

    data = payload.get("server")
    if not isinstance(data, list):
        raise ScraperError("Hetzner payload is missing server[]")

    rows: list[dict[str, Any]] = []
    for item in data:
        if isinstance(item, dict):
            rows.append(item)

    return rows


def run_db_init(db_path: Path) -> None:
    with open_db(db_path) as conn:
        with conn:
            conn.executescript(
                """
                DROP VIEW IF EXISTS servers_enriched;
                DROP TABLE IF EXISTS sb_enrichment;
                DROP TABLE IF EXISTS sb_server;
                DROP TABLE IF EXISTS benchmark_cpu;
                DROP TABLE IF EXISTS dataset_sync;
                """
            )
        ensure_schema(conn)


def derive_region(datacenter: str) -> str | None:
    text = datacenter.strip().upper()
    if not text:
        return None
    m = REGION_RE.match(text)
    if m:
        return m.group(1)
    return None


def derive_cpu_vendor(cpu: str) -> str:
    t = cpu.lower()
    if "amd" in t:
        return "AMD"
    if "intel" in t:
        return "Intel"
    return "Unknown"


def parse_drive_list(values: Any) -> tuple[int, float]:
    if not isinstance(values, list):
        return (0, 0.0)
    nums = [parse_numeric(v) for v in values]
    clean = [v for v in nums if v is not None and v > 0]
    return (len(clean), float(sum(clean)))


def extract_disk_stats(server: dict[str, Any]) -> tuple[int, float, int, float, int, float]:
    disk_data = server.get("serverDiskData")
    if not isinstance(disk_data, dict):
        return (0, 0.0, 0, 0.0, 0, 0.0)

    hdd_count, hdd_total = parse_drive_list(disk_data.get("hdd"))
    sata_count, sata_total = parse_drive_list(disk_data.get("sata"))
    nvme_count, nvme_total = parse_drive_list(disk_data.get("nvme"))
    return (hdd_count, hdd_total, sata_count, sata_total, nvme_count, nvme_total)


def extract_special_flags(server: dict[str, Any]) -> tuple[int, int]:
    specials = server.get("specials")
    tags = set()
    if isinstance(specials, list):
        for s in specials:
            tags.add(str(s).strip().lower())

    has_inic = 1 if "inic" in tags else 0
    has_gpu = 1 if "gpu" in tags else 0

    return (has_gpu, has_inic)


def run_bench_sync(db_path: Path) -> int:
    rows = fetch_cpubenchmark_dataset()

    dedup: dict[str, tuple[int, str, float | None, float | None, float | None, float | None]] = {}
    skipped_non_single_cpu = 0
    skipped_invalid = 0
    for row in rows:
        bench_id = parse_int(row.get("id"))
        name = str(row.get("name") or "").strip()
        cpumark = parse_numeric(row.get("cpumark"))
        cores = parse_numeric(row.get("cores"))
        logicals = parse_numeric(row.get("logicals"))
        cpu_count = parse_numeric(row.get("cpuCount"))
        name_norm = normalize_cpu_name(name)

        if bench_id is None or not name or not name_norm:
            skipped_invalid += 1
            continue

        # Hetzner SB rows are single-socket right now; keep benchmark rows comparable.
        if cpu_count is None or int(cpu_count) != 1:
            skipped_non_single_cpu += 1
            continue

        existing = dedup.get(name_norm)
        if existing is None:
            dedup[name_norm] = (bench_id, name, cpumark, cores, logicals, cpu_count)
        else:
            prev_mark = existing[2] if existing[2] is not None else -1.0
            new_mark = cpumark if cpumark is not None else -1.0
            if new_mark > prev_mark:
                dedup[name_norm] = (bench_id, name, cpumark, cores, logicals, cpu_count)

    insert_rows = [
        (bench_id, name, name_norm, cpumark, cores, logicals, cpu_count)
        for name_norm, (bench_id, name, cpumark, cores, logicals, cpu_count) in dedup.items()
    ]

    if not insert_rows:
        raise ScraperError("No valid benchmark rows to insert")

    with open_db(db_path) as conn:
        ensure_schema(conn)
        with conn:
            # Benchmark rows are FK targets for existing enrichment rows.
            # Reset enrichment first so benchmark replacement can proceed safely.
            conn.execute("DELETE FROM sb_enrichment")
            conn.execute("DELETE FROM benchmark_cpu")
            conn.executemany(
                """
                INSERT INTO benchmark_cpu (
                    bench_id, name, name_norm, cpumark, cores, logicals, cpu_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                insert_rows,
            )
            upsert_dataset_sync(
                conn,
                dataset="benchmark",
                row_count=len(insert_rows),
                unmatched_count=0,
                source=CPUBENCH_DATA_URL,
            )

    print(f"Benchmark sync complete: rows={len(insert_rows)} db={db_path}")
    if skipped_non_single_cpu > 0:
        print(f"WARNING: filtered out {skipped_non_single_cpu} benchmark rows with cpuCount != 1")
    if skipped_invalid > 0:
        print(f"WARNING: skipped {skipped_invalid} invalid benchmark rows (missing id/name)")
    return len(insert_rows)


def run_sb_sync(db_path: Path) -> tuple[int, int, int]:
    servers = fetch_hetzner_servers()

    with open_db(db_path) as conn:
        ensure_schema(conn)

        bench_count = conn.execute("SELECT COUNT(*) FROM benchmark_cpu").fetchone()[0]
        if bench_count <= 0:
            raise ScraperError(
                "benchmark_cpu is empty. Run `python3 scraper.py bench-sync` first."
            )

        bench_map: dict[str, tuple[int, float | None]] = {
            row[0]: (row[1], row[2])
            for row in conn.execute("SELECT name_norm, bench_id, cpumark FROM benchmark_cpu")
        }

        sb_rows: list[tuple[Any, ...]] = []
        enrich_rows: list[tuple[Any, ...]] = []
        unmatched = 0
        unmatched_cpu_counter: Counter[str] = Counter()
        unmatched_region = 0
        unmatched_region_counter: Counter[str] = Counter()
        unknown_cpu_vendor = 0
        missing_price_for_ratio = 0
        matched = 0

        for s in servers:
            server_id = parse_int(s.get("id"))
            if server_id is None:
                continue

            cpu = str(s.get("cpu") or "")
            cpu_norm = normalize_cpu_name(cpu)
            cpu_vendor = derive_cpu_vendor(cpu)
            if cpu_vendor == "Unknown":
                unknown_cpu_vendor += 1
            price = parse_numeric(s.get("price"))
            drive_count = parse_int(s.get("hdd_count"))
            datacenter = str(s.get("datacenter") or "")
            region = derive_region(datacenter)
            if region is None:
                unmatched_region += 1
                unmatched_region_counter[datacenter] += 1
            (
                disk_hdd_count,
                disk_hdd_total_gb,
                disk_sata_count,
                disk_sata_total_gb,
                disk_nvme_count,
                disk_nvme_total_gb,
            ) = extract_disk_stats(s)
            has_gpu, has_inic = extract_special_flags(s)
            information_json = serialize_json_array(s.get("information"))
            description_json = serialize_json_array(s.get("description"))
            hdd_arr_json = serialize_json_array(s.get("hdd_arr"))
            dist_json = serialize_json_array(s.get("dist"))

            sb_rows.append(
                (
                    server_id,
                    parse_int(s.get("key")),
                    str(s.get("name") or ""),
                    cpu,
                    cpu_norm,
                    cpu_vendor,
                    datacenter,
                    region,
                    price,
                    parse_numeric(s.get("setup_price")),
                    parse_numeric(s.get("hourly_price")),
                    parse_numeric(s.get("ram_size")),
                    drive_count,
                    disk_hdd_count,
                    disk_hdd_total_gb,
                    disk_sata_count,
                    disk_sata_total_gb,
                    disk_nvme_count,
                    disk_nvme_total_gb,
                    str(s.get("traffic") or ""),
                    parse_int(s.get("bandwidth")),
                    parse_bool_int(s.get("is_ecc")),
                    has_gpu,
                    has_inic,
                    parse_bool_int(s.get("is_highio")),
                    information_json,
                    description_json,
                    hdd_arr_json,
                    dist_json,
                )
            )

            bench_id: int | None = None
            cpumark: float | None = None

            if cpu_norm:
                match = bench_map.get(cpu_norm)
                if match is not None:
                    bench_id = match[0]
                    cpumark = match[1]

            if bench_id is None:
                unmatched += 1
                unmatched_cpu_counter[cpu] += 1
            else:
                matched += 1

            price_to_cpu: float | None = None
            cpu_per_price: float | None = None
            if price is None or price <= 0:
                missing_price_for_ratio += 1
            if price is not None and cpumark is not None and price > 0 and cpumark > 0:
                price_to_cpu = price / cpumark
                cpu_per_price = cpumark / price

            enrich_rows.append((server_id, bench_id, price_to_cpu, cpu_per_price))

        with conn:
            conn.execute("DELETE FROM sb_enrichment")
            conn.execute("DELETE FROM sb_server")
            conn.executemany(
                """
                INSERT INTO sb_server (
                    server_id, "key", name, cpu, cpu_norm, cpu_vendor, datacenter, region, price,
                    setup_price, hourly_price, ram_size, drive_count,
                    disk_hdd_count, disk_hdd_total_gb, disk_sata_count, disk_sata_total_gb,
                    disk_nvme_count, disk_nvme_total_gb,
                    traffic, bandwidth, is_ecc, has_gpu, has_inic, is_highio,
                    information_json, description_json, hdd_arr_json, dist_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                sb_rows,
            )
            conn.executemany(
                "INSERT INTO sb_enrichment (server_id, bench_id, price_to_cpu, cpu_per_price) VALUES (?, ?, ?, ?)",
                enrich_rows,
            )
            upsert_dataset_sync(
                conn,
                dataset="sb",
                row_count=len(sb_rows),
                unmatched_count=unmatched,
                source=HETZNER_SB_EUR_URL,
            )

    print(f"SB sync complete: rows={len(sb_rows)} matched={matched} unmatched={unmatched} db={db_path}")
    if unmatched > 0:
        top = ", ".join(
            f"{cpu} ({count})"
            for cpu, count in unmatched_cpu_counter.most_common(5)
        )
        print(f"WARNING: {unmatched} servers were unmatched by CPU name. Top unmatched: {top}")
    if unmatched_region > 0:
        top_regions = ", ".join(
            f"{dc or '<empty>'} ({count})"
            for dc, count in unmatched_region_counter.most_common(5)
        )
        print(
            f"WARNING: {unmatched_region} servers had unrecognized datacenter->region mapping. "
            f"Top: {top_regions}"
        )
    if unknown_cpu_vendor > 0:
        print(
            f"WARNING: {unknown_cpu_vendor} servers had unknown CPU vendor "
            "(not AMD/Intel by name parsing)."
        )
    if missing_price_for_ratio > 0:
        print(
            f"WARNING: {missing_price_for_ratio} servers could not compute price/value metrics due to missing or invalid price."
        )

    return len(sb_rows), matched, unmatched


def command_db_init(args: argparse.Namespace) -> int:
    db_path = Path(args.db_path).expanduser().resolve()
    run_db_init(db_path)
    print(f"DB initialized: {db_path}")
    return 0


def command_bench_sync(args: argparse.Namespace) -> int:
    db_path = Path(args.db_path).expanduser().resolve()
    run_bench_sync(db_path)
    return 0


def command_sb_sync(args: argparse.Namespace) -> int:
    db_path = Path(args.db_path).expanduser().resolve()
    run_sb_sync(db_path)
    return 0


def command_sync_all(args: argparse.Namespace) -> int:
    db_path = Path(args.db_path).expanduser().resolve()
    run_bench_sync(db_path)
    run_sb_sync(db_path)
    return 0


def add_db_path_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path (default: {DEFAULT_DB_PATH})",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="SQLite-first Hetzner + benchmark sync pipeline",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_init = subparsers.add_parser("db-init", help="Initialize schema")
    add_db_path_argument(p_init)
    p_init.set_defaults(func=command_db_init)

    p_bench = subparsers.add_parser("bench-sync", help="Sync benchmark dataset into SQLite")
    add_db_path_argument(p_bench)
    p_bench.set_defaults(func=command_bench_sync)

    p_sb = subparsers.add_parser("sb-sync", help="Sync Hetzner SB dataset and enrichment")
    add_db_path_argument(p_sb)
    p_sb.set_defaults(func=command_sb_sync)

    p_all = subparsers.add_parser("sync-all", help="Run benchmark then SB sync")
    add_db_path_argument(p_all)
    p_all.set_defaults(func=command_sync_all)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        return int(args.func(args))
    except ScraperError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except sqlite3.DatabaseError as exc:
        print(f"Database error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
