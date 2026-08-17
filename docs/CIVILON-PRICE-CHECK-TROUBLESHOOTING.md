# Civilon Price Check Troubleshooting

Fail closed, preserve immutable history, and use the manual path when optional AI is unavailable. Do not change production, credentials, DNS, Netlify configuration, or PR #11 to resolve an operator issue.

| Symptom | Check | Safe action |
| --- | --- | --- |
| Login denied/loops | Invited exact identity, active local binding, normal browser cookies | Sign out and retry configured Google flow. Escalate binding conflict; never rebind by email manually. |
| Request not in queue | Filters/search/status, feature-approved environment | Clear filters and search by authorized reference. Do not use customer PII in broad searches. |
| Cannot assign another person | Current role and target active/bound state | Analyst/Reviewer self-assign; only Admin assigns others. |
| Status option missing | Current state-machine path, role, required persisted revision/analysis/result | Complete the prerequisite. Never force a state. |
| Information request recorded but customer did not receive it | Audit event vs actual notification/delivery record | Do not claim delivery. Use approved authorized contact process/template. |
| Upload stays Pending | GuardDuty tag/reconciliation timing and processing job | Wait and refresh later. Admin may reconcile; do not download/extract. |
| Upload Rejected | Threat/content/signature/safety validation | Never open. Ask for a replacement using the approved template. |
| Upload Failed | Unsupported/access denied/scan mismatch/unknown | Continue without file or request replacement. Admin may retry bounded reconciliation. |
| Download absent | Attachment must be Clean; role needs download capability | Do not bypass. Auditor remains metadata-only. |
| Extraction unavailable/failed | Clean state, job attempts, safe error state | Review document manually. Admin controls retry; never repeatedly click or copy document to an unapproved tool. |
| Proposal has wrong/multiple values | Correct line, evidence cue, presence/conflict status | Keep current/unset, accept only verified fields, create revision with reason. |
| Comparable cannot be included | Verification, permitted use, exact/verified relationship, currency | Exclude with controlled reason. Do not broaden governance or expose source identity. |
| Range absent | 0/1 selected, mixed currency, incompatible evidence | Zero/one does not support displayed range; resolve evidence/currency or issue insufficient evidence. |
| Calculated figures look wrong | Current revision, included snapshots, unit vs core/fees, transaction type | Stop approval. Recheck decisions; create a new analysis. Never edit calculated facts in browser/result. |
| Confidence choice rejected | Zero evidence or missing bounded reason | Use Insufficient data for zero; otherwise choose High/Medium/Low with evidence-based reason. |
| AI draft rejected/failed/stale | Policy/schema failure, re-analysis, version/digest mismatch, attempt cap | Draft manually or regenerate if allowed. Never copy rejected/stale text. |
| Approve button missing | Reviewer/Admin role, current analysis/result state, valid content | Route to authorized reviewer; do not elevate role informally. |
| Approved result changed | New analysis/material content creates new version | Review and approve the new version. Sent history stays immutable. |
| Delivery Pending/Failed | Outbox job, attempt count, sanitized code, provider state | Keep result Approved until success; allow bounded worker retry. Escalate `dead_letter`. Do not send raw secure link. |
| Customer result link unavailable | Malformed/expired/revoked/superseded credential all look generic | Verify identity through approved channel and use authorized reissue workflow; never request the link/token from customer. |
| Duplicate sourcing request concern | Existing opportunity linked to result | Use the existing row; the result constraint should prevent duplication. |
| Audit/job data contains sensitive content | Any token, URL, raw document/generated text, credential, excess PII | Treat as privacy/security incident; stop copying it and escalate immediately. |

## Escalation packet

Provide only: internal Price Check ID/reference, timestamp and timezone, environment/branch, visible workflow state, attachment/job/result-delivery state, sanitized failure code, staff role, and actions already attempted. Redact screenshots.

Never attach customer documents, raw comparables, supplier/customer provenance, analyst notes, cookies, authorization headers, API keys, provider tokens, database URLs, signed object URLs, or secure customer-result links.

## Recovery principles

1. Preserve original submission and append-only audit history.
2. Create a new revision, analysis, AI artifact, or result version instead of overwriting history.
3. Optional extraction/explanation failure does not block manual work.
4. Delivery success—not approval or queueing—sets Sent.
5. Escalate deterministic calculation mismatch, identity conflict, repeated scan failure, dead-letter delivery, or any security/privacy concern.
