import type { DependencyStatus } from "@netskope/shared";

const copy: Record<DependencyStatus, string> = {
  up: "Up",
  down: "Down",
};

export function ServiceStatus({
  name,
  detail,
  status,
}: {
  name: string;
  detail: string;
  status: DependencyStatus | "unknown";
}) {
  const label = status === "unknown" ? "Unknown" : copy[status];
  const dot =
    status === "up" ? "bg-emerald-700" : status === "down" ? "bg-red-700" : "bg-zinc-400";

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 last:border-b-0">
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="text-sm text-[var(--muted)]">{detail}</p>
      </div>
      <span className="inline-flex items-center gap-2 text-sm">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        <span>{label}</span>
      </span>
    </div>
  );
}
