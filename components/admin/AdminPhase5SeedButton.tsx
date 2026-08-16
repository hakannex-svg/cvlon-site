"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminPhase5SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function seedPreview() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/phase-5/seed", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = await response.json().catch(() => ({ error: "The preview response could not be read." }));
      if (!response.ok) throw new Error(payload.error ?? "Synthetic preview evidence could not be created.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Synthetic preview evidence could not be created.");
      setBusy(false);
    }
  }

  return <section className="admin-preview-seed" aria-label="Synthetic Phase 5 preview evidence">
    <div>
      <strong>Phase 5 synthetic review set</strong>
      <p>Create the approved fictional requests, observations, restrictions, and governed relationship cases in this isolated Deploy Preview database.</p>
      {error && <p className="admin-error" role="alert">{error}</p>}
    </div>
    <button type="button" disabled={busy} onClick={seedPreview}>{busy ? "Creating preview set…" : "Create synthetic review set"}</button>
  </section>;
}
