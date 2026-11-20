import { isHealthReport, type HealthReport } from "@netskope/shared";

export async function getHealth(): Promise<HealthReport | null> {
  const baseUrl = process.env.API_URL;

  if (!baseUrl) {
    return null;
  }

  try {
    const response = await fetch(new URL("/api/v1/health", baseUrl), {
      cache: "no-store",
    });

    if (response.status !== 200 && response.status !== 503) {
      return null;
    }

    const payload: unknown = await response.json();
    return isHealthReport(payload) ? payload : null;
  } catch {
    return null;
  }
}
