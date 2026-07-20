"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizePortalLocale, portalCopies, portalIdentifierIsValid, type PortalLocale } from "./portal-i18n";
import SupportCenter from "./support-center";
import { regulatoryCountries, regulatoryNews, regulatoryWatchUi, type RegulatoryCountry } from "./regulatory-watch";

import { D2F_PLATFORM_VERSION_LABEL } from "../lib/platform-version";

type Member = { userId: string; email: string; fullName: string; role: "owner" | "collaborator"; status: "active" | "invited" };
type Billing = { amountEur: number | null; annualAmountEur: number | null; currency: string; bankName: string; beneficiary: string; iban: string; bic: string; bankInformation: string; sepaCreditTransfer: boolean };
type SignupPayment = { reference: string; billing: Billing };
type IdentifierCheck = { valid: boolean; checksumValid?: boolean; registryStatus: string; legalName: string; address: string; active: boolean | null; reason?: string };
type Account = {
  id: string;
  name: string;
  companyIdentifier: string;
  country: string;
  plan: "monthly" | "lifetime";
  seatLimit: number;
  status: string;
  members: Member[];
  billingProfile: BillingProfile;
  subscription: {
    status: string;
    amountEur: number | null;
    bankTransferReference: string;
    payerName: string;
    customerTransferReference: string;
    paidOn: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    billingTerm: "monthly" | "annual" | "lifetime";
  };
  role: "owner" | "collaborator";
  canUseApplication: boolean;
  isTrial: boolean;
  trialEndsAt: string;
  trialRequested: boolean;
  isPlatformAdmin: boolean;
  billing: Billing;
};
type SessionData = { user: { id: string; email: string; fullName: string; role: string }; account: Account; idleTimeoutSeconds: number };
type BillingProfile = { legalName: string; legalIdentifier: string; vatId: string; street: string; street2: string; postalCode: string; city: string; country: string; email: string };
type SubscriptionInvoice = { id: string; number: string; date: string; amount: number; periodStart: string; periodEnd: string };
type AdminCompany = { id: string; name: string; companyIdentifier: string; status: string; subscriptionStatus: string; plan: string; billingTerm: "monthly" | "annual" | "lifetime"; trialRequested: boolean; members: number; amountEur: number | null; payerName: string; transferReference: string; paidOn: string; currentPeriodEnd: string; isTrial: boolean; trialEndsAt: string; canReactivate: boolean; reactivationKind: "trial" | "paid"; createdAt: string };

const billingProfileCopy: Record<PortalLocale, { title: string; lead: string; street: string; street2: string; postal: string; city: string; vat: string; billingEmail: string }> = {
  fr: { title: "Coordonnées de facturation", lead: "Elles seront reprises sur les factures D2F.", street: "Adresse", street2: "Complément d’adresse (optionnel)", postal: "Code postal", city: "Ville", vat: "Numéro de TVA (optionnel)", billingEmail: "E-mail de facturation" },
  en: { title: "Billing details", lead: "They will appear on D2F invoices.", street: "Address", street2: "Address line 2 (optional)", postal: "Postcode", city: "City", vat: "VAT number (optional)", billingEmail: "Billing email" },
  sr: { title: "Podaci za fakturisanje", lead: "Biće prikazani na D2F fakturama.", street: "Adresa", street2: "Dodatak adrese (opciono)", postal: "Poštanski broj", city: "Grad", vat: "PDV broj (opciono)", billingEmail: "E-adresa za fakture" },
  it: { title: "Dati di fatturazione", lead: "Saranno riportati sulle fatture D2F.", street: "Indirizzo", street2: "Seconda riga (facoltativa)", postal: "CAP", city: "Città", vat: "Partita IVA (facoltativa)", billingEmail: "E-mail di fatturazione" },
  es: { title: "Datos de facturación", lead: "Se incluirán en las facturas D2F.", street: "Dirección", street2: "Línea 2 (opcional)", postal: "Código postal", city: "Ciudad", vat: "N.º de IVA (opcional)", billingEmail: "Correo de facturación" },
};

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

function accountStatusLabel(account: Account) {
  return account.isTrial && account.trialEndsAt
    ? `Essai gratuit jusqu’au ${formatDate(account.trialEndsAt)}`
    : formatStatus(account.status);
}

function formatPortalPrice(amount: number, locale: PortalLocale) {
  const locales: Record<PortalLocale, string> = { fr: "fr-FR", en: "en-GB", sr: "sr-Latn-RS", it: "it-IT", es: "es-ES" };
  return new Intl.NumberFormat(locales[locale], {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function AuthPortal({ onAuthenticated, monthlyPriceEur, annualPriceEur }: { onAuthenticated: (session: SessionData) => void; monthlyPriceEur: number; annualPriceEur: number }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [locale, setLocale] = useState<PortalLocale>("fr");
  const [country, setCountry] = useState<RegulatoryCountry>("FR");
  const [newsIndex, setNewsIndex] = useState(0);
  const [signupPayment, setSignupPayment] = useState<SignupPayment | null>(null);
  const [billingTerm, setBillingTerm] = useState<"monthly" | "annual">("monthly");
  const [identifierValue, setIdentifierValue] = useState("");
  const [companyNameValue, setCompanyNameValue] = useState("");
  const [billingStreet, setBillingStreet] = useState("");
  const [identifierCheck, setIdentifierCheck] = useState<IdentifierCheck | null>(null);
  const [identifierChecking, setIdentifierChecking] = useState(false);
  const copy = portalCopies[locale];
  const identifier = copy.identifiers[country] || copy.identifiers.DEFAULT;
  const connector = copy.connectors[country] || copy.connectors.DEFAULT;
  const regulatoryUi = regulatoryWatchUi[locale];
  const billingCopy = billingProfileCopy[locale];
  const countryNews = regulatoryNews[country];
  const newsItem = countryNews[newsIndex % countryNews.length];

  useEffect(() => {
    const preferred = normalizePortalLocale(localStorage.getItem("d2f-portal-language") || navigator.language);
    document.documentElement.lang = preferred;
    const update = window.setTimeout(() => setLocale(preferred), 0);
    return () => window.clearTimeout(update);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rotation = window.setInterval(() => setNewsIndex((index) => (index + 1) % regulatoryNews[country].length), 9000);
    return () => window.clearInterval(rotation);
  }, [country]);

  function selectCountry(value: string) {
    if (!regulatoryCountries.includes(value as RegulatoryCountry)) return;
    setCountry(value as RegulatoryCountry);
    setNewsIndex(0);
    setError("");
    setIdentifierValue("");
    setIdentifierCheck(null);
  }

  function changeLocale(value: string) {
    const next = normalizePortalLocale(value);
    setLocale(next);
    localStorage.setItem("d2f-portal-language", next);
    document.documentElement.lang = next;
    setError("");
    setNotice("");
  }

  async function checkIdentifier(value: unknown, showError = true) {
    const candidate = String(value || "").trim();
    setIdentifierCheck(null);
    if (!portalIdentifierIsValid(country, candidate)) {
      if (showError) setError(copy.identifierInvalid);
      return null;
    }
    setIdentifierChecking(true);
    if (showError) setError("");
    try {
      const result = await api("/auth/validate-identifier", { method: "POST", body: JSON.stringify({ country, identifier: candidate }) }) as IdentifierCheck;
      setIdentifierCheck(result);
      if (result.valid && result.legalName && !companyNameValue.trim()) setCompanyNameValue(result.legalName);
      if (result.valid && result.address && !billingStreet.trim()) setBillingStreet(result.address);
      if (!result.valid && showError) setError(result.reason === "closed_establishment" ? copy.identifierClosed : copy.identifierInvalid);
      return result;
    } catch {
      if (showError) setError(copy.identifierInvalid);
      return null;
    } finally {
      setIdentifierChecking(false);
    }
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
    if (!portalIdentifierIsValid(country, identifierValue)) {
      setError(copy.identifierInvalid); setBusy(false); return;
    }
    const verifiedIdentifier = await checkIdentifier(identifierValue);
    if (!verifiedIdentifier?.valid) { setBusy(false); return; }
    try {
      const result = await api("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          companyName: companyNameValue, companyIdentifier: identifierValue, country: form.get("country"),
          fullName: form.get("fullName"), email: form.get("email"), password,
          billingStreet: form.get("billingStreet"), billingStreet2: form.get("billingStreet2"), billingPostalCode: form.get("billingPostalCode"), billingCity: form.get("billingCity"), billingVatId: form.get("billingVatId"), billingEmail: form.get("email"),
          acceptTerms: form.get("acceptTerms") === "on", acceptPaymentTerms: form.get("acceptPaymentTerms") === "on", website: form.get("website"), locale, billingTerm,
        }),
      });
      if (result.user && result.account) onAuthenticated(result);
      else {
        setSignupPayment(result.billing && result.bankTransferReference ? { billing: result.billing, reference: result.bankTransferReference } : null);
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
        <div className="auth-logo-wrap"><img src="/d2f-platform-logo.png" alt="D2F Platform" /></div>
        <p className="eyebrow">D2F COMPLIANT</p>
        <h1>{copy.brandTitle}</h1>
        <p className="auth-lead">{copy.brandLead}</p>
        <section className="auth-regulatory" aria-labelledby="regulatory-watch-title">
          <div className="regulatory-heading">
            <div><p className="eyebrow">{regulatoryUi.eyebrow}</p><h2 id="regulatory-watch-title">{regulatoryUi.title}</h2></div>
            <p>{regulatoryUi.intro}</p>
          </div>
          <div className="regulatory-countries" role="group" aria-label={regulatoryUi.chooseCountry}>
            {regulatoryCountries.map((countryCode) => <button key={countryCode} type="button" className={country === countryCode ? "is-active" : ""} aria-pressed={country === countryCode} onClick={() => selectCountry(countryCode)}><strong>{countryCode}</strong><span>{copy.countries[countryCode]}</span></button>)}
          </div>
          <article className="regulatory-story" aria-live="polite">
            <div className="regulatory-story__meta"><span>{newsItem.label[locale]}</span><time>{typeof newsItem.date === "string" ? newsItem.date : newsItem.date[locale]}</time></div>
            <h3>{newsItem.text[locale].title}</h3>
            <p>{newsItem.text[locale].summary}</p>
            <footer>
              <a href={newsItem.sourceUrl} target="_blank" rel="noreferrer"><span>{regulatoryUi.officialSource}</span><small>{newsItem.sourceName}</small></a>
              <div className="regulatory-controls">
                <button type="button" aria-label={regulatoryUi.previous} title={regulatoryUi.previous} onClick={() => setNewsIndex((index) => (index - 1 + countryNews.length) % countryNews.length)}>←</button>
                <span>{newsIndex % countryNews.length + 1}/{countryNews.length}</span>
                <button type="button" aria-label={regulatoryUi.next} title={regulatoryUi.next} onClick={() => setNewsIndex((index) => (index + 1) % countryNews.length)}>→</button>
              </div>
            </footer>
          </article>
          <p className="regulatory-verified">{regulatoryUi.verified}</p>
        </section>
        <div className="auth-benefits">
          <div><span>01</span><p><strong>{copy.isolatedTitle}</strong><br />{copy.isolatedText}</p></div>
          <div><span>02</span><p><strong>{copy.seatsTitle}</strong><br />{copy.seatsText}</p></div>
          <div><span>03</span><p><strong>{copy.sessionTitle}</strong><br />{copy.sessionText}</p></div>
        </div>
        <div className="auth-discover">
          <span>{copy.discoverTitle}</span>
          <a href="https://www.linkedin.com/in/d2fcompliant11030/recent-activity/all/" target="_blank" rel="noreferrer">{copy.linkedinPosts} ↗</a>
          <a href="https://d2fcompliant.com" target="_blank" rel="noreferrer">{copy.d2fWebsite} ↗</a>
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
              {signupPayment && <section className="signup-payment-card" aria-label={copy.paymentInstructions}>
                <div><p className="eyebrow">{copy.requestRecorded}</p><h3>{copy.paymentInstructions}</h3><p>{copy.paymentAfterConfirmation}</p></div>
                <dl>
                  <div><dt>{copy.bankName}</dt><dd>{signupPayment.billing.bankName}</dd></div>
                  <div><dt>{copy.beneficiary}</dt><dd>{signupPayment.billing.beneficiary}</dd></div>
                  <div><dt>IBAN</dt><dd>{signupPayment.billing.iban}</dd></div>
                  <div><dt>BIC / SWIFT</dt><dd>{signupPayment.billing.bic}</dd></div>
                  <div><dt>{copy.mandatoryReference}</dt><dd>{signupPayment.reference}</dd></div>
                </dl>
                <p className="sepa-note"><strong>SEPA SCT</strong> · {copy.sepaTransfer}</p>
              </section>}
              <button className="primary-action" disabled={busy}>{busy ? copy.wait : resetMode ? copy.sendLink : copy.login}</button>
              <button className="link-action" type="button" onClick={() => { setResetMode(!resetMode); setError(""); setNotice(""); }}>{resetMode ? copy.backToLogin : copy.forgot}</button>
            </form>
          ) : (
            <form className="auth-form signup-form" onSubmit={submitSignup}>
              <div><p className="eyebrow">{copy.monthly}</p><h2>{copy.createSpace}</h2><p>{copy.signupLead}</p></div>
              <section className="pricing-card" aria-label={copy.pricingPlan}>
                <div className="pricing-card__head">
                  <div><span>{copy.pricingPlan}</span></div>
                  <span className="pricing-card__tag">{copy.pricingCommitment}</span>
                </div>
                <div className="pricing-offers" role="radiogroup" aria-label={copy.pricingPlan}>
                  <label className={`pricing-offer ${billingTerm === "monthly" ? "is-selected" : ""}`}>
                    <input type="radio" name="billingTermChoice" value="monthly" checked={billingTerm === "monthly"} onChange={() => setBillingTerm("monthly")} />
                    <span><strong>{copy.pricingMonthlyLabel}</strong><small>{copy.pricingMonthlyNote}</small></span>
                    <p><strong>{formatPortalPrice(monthlyPriceEur, locale)}</strong><small>{copy.pricingPeriod}</small></p>
                  </label>
                  <label className={`pricing-offer ${billingTerm === "annual" ? "is-selected" : ""}`}>
                    <input type="radio" name="billingTermChoice" value="annual" checked={billingTerm === "annual"} onChange={() => setBillingTerm("annual")} />
                    <span><strong>{copy.pricingAnnualLabel}</strong><small>{copy.pricingAnnualNote}</small></span>
                    <p><strong>{formatPortalPrice(annualPriceEur, locale)}</strong><small>{copy.pricingAnnualPeriod}</small></p>
                    <em>{copy.pricingAnnualSaving}</em>
                  </label>
                </div>
                <ul>
                  <li>{copy.pricingScope}</li>
                  <li>{copy.pricingSeats}</li>
                  <li>{copy.pricingIncluded}</li>
                </ul>
                <p className="pricing-card__trial"><strong>{copy.trialTitle}</strong> {copy.trialText}</p>
                <p className="pricing-card__renewal">{copy.pricingNoAutoRenewal}</p>
                <p className="pricing-card__tax">{copy.pricingTax}</p>
                <p className="pricing-card__external">{copy.pricingExternal}</p>
              </section>
              <p className="establishment-note">{copy.identifierScope}</p>
              <div className="form-grid">
                <label>{copy.companyName}<input name="companyName" value={companyNameValue} onChange={(event) => setCompanyNameValue(event.target.value)} autoComplete="organization" required /></label>
                <label>{copy.country}<select name="country" value={country} onChange={(event) => selectCountry(event.target.value)}>{regulatoryCountries.map((countryCode) => <option key={countryCode} value={countryCode}>{copy.countries[countryCode]}</option>)}</select></label>
                <label className="span-2 identifier-field">{identifier.label}<span><input name="companyIdentifier" value={identifierValue} onChange={(event) => { setIdentifierValue(event.target.value); setIdentifierCheck(null); setError(""); }} onBlur={() => { if (portalIdentifierIsValid(country, identifierValue)) void checkIdentifier(identifierValue, false); }} placeholder={identifier.placeholder} inputMode={["FR", "RS"].includes(country) ? "numeric" : "text"} required /><button type="button" onClick={() => void checkIdentifier(identifierValue)} disabled={identifierChecking}>{identifierChecking ? "…" : copy.identifierCheckPrompt}</button></span></label>
                {identifierChecking && <p className="identifier-validation is-checking span-2">{copy.identifierChecking}</p>}
                {!identifierChecking && identifierCheck?.valid && <p className={"identifier-validation is-valid span-2 " + (["unavailable", "not_found"].includes(identifierCheck.registryStatus) ? "is-warning" : "")}><strong>✓ {copy.identifierVerified}</strong>{identifierCheck.legalName && <span>{identifierCheck.legalName}{identifierCheck.address ? ` · ${identifierCheck.address}` : ""}</span>}{["unavailable", "not_found"].includes(identifierCheck.registryStatus) && <span>{copy.identifierRegistryUnavailable}</span>}</p>}
                {!identifierChecking && identifierCheck && !identifierCheck.valid && <p className="identifier-validation is-error span-2">{identifierCheck.reason === "closed_establishment" ? copy.identifierClosed : copy.identifierInvalid}</p>}
                <p className="connector-note span-2"><span>{copy.expectedConnection}</span><strong>{connector}</strong></p>
                <div className="span-2 billing-profile-heading"><strong>{billingCopy.title}</strong><span>{billingCopy.lead}</span></div>
                <label className="span-2">{billingCopy.street}<input name="billingStreet" value={billingStreet} onChange={(event) => setBillingStreet(event.target.value)} autoComplete="street-address" required /></label>
                <label className="span-2">{billingCopy.street2}<input name="billingStreet2" autoComplete="address-line2" /></label>
                <label>{billingCopy.postal}<input name="billingPostalCode" autoComplete="postal-code" required /></label>
                <label>{billingCopy.city}<input name="billingCity" autoComplete="address-level2" required /></label>
                <label className="span-2">{billingCopy.vat}<input name="billingVatId" autoComplete="off" /></label>
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
  return <main className="auth-page single-auth"><section className="auth-panel"><form className="auth-card auth-form" onSubmit={submit}><img className="small-logo" src="/d2f-platform-logo.png" alt="D2F Platform" /><p className="eyebrow">ACCÈS SÉCURISÉ</p><h2>Choisir votre mot de passe</h2><p>Finalisez votre invitation ou la récupération de votre compte.</p><label>Nouveau mot de passe<input name="password" type="password" minLength={12} required /></label><label>Confirmer<input name="confirm" type="password" minLength={12} required /></label>{error && <p className="form-message is-error">{error}</p>}<button className="primary-action" disabled={busy}>{busy ? "Validation…" : "Valider et se connecter"}</button></form></section></main>;
}

function AccountDrawer({ session, onSession, onClose, onPendingCount }: { session: SessionData; onSession: (value: SessionData) => void; onClose: () => void; onPendingCount: (count: number) => void }) {
  const account = session.account;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adminCompanies, setAdminCompanies] = useState<AdminCompany[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [subscriptionInvoices, setSubscriptionInvoices] = useState<SubscriptionInvoice[]>([]);

  useEffect(() => {
    if (account.isPlatformAdmin) void loadAdmin();
    if (account.plan !== "lifetime") void loadSubscriptionInvoices();
  }, [account.id, account.isPlatformAdmin, account.plan]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await api("/auth/collaborators", { method: "POST", body: JSON.stringify({ fullName: form.get("fullName"), email: form.get("email") }) });
      onSession({ ...session, account: updated }); setMessage("Invitation envoyée."); event.currentTarget.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Invitation impossible"); }
  }

  async function requestTrial() {
    setError(""); setMessage("");
    try {
      const updated = await api("/auth/subscription", { method: "POST", body: JSON.stringify({ action: "request_trial" }) });
      onSession({ ...session, account: updated });
      setMessage("Demande d’essai envoyée à D2F. Vous serez informé dès son activation.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Demande impossible"); }
  }

  async function chooseOffer(billingTerm: "monthly" | "annual") {
    setError(""); setMessage("");
    try {
      const updated = await api("/auth/subscription", { method: "POST", body: JSON.stringify({ action: "select_offer", billingTerm }) });
      onSession({ ...session, account: updated });
      setMessage(billingTerm === "annual" ? "Formule annuelle sélectionnée." : "Formule mensuelle sélectionnée.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Modification impossible"); }
  }

  async function saveBillingProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await api("/auth/subscription", { method: "POST", body: JSON.stringify({
        action: "update_billing_profile",
        legalName: form.get("legalName"), vatId: form.get("vatId"), street: form.get("street"), street2: form.get("street2"), postalCode: form.get("postalCode"), city: form.get("city"), email: form.get("billingEmail"),
      }) });
      onSession({ ...session, account: updated });
      setMessage("Coordonnées de facturation enregistrées.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Enregistrement impossible"); }
  }

  async function loadSubscriptionInvoices() {
    try { setSubscriptionInvoices(await api("/auth/subscription/invoice") as SubscriptionInvoice[]); }
    catch { setSubscriptionInvoices([]); }
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
    try {
      const companies = await api("/auth/admin/companies") as AdminCompany[];
      setAdminCompanies(companies);
      onPendingCount(companies.filter((company) => company.plan !== "lifetime" && ["pending_payment", "payment_declared"].includes(company.subscriptionStatus)).length);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Chargement impossible"); }
    finally { setAdminLoading(false); }
  }

  async function setCompanyStatus(tenantId: string, status: "active" | "suspended" | "trial") {
    setError(""); setMessage("");
    try {
      const result = await api("/auth/admin/companies", { method: "PATCH", body: JSON.stringify({ tenantId, status }) });
      setMessage(result.invoice?.number
        ? `Paiement validé : facture ${result.invoice.number} créée et encaissement enregistré automatiquement.`
        : status === "active" ? "Accès réactivé jusqu’à la date déjà accordée." : status === "trial" ? "Essai activé." : "Abonnement suspendu.");
      await loadAdmin();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Mise à jour impossible"); }
  }

  const annual = account.subscription.billingTerm === "annual";
  const offerAmount = annual ? account.billing.annualAmountEur : account.billing.amountEur;
  const offerLabel = annual ? "Annuelle" : "Mensuelle";
  const offerPeriod = annual ? "an" : "mois";
  const canChooseOffer = account.role === "owner" && account.subscription.status !== "payment_declared" && !account.subscription.paidOn;
  const canRequestTrial = account.role === "owner" && !account.isTrial && !account.trialRequested && !account.subscription.currentPeriodEnd && account.subscription.status !== "payment_declared";

  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="account-drawer" aria-label="Compte entreprise">
    <div className="drawer-head"><div><p className="eyebrow">COMPTE ENTREPRISE</p><h2>{account.name}</h2><p>{account.companyIdentifier}</p></div><button className="close-button" onClick={onClose} aria-label="Fermer">×</button></div>
    <section className="account-section"><div className="section-title"><h3>Abonnement</h3><span className={`status-pill status-${account.status}`}>{accountStatusLabel(account)}</span></div>
      <div className="info-grid"><div><span>Formule</span><strong>{account.plan === "lifetime" ? "D2F à vie" : offerLabel}</strong></div><div><span>Utilisateurs</span><strong>{account.members.length} / {account.seatLimit}</strong></div><div><span>Montant</span><strong>{account.plan === "lifetime" ? "0 €" : offerAmount ? `${offerAmount.toFixed(2)} € / ${offerPeriod}` : "À confirmer par D2F"}</strong></div><div><span>{account.isTrial ? "Fin de l’essai" : account.plan === "lifetime" ? "Paiement" : "Accès payé jusqu’au"}</span><strong>{account.plan === "lifetime" ? "Aucun" : formatDate(account.isTrial ? account.trialEndsAt : account.subscription.currentPeriodEnd)}</strong></div></div>
      {account.plan === "monthly" && <>
        {account.isTrial && <p className="trial-banner"><strong>Essai D2F actif.</strong> Vous disposez de 14 jours complets. Si votre paiement est validé pendant l’essai, votre période payée commencera après le dernier jour gratuit.</p>}
        {account.trialRequested && !account.isTrial && <p className="form-message is-ok"><strong>Essai demandé.</strong> D2F doit maintenant valider le démarrage des 14 jours.</p>}
        {canRequestTrial && <div className="trial-request-panel"><div><strong>Tester D2F pendant 14 jours</strong><span>Aucun paiement préalable. Un seul essai par établissement, activé par D2F.</span></div><button type="button" onClick={requestTrial}>Demander mon essai</button></div>}
        <details className="billing-profile-panel" open={!account.billingProfile.street || !account.billingProfile.postalCode || !account.billingProfile.city}>
          <summary><span><strong>Coordonnées de facturation</strong><small>Reprises automatiquement sur la facture d’abonnement D2F.</small></span><span>Modifier</span></summary>
          <form className="compact-form billing-profile-form" onSubmit={saveBillingProfile}>
            <label>Raison sociale<input name="legalName" defaultValue={account.billingProfile.legalName || account.name} required /></label>
            <label>Identifiant légal<input value={account.companyIdentifier} disabled /></label>
            <label>Numéro de TVA (optionnel)<input name="vatId" defaultValue={account.billingProfile.vatId} /></label>
            <label>E-mail de facturation<input name="billingEmail" type="email" defaultValue={account.billingProfile.email || session.user.email} required /></label>
            <label className="span-2">Adresse<input name="street" defaultValue={account.billingProfile.street} required /></label>
            <label className="span-2">Complément d’adresse<input name="street2" defaultValue={account.billingProfile.street2} /></label>
            <label>Code postal<input name="postalCode" defaultValue={account.billingProfile.postalCode} required /></label>
            <label>Ville<input name="city" defaultValue={account.billingProfile.city} required /></label>
            <button className="secondary-action">Enregistrer les coordonnées</button>
          </form>
        </details>
        {canChooseOffer && <div className="billing-choice" aria-label="Choisir la formule"><button type="button" className={!annual ? "is-active" : ""} onClick={() => chooseOffer("monthly")}><span>Mensuel</span><strong>{account.billing.amountEur?.toFixed(0) || "29"} € / mois</strong><small>Sans engagement annuel</small></button><button type="button" className={annual ? "is-active" : ""} onClick={() => chooseOffer("annual")}><span>Annuel</span><strong>{account.billing.annualAmountEur?.toFixed(0) || "290"} € / an</strong><small>12 mois · économie de 58 €</small></button></div>}
        <div className="bank-box"><p><span>Banque</span><strong>{account.billing.bankName}</strong></p><p><span>Bénéficiaire</span><strong>{account.billing.beneficiary}</strong></p><p><span>IBAN</span><strong>{account.billing.iban}</strong></p><p><span>BIC / SWIFT</span><strong>{account.billing.bic}</strong></p><p><span>Référence obligatoire</span><strong>{account.subscription.bankTransferReference}</strong></p><p><span>Informations</span><strong>{account.billing.bankInformation}</strong></p></div>
        <p className="payment-explainer"><strong>Virement SEPA SCT en euros.</strong> Il ne s’agit pas d’un prélèvement automatique : vous pouvez arrêter à tout moment. L’accès reste ouvert jusqu’à la fin de la période déjà réglée. D2F contrôle la réception avant activation.</p>
        {subscriptionInvoices.length > 0 && <section className="subscription-invoices"><h4>Factures d’abonnement</h4>{subscriptionInvoices.map((invoice) => <a key={invoice.id} href={`/auth/subscription/invoice?invoiceId=${encodeURIComponent(invoice.id)}&locale=fr`}><span><strong>{invoice.number}</strong><small>{formatDate(invoice.date)} · période du {formatDate(invoice.periodStart)} au {formatDate(invoice.periodEnd)}</small></span><strong>{invoice.amount.toFixed(2)} € ↓</strong></a>)}</section>}
        {account.subscription.status === "payment_declared" && <p className="form-message is-ok">Virement déclaré — D2F doit encore confirmer sa réception.</p>}
        {account.role === "owner" && account.subscription.status !== "payment_declared" && <form className="compact-form" onSubmit={declarePayment}><h4>{account.status === "active" ? "Déclarer le règlement de la prochaine période" : "Déclarer un virement réellement effectué"}</h4><label>Nom du payeur / titulaire du compte<input name="payerName" defaultValue={account.subscription.payerName} required /></label><label>Référence de votre banque<input name="transferReference" defaultValue={account.subscription.customerTransferReference} minLength={4} required /></label><label>Date d’exécution<input name="paidOn" type="date" defaultValue={account.subscription.paidOn} required /></label><label className="compact-check"><input name="confirmTransfer" type="checkbox" required /><span>Je confirme que ce virement a bien été exécuté. Cette déclaration sera vérifiée par D2F avant activation.</span></label><button className="secondary-action">Déclarer le virement</button></form>}
      </>}
    </section>
    <section className="account-section"><div className="section-title"><h3>Collaborateurs</h3><span>{account.members.length} siège{account.members.length > 1 ? "s" : ""} utilisé{account.members.length > 1 ? "s" : ""}</span></div><div className="member-list">{account.members.map((member) => <div key={member.userId}><span className="member-avatar">{(member.fullName || member.email).slice(0, 1).toUpperCase()}</span><p><strong>{member.fullName || member.email}</strong><small>{member.email} · {member.role === "owner" ? "Propriétaire" : member.status === "invited" ? "Invitation envoyée" : "Collaborateur"}</small></p></div>)}</div>
      {account.role === "owner" && account.canUseApplication && account.members.length < account.seatLimit && <form className="compact-form" onSubmit={invite}><h4>Inviter le deuxième utilisateur</h4><label>Nom<input name="fullName" required /></label><label>E-mail professionnel<input name="email" type="email" required /></label><button className="secondary-action">Envoyer l’invitation</button></form>}{!account.canUseApplication && <p className="locked-feature">L’invitation du collaborateur sera disponible après activation de l’essai ou du paiement.</p>}
    </section>
    {account.isPlatformAdmin && <section className="account-section admin-section"><div className="section-title"><div><h3>Accès clients D2F</h3><p>Activation, essai et suspension sont réservés à D2F Compliant.</p></div><button className="mini-action" onClick={loadAdmin}>{adminLoading ? "Chargement…" : "Actualiser"}</button></div>{!adminLoading && !adminCompanies.length && <p className="admin-empty">Aucune demande client.</p>}{adminCompanies.map((company) => <div className={`admin-company ${["pending_payment", "payment_declared"].includes(company.subscriptionStatus) ? "is-pending" : ""}`} key={company.id}><div><strong>{company.name}</strong><small>{company.companyIdentifier} · {formatStatus(company.status)} · {company.members}/2 utilisateurs</small><small>Formule {company.billingTerm === "annual" ? "annuelle · 290 € / an" : "mensuelle · 29 € / mois"}</small><small>Demande du {formatDate(company.createdAt.slice(0, 10))}</small>{company.trialRequested && !company.isTrial && <small className="admin-trial">Essai demandé par le client — en attente de votre validation</small>}{company.isTrial && <small className="admin-trial">Essai actif jusqu’au {formatDate(company.trialEndsAt)}</small>}{company.currentPeriodEnd && !company.isTrial && <small>Accès jusqu’au {formatDate(company.currentPeriodEnd)}</small>}{company.transferReference && <small>Virement : {company.transferReference} · {company.paidOn || "date non indiquée"} · {formatStatus(company.subscriptionStatus)}</small>}</div>{company.plan !== "lifetime" && <div>{company.subscriptionStatus === "payment_declared" && <button onClick={() => setCompanyStatus(company.id, "active")}>Confirmer reçu + {company.billingTerm === "annual" ? "12 mois" : "1 mois"}</button>}{company.subscriptionStatus === "pending_payment" && !company.currentPeriodEnd && <button className="trial-action" onClick={() => setCompanyStatus(company.id, "trial")}>{company.trialRequested ? "Démarrer l’essai demandé" : "Accorder 14 jours d’essai"}</button>}{company.subscriptionStatus === "pending_payment" && company.currentPeriodEnd && <span className="admin-note">Essai déjà utilisé</span>}{company.status === "suspended" && company.canReactivate && <button className="trial-action" onClick={() => setCompanyStatus(company.id, "active")}>{company.reactivationKind === "trial" ? "Réactiver l’essai" : "Réactiver l’abonnement"}</button>}{company.status === "suspended" && !company.canReactivate && <span className="admin-note">Période expirée — nouveau paiement requis</span>}{company.status !== "suspended" && <button onClick={() => setCompanyStatus(company.id, "suspended")}>Suspendre</button>}</div>}</div>)}</section>}
    {error && <p className="form-message is-error">{error}</p>}{message && <p className="form-message is-ok">{message}</p>}
  </aside></div>;
}

function LockedSubscription({ session, onOpen, onSession }: { session: SessionData; onOpen: () => void; onSession: (value: SessionData) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const account = session.account;
  const trialAlreadyUsed = Boolean(account.subscription.currentPeriodEnd) && !account.isTrial;

  async function requestTrial() {
    setBusy(true); setError("");
    try {
      const updated = await api("/auth/subscription", { method: "POST", body: JSON.stringify({ action: "request_trial" }) });
      onSession({ ...session, account: updated });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Demande impossible");
    } finally { setBusy(false); }
  }

  return <main className="locked-page"><img src="/d2f-platform-logo.png" alt="D2F Platform" /><p className="eyebrow">ACCÈS D2F PLATFORM</p><h1>{accountStatusLabel(account)}</h1><p>Choisissez l’essai gratuit ou votre formule de règlement. Les informations déjà saisies ont prérempli votre fiche Entreprise.</p><ol className="activation-steps"><li><strong>Entreprise enregistrée</strong>Vos coordonnées sont conservées dans votre espace dédié.</li><li><strong>14 jours pour essayer</strong>Demandez l’essai ; D2F valide son démarrage sans paiement préalable.</li><li><strong>Vous décidez ensuite</strong>Sans paiement validé à la fin de l’essai, l’accès est suspendu automatiquement.</li></ol>{account.trialRequested ? <p className="form-message is-ok"><strong>Demande envoyée.</strong> D2F doit valider le démarrage de vos 14 jours.</p> : trialAlreadyUsed ? <p className="form-message">Votre essai a déjà été utilisé. Choisissez une formule puis déclarez votre règlement.</p> : <div className="locked-trial"><strong>Essai gratuit de 14 jours</strong><span>Sans carte bancaire et sans paiement préalable.</span><button className="primary-action" type="button" disabled={busy} onClick={requestTrial}>{busy ? "Envoi…" : "Demander mes 14 jours d’essai"}</button></div>}{error && <p className="form-message is-error">{error}</p>}<div className="reference-card"><span>Référence de règlement</span><strong>{account.subscription.bankTransferReference || "Disponible dans votre compte"}</strong></div><div className="locked-actions"><button className="primary-action" onClick={onOpen}>Choisir ma formule et voir les coordonnées</button></div></main>;
}

export default function SessionShell({ monthlyPriceEur, annualPriceEur }: { monthlyPriceEur: number; annualPriceEur: number }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionData | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [warning, setWarning] = useState(0);
  const [adminPendingCount, setAdminPendingCount] = useState(0);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTicketId, setSupportTicketId] = useState("");
  const [supportAttentionCount, setSupportAttentionCount] = useState(0);
  const [completionToken, setCompletionToken] = useState("");
  const lastActivity = useRef(0);

  const logout = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    setSession(null); setDrawer(false); setSupportOpen(false); setSupportTicketId(""); setWarning(0); setAdminPendingCount(0); setSupportAttentionCount(0);
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
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type === "d2f-activity") mark();
      if (event.data?.type === "d2f-open-support") {
        setSupportTicketId(String(event.data.ticketId || ""));
        setDrawer(false);
        setSupportOpen(true);
        mark();
      }
    };
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

  useEffect(() => {
    if (!session?.account.isPlatformAdmin) return;
    let cancelled = false;
    const refreshRequests = async () => {
      try {
        const companies = await api("/auth/admin/companies") as AdminCompany[];
        if (!cancelled) setAdminPendingCount(companies.filter((company) => company.plan !== "lifetime" && ["pending_payment", "payment_declared"].includes(company.subscriptionStatus)).length);
      } catch {
        if (!cancelled) setAdminPendingCount(0);
      }
    };
    void refreshRequests();
    const interval = window.setInterval(refreshRequests, 60000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [session?.account.isPlatformAdmin]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const refreshSupport = async () => {
      try {
        const result = await api("/auth/support");
        if (!cancelled) setSupportAttentionCount(Number(result.attentionCount || 0));
      } catch {
        if (!cancelled) setSupportAttentionCount(0);
      }
    };
    void refreshSupport();
    const interval = window.setInterval(refreshSupport, 60000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [session]);

  const notifySupportChanged = useCallback(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".web-app-frame");
    frame?.contentWindow?.postMessage({ type: "d2f-support-updated" }, location.origin);
  }, []);

  const initials = useMemo(() => session?.user.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "D2F", [session]);

  if (loading) return <main className="session-loading"><img src="/d2f-platform-logo.png" alt="D2F Platform" /><span>Ouverture sécurisée…</span></main>;
  if (completionToken) return <PasswordCompletion token={completionToken} onAuthenticated={(value) => { setCompletionToken(""); setSession(value); }} />;
  if (!session) return <AuthPortal onAuthenticated={setSession} monthlyPriceEur={monthlyPriceEur} annualPriceEur={annualPriceEur} />;

  return <main className="app-session-shell">
    <header className="account-bar"><div className="account-brand"><img src="/d2f-platform-logo.png" alt="" /><strong>D2F Platform</strong><small className="app-build-badge">{D2F_PLATFORM_VERSION_LABEL}</small><span>{session.account.name}</span></div><div className="account-actions">{warning > 0 && <span className="idle-warning">Déconnexion dans {warning} s</span>}<button className="support-header-button" onClick={() => { setDrawer(false); setSupportTicketId(""); setSupportOpen(true); }} aria-label={`Support D2F · ${supportAttentionCount} ticket(s) à consulter`}><span>Support</span>{supportAttentionCount > 0 && <strong>{supportAttentionCount}</strong>}</button>{session.account.isPlatformAdmin && <button className="admin-request-button" onClick={() => { setSupportOpen(false); setDrawer(true); }} aria-label={`${adminPendingCount} demandes clients à traiter`}><span>Demandes</span><strong>{adminPendingCount}</strong></button>}<button className="account-button" onClick={() => { setSupportOpen(false); setDrawer(true); }}><span>{initials}</span><span><strong>{session.user.fullName}</strong><small>{accountStatusLabel(session.account)}</small></span></button><button className="logout-button" onClick={logout}>Déconnexion</button></div></header>
    {session.account.canUseApplication ? <iframe className="web-app-frame" src="/erp/index.html?v=20260720-support-governance-sort-v215" title="D2F Platform" allow="clipboard-read; clipboard-write" onLoad={(event) => event.currentTarget.contentWindow?.postMessage({ type: "d2f-platform-license", account: { id: session.account.id, name: session.account.name, plan: session.account.plan, billingTerm: session.account.subscription.billingTerm, isPlatformAdmin: session.account.isPlatformAdmin } }, location.origin)} /> : <LockedSubscription session={session} onOpen={() => setDrawer(true)} onSession={setSession} />}
    {drawer && <AccountDrawer session={session} onSession={setSession} onClose={() => setDrawer(false)} onPendingCount={setAdminPendingCount} />}
    {supportOpen && <SupportCenter session={session} initialTicketId={supportTicketId} onClose={() => { setSupportOpen(false); setSupportTicketId(""); }} onAttentionCount={setSupportAttentionCount} onChanged={notifySupportChanged} />}
  </main>;
}
