# Civilon legal review checklist

Status: **PENDING COUNSEL REVIEW BEFORE PUBLIC PRODUCTION LAUNCH**.

This checklist is an internal launch control. It is not legal advice and does not authorize public Price Check enablement.

## Public documents

- [ ] Approve the Privacy Policy identity, contact details, data categories, purposes, processors, international transfer language, rights handling and update mechanism.
- [ ] Approve Terms of Use business-use scope, acceptable-use controls, service availability wording, intellectual-property language and third-party service wording.
- [ ] Approve the final jurisdiction, dispute-resolution, liability and disclaimer provisions. The current draft deliberately does not invent them.
- [ ] Confirm the public Price Check wording remains informational/human-reviewed and does not imply appraisal, valuation certificate, fair-market value, price guarantee, inventory, certification, supplier cost or margin determination.
- [ ] Confirm document-upload, automated extraction and AI-assisted explanation disclosure accurately describes only approved processing.
- [ ] Confirm no Zero Data Retention, complete-anonymity, deletion-period or training-control claim exceeds the approved provider terms and Civilon operations.

## Explicit acknowledgement design

- [ ] Approve the separate service-processing and legal-document acknowledgement wording.
- [ ] Confirm neither control is a marketing consent.
- [ ] Approve legal document versioning and the immutable audit-event retention approach.
- [ ] Approve the requester confirmation/record-access response process.

## Retention decisions required

All values below are intentionally **OWNER/COUNSEL DECISION REQUIRED** before a production feature launch. Implement approved lifecycle configuration only after the decision is recorded.

| Record or artifact | Current technical state | Retention decision |
| --- | --- | --- |
| Abandoned Price Check form/request | No production policy | OWNER/COUNSEL DECISION REQUIRED |
| Quarantined upload | Private non-production workflow | OWNER/COUNSEL DECISION REQUIRED |
| Rejected/malware upload | Private non-production workflow | OWNER/COUNSEL DECISION REQUIRED |
| Accepted Price Check and attachments | Private workflow; no production record | OWNER/COUNSEL DECISION REQUIRED |
| Transaction and analysis records | Preview database only | OWNER/COUNSEL DECISION REQUIRED |
| Immutable audit events | Preview database only | OWNER/COUNSEL DECISION REQUIRED |
| Result-delivery/outbox email metadata | Preview database only | OWNER/COUNSEL DECISION REQUIRED |
| Sourcing opportunity/conversion record | Preview database only | OWNER/COUNSEL DECISION REQUIRED |
| Security logs and abuse controls | Provider/service controlled | OWNER/COUNSEL DECISION REQUIRED |

## Consent and analytics decisions

- [ ] Decide whether optional analytics requires consent in each target geography.
- [ ] Approve CMP/provider, banner copy, consent records, opt-out behavior and tag firing conditions.
- [ ] Approve GA4/GTM public identifiers and event-retention settings.
- [ ] Confirm GTM/GA4 never receives form fields, uploaded document data, email, phone, part number, price, tail number, result token or private result data.

## Processor and vendor review

- [ ] Netlify hosting/database and preview branch controls.
- [ ] AWS private storage and GuardDuty Malware Protection for S3 scan/tagging workflow.
- [ ] OpenAI API data controls and approved production project/key model scope.
- [ ] Google OIDC identity flow and local exact-identity authorization.
- [ ] Postmark sender, delivery and data-processing terms.

Counsel sign-off date: ____________________  Owner sign-off date: ____________________
