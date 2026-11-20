import { ServiceStatus } from "@/components/service-status";
import { getHealth } from "@/lib/api";

const processes = [
  { name: "Web", detail: "Next.js on port 3010. Presentation only." },
  { name: "API", detail: "Fastify on port 3011. Validation, persistence, and job orchestration." },
  { name: "Worker", detail: "Separate process. Browser sessions will run here, never inside an API request." },
];

export default async function HomePage() {
  const health = await getHealth();
  const apiStatus = health ? "up" : "down";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-16">
      <header className="mb-10">
        <p className="text-sm font-medium tracking-wide text-[var(--muted)]">Netskope</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Website API discovery and performance intelligence
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Inspect how a website you own communicates with its backend. The scanner is not
          enabled yet. This screen confirms that the application processes and their data
          services can see each other.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--card)] px-5 py-2">
        <div className="flex items-baseline justify-between gap-4 py-3">
          <h2 className="text-sm font-semibold">Service status</h2>
          <p className="text-sm text-[var(--muted)]">
            {health ? (health.status === "ok" ? "API dependencies healthy" : "API degraded") : "API unreachable"}
          </p>
        </div>
        <ServiceStatus name="API" detail="GET /api/v1/health" status={apiStatus} />
        <ServiceStatus
          name="PostgreSQL"
          detail="Scan and request storage"
          status={health?.checks.postgres ?? "unknown"}
        />
        <ServiceStatus
          name="Redis"
          detail="Queue and worker coordination"
          status={health?.checks.redis ?? "unknown"}
        />
        <ServiceStatus
          name="Worker"
          detail="Heartbeat key in Redis"
          status={health?.checks.worker ?? "unknown"}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Process boundaries</h2>
        <ul className="mt-3 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--card)] px-5">
          {processes.map((process) => (
            <li key={process.name} className="py-3">
              <p className="text-sm font-medium">{process.name}</p>
              <p className="text-sm text-[var(--muted)]">{process.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
