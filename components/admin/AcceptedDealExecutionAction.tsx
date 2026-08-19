"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AcceptedDealExecutionSourceStatus } from "@/db/price-check/domain/accepted-deal-policy";

export function AcceptedDealExecutionAction({
  buyRequestId,
  expectedStatus,
}: {
  buyRequestId: string;
  expectedStatus: AcceptedDealExecutionSourceStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startExecution() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/marketplace/buy-requests/${buyRequestId}/execution`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedStatus }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Execution could not be started.");
        return;
      }
      router.refresh();
    } catch {
      setError("Execution could not be started.");
    } finally {
      setPending(false);
    }
  }

  return <div className="admin-note-template" aria-label="Start accepted deal execution">
    <button type="button" onClick={() => void startExecution()} disabled={pending}>
      {pending ? "Starting…" : "Start execution — mark Converted"}
    </button>
    <small>
      Converted means Civilon has begun carrying out this accepted deal. It does not mean payment,
      procurement, supplier reconfirmation, documentation acceptance, shipment, export, delivery,
      certification, airworthiness approval, authenticity, fitness, or confirmed availability.
    </small>
    {error ? <p className="admin-error" role="alert">{error}</p> : null}
  </div>;
}
