"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { countryPackCopies } from "./country-pack-i18n";
import type { SupportLanguage } from "./support-i18n";

type Evidence = { id: string; evidence_type: string; source_uri: string; authority: string; effective_date: string; sha256: string; verification_status: string; metadata: { title?: string; sourceId?: string } };
type Review = { id: string; review_type: string; reviewer: string; decision: string; notes: string; evidence_snapshot_hash: string; decided_at: string };
type CountryPack = {
  id: string; packId: string; country: string; version: string; status: string; regulatoryOwner: string; technicalOwner: string; manifestHash: string;
  effectiveFrom: string; effectiveTo: string; publishedAt: string; evidence: Evidence[]; reviews: Review[]; latestReviews: Record<string, Review | null>;
  manifest: { module: string; currency: string; languages: string[]; unresolvedDecisions: string[]; automaticPublication?: boolean };
  readiness: { ownersComplete: boolean; evidenceVerified: boolean; approvalsComplete: boolean; manualPublication: boolean; publishable: boolean };
};
type Workspace = { packs: CountryPack[] };

async function packApi(body?: Record<string, unknown>) {
  const response = await fetch("/auth/admin/country-packs", { method: body ? "POST" : "GET", credentials: "same-origin", headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Country Packs indisponibles");
  return payload.result;
}
function date(value: string) { return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function countryFromTicket(value: string) { return (value.match(/Country Pack\s+([A-Z]{2})/i)?.[1] || "").toUpperCase(); }

export default function CountryPackCenter({ language, ticketId = "", ticketSubject = "", onPublished }: { language: SupportLanguage; ticketId?: string; ticketSubject?: string; onPublished: (ticketClosed: boolean) => void }) {
  const copy = countryPackCopies[language];
  const reviewLabel = (kind: string) => kind === "regulatory" ? copy.regulatory : kind === "technical" ? copy.technical : copy.security;
  const preferredCountry = countryFromTicket(ticketSubject);
  const [workspace, setWorkspace] = useState<Workspace>({ packs: [] });
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const selected = useMemo(() => workspace.packs.find((pack) => pack.id === selectedId) || workspace.packs[0] || null, [workspace, selectedId]);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await packApi() as Workspace; setWorkspace(result);
      setSelectedId((current) => current && result.packs.some((pack) => pack.id === current) ? current : result.packs.find((pack) => pack.country === preferredCountry)?.id || result.packs[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Chargement impossible"); }
    finally { setBusy(false); }
  }, [preferredCountry]);
  useEffect(() => { void load(); }, [load]);

  async function action(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await packApi(body);
      const nextWorkspace = (result.workspace || result) as Workspace; setWorkspace(nextWorkspace); setMessage(success);
      if (body.action === "publish") onPublished(Boolean(ticketId && selected && preferredCountry === selected.country));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Action impossible"); }
    finally { setBusy(false); }
  }
  function owners(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    void action({ action: "owners", packVersionId: selected.id, regulatoryOwner: form.get("regulatoryOwner"), technicalOwner: form.get("technicalOwner") }, "Responsables enregistrés.");
  }
  function review(event: FormEvent<HTMLFormElement>, reviewType: string) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    void action({ action: "review", packVersionId: selected.id, reviewType, decision: form.get("decision"), notes: form.get("notes") }, `Validation ${reviewLabel(reviewType).toLowerCase()} enregistrée.`);
  }

  return <section className="country-pack-center" aria-label="Qualification des Country Packs">
    <aside className="country-pack-list">
      <header><div><p className="eyebrow">{copy.governance}</p><h3>{copy.title}</h3></div><button type="button" onClick={load} disabled={busy}>↻</button></header>
      {workspace.packs.map((pack) => <button type="button" key={pack.id} className={pack.id === selected?.id ? "is-selected" : ""} onClick={() => setSelectedId(pack.id)}>
        <span className="country-pack-code">{pack.country}</span><span><strong>{pack.packId}</strong><small>{copy.version} {pack.version}</small></span><em className={`pack-status status-${pack.status}`}>{pack.status}</em>
      </button>)}
      {!busy && !workspace.packs.length && <p className="support-empty">{copy.noPacks}</p>}
    </aside>
    <main className="country-pack-detail">
      {selected ? <>
        <header className="country-pack-hero"><div><p className="eyebrow">{selected.country} · {selected.manifest.module || "expenses"}</p><h3>{selected.packId}</h3><p>Version {selected.version} · applicable depuis {date(selected.effectiveFrom)}</p></div><span className={`pack-status status-${selected.status}`}>{selected.status}</span></header>
        {ticketId && preferredCountry === selected.country && <div className="country-pack-ticket"><strong>{copy.linkedTicket} : {ticketSubject}</strong><span>{copy.closeAfterPublish}</span></div>}
        <section className="country-pack-readiness">
          <div className={selected.readiness.ownersComplete ? "is-ok" : ""}><span>1</span><strong>{copy.owners}</strong><small>{selected.readiness.ownersComplete ? copy.completed : copy.toComplete}</small></div>
          <div className={selected.readiness.evidenceVerified ? "is-ok" : ""}><span>2</span><strong>{copy.evidence}</strong><small>{selected.evidence.filter((item) => item.verification_status === "verified").length}/{selected.evidence.length} {copy.verified}</small></div>
          <div className={selected.readiness.approvalsComplete ? "is-ok" : ""}><span>3</span><strong>{copy.approvals}</strong><small>{Object.values(selected.latestReviews).filter((item) => item?.decision === "approved").length}/3 {copy.approved}</small></div>
          <div className={selected.status === "published" ? "is-ok" : ""}><span>4</span><strong>{copy.publication}</strong><small>{selected.status === "published" ? date(selected.publishedAt) : copy.manual}</small></div>
        </section>
        <form className="country-pack-owners" onSubmit={owners}><h4>{copy.versionOwners}</h4><label>{copy.regulatoryOwner}<input name="regulatoryOwner" defaultValue={selected.regulatoryOwner} required disabled={selected.status === "published"} /></label><label>{copy.technicalOwner}<input name="technicalOwner" defaultValue={selected.technicalOwner} required disabled={selected.status === "published"} /></label><button className="secondary-action" disabled={busy || selected.status === "published"}>{copy.save}</button></form>
        <section className="country-pack-section"><header><div><h4>{copy.regulatoryEvidence}</h4><p>{copy.evidenceHint}</p></div></header><div className="country-pack-evidence">
          {selected.evidence.map((item) => <article key={item.id}><div><span className={`evidence-dot status-${item.verification_status}`} /><div><strong>{item.metadata?.title || item.evidence_type}</strong><small>{item.authority} · {item.effective_date || copy.dateToConfirm}</small></div></div><a href={item.source_uri} target="_blank" rel="noreferrer">{copy.openSource}</a><code title={item.sha256}>{item.sha256.slice(0, 14)}…</code><div className="evidence-actions"><button type="button" className={item.verification_status === "verified" ? "is-active" : ""} disabled={busy || selected.status === "published"} onClick={() => action({ action: "evidence", packVersionId: selected.id, evidenceId: item.id, status: "verified" }, "Preuve vérifiée.")}>{copy.verifiedAction}</button><button type="button" className={item.verification_status === "rejected" ? "is-rejected" : ""} disabled={busy || selected.status === "published"} onClick={() => action({ action: "evidence", packVersionId: selected.id, evidenceId: item.id, status: "rejected" }, "Preuve rejetée.")}>{copy.reject}</button></div></article>)}
        </div></section>
        <section className="country-pack-section"><header><div><h4>{copy.humanApprovals}</h4><p>{copy.humanHint}</p></div></header><div className="country-pack-reviews">
          {(["regulatory", "technical", "security"] as const).map((kind) => { const current = selected.latestReviews[kind]; return <form key={kind} onSubmit={(event) => review(event, kind)}><header><span>{reviewLabel(kind)}</span><em className={`review-decision decision-${current?.decision || "pending"}`}>{current?.decision || "pending"}</em></header>{current && <p><strong>{current.reviewer}</strong><small>{date(current.decided_at)}</small><span>{current.notes}</span></p>}<label>{copy.decision}<select name="decision" defaultValue="approved" disabled={selected.status === "published"}><option value="approved">{copy.approve}</option><option value="changes_requested">{copy.changes}</option><option value="rejected">{copy.reject}</option></select></label><label>{copy.validationNote}<textarea name="notes" minLength={10} rows={3} required placeholder={copy.notePlaceholder} disabled={selected.status === "published"} /></label><button className="secondary-action" disabled={busy || !selected.readiness.evidenceVerified || selected.status === "published"}>{copy.recordDecision}</button></form>; })}
        </div></section>
        {selected.manifest.unresolvedDecisions?.length > 0 && <section className="country-pack-open-points"><strong>{copy.openPoints}</strong>{selected.manifest.unresolvedDecisions.map((item) => <p key={item}>• {item}</p>)}</section>}
        <footer className="country-pack-publish"><div><strong>{copy.explicitPublication}</strong><span>{selected.manifest.module === "expenses" ? copy.publishHint : copy.publishHintPlatform}</span><code>{selected.manifestHash}</code></div><button type="button" className="primary-action" disabled={busy || !selected.readiness.publishable} onClick={() => action({ action: "publish", packVersionId: selected.id, ticketId: preferredCountry === selected.country ? ticketId : "" }, `Country Pack ${selected.country} ${selected.version} publié.`)}>{selected.status === "published" ? copy.published : copy.publish}</button></footer>
      </> : <div className="support-welcome"><div><span>✓</span><h3>{copy.title}</h3><p>{copy.selectPack}</p></div></div>}
    </main>
    {error && <p className="support-toast is-error" role="alert">{error}</p>}{message && <p className="support-toast is-ok">{message}</p>}
  </section>;
}
