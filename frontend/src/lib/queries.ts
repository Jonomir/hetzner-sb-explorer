import "server-only";

import { getDb, getDbPath } from "@/lib/db";
import {
  DatasetSyncSchema,
  type DashboardData,
  ServerRowSchema,
} from "@/lib/types";

const SERVER_QUERY = `
SELECT
  server_id,
  "key" AS server_key,
  name,
  cpu,
  cpu_vendor,
  datacenter,
  region,
  price,
  setup_price,
  hourly_price,
  ram_size,
  drive_count,
  disk_hdd_count,
  disk_hdd_total_gb,
  disk_sata_count,
  disk_sata_total_gb,
  disk_nvme_count,
  disk_nvme_total_gb,
  has_hdd,
  has_sata,
  has_nvme,
  traffic,
  bandwidth,
  is_ecc,
  has_gpu,
  has_inic,
  is_highio,
  information_json,
  description_json,
  hdd_arr_json,
  dist_json,
  bench_cpumark,
  bench_cores,
  bench_threads,
  bench_cpu_count,
  price_to_cpu,
  cpu_per_price
FROM servers_enriched
ORDER BY
  (cpu_per_price IS NULL) ASC,
  cpu_per_price DESC,
  price ASC,
  server_id ASC
`;

const SYNC_QUERY = `
SELECT dataset, synced_at_utc, row_count, unmatched_count, source
FROM dataset_sync
ORDER BY dataset ASC
`;

const vendorOrder: Record<string, number> = {
  AMD: 0,
  Intel: 1,
  Unknown: 2,
};

const regionOrder: Record<string, number> = {
  FSN: 0,
  NBG: 1,
  HEL: 2,
};

export function loadDashboardData(): DashboardData {
  const db = getDb();
  const serverRows = db.prepare(SERVER_QUERY).all();
  const syncRows = db.prepare(SYNC_QUERY).all();

  const servers = ServerRowSchema.array().parse(serverRows);
  const sync = DatasetSyncSchema.array().parse(syncRows);

  const regions = Array.from(
    new Set(servers.map((row) => row.region).filter((value): value is string => Boolean(value))),
  ).sort((a, b) => {
    const scoreA = regionOrder[a] ?? 99;
    const scoreB = regionOrder[b] ?? 99;
    if (scoreA === scoreB) {
      return a.localeCompare(b);
    }
    return scoreA - scoreB;
  });

  const cpuVendors = Array.from(
    new Set(servers.map((row) => row.cpu_vendor).filter(Boolean)),
  ).sort((a, b) => {
    const scoreA = vendorOrder[a] ?? 99;
    const scoreB = vendorOrder[b] ?? 99;
    if (scoreA === scoreB) {
      return a.localeCompare(b);
    }
    return scoreA - scoreB;
  });

  return {
    dbPath: getDbPath(),
    loadedAtUtc: new Date().toISOString(),
    filters: {
      regions,
      cpuVendors,
    },
    sync,
    servers,
  };
}
