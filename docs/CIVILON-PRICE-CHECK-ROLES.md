# Civilon Price Check Roles and Capabilities

This matrix reflects the implemented policy in `lib/price-check/admin/policy.ts` on this documentation branch. UI visibility is not authorization; protected routes enforce the same server-side policy.

| Capability | ANALYST | REVIEWER | ADMIN | AUDITOR |
| --- | :---: | :---: | :---: | :---: |
| View protected Price Check data | Yes | Yes | Yes | Yes |
| Self-assign | Yes | Yes | Yes | No |
| Assign any active staff user | No | No | Yes | No |
| Create immutable reviewed revision | Yes | Yes | Yes | No |
| Request information / ordinary transition | Yes | Yes | Yes | No |
| Create analysis / observation | Yes | Yes | Yes | No |
| Manage governed part relationships | No | No | Yes | No |
| Draft result / AI explanation proposal | Yes | Yes | Yes | No |
| Approve and send result | No | Yes | Yes | No |
| Exceptional transitions | No | No | Yes | No |
| Download Clean attachment | Yes | Yes | Yes | No |
| Reconcile scan / controlled extraction retry | No | No | Yes | No |
| Trigger extraction / apply selected fields | Yes | Yes | Yes | No |
| Manage staff (capability reserved) | No | No | Yes | No |

## Role summaries

- **ANALYST:** Performs triage, self-assignment, revisions, information requests, evidence decisions, deterministic analysis, observation creation, result drafting, AI-assistance review, and clean-document extraction/application. Cannot approve/send, assign others, manage governed relationships, reconcile scans, or perform controlled retries.
- **REVIEWER:** Analyst capabilities plus result approval and send. Review and approval are separate human actions; role authority does not make AI output authoritative.
- **ADMIN:** Full current policy, including assignment to active staff, governed relationship management, exceptional status actions, attachment reconciliation, controlled extraction retry, and reserved staff-management capability.
- **AUDITOR:** Read-only visibility. No assignment, download, mutation, extraction, analysis, drafting, approval, send, or retry.

## Operational status rules

Analyst/Reviewer ordinary status choices are Needs information, Ready for analysis, Analysis ready, and Withdrawn when the state machine permits them. Admin additionally has Processing failed, Spam, and Closed choices where permitted. Human review, approval, sent, quote requested, and converted are normally produced by their dedicated domain actions—not by forcing a generic transition.

## Staff Management — Live

**STAFF MANAGEMENT — LIVE** at `https://cvlon.com/admin/staff`. An active `ADMIN` may add an exact Google email with an `ADMIN`, `REVIEWER`, `ANALYST`, or `AUDITOR` role. New records remain **Awaiting first login** until the employee uses that exact verified Google account at `https://cvlon.com/admin/login`; the first authorized login binds the immutable Google identity and displays **Bound**. Admins may change roles, disable/re-enable access, and revoke sessions. Role changes revoke current sessions, re-enabling does not revive old sessions, and the final active Admin cannot be demoted or disabled.
