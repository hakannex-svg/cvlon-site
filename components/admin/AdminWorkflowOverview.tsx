import type { PriceCheckStatus } from "@/db/price-check/domain/status-policy";
import { getPriceCheckWorkflowGuidance } from "@/lib/price-check/admin/workflow-guidance";

export function AdminWorkflowOverview({ status, assigned }: { status: PriceCheckStatus; assigned: boolean }) {
  const guidance = getPriceCheckWorkflowGuidance(status, assigned);
  return <section className="admin-workflow-overview" aria-labelledby="workflow-map-title">
    <div className="admin-workflow-heading"><div><p className="admin-eyebrow">Price Check workflow</p><h2 id="workflow-map-title">Where this request is now</h2></div><a href="/admin/help#workflow">Guide →</a></div>
    <ol className="admin-workflow-map">{guidance.phases.map((phase, index) => <li key={phase.id} className={`is-${phase.state}`} aria-current={phase.state === "current" || phase.state === "attention" ? "step" : undefined}><span>{index + 1}</span><div><b>{phase.title}</b><small>{phase.state === "attention" ? "Attention required" : phase.state[0].toUpperCase() + phase.state.slice(1)}</small></div></li>)}</ol>
    <div className={`admin-next-action is-${guidance.phases[guidance.currentPhase].state}`}><div><p className="admin-eyebrow">Next action</p><h2>Recommended next action</h2><p>{guidance.nextAction}</p></div><a href="#actions">Go to actions ↓</a></div>
  </section>;
}
