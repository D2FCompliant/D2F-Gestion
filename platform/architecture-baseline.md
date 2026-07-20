# D2F Platform — implementation baseline

## Documents reconciled

The Product Architecture Specification defines product ownership and the delivery roadmap. The D2F Platform Reference Architecture defines logical layers. Where wording differs, the following interpretation is normative for implementation:

- The Canonical Business Model is a versioned contract language, not a shared database.
- An application persists only aggregates it owns; it does not persist every canonical object.
- D2F Gestion remains the authority for customers, quotes, customer invoices, credit notes and customer receipts.
- Country Packs are accessed through Compliance services; applications do not import them directly.
- Business intent may use synchronous APIs. Completed facts use immutable events.
- Shared engines centralize technical mechanisms, not domain decisions.
- D2F AI remains assistive and does not own business data.

## Existing D2F Gestion baseline

The current application already provides useful foundations:

- Supabase server-side access and tenant records;
- append-only audit events;
- customer invoice lifecycle including an explicit `issued` state;
- country-aware compliance checks;
- integration and transmission records;
- Cloudflare/Vinext web delivery and Electron packaging.

Transitional constraints:

- core records currently use a generic JSON `d2f_records` store;
- older lifetime data can use an owner key rather than a tenant UUID;
- country-specific checks currently exist inside D2F Gestion;
- invoice issuance and event publication are not yet one atomic database transaction.

These constraints are adapters to migrate, not reasons to rewrite Gestion.

## France — routage des PA

- Une entreprise possède au maximum une PA active pour la réception.
- Elle peut autoriser plusieurs PA qualifiées pour l’émission.
- Une préférence de PA sortante peut être définie par client.
- Une facture peut exceptionnellement imposer une PA sortante autorisée.
- La priorité est : facture, préférence client, PA sortante par défaut.
- La PA retenue est figée lors de l’émission et tracée dans l’événement.

## First vertical slice

The first production slice is:

1. issue a customer invoice in D2F Gestion;
2. update the invoice and append `InvoiceIssued` in one transaction;
3. publish the pending Outbox event;
4. let D2F Financial register it once through its Inbox;
5. build read-only customer/invoice projections;
6. create an accounting proposal;
7. require a controlled validation before posting.

## Current foundation delivered

- Event Envelope v1 JSON Schema.
- `InvoiceIssued` JSON Schema.
- Country Capabilities v1 JSON Schema.
- RLS-protected Outbox and idempotent Inbox migration.
- Contract tests included in the normal test suite.

## Next implementation lot

The next lot must add a database issuance command that atomically updates the invoice and inserts its event. It must preserve existing numbering and immutability behavior.

Acceptance criteria:

- draft invoice only;
- idempotency key required;
- a second identical command returns the first result;
- no issued invoice exists without its Outbox event;
- decimal values are serialized as strings;
- tenant/owner boundary is derived server-side;
- failure rolls back invoice and event together;
- tests cover final invoice, deposit invoice and credit note;
- existing D2F Gestion UI and RPC behavior remain compatible.

No Financial posting code should be added before this atomic boundary is complete.
