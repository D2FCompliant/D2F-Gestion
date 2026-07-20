# D2F Financial and D2F Expense - foundation v1

## Domain ownership

D2F Financial owns suppliers, supplier invoices, accounting proposals, journals, bank accounts, treasury and reimbursement preparation.

D2F Expense owns expenses, expense reports, expense lines and receipt metadata.

D2F Gestion remains authoritative for customers, quotes, customer invoices, credit notes and customer receipts. Financial stores only rebuildable projections of Gestion data.

## First vertical slices

### Financial

1. Consume InvoiceIssued from D2F Gestion.
2. Store an idempotent read-only customer invoice projection.
3. Produce a draft accounting proposal.
4. Require controlled validation before posting.

### Expense

1. Create an expense report and at least one line.
2. Attach receipt metadata while preserving the original document provenance.
3. Submit the aggregate atomically and publish ExpenseSubmitted.
4. Approve or reject separately.
5. Publish ExpenseApproved for Financial reimbursement and accounting preparation.

Approval, reimbursement and accounting posting remain separate decisions.

## Initial limitations

Receipt bytes remain in the existing protected object store. This foundation stores only metadata and integrity references. Country Pack rules for eligibility, recoverable VAT, mileage and per diem are intentionally not hard-coded in the core.
