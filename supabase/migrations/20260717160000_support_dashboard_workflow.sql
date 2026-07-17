alter table public.d2f_support_tickets
  add column if not exists ticket_scope text not null default 'customer';

alter table public.d2f_support_tickets
  drop constraint if exists d2f_support_tickets_ticket_scope_check;

alter table public.d2f_support_tickets
  add constraint d2f_support_tickets_ticket_scope_check check (ticket_scope in ('customer','internal'));

alter table public.d2f_support_tickets
  add column if not exists request_type text not null default 'incident';

alter table public.d2f_support_tickets
  drop constraint if exists d2f_support_tickets_request_type_check;

alter table public.d2f_support_tickets
  add constraint d2f_support_tickets_request_type_check check (request_type in ('incident','need','question'));
