"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizePortalLocale, portalCopies, portalIdentifierIsValid, type PortalLocale } from "./portal-i18n";

type Member = { userId: string; email: string; fullName: string; role: "owner" | "collaborator"; status: "active" | "invited" };
type Account = {
  id: string;
  name: string;
  companyIdentifier: string;
  country: string;
  plan: "monthly" | "lifetime";
  seatLimit: number;
  status: string;
  members: Member[];
  subscription: {
    status: string;
    amountEur: number | null;
    bankTransferReference: string;
    payerName: string;
    customerTransferReference: string;
    paidOn: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  };
  role: "owner" | "collaborator";
  canUseApplication: boolean;
  isPlatformAdmin: boolean;
  billing: { amountEur: number | null; currency: string; beneficiary: string; iban: string; bic: string };
};
type SessionData = { user: { id: string; email: string; fullName: string; role: string }; account: Account; idleTimeoutSeconds: number };
type AdminCompany = { id: string; name: string; companyIdentifier: string; status: string; subscriptionStatus: string; plan: string; members: number; amountEur: number | null; payerName: string; transferReference: string; paidOn: string; currentPeriodEnd: string };

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Service indisponible");
  return payload.result;
}

function formatStatus(status: string) {
  return ({
    lifetime: "Licence D2F à vie",
    active: "Abonnement actif",
    pending_payment: "En attente du virement",
    payment_declared: "Virement déclaré — validation D2F en cours",
    suspended: "Abonnement suspendu",
  } as Record<string, string>)[status] || status;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function AuthPortal({ onAuthenticated }: { onAuthenticated: (session: SessionData) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [locale, setLocale] = useState<PortalLocale>("fr");
  const [country, setCountry] = useState("FR");
  const copy = portalCopies[locale];
  const identifier = copy.identifiers[country] || copy.identifiers.DEFAULT;
  const connector = copy.connectors[country] || copy.connectors.DEFAULT;

  useEffect(() => {
    const preferred = normalizePortalLocale(localStorage.getItem("d2f-portal-language") || navigator.language);
    document.documentElement.lang = preferred;
    const update = window.setTimeout(() => setLocale(preferred), 0);
    return () => window.clearTimeout(update);
  }, []);

  function changeLocale(value: string) {
    const next = normalizePortalLocale(value);
    setLocale(next);
    localStorage.setItem("d2f-portal-language", next);
    document.documentElement.lang = next;
    setError("");
    setNotice("");
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      if (resetMode) {
        const result = await api("/auth/password-reset", { method: "POST", body: JSON.stringify({ email: form.get("email") }) });
        setNotice(result.message);
      } else {
        onAuthenticated(await api("/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) }));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.loginError);
    } finally { setBusy(false); }
  }

  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password !== String(form.get("passwordConfirm") || "")) {
      setError(copy.passwordMismatch); setBusy(false); return;
    }
    if (!portalIdentifierIsValid(country, form.get("companyIdentifier"))) {
      setError(copy.identifierInvalid); setBusy(false); return;
    }
    try {
      const result = await api("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          companyName: form.get("companyName"), companyIdentifier: form.get("companyIdentifier"), country: form.get("country"),
          fullName: form.get("fullName"), email: form.get("email"), password,
          acceptTerms: form.get("acceptTerms") === "on", acceptPaymentTerms: form.get("acceptPaymentTerms") === "on", website: form.get("website"), locale,
        }),
      });
      if (result.user && result.account) onAuthenticated(result);
      else {
        setNotice(result.message || copy.signupNotice);
        setMode("login");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.signupError);
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-logo-wrap"><img src="/d2f-gestion-logo.png" alt="D2F Gestion" /></div>
        <p className="eyebrow">D2F COMPLIANT</p>
        <h1>{copy.brandTitle}</h1>
        <p className="auth-lead">{copy.brandLead}</p>
        <div className="auth-benefits">
          <div><span>01</span><p><strong>{copy.isolatedTitle}</strong><br />{copy.isolatedText}</p></div>
          <div><span>02</span><p><strong>{copy.seatsTitle}</strong><br />{copy.seatsText}</p></div>
          <div><span>03</span><p><strong>{copy.sessionTitle}</strong><br />{copy.sessionText}</p></div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <label className="portal-language"><span>{copy.language}</span><select value={locale} onChange={(event) => changeLocale(event.target.value)} aria-label={copy.language}><option value="fr">FR · Français</option><option value="en">EN · English</option><option value="sr">SR · Srpski</option><option value="it">IT · Italiano</option><option value="es">ES · Español</option></select></label>
          <div className="auth-tabs" role="tablist" aria-label="Accès D2F">
            <button className={mode === "login" ? "is-active" : ""} onClick={() => { setMode("login"); setResetMode(false); setError(""); }} type="button">{copy.loginTab}</button>
            <button className={mode === "signup" ? "is-active" : ""} onClick={() => { setMode("signup"); setError(""); }} type="button">{copy.signupTab}</button>
          </div>
          {mode === "login" ? (
            <form className="auth-form" onSubmit={submitLogin}>
              <div><p className="eyebrow">{copy.secureSpace}</p><h2>{resetMode ? copy.resetTitle : copy.welcome}</h2><p>{resetMode ? copy.resetLead : copy.loginLead}</p></div>
              <label>{copy.email}<input name="email" type="email" autoComplete="email" required /></label>
              {!resetMode && <label>{copy.password}<input name="password" type="password" autoComplete="current-password" required /></label>}
              {error && <p className="form-message is-error" role="alert">{error}</p>}
              {notice && <p className="form-message is-ok">{notice}</p>}
              <button className="primary-action" disabled={busy}>{busy ? copy.wait : resetMode ? copy.sendLink : copy.login}</button>
              <button className="link-action" type="button" onClick={() => { setResetMode(!resetMode); setError(""); setNotice(""); }}>{resetMode ? copy.backToLogin : copy.forgot}</button>
            </form>
          ) : (
            <form className="auth-form signup-form" onSubmit={submitSignup}>
              <div><p className="eyebrow">{copy.monthly}</p><h2>{copy.createSpace}</h2><p>{copy.signupLead}</p></div>
              <p className="establishment-note">{copy.identifierScope}</p>
              <div className="form-grid">
                <label>{copy.companyName}<input name="companyName" autoComplete="organization" required /></label>
                <label>{copy.country}<select name="country" value={country} onChange={(event) => { setCountry(event.target.value); setError(""); }}><option value="FR">{copy.countries.FR}</option><option value="RS">{copy.countries.RS}</option><option value="IT">{copy.countries.IT}</option><option value="ES">{copy.countries.ES}</option><option value="DE">{copy.countries.DE}</option><option value="OTHER">{copy.countries.OTHER}</option></select></label>
                <label className="span-2">{identifier.label}<input name="companyIdentifier" placeholder={identifier.placeholder} inputMode={["FR", "RS"].includes(country) ? "numeric" : "text"} required /></label>
                <p className="connector-note span-2"><span>{copy.expectedConnection}</span><strong>{connector}</strong></p>
                <label>{copy.ownerName}<input name="fullName" autoComplete="name" required /></label>
                <label>{copy.workEmail}<input name="email" type="email" autoComplete="email" required /></label>
                <label>{copy.password}<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
                <label>{copy.confirmPassword}<input name="passwordConfirm" type="password" autoComplete="new-password" minLength={12} required /></label>
                <label className="honeypot" aria-hidden="true">Site web<input name="website" tabIndex={-1} autoComplete="off" /></label>
              </div>
              <label className="check-line"><input name="acceptTerms" type="checkbox" required /> <span>{copy.terms}</span></label>
              <label className="check-line"><input name="acceptPaymentTerms" type="checkbox" required /> <span>{copy.paymentTerms}</span></label>
              {error && <p className="form-message is-error" role="alert">{error}</p>}
              {notice && <p className="form-message is-ok">{notice}</p>}
              <button className="primary-action" disabled={busy}>{busy ? copy.creating : copy.createCompany}</button>
              <p className="security-note">{copy.passwordSecurity}</p>
            </form>
          )}
        </div>
        <p className="auth-copyright">© D2F Compliant d.o.o. 2026</p>
      </section>
    </main>
  );
}

function PasswordCompletion({ token, onAuthenticated }: { token: string; onAuthenticated: (session: SessionData) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) { setError("Les mots de passe ne correspondent pas"); setBusy(false); return; }
    try {
      const result = await api("/auth/complete-invite", { method: "POST", body: JSON.stringify({ accessToken: token, password: form.get("password") }) });
      history.replaceState(null, "", location.pathname);
      onAuthenticated(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Lien invalide"); }
    finally { setBusy(false); }
  }
  return <main className="auth-page single-auth"><section className="auth-panel"><form className="auth-card auth-form" onSubmit={submit}><img className="small-logo" src="/d2f-gestion-logo.png" alt="D2F Gestion" /><p className="eyebrow">ACCÈS SÉCURISÉ</p><h2>Choisir votre mot de passe</h2><p>Finalisez votre invitation ou la récupération de votre compte.</p><label>Nouveau mot de passe<input name="password" type="password" minLength={12} required /></label><label>Confirmer<input name="confirm" type="password" minLength={12} required /></label>{error && <p className="form-message is-error">{error}</p>}<button className="primary-action" disabled={busy}>{busy ? "Validation…" : "Valider et se connecter"}</button></form></section></main>;
}

function AccountDrawer({ session, onSession, onClose }: { session: SessionData; onSession: (value: SessionData) => void; onClose: () => void }) {
  const account = session.account;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adminCompanies, setAdminCompanies] = useState<AdminCompany[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await api("/auth/collaborators", { method: "POST", body: JSON.stringify({ fullName: form.get("fullName"), email: form.get("email") }) });
      onSession({ ...session, account: updated }); setMessage("Invitation envoyée."); event.currentTarget.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Invitation impossible"); }
  }

  async function declarePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await api("/auth/subscription", { method: "POST", body: JSON.stringify({ payerName: form.get("payerName"), transferReference: form.get("transferReference"), paidOn: form.get("paidOn"), confirmTransfer: form.get("confirmTransfer") === "on" }) });
      onSession({ ...session, account: updated }); setMessage("Virement déclaré. D2F procédera à sa validation.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Déclaration impossible"); }
  }

  async function loadAdmin() {
    setAdminLoading(true); setError("");
    try { setAdminCompanies(await api("/auth/admin/companies")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Chargement impossible"); }
    finally { setAdminLoading(false); }
  }

  async function setCompanyStatus(tenantId: string, status: "active" | "suspended") {
    await api("/auth/admin/companies", { method: "PATCH", body: JSON.stringify({ tenantId, status }) });
    await loadAdmin();
  }

  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="account-drawer" aria-label="Compte entreprise">
    <div className="drawer-head"><div><p className="eyebrow">COMPTE ENTREPRISE</p><h2>{account.name}</h2><p>{account.companyIdentifier}</p></div><button className="close-button" onClick={onClose} aria-label="Fermer">×</button></div>
    <section className="account-section"><div className="section-title"><h3>Abonnement</h3><span className={`status-pill status-${account.status}`}>{formatStatus(account.status)}</span></div>
      <div className="info-grid"><div><span>Formule</span><strong>{account.plan === "lifetime" ? "D2F à vie" : "Mensuelle"}</strong></div><div><span>Utilisateurs</span><strong>{account.members.length} / {account.seatLimit}</strong></div><div><span>Montant</span><strong>{account.plan === "lifetime" ? "0 €" : account.subscription.amountEur ? `${account.subscription.amountEur.toFixed(2)} € / mois` : "À confirmer par D2F"}</strong></div><div><span>{account.plan === "lifetime" ? "Paiement" : "Accès payé jusqu’au"}</span><strong>{account.plan === "lifetime" ? "Aucun" : formatDate(account.subscription.currentPeriodEnd)}</strong></div></div>
      {account.plan === "monthly" && <><div className="bank-box"><p><span>Bénéficiaire</span><strong>{account.billing.beneficiary}</strong></p><p><span>IBAN</span><strong>{account.billing.iban || "Communiqué par D2F"}</strong></p><p><span>BIC</span><strong>{account.billing.bic || "Communiqué par D2F"}</strong></p><p><span>Référence obligatoire</span><strong>{account.subscription.bankTransferReference}</strong></p></div><p className="payment-explainer"><strong>Virement bancaire manuel.</strong> Cette déclaration ne crée pas un mandat de prélèvement SEPA et n’active pas immédiatement le logiciel. D2F contrôle la réception des fonds avant d’ouvrir la période d’abonnement.</p>{account.subscription.status === "payment_declared" && <p className="form-message is-ok">Virement déclaré — D2F doit encore confirmer sa réception.</p>}{account.role === "owner" && account.subscription.status !== "payment_declared" && <form className="compact-form" onSubmit={declarePayment}><h4>{account.status === "active" ? "Déclarer le virement du mois suivant" : "Déclarer un virement réellement effectué"}</h4><label>Nom du payeur / titulaire du compte<input name="payerName" defaultValue={account.subscription.payerName} required /></label><label>Référence de votre banque<input name="transferReference" defaultValue={account.subscription.customerTransferReference} minLength={4} required /></label><label>Date d’exécution<input name="paidOn" type="date" defaultValue={account.subscription.paidOn} required /></label><label className="compact-check"><input name="confirmTransfer" type="checkbox" required /><span>Je confirme que ce virement a bien été exécuté. Cette déclaration sera vérifiée par D2F avant activation.</span></label><button className="secondary-action">Déclarer le virement</button></form>}</>}
    </section>
    <section className="account-section"><div className="section-title"><h3>Collaborateurs</h3><span>{account.members.length} siège{account.members.length > 1 ? "s" : ""} utilisé{account.members.length > 1 ? "s" : ""}</span></div><div className="member-list">{account.members.map((member) => <div key={member.userId}><span className="member-avatar">{(member.fullName || member.email).slice(0, 1).toUpperCase()}</span><p><strong>{member.fullName || member.email}</strong><small>{member.email} · {member.role === "owner" ? "Propriétaire" : member.status === "invited" ? "Invitation envoyée" : "Collaborateur"}</small></p></div>)}</div>
      {account.role === "owner" && account.canUseApplication && account.members.length < account.seatLimit && <form className="compact-form" onSubmit={invite}><h4>Inviter le deuxième utilisateur</h4><label>Nom<input name="fullName" required /></label><label>E-mail professionnel<input name="email" type="email" required /></label><button className="secondary-action">Envoyer l’invitation</button></form>}{!account.canUseApplication && <p className="locked-feature">L’invitation du collaborateur sera disponible après activation du paiement.</p>}
    </section>
    {account.isPlatformAdmin && <section className="account-section admin-section"><div className="section-title"><h3>Administration D2F</h3><button className="mini-action" onClick={loadAdmin}>{adminLoading ? "Chargement…" : "Actualiser"}</button></div>{adminCompanies.map((company) => <div className="admin-company" key={company.id}><div><strong>{company.name}</strong><small>{company.companyIdentifier} · {formatStatus(company.status)} · {company.members}/2 utilisateurs</small>{company.currentPeriodEnd && <small>Accès payé jusqu’au {formatDate(company.currentPeriodEnd)}</small>}{company.transferReference && <small>Virement : {company.transferReference} · {company.paidOn || "date non indiquée"} · {formatStatus(company.subscriptionStatus)}</small>}</div>{company.plan !== "lifetime" && <div>{company.subscriptionStatus === "payment_declared" ? <button onClick={() => setCompanyStatus(company.id, "active")}>Confirmer reçu + 1 mois</button> : <span className="locked-feature">Déclaration requise</span>}<button onClick={() => setCompanyStatus(company.id, "suspended")}>Suspendre</button></div>}</div>)}</section>}
    {error && <p className="form-message is-error">{error}</p>}{message && <p className="form-message is-ok">{message}</p>}
  </aside></div>;
}

function LockedSubscription({ session, onOpen }: { session: SessionData; onOpen: () => void }) {
  return <main className="locked-page"><img src="/d2f-gestion-logo.png" alt="D2F Gestion" /><p className="eyebrow">PORTAIL DE RÈGLEMENT</p><h1>{formatStatus(session.account.status)}</h1><p>Votre connexion est confirmée, mais l’application reste verrouillée jusqu’à réception et validation du règlement par D2F Compliant.</p><ol className="activation-steps"><li><strong>Entreprise créée</strong>Adresse e-mail et identité confirmées.</li><li><strong>Paiement déclaré</strong>Le client renseigne un virement réellement exécuté.</li><li><strong>Réception validée</strong>D2F ouvre alors un mois d’accès.</li></ol><div className="reference-card"><span>Référence à indiquer</span><strong>{session.account.subscription.bankTransferReference || "D2F vous communiquera la référence"}</strong></div><button className="primary-action" onClick={onOpen}>Voir les coordonnées et déclarer le virement</button></main>;
}

export default function SessionShell() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [warning, setWarning] = useState(0);
  const [completionToken, setCompletionToken] = useState("");
  const lastActivity = useRef(0);

  const logout = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    setSession(null); setDrawer(false); setWarning(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = window.setTimeout(() => {
      const parameters = new URLSearchParams(location.hash.replace(/^#/, ""));
      const accessToken = parameters.get("access_token") || "";
      const type = parameters.get("type") || "";
      if (accessToken && ["invite", "recovery"].includes(type)) {
        if (!cancelled) { setCompletionToken(accessToken); setLoading(false); }
        return;
      }
      if (accessToken) {
        api("/auth/token-login", { method: "POST", body: JSON.stringify({ accessToken }) }).then((result) => {
          history.replaceState(null, "", location.pathname);
          if (!cancelled) { setSession(result); setLoading(false); }
        }).catch(() => {
          history.replaceState(null, "", location.pathname);
          if (!cancelled) setLoading(false);
        });
        return;
      }
      api("/auth/session").then((result) => { if (!cancelled) setSession(result); }).catch(() => {
        if (!cancelled) setSession(null);
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(bootstrap); };
  }, []);

  useEffect(() => {
    if (!session) return;
    lastActivity.current = Date.now();
    const mark = () => { lastActivity.current = Date.now(); setWarning(0); };
    const message = (event: MessageEvent) => { if (event.data?.type === "d2f-activity") mark(); };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((name) => window.addEventListener(name, mark, { passive: true }));
    window.addEventListener("message", message);
    const interval = window.setInterval(async () => {
      const remaining = Math.ceil((session.idleTimeoutSeconds * 1000 - (Date.now() - lastActivity.current)) / 1000);
      if (remaining <= 0) { await logout(); return; }
      setWarning(remaining <= 60 ? remaining : 0);
      if (remaining > session.idleTimeoutSeconds - 20 && Date.now() - lastActivity.current < 20000) {
        api("/auth/session", { method: "POST", body: "{}" }).catch(() => logout());
      }
    }, 5000);
    return () => { events.forEach((name) => window.removeEventListener(name, mark)); window.removeEventListener("message", message); clearInterval(interval); };
  }, [session, logout]);

  const initials = useMemo(() => session?.user.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "D2F", [session]);

  if (loading) return <main className="session-loading"><img src="/d2f-gestion-logo.png" alt="D2F Gestion" /><span>Ouverture sécurisée…</span></main>;
  if (completionToken) return <PasswordCompletion token={completionToken} onAuthenticated={(value) => { setCompletionToken(""); setSession(value); }} />;
  if (!session) return <AuthPortal onAuthenticated={setSession} />;

  return <main className="app-session-shell">
    <header className="account-bar"><div className="account-brand"><img src="/d2f-gestion-logo.png" alt="" /><strong>D2F Gestion</strong><span>{session.account.name}</span></div><div className="account-actions">{warning > 0 && <span className="idle-warning">Déconnexion dans {warning} s</span>}<button className="account-button" onClick={() => setDrawer(true)}><span>{initials}</span><span><strong>{session.user.fullName}</strong><small>{formatStatus(session.account.status)}</small></span></button><button className="logout-button" onClick={logout}>Déconnexion</button></div></header>
    {session.account.canUseApplication ? <iframe className="web-app-frame" src="/erp/index.html?v=20260716-documents-v9" title="D2F Gestion" allow="clipboard-read; clipboard-write" /> : <LockedSubscription session={session} onOpen={() => setDrawer(true)} />}
    {drawer && <AccountDrawer session={session} onSession={setSession} onClose={() => setDrawer(false)} />}
  </main>;
}
