import { MissingDataPanel, ServerDashboard } from "@/components/server-dashboard";
import { loadDashboardData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function Home() {
  let data: ReturnType<typeof loadDashboardData> | null = null;
  let message: string | null = null;

  try {
    data = loadDashboardData();
  } catch (error) {
    message = error instanceof Error ? error.message : "Unknown error";
  }

  if (!data) {
    return <MissingDataPanel message={message ?? "Unknown error"} />;
  }

  return <ServerDashboard data={data} />;
}
