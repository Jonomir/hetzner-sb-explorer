import { z } from "zod";

export const ServerRowSchema = z.object({
  server_id: z.number().int(),
  server_key: z.number().int().nullable(),
  name: z.string(),
  cpu: z.string(),
  cpu_vendor: z.string(),
  datacenter: z.string(),
  region: z.string().nullable(),
  price: z.number().nullable(),
  setup_price: z.number().nullable(),
  hourly_price: z.number().nullable(),
  ram_size: z.number().nullable(),
  drive_count: z.number().int().nullable(),
  disk_hdd_count: z.number().int().nullable(),
  disk_hdd_total_gb: z.number().nullable(),
  disk_sata_count: z.number().int().nullable(),
  disk_sata_total_gb: z.number().nullable(),
  disk_nvme_count: z.number().int().nullable(),
  disk_nvme_total_gb: z.number().nullable(),
  has_hdd: z.number().int(),
  has_sata: z.number().int(),
  has_nvme: z.number().int(),
  traffic: z.string(),
  bandwidth: z.number().int().nullable(),
  is_ecc: z.number().int(),
  has_gpu: z.number().int(),
  has_inic: z.number().int(),
  is_highio: z.number().int(),
  information_json: z.string(),
  description_json: z.string(),
  hdd_arr_json: z.string(),
  dist_json: z.string(),
  bench_cpumark: z.number().nullable(),
  bench_cores: z.number().nullable(),
  bench_threads: z.number().nullable(),
  bench_cpu_count: z.number().nullable(),
  price_to_cpu: z.number().nullable(),
  cpu_per_price: z.number().nullable(),
});

export type ServerRow = z.infer<typeof ServerRowSchema>;

export const DatasetSyncSchema = z.object({
  dataset: z.string(),
  synced_at_utc: z.string(),
  row_count: z.number().int(),
  unmatched_count: z.number().int(),
  source: z.string(),
});

export type DatasetSync = z.infer<typeof DatasetSyncSchema>;

export type DashboardData = {
  dbPath: string;
  loadedAtUtc: string;
  filters: {
    regions: string[];
    cpuVendors: string[];
  };
  sync: DatasetSync[];
  servers: ServerRow[];
};
