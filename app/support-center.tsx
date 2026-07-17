"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supportCopies, supportLanguage, type SupportLanguage } from "./support-i18n";

type SupportMessage = { id: string; authorType: string; authorName: string; authorEmail: string; body: string; internal: boolean; createdAt: string };
type SupportTicket = {
  id: string; number: string; tenantId: string; companyName: string; requesterName: string; requesterEmail: string; contactEmail: string;
  ticketScope: string; requestType: string;
  locale: string; category: string; priority: string; subject: string; description: string; status: string; assignedTo: string;
  l1Mode: string; l1Summary: string; resolution: string; externalProvider: string; externalKey: string; externalUrl: string;
  resolvedAt: string; closedAt: string; createdAt: string; updatedAt: string; messages: SupportMessage[];
};
type SupportPayload = { tickets: SupportTicket[]; attentionCount: number; supportEmail: string; deliveryConfigured: boolean; l1Mode: string; generativeAiConfigured: boolean; isAdmin: boolean };
type SupportSession = { user: { email: string; fullName: string }; account: { name: string; isPlatformAdmin: boolean } };

async function supportApi(method: "GET" | "POST" | "PATCH", body?: Record<string, unknown>) {
  const response = await fetch("/auth/support", {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Support indisponible");
  return payload.result as SupportPayload;
}

function displayDate(value: string, language: SupportLanguage) {
  if (!value) return "—";
  const locales: Record<SupportLanguage, string> = { fr: "fr-FR", en: "en-GB", sr: "sr-Latn-RS", it: "it-IT", es: "es-ES" };
  return new Intl.DateTimeFormat(locales[language], { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function SupportCenter({ session, onClose, onAttentionCount, onChanged, initialTicketId = "" }: { session: SupportSession; onClose: () => void; onAttentionCount: (count: number) => void; onChanged: () => void; initialTicketId?: string }) {
  const [language] = useState<SupportLanguage>(() => typeof window === "undefined"
    ? "fr"
    : supportLanguage(localStorage.getItem("d2f-portal-language") || navigator.language));
  const [payload, setPayload] = useState<SupportPayload | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const copy = supportCopies[language];
  const selected = useMemo(() => payload?.tickets.find((ticket) => ticket.id === selectedId) || null, [payload, selectedId]);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await supportApi("GET");
      setPayload(result); onAttentionCount(result.attentionCount);
      setSelectedId((current) => {
        const preferred = initialTicketId && result.tickets.some((ticket) => ticket.id === initialTicketId) ? initialTicketId : current;
        return preferred && result.tickets.some((ticket) => ticket.id === preferred) ? preferred : result.tickets[0]?.id || "";
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Support indisponible");
    } finally { setBusy(false); }
  }, [initialTicketId, onAttentionCount]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function acceptResult(result: SupportPayload, preferredId?: string) {
    setPayload(result); onAttentionCount(result.attentionCount); onChanged();
    const next = preferredId || selectedId || result.tickets[0]?.id || "";
    setSelectedId(result.tickets.some((ticket) => ticket.id === next) ? next : result.tickets[0]?.id || "");
  }

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await supportApi("POST", {
        category: form.get("category"), priority: form.get("priority"), subject: form.get("subject"), description: form.get("description"),
        contactEmail: form.get("contactEmail"), locale: language, ticketScope: form.get("ticketScope"), requestType: form.get("requestType"),
      });
      acceptResult(result, result.tickets[0]?.id); setCreating(false); setMessage(`${copy.created} ${result.tickets[0]?.number || ""}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Création impossible"); }
    finally { setBusy(false); }
  }

  async function reanalyze() {
    if (!selected) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await supportApi("POST", { action: "reanalyze", ticketId: selected.id });
      acceptResult(result, selected.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Analyse impossible"); }
    finally { setBusy(false); }
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await supportApi("POST", { action: "reply", ticketId: selected.id, body: form.get("body"), internal: form.get("internal") === "on" });
      acceptResult(result, selected.id); formElement.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Réponse impossible"); }
    finally { setBusy(false); }
  }

  async function updateStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await supportApi("PATCH", { ticketId: selected.id, status: form.get("status"), assignedTo: form.get("assignedTo"), resolution: form.get("resolution") });
      acceptResult(result, selected.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Mise à jour impossible"); }
    finally { setBusy(false); }
  }

  async function closeResolved() {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const result = await supportApi("PATCH", { ticketId: selected.id, status: "closed" });
      acceptResult(result, selected.id); setMessage(copy.confirmedClose);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Clôture impossible"); }
    finally { setBusy(false); }
  }

  const categoryEntries = Object.entries(copy.categories);
  const priorityEntries = Object.entries(copy.priorities);

  return <div className="support-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="support-center" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <header className="support-head"><div><p className="eyebrow">D2F COMPLIANT · VERSION 2.1.5</p><h2 id="support-title">{payload?.isAdmin ? copy.adminTitle : copy.title}</h2><p>{payload?.isAdmin ? copy.adminSubtitle : copy.subtitle}</p></div><div><a href={`mailto:${payload?.supportEmail || "support@d2fcompliant.com"}`}><span>{copy.supportByEmail}</span><strong>{payload?.supportEmail || "support@d2fcompliant.com"}</strong></a><button type="button" onClick={onClose} aria-label={copy.close}>×</button></div></header>
      <div className="support-toolbar"><div><button type="button" className="support-new" onClick={() => { setCreating(true); setSelectedId(""); setError(""); }}>{payload?.isAdmin ? copy.newInternalTicket : copy.newTicket}</button><button type="button" className="support-refresh" onClick={load} disabled={busy}>↻</button></div><p className={payload?.deliveryConfigured ? "is-active" : ""}>{payload?.deliveryConfigured ? copy.emailActive : copy.emailPending}</p></div>
      <div className={`support-layout ${creating ? "is-creating" : ""}`}>
        <aside className={`support-list ${selected || creating ? "has-mobile-detail" : ""}`} aria-label={copy.tickets}>
          <div className="support-list__title"><strong>{copy.tickets}</strong><span>{payload?.tickets.length || 0}</span></div>
          {busy && !payload && <p className="support-empty">{copy.waiting}</p>}
          {!busy && payload && !payload.tickets.length && <p className="support-empty">{copy.noTickets}</p>}
          {payload?.tickets.map((ticket) => <button type="button" key={ticket.id} className={ticket.id === selectedId ? "is-selected" : ""} onClick={() => { setSelectedId(ticket.id); setCreating(false); setError(""); }}><div><strong>{ticket.number}</strong><span className={`support-status status-${ticket.status}`}>{copy.statuses[ticket.status] || ticket.status}</span></div><p>{ticket.subject}</p>{payload.isAdmin && <small>{ticket.companyName} · {copy.scopes[ticket.ticketScope] || ticket.ticketScope}</small>}<footer><span className={`priority-${ticket.priority}`}>{copy.priorities[ticket.priority] || ticket.priority} · {copy.requestTypes[ticket.requestType] || ticket.requestType}</span><time>{displayDate(ticket.updatedAt, language)}</time></footer></button>)}
        </aside>
        <main className="support-detail">
          {(selected || creating) && <button type="button" className="support-mobile-back" onClick={() => { setSelectedId(""); setCreating(false); }}>{copy.back}</button>}
          {creating ? <form className="support-new-form" onSubmit={createTicket}>
            <div><p className="eyebrow">{payload?.isAdmin ? copy.newInternalTicket : copy.newTicket}</p><h3>{copy.assistantTitle}</h3><p>{copy.assistantText}</p></div>
            <div className="support-form-grid">{payload?.isAdmin && <>
              <label>{copy.ticketScope}<select name="ticketScope" defaultValue="internal">{Object.entries(copy.scopes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>{copy.requestType}<select name="requestType" defaultValue="incident">{Object.entries(copy.requestTypes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            </>}<label>{copy.category}<select name="category" defaultValue="technical">{categoryEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>{copy.priority}<select name="priority" defaultValue="normal">{priorityEntries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="span-2">{copy.subject}<input name="subject" minLength={5} maxLength={160} required /></label><label className="span-2">{copy.description}<textarea name="description" minLength={10} maxLength={8000} rows={7} required /></label><label className="span-2">{copy.contactEmail}<input name="contactEmail" type="email" defaultValue={session.user.email} required /></label></div>
            <p className="support-privacy">Ne communiquez jamais de mot de passe, clé API, secret, donnée bancaire complète ou document contenant des données non nécessaires.</p>
            <button className="primary-action" disabled={busy}>{busy ? copy.creating : copy.create}</button>
          </form> : selected ? <article className="support-ticket">
            <header><div><div className="support-ticket__meta"><strong>{selected.number}</strong><span className={`support-status status-${selected.status}`}>{copy.statuses[selected.status] || selected.status}</span><span className={`support-priority priority-${selected.priority}`}>{copy.priorities[selected.priority] || selected.priority}</span><span className="support-priority">{copy.scopes[selected.ticketScope] || selected.ticketScope} · {copy.requestTypes[selected.requestType] || selected.requestType}</span></div><h3>{selected.subject}</h3><p>{copy.company}: <strong>{selected.companyName}</strong> · {copy.requester}: <strong>{selected.requesterName}</strong> · {selected.contactEmail}</p></div><time>{copy.updated}: {displayDate(selected.updatedAt, language)}</time></header>
            {payload?.isAdmin && selected.status !== "closed" && <button type="button" className="support-reanalyze" onClick={reanalyze} disabled={busy}>{copy.reanalyze}</button>}
            <section className="support-timeline">{selected.messages.map((item) => <div className={`support-message author-${item.authorType} ${item.internal ? "is-internal" : ""}`} key={item.id}><header><strong>{item.authorName || copy.authors[item.authorType] || item.authorType}</strong><span>{item.internal ? copy.internalNote : copy.authors[item.authorType]}</span><time>{displayDate(item.createdAt, language)}</time></header><p>{item.body}</p></div>)}</section>
            {selected.status !== "closed" && <form className="support-reply" onSubmit={reply}><label>{copy.reply}<textarea name="body" rows={4} maxLength={8000} required /></label>{payload?.isAdmin && <label className="support-internal"><input type="checkbox" name="internal" /><span>{copy.internalNote}</span></label>}<button className="secondary-action" disabled={busy}>{copy.sendReply}</button></form>}
            {payload?.isAdmin && selected.status !== "closed" && <form className="support-admin-form" onSubmit={updateStatus}><label>{copy.status}<select name="status" defaultValue={selected.status}>{Object.entries(copy.statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{copy.assignedTo}<input name="assignedTo" defaultValue={selected.assignedTo} placeholder="support@d2fcompliant.com" /></label><label className="span-2">{copy.resolution}<textarea name="resolution" rows={3} defaultValue={selected.resolution} /></label><button className="secondary-action span-2" disabled={busy}>{copy.apply}</button></form>}
            {!payload?.isAdmin && selected.status === "resolved" && <button type="button" className="support-close-ticket" onClick={closeResolved} disabled={busy}>{copy.close}</button>}
          </article> : <div className="support-welcome"><div><span>?</span><h3>{copy.assistantTitle}</h3><p>{copy.assistantText}</p><button type="button" className="primary-action" onClick={() => setCreating(true)}>{payload?.isAdmin ? copy.newInternalTicket : copy.newTicket}</button></div></div>}
        </main>
      </div>
      {error && <p className="support-toast is-error" role="alert">{error}</p>}{message && <p className="support-toast is-ok">{message}</p>}
    </section>
  </div>;
}
