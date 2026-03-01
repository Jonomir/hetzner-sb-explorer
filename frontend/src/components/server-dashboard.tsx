"use client";
"use no memo";

import {
  type Column,
  type ColumnDef,
  type SortingFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DashboardData, ServerRow } from "@/lib/types";

const euroFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const decimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

const numberSortNullLast: SortingFn<ServerRow> = (rowA, rowB, columnId) => {
  const a = rowA.getValue<number | null>(columnId);
  const b = rowB.getValue<number | null>(columnId);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
};

function parseInputNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonList(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonNumberList(text: string): number[] {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => Number(item))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
}

type ValueScatterPoint = {
  serverId: number;
  region: string | null;
  datacenter: string | null;
  cpu: string;
  price: number;
  cpuPerPrice: number;
  outlierDelta: number;
  isOutlier: boolean;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatAxisEuro(value: number): string {
  return `€${Math.round(value)}`;
}

function formatAxisMetric(value: number): string {
  return decimalFormatter.format(value);
}

function ValueScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ValueScatterPoint }>;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">#{point.serverId}</p>
      <p className="text-slate-700">{point.cpu}</p>
      <p className="text-slate-600">{point.region ?? "—"} · {point.datacenter ?? "—"}</p>
      <p className="mt-1 text-slate-700">Monthly: {formatMoney(point.price)}</p>
      <p className="text-slate-700">CPU/€: {formatMetric(point.cpuPerPrice)}</p>
      <p className="text-slate-700">Outlier delta: +{formatMetric(point.outlierDelta)}</p>
    </div>
  );
}

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return euroFormatter.format(value);
}

function formatNumber(value: number | null): string {
  if (value == null) return "—";
  return numberFormatter.format(value);
}

function formatMetric(value: number | null): string {
  if (value == null) return "—";
  return decimalFormatter.format(value);
}

function formatTimeAgo(value: string | null | undefined, nowMs: number): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((date.getTime() - nowMs) / 1000);
  const absSeconds = Math.abs(seconds);

  if (absSeconds < 60) {
    return relativeTimeFormatter.format(seconds, "second");
  }
  const minutes = Math.round(seconds / 60);
  if (absSeconds < 3600) {
    return relativeTimeFormatter.format(minutes, "minute");
  }
  const hours = Math.round(seconds / 3600);
  if (absSeconds < 86400) {
    return relativeTimeFormatter.format(hours, "hour");
  }
  const days = Math.round(seconds / 86400);
  if (absSeconds < 2592000) {
    return relativeTimeFormatter.format(days, "day");
  }
  const months = Math.round(seconds / 2592000);
  if (absSeconds < 31536000) {
    return relativeTimeFormatter.format(months, "month");
  }
  const years = Math.round(seconds / 31536000);
  return relativeTimeFormatter.format(years, "year");
}

function formatStorageGb(value: number | null): string {
  if (value == null || value <= 0) return "0 GB";
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} TB`;
  }
  return `${numberFormatter.format(value)} GB`;
}

function boolPill(enabled: boolean, label: string) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
        enabled
          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

function SectionList({ title, entries }: { title: string; entries: string[] }) {
  if (entries.length === 0) {
    return (
      <section>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">{title}</h4>
        <p className="text-sm text-slate-500">No details available.</p>
      </section>
    );
  }

  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-slate-700">{title}</h4>
      <ul className="space-y-1">
        {entries.map((entry, index) => (
          <li key={`${title}-${index}-${entry}`} className="text-sm text-slate-600">
            {entry}
          </li>
        ))}
      </ul>
    </section>
  );
}

function drivePill(label: string, count: number | null, totalGb: number | null) {
  const safeCount = count ?? 0;
  const enabled = safeCount > 0;
  return (
    <span
      className={`inline-flex w-[118px] flex-col rounded-2xl px-2 py-1.5 text-xs font-semibold leading-tight tabular-nums ${
        enabled
          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      <span className="whitespace-nowrap">{safeCount}x {label}</span>
      <span className="whitespace-nowrap text-[11px] font-medium">{formatStorageGb(totalGb)} total</span>
    </span>
  );
}

function DrivePillWithTooltip({
  label,
  count,
  totalGb,
  sizesGb,
}: {
  label: string;
  count: number | null;
  totalGb: number | null;
  sizesGb: number[];
}) {
  return (
    <div className="group relative inline-flex">
      <button
        className="rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        type="button"
      >
        {drivePill(label, count, totalGb)}
      </button>
      <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-max max-w-[220px] -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1.5 text-[12px] text-white shadow-xl group-hover:block group-focus-within:block">
        <p className="mb-1 font-semibold">{label} drives</p>
        {sizesGb.length === 0 ? (
          <p className="text-slate-200">No drives</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4 text-slate-100">
            {sizesGb.map((size, index) => (
              <li key={`${label}-drive-${index}-${size}`}>{formatStorageGb(size)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SortHeader({
  column,
  title,
}: {
  column: Column<ServerRow, unknown>;
  title: string;
}) {
  const direction = column.getIsSorted();
  const arrow = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
  return (
    <button
      className="inline-flex items-center gap-1 font-semibold text-slate-700 transition-colors hover:text-[var(--accent)]"
      onClick={column.getToggleSortingHandler()}
      type="button"
    >
      {title}
      <span className="text-xs">{arrow}</span>
    </button>
  );
}

export function ServerDashboard({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [cpuVendor, setCpuVendor] = useState("all");
  const [cpuNameQuery, setCpuNameQuery] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minRam, setMinRam] = useState("");
  const [minCores, setMinCores] = useState("");
  const [minHddTb, setMinHddTb] = useState("");
  const [minSataTb, setMinSataTb] = useState("");
  const [minNvmeTb, setMinNvmeTb] = useState("");
  const [minHddDriveTb, setMinHddDriveTb] = useState("");
  const [minSataDriveTb, setMinSataDriveTb] = useState("");
  const [minNvmeDriveTb, setMinNvmeDriveTb] = useState("");
  const [eccOnly, setEccOnly] = useState(false);
  const [gpuOnly, setGpuOnly] = useState(false);
  const [inicOnly, setInicOnly] = useState(false);
  const [needsHdd, setNeedsHdd] = useState(false);
  const [needsSata, setNeedsSata] = useState(false);
  const [needsNvme, setNeedsNvme] = useState(false);
  const [expandedServerId, setExpandedServerId] = useState<number | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: "cpu_per_price", desc: true }]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [showAdvancedDriveFilters, setShowAdvancedDriveFilters] = useState(false);
  const [nowMs, setNowMs] = useState(() => {
    const parsed = Date.parse(data.loadedAtUtc);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  });

  const maxPriceValue = parseInputNumber(maxPrice);
  const minRamValue = parseInputNumber(minRam);
  const minCoresValue = parseInputNumber(minCores);
  const minHddTbValue = parseInputNumber(minHddTb);
  const minSataTbValue = parseInputNumber(minSataTb);
  const minNvmeTbValue = parseInputNumber(minNvmeTb);
  const minHddDriveTbValue = parseInputNumber(minHddDriveTb);
  const minSataDriveTbValue = parseInputNumber(minSataDriveTb);
  const minNvmeDriveTbValue = parseInputNumber(minNvmeDriveTb);

  const filteredServers = useMemo(() => {
    const cpuQuery = cpuNameQuery.trim().toLowerCase();
    return data.servers.filter((row) => {
      if (selectedRegions.length > 0) {
        if (!row.region || !selectedRegions.includes(row.region)) return false;
      }
      if (cpuVendor !== "all" && row.cpu_vendor !== cpuVendor) return false;
      if (cpuQuery && !row.cpu.toLowerCase().includes(cpuQuery)) return false;
      if (maxPriceValue != null && (row.price == null || row.price > maxPriceValue)) return false;
      if (minRamValue != null && (row.ram_size == null || row.ram_size < minRamValue)) return false;
      if (minCoresValue != null && (row.bench_cores == null || row.bench_cores < minCoresValue)) return false;
      if (eccOnly && row.is_ecc !== 1) return false;
      if (gpuOnly && row.has_gpu !== 1) return false;
      if (inicOnly && row.has_inic !== 1) return false;
      if (needsHdd && row.has_hdd !== 1) return false;
      if (needsSata && row.has_sata !== 1) return false;
      if (needsNvme && row.has_nvme !== 1) return false;
      if (minHddTbValue != null && (row.disk_hdd_total_gb == null || row.disk_hdd_total_gb < minHddTbValue * 1000)) return false;
      if (minSataTbValue != null && (row.disk_sata_total_gb == null || row.disk_sata_total_gb < minSataTbValue * 1000)) return false;
      if (minNvmeTbValue != null && (row.disk_nvme_total_gb == null || row.disk_nvme_total_gb < minNvmeTbValue * 1000)) return false;
      if (minHddDriveTbValue != null) {
        const hddSizes = parseJsonNumberList(row.disk_hdd_sizes_json);
        if (!hddSizes.some((sizeGb) => sizeGb >= minHddDriveTbValue * 1000)) return false;
      }
      if (minSataDriveTbValue != null) {
        const sataSizes = parseJsonNumberList(row.disk_sata_sizes_json);
        if (!sataSizes.some((sizeGb) => sizeGb >= minSataDriveTbValue * 1000)) return false;
      }
      if (minNvmeDriveTbValue != null) {
        const nvmeSizes = parseJsonNumberList(row.disk_nvme_sizes_json);
        if (!nvmeSizes.some((sizeGb) => sizeGb >= minNvmeDriveTbValue * 1000)) return false;
      }
      return true;
    });
  }, [
    cpuNameQuery,
    cpuVendor,
    data.servers,
    eccOnly,
    gpuOnly,
    inicOnly,
    maxPriceValue,
    minCoresValue,
    minHddDriveTbValue,
    minHddTbValue,
    minNvmeDriveTbValue,
    minNvmeTbValue,
    minRamValue,
    minSataDriveTbValue,
    minSataTbValue,
    needsHdd,
    needsNvme,
    needsSata,
    selectedRegions,
  ]);

  const valueScatter = useMemo(() => {
    const eligible = filteredServers
      .filter(
        (row) =>
          row.price != null &&
          row.price > 0 &&
          row.cpu_per_price != null &&
          row.cpu_per_price > 0,
      )
      .map((row) => ({
        serverId: row.server_id,
        region: row.region,
        datacenter: row.datacenter,
        cpu: row.cpu,
        price: row.price as number,
        cpuPerPrice: row.cpu_per_price as number,
      }));

    if (eligible.length === 0) {
      return {
        points: [] as ValueScatterPoint[],
        outliers: [] as ValueScatterPoint[],
      };
    }

    const bucketSize = 25;
    const buckets = new Map<number, number[]>();
    for (const row of eligible) {
      const bucket = Math.floor(row.price / bucketSize);
      const values = buckets.get(bucket);
      if (values) {
        values.push(row.cpuPerPrice);
      } else {
        buckets.set(bucket, [row.cpuPerPrice]);
      }
    }

    const bucketMedian = new Map<number, number>();
    for (const [bucket, values] of buckets) {
      bucketMedian.set(bucket, median(values));
    }

    const ranked = eligible.map((row) => {
      const bucket = Math.floor(row.price / bucketSize);
      const baseline = bucketMedian.get(bucket) ?? 0;
      return {
        ...row,
        outlierDelta: row.cpuPerPrice - baseline,
      };
    });

    const outlierIds = new Set(
      ranked
        .filter((row) => row.outlierDelta > 0)
        .sort((a, b) => b.outlierDelta - a.outlierDelta)
        .slice(0, 10)
        .map((row) => row.serverId),
    );

    const points = ranked.map((row) => ({
      ...row,
      isOutlier: outlierIds.has(row.serverId),
    }));

    const outliers = points
      .filter((row) => row.isOutlier)
      .sort((a, b) => b.outlierDelta - a.outlierDelta)
      .slice(0, 8);

    return { points, outliers };
  }, [filteredServers]);

  useEffect(() => {
    setPagination((current) => (current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }));
  }, [
    selectedRegions,
    cpuVendor,
    cpuNameQuery,
    maxPrice,
    minRam,
    minCores,
    minHddTb,
    minSataTb,
    minNvmeTb,
    minHddDriveTb,
    minSataDriveTb,
    minNvmeDriveTb,
    eccOnly,
    gpuOnly,
    inicOnly,
    needsHdd,
    needsSata,
    needsNvme,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const parsed = Date.parse(data.loadedAtUtc);
    setNowMs(Number.isNaN(parsed) ? Date.now() : parsed);
  }, [data.loadedAtUtc]);

  const columns = useMemo<ColumnDef<ServerRow>[]>(
    () => [
      {
        accessorKey: "region",
        header: ({ column }) => <SortHeader column={column} title="Region" />,
        cell: ({ row }) => row.original.region ?? "—",
      },
      {
        accessorKey: "datacenter",
        header: ({ column }) => <SortHeader column={column} title="Data center" />,
        cell: ({ row }) => row.original.datacenter || "—",
      },
      {
        accessorKey: "cpu",
        header: ({ column }) => <SortHeader column={column} title="CPU" />,
        cell: ({ row }) => <div className="text-slate-900">{row.original.cpu}</div>,
      },
      {
        id: "cores_threads",
        accessorFn: (row) => row.bench_threads,
        sortingFn: numberSortNullLast,
        header: ({ column }) => <SortHeader column={column} title="Cores/Threads" />,
        cell: ({ row }) => `${formatNumber(row.original.bench_cores)} / ${formatNumber(row.original.bench_threads)}`,
      },
      {
        accessorKey: "ram_size",
        sortingFn: numberSortNullLast,
        header: ({ column }) => <SortHeader column={column} title="RAM" />,
        cell: ({ row }) => `${formatNumber(row.original.ram_size)} GB`,
      },
      {
        id: "drive_profile",
        accessorFn: (row) =>
          (row.disk_hdd_count ?? 0) + (row.disk_sata_count ?? 0) + (row.disk_nvme_count ?? 0),
        sortingFn: numberSortNullLast,
        header: ({ column }) => <SortHeader column={column} title="Drives" />,
        cell: ({ row }) => {
          const hddSizes = parseJsonNumberList(row.original.disk_hdd_sizes_json);
          const sataSizes = parseJsonNumberList(row.original.disk_sata_sizes_json);
          const nvmeSizes = parseJsonNumberList(row.original.disk_nvme_sizes_json);

          return (
            <div className="flex flex-nowrap gap-1">
              <DrivePillWithTooltip
                count={row.original.disk_hdd_count}
                label="HDD"
                sizesGb={hddSizes}
                totalGb={row.original.disk_hdd_total_gb}
              />
              <DrivePillWithTooltip
                count={row.original.disk_sata_count}
                label="SATA"
                sizesGb={sataSizes}
                totalGb={row.original.disk_sata_total_gb}
              />
              <DrivePillWithTooltip
                count={row.original.disk_nvme_count}
                label="NVMe"
                sizesGb={nvmeSizes}
                totalGb={row.original.disk_nvme_total_gb}
              />
            </div>
          );
        },
      },
      {
        accessorKey: "price",
        sortingFn: numberSortNullLast,
        header: ({ column }) => <SortHeader column={column} title="Monthly" />,
        cell: ({ row }) => <span className="font-semibold text-slate-900">{formatMoney(row.original.price)}</span>,
      },
      {
        accessorKey: "bench_cpumark",
        sortingFn: numberSortNullLast,
        header: ({ column }) => <SortHeader column={column} title="CPU Mark" />,
        cell: ({ row }) => formatNumber(row.original.bench_cpumark),
      },
      {
        accessorKey: "cpu_per_price",
        sortingFn: numberSortNullLast,
        header: ({ column }) => <SortHeader column={column} title="CPU/€" />,
        cell: ({ row }) => <span className="font-semibold text-[var(--accent-strong)]">{formatMetric(row.original.cpu_per_price)}</span>,
      },
      {
        id: "flags",
        header: "Flags",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {boolPill(row.original.is_ecc === 1, "ECC")}
            {boolPill(row.original.has_gpu === 1, "GPU")}
            {boolPill(row.original.has_inic === 1, "iNIC")}
          </div>
        ),
      },
    ],
    [],
  );

  // TanStack Table's hook shape is not compiler-memoizable; this is expected.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredServers,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const benchmarkSync = data.sync.find((entry) => entry.dataset === "benchmark");
  const sbSync = data.sync.find((entry) => entry.dataset === "sb");

  const clearFilters = () => {
    setSelectedRegions([]);
    setCpuVendor("all");
    setCpuNameQuery("");
    setMaxPrice("");
    setMinRam("");
    setMinCores("");
    setMinHddTb("");
    setMinSataTb("");
    setMinNvmeTb("");
    setMinHddDriveTb("");
    setMinSataDriveTb("");
    setMinNvmeDriveTb("");
    setEccOnly(false);
    setGpuOnly(false);
    setInicOnly(false);
    setNeedsHdd(false);
    setNeedsSata(false);
    setNeedsNvme(false);
  };

  const onNumericInputChange = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string,
  ) => {
    if (!value.trim()) {
      setter("");
      return;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    setter(String(Math.max(0, parsed)));
  };

  const onArrowStep = (
    currentValue: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    delta: number,
  ) => {
    const baseValue = parseInputNumber(currentValue) ?? 0;
    setter(String(Math.max(0, baseValue + delta)));
  };

  const scatterNormal = valueScatter.points.filter((point) => !point.isOutlier);
  const scatterOutliers = valueScatter.points.filter((point) => point.isOutlier);
  const scatterPriceMax =
    valueScatter.points.length > 0
      ? Math.max(...valueScatter.points.map((point) => point.price)) * 1.05
      : 100;
  const scatterCpuPerEuroMax =
    valueScatter.points.length > 0
      ? Math.max(...valueScatter.points.map((point) => point.cpuPerPrice)) * 1.1
      : 100;

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-[1600px] space-y-4 animate-[fade-in_260ms_ease-out]">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_12px_30px_rgba(23,23,28,0.06)]">
          <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border)] pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                Hetzner Serverboerse
              </p>
              <h1 className="text-2xl font-semibold text-slate-900">Live Snapshot Explorer</h1>
              <p className="text-sm text-slate-500">
                Filter fast, inspect details, and compare value by CPU performance.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start md:self-auto">
              <button
                aria-label="Refresh data from database"
                className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--accent-strong)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isRefreshing}
                onClick={() => {
                  startRefreshTransition(() => {
                    router.refresh();
                  });
                }}
                title={isRefreshing ? "Refreshing..." : "Refresh data"}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M21 2v6h-6" />
                  <path d="M3 11a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M3 22v-6h6" />
                  <path d="M21 13a9 9 0 0 1-15 6.7L3 16" />
                </svg>
              </button>
              <div className="rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent-strong)]">
                <p>
                  <span className="font-semibold">SB Sync:</span>{" "}
                  {formatTimeAgo(sbSync?.synced_at_utc, nowMs)}
                </p>
                <p>
                  <span className="font-semibold">Bench Sync:</span>{" "}
                  {formatTimeAgo(benchmarkSync?.synced_at_utc, nowMs)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                CPU Vendor
              </span>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                onChange={(event) => setCpuVendor(event.target.value)}
                value={cpuVendor}
              >
                <option value="all">All</option>
                {data.filters.cpuVendors.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                CPU Name
              </span>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                onChange={(event) => setCpuNameQuery(event.target.value)}
                placeholder="e.g. EPYC 7502P"
                type="text"
                value={cpuNameQuery}
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Min Cores
              </span>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                inputMode="numeric"
                min={0}
                onChange={(event) => onNumericInputChange(setMinCores, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    onArrowStep(minCores, setMinCores, 1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    onArrowStep(minCores, setMinCores, -1);
                  }
                }}
                placeholder="e.g. 8"
                step={1}
                type="number"
                value={minCores}
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Min RAM (GB)
              </span>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                inputMode="numeric"
                min={0}
                onChange={(event) => onNumericInputChange(setMinRam, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    onArrowStep(minRam, setMinRam, 1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    onArrowStep(minRam, setMinRam, -1);
                  }
                }}
                placeholder="e.g. 8"
                step={1}
                type="number"
                value={minRam}
              />
            </label>

            <label className="xl:justify-self-end xl:min-w-[14rem]">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Max Price (€ / month)
              </span>
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                inputMode="numeric"
                min={0}
                onChange={(event) => onNumericInputChange(setMaxPrice, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    onArrowStep(maxPrice, setMaxPrice, 1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    onArrowStep(maxPrice, setMaxPrice, -1);
                  }
                }}
                placeholder="No limit"
                step={1}
                type="number"
                value={maxPrice}
              />
            </label>
          </div>

          <div className="mt-3">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Regions (multi-select)</span>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button
                className={`rounded-full border px-3 py-1.5 ${
                  selectedRegions.length === 0
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                    : "border-[var(--border)] bg-white text-slate-700"
                }`}
                onClick={() => setSelectedRegions([])}
                type="button"
              >
                All
              </button>
              {data.filters.regions.map((option) => {
                const active = selectedRegions.includes(option);
                return (
                  <button
                    className={`rounded-full border px-3 py-1.5 ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "border-[var(--border)] bg-white text-slate-700"
                    }`}
                    key={option}
                    onClick={() =>
                      setSelectedRegions((current) =>
                        current.includes(option)
                          ? current.filter((region) => region !== option)
                          : [...current, option],
                      )
                    }
                    type="button"
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <label className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5">
              <input checked={eccOnly} onChange={(e) => setEccOnly(e.target.checked)} type="checkbox" />
              ECC only
            </label>
            <label className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5">
              <input checked={gpuOnly} onChange={(e) => setGpuOnly(e.target.checked)} type="checkbox" />
              GPU only
            </label>
            <label className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5">
              <input checked={inicOnly} onChange={(e) => setInicOnly(e.target.checked)} type="checkbox" />
              iNIC only
            </label>
            <label className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5">
              <input checked={needsHdd} onChange={(e) => setNeedsHdd(e.target.checked)} type="checkbox" />
              HDD
            </label>
            <label className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5">
              <input checked={needsSata} onChange={(e) => setNeedsSata(e.target.checked)} type="checkbox" />
              SATA SSD
            </label>
            <label className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5">
              <input checked={needsNvme} onChange={(e) => setNeedsNvme(e.target.checked)} type="checkbox" />
              NVMe SSD
            </label>
            <button
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 font-semibold text-white transition hover:bg-[var(--accent-strong)]"
              onClick={clearFilters}
              type="button"
            >
              Clear Filters
            </button>
          </div>

          <div className="mt-3 rounded-xl border border-[var(--border)] bg-white p-3">
            <button
              className="flex w-full items-center justify-between text-left"
              onClick={() => setShowAdvancedDriveFilters((open) => !open)}
              type="button"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Advanced Drive Filters
              </span>
              <span className="text-sm font-semibold text-slate-700">
                {showAdvancedDriveFilters ? "Hide" : "Show"}
              </span>
            </button>

            {showAdvancedDriveFilters ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Min HDD Total (TB)
                    </span>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                      inputMode="decimal"
                      min={0}
                      onChange={(event) => onNumericInputChange(setMinHddTb, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          onArrowStep(minHddTb, setMinHddTb, 1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          onArrowStep(minHddTb, setMinHddTb, -1);
                        }
                      }}
                      placeholder="e.g. 4"
                      step={0.5}
                      type="number"
                      value={minHddTb}
                    />
                  </label>

                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Min SATA Total (TB)
                    </span>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                      inputMode="decimal"
                      min={0}
                      onChange={(event) => onNumericInputChange(setMinSataTb, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          onArrowStep(minSataTb, setMinSataTb, 1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          onArrowStep(minSataTb, setMinSataTb, -1);
                        }
                      }}
                      placeholder="e.g. 2"
                      step={0.5}
                      type="number"
                      value={minSataTb}
                    />
                  </label>

                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Min NVMe Total (TB)
                    </span>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                      inputMode="decimal"
                      min={0}
                      onChange={(event) => onNumericInputChange(setMinNvmeTb, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          onArrowStep(minNvmeTb, setMinNvmeTb, 1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          onArrowStep(minNvmeTb, setMinNvmeTb, -1);
                        }
                      }}
                      placeholder="e.g. 4"
                      step={0.5}
                      type="number"
                      value={minNvmeTb}
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Min HDD Drive (TB)
                    </span>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                      inputMode="decimal"
                      min={0}
                      onChange={(event) => onNumericInputChange(setMinHddDriveTb, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          onArrowStep(minHddDriveTb, setMinHddDriveTb, 1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          onArrowStep(minHddDriveTb, setMinHddDriveTb, -1);
                        }
                      }}
                      placeholder="e.g. 4"
                      step={0.5}
                      type="number"
                      value={minHddDriveTb}
                    />
                  </label>

                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Min SATA Drive (TB)
                    </span>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                      inputMode="decimal"
                      min={0}
                      onChange={(event) => onNumericInputChange(setMinSataDriveTb, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          onArrowStep(minSataDriveTb, setMinSataDriveTb, 1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          onArrowStep(minSataDriveTb, setMinSataDriveTb, -1);
                        }
                      }}
                      placeholder="e.g. 2"
                      step={0.5}
                      type="number"
                      value={minSataDriveTb}
                    />
                  </label>

                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Min NVMe Drive (TB)
                    </span>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                      inputMode="decimal"
                      min={0}
                      onChange={(event) => onNumericInputChange(setMinNvmeDriveTb, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          onArrowStep(minNvmeDriveTb, setMinNvmeDriveTb, 1);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          onArrowStep(minNvmeDriveTb, setMinNvmeDriveTb, -1);
                        }
                      }}
                      placeholder="e.g. 2"
                      step={0.5}
                      type="number"
                      value={minNvmeDriveTb}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_12px_30px_rgba(23,23,28,0.06)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Value Outliers</h2>
              <p className="text-xs text-slate-500">Monthly price vs CPU/€, highlighted by same-price bucket outlier score.</p>
            </div>
            <p className="text-xs text-slate-500">
              {numberFormatter.format(valueScatter.points.length)} points in chart
            </p>
          </div>

          {valueScatter.points.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-white p-6 text-sm text-slate-500">
              No chart data for current filters.
            </div>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-2">
                <div className="h-[320px] min-w-0 w-full">
                  <ResponsiveContainer height={320} minWidth={0} width="100%">
                    <ScatterChart margin={{ top: 16, right: 20, bottom: 8, left: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" />
                      <XAxis
                        dataKey="price"
                        domain={[0, scatterPriceMax]}
                        name="Monthly"
                        tickFormatter={formatAxisEuro}
                        type="number"
                      />
                      <YAxis
                        dataKey="cpuPerPrice"
                        domain={[0, scatterCpuPerEuroMax]}
                        name="CPU/€"
                        tickFormatter={formatAxisMetric}
                        type="number"
                      />
                      <Tooltip content={<ValueScatterTooltip />} />
                      <Scatter data={scatterNormal} fill="#94a3b8" name="Servers" />
                      <Scatter data={scatterOutliers} fill="#d50c2d" name="Outliers" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="flex h-[340px] min-h-0 flex-col rounded-xl border border-[var(--border)] bg-white p-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-800">Top outliers by bucket</h3>
                {valueScatter.outliers.length === 0 ? (
                  <p className="text-xs text-slate-500">No positive outliers in current filters.</p>
                ) : (
                  <ul className="min-h-0 space-y-2 overflow-y-auto pr-1">
                    {valueScatter.outliers.map((point) => (
                      <li key={`outlier-${point.serverId}`} className="rounded-lg border border-[var(--border)] p-2">
                        <div className="flex items-center justify-between gap-2">
                          <a
                            className="text-sm font-semibold text-[var(--accent-strong)] underline underline-offset-2"
                            href={`https://www.hetzner.com/sb/#search=${point.serverId}`}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            #{point.serverId}
                          </a>
                          <span className="text-xs font-semibold text-[var(--accent-strong)]">
                            +{formatMetric(point.outlierDelta)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-700">{point.cpu}</p>
                        <p className="text-xs text-slate-500">
                          {point.region ?? "—"} · {point.datacenter ?? "—"}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {formatMoney(point.price)} · CPU/€ {formatMetric(point.cpuPerPrice)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_12px_30px_rgba(23,23,28,0.06)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{numberFormatter.format(filteredServers.length)}</span> matching
              servers
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] border-collapse text-sm">
                <thead className="bg-slate-50">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="border-b border-[var(--border)] px-3 py-2 text-left">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={columns.length}>
                        No servers match your current filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const isExpanded = expandedServerId === row.original.server_id;
                      const information = parseJsonList(row.original.information_json);
                      const auctionUrl = `https://www.hetzner.com/sb/#search=${row.original.server_id}`;
                      const informationWithNetwork = [
                        ...information,
                        `Bandwidth: ${row.original.bandwidth ?? "—"} Mbit/s`,
                        `Traffic: ${row.original.traffic || "—"}`,
                      ];
                      const hddArr = parseJsonList(row.original.hdd_arr_json);

                      return (
                        <Fragment key={row.id}>
                          <tr
                            className="cursor-pointer border-b border-[var(--border)] transition hover:bg-[var(--accent-soft)]/50"
                            onClick={() =>
                              setExpandedServerId((current) =>
                                current === row.original.server_id ? null : row.original.server_id,
                              )
                            }
                          >
                            {row.getVisibleCells().map((cell) => (
                              <td key={cell.id} className="px-3 py-2 align-top text-slate-700">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </td>
                            ))}
                          </tr>
                          {isExpanded ? (
                            <tr className="border-b border-[var(--border)] bg-slate-50/70">
                              <td className="px-4 py-4" colSpan={columns.length}>
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="rounded-lg border border-[var(--border)] bg-white p-3">
                                    <section>
                                      <h4 className="mb-2 text-sm font-semibold text-slate-700">Information</h4>
                                      <p className="mb-2 text-sm">
                                        <a
                                          className="font-semibold text-[var(--accent-strong)] underline underline-offset-2 hover:text-[var(--accent)]"
                                          href={auctionUrl}
                                          rel="noopener noreferrer"
                                          target="_blank"
                                        >
                                          Auction ID: {row.original.server_id}
                                        </a>
                                      </p>
                                      <ul className="space-y-1">
                                        {informationWithNetwork.map((entry, index) => (
                                          <li
                                            key={`Information-${index}-${entry}`}
                                            className="text-sm text-slate-600"
                                          >
                                            {entry}
                                          </li>
                                        ))}
                                      </ul>
                                    </section>
                                  </div>
                                  <div className="rounded-lg border border-[var(--border)] bg-white p-3">
                                    <SectionList entries={hddArr} title="Drive Details" />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <div>
              Page {table.getState().pagination.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2">
                Rows
                <select
                  className="rounded-md border border-[var(--border)] bg-white px-2 py-1"
                  onChange={(event) =>
                    setPagination((current) => ({
                      ...current,
                      pageIndex: 0,
                      pageSize: Number(event.target.value),
                    }))
                  }
                  value={table.getState().pagination.pageSize}
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="rounded-md border border-[var(--border)] px-3 py-1 disabled:opacity-40"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
                type="button"
              >
                Previous
              </button>
              <button
                className="rounded-md bg-[var(--accent)] px-3 py-1 text-white disabled:opacity-40"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-slate-500">
          <p>
            Data source: {numberFormatter.format(data.servers.length)} servers from <code>servers_enriched</code>.
          </p>
          <p>
            DB path: <code>{data.dbPath}</code>
          </p>
        </section>
      </div>
    </main>
  );
}

export function MissingDataPanel({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_12px_30px_rgba(23,23,28,0.06)]">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Data unavailable</p>
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Could not load SQLite snapshot</h1>
        <p className="mb-4 text-sm text-slate-600">{message}</p>
        <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-slate-50 p-3 text-xs text-slate-600">
          python3 scraper.py sync-all --db-path ./data/sb.sqlite
        </pre>
      </section>
    </main>
  );
}
