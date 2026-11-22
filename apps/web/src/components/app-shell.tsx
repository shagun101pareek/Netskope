"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, clearToken, readToken, writeToken } from "@/lib/client";

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (readToken()) {
        if (!cancelled) setReady(true);
        return;
      }
      const refreshed = await fetch(new URL("/api/v1/auth/refresh", process.env.API_URL), {
        method: "POST",
        credentials: "include",
      });
      if (!refreshed.ok) {
        router.replace("/login");
        return;
      }
      const body = (await refreshed.json()) as { accessToken: string };
      writeToken(body.accessToken);
      if (!cancelled) setReady(true);
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    clearToken();
    router.replace("/login");
  }

  if (!ready) {
    return <p className="px-6 py-10 text-sm text-[var(--muted)]">Checking session…</p>;
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-[var(--line)] bg-[var(--card)] px-5 py-6 md:border-r md:border-b-0">
        <Link href="/app" className="text-sm font-semibold">
          Netskope
        </Link>
        <nav className="mt-6 flex gap-4 text-sm md:flex-col">
          <Link href="/app">Scans</Link>
          <button className="text-left text-[var(--muted)]" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </aside>
      <div className="px-6 py-8">{children}</div>
    </div>
  );
}
