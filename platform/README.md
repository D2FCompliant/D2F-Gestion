# D2F Platform foundation

This directory contains the versioned contracts shared by D2F Gestion and future D2F modules.

1. D2F Gestion remains the authority for customer invoices.
2. Only an issued invoice can publish `InvoiceIssued`.
3. Consumers keep read-only projections and process every `eventId` idempotently.
4. Country-specific execution remains behind versioned capabilities and country packs.

These additive contracts do not replace the existing D2F Gestion data model.

- `contracts/events`: event envelope and business events.
- `contracts/capabilities`: country capabilities for licensing and activation.
- `contracts/openapi`: synchronous commands and immediate reads.

The migration `20260720110000_platform_event_backbone.sql` provides the transactional Outbox and consumer Inbox. Delivery is at-least-once.

The migration `20260720130000_financial_expense_foundation.sql` adds the first Financial projections, controlled accounting proposals, and authoritative Expense aggregates.
