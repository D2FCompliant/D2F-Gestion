(function () {
  const local = { financial: null, expenses: null, selectedReportId: "", pendingReceipt: null, expenseFoundationReady: true, financialFoundationReady: true, financialFilter: "all", lifetimeLicense: false, licenseResolved: false, companyCurrency: "EUR", companyCountry: "" };
  const tr = (key, fallback, vars) => window.__d2fT?.(key, fallback, vars) || fallback;
  const locale = () => (document.documentElement.lang || "en").toLowerCase().slice(0, 2);
  const byId = (id) => document.getElementById(id);
  const money = (value, currency = "EUR") => new Intl.NumberFormat(document.documentElement.lang || "fr", {
    style: "currency", currency: currency || "EUR", maximumFractionDigits: 2,
  }).format(Number(value || 0));

  function clear(element) { if (element) element.replaceChildren(); }
  function setText(id, value) { const element = byId(id); if (element) element.textContent = String(value ?? ""); }
  function number(value) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
  function categoryLabel(value) {
    const keys = {
      meal: "meals", accommodation: "lodging", fuel: "fuel", toll: "toll", parking: "parking", train: "train",
      flight: "flight", taxi: "taxi", ride_hailing: "ride_hailing", public_transport: "public_transport",
      vehicle_rental: "vehicle_rental", mileage: "mileage", per_diem: "per_diem",
      telecommunications: "telecommunications", office_supplies: "office_supplies", equipment: "equipment",
      software: "software", subscriptions: "subscriptions", professional_services: "professional_services",
      rent: "rent", utilities: "utilities", insurance: "insurance", bank_fees: "bank_fees",
      representation: "representation", training: "training", conference: "conference",
      home_working: "home_working", miscellaneous: "other",
    };
    const key = keys[String(value || "")];
    return key ? tr("expenses.category." + key, String(value || "")) : String(value || "—");
  }
  function paymentLabel(value) {
    const key = String(value || "");
    return key ? tr("expenses.payment." + key, key) : "—";
  }
  function reportTypeLabel(value) {
    return value === "travel_order"
      ? tr("expenses.type.travel_order", "Ordre de mission / voyage")
      : tr("expenses.type.company_expense", "Dépense d’entreprise / achat");
  }
  function cell(text, className = "") {
    const td = document.createElement("td"); td.textContent = String(text ?? ""); if (className) td.className = className; return td;
  }
  function toggleEmpty(id, hasRows) { byId(id)?.toggleAttribute("hidden", Boolean(hasRows)); }
  function statusLabel(status) {
    return ({
      draft: tr("expenses.status.draft", "Brouillon"), submitted: tr("expenses.status.submitted", "À approuver"),
      approved: tr("expenses.status.approved", "Approuvée"), rejected: tr("expenses.status.rejected", "Refusée"),
      returned: tr("expenses.status.returned", "À corriger"), validated: tr("financial.status.validated", "Validée"),
      posted: tr("financial.status.posted", "Comptabilisée"), matched: tr("financial.status.matched", "Rapproché"),
      partial: tr("financial.status.partial", "Partiel"), open: tr("financial.status.open", "À rapprocher"),
      credited: tr("payments.status.credited", "Annulée par avoir"),
    })[status] || status || tr("expenses.status.draft", "Brouillon");
  }
  function badge(status) {
    const span = document.createElement("span"); span.className = "platformStatus platformStatus--" + String(status || "draft");
    span.textContent = statusLabel(status); return span;
  }
  function actionButton(label, action, reportId, variant = "secondary") {
    const button = document.createElement("button"); button.type = "button";
    button.className = "btn btn--" + variant + " btn--compact"; button.dataset.platformAction = action;
    button.dataset.reportId = reportId; button.textContent = label; return button;
  }
  function taskButton(title, detail, action, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "platformActionItem" + (options.urgent ? " platformActionItem--urgent" : "");
    if (options.go) button.dataset.platformGo = options.go;
    else button.dataset.platformAction = action;
    if (options.reportId) button.dataset.reportId = options.reportId;
    if (options.application) button.dataset.application = options.application;
    button.innerHTML = "<span>" + String(title) + "</span><small>" + String(detail) + "</small><strong>" + (options.label || tr("platform.action.process", "Traiter →")) + "</strong>";
    return button;
  }
  function showFoundation(application, ready) {
    document.querySelectorAll("." + application + "-foundation-banner").forEach((banner) => {
      const moduleAlreadyLicensed = local.licenseResolved && local.lifetimeLicense;
      banner.hidden = ready || !local.licenseResolved || moduleAlreadyLicensed;
      const button = banner.querySelector('[data-platform-action="platform:requestActivation"]');
      if (button) button.hidden = moduleAlreadyLicensed;
    });
  }
  function missingReceiptLines(reportId) {
    const receipts = new Set(reportReceipts(reportId).map((receipt) => String(receipt.expense_line_id || "")).filter(Boolean));
    return reportLines(reportId).filter((line) => line.receipt_required !== false && !receipts.has(String(line.id)));
  }
  async function requestActivation(application) {
    if (local.lifetimeLicense && application !== "country-pack") {
      setText("appStatus", tr("platform.activation.lifetime", "Inclus dans la licence D2F à vie · aucun ticket support créé"));
      return null;
    }
    const isCountryPack = String(application || "").startsWith("country-pack");
    const packModule = application === "country-pack-expenses" ? "Expenses" : application === "country-pack-financial" ? "Financial" : "Platform";
    const applicationLabel = isCountryPack ? "Country Pack " + packModule + " " + (window.D2FPlatformCapabilities?.countryPack?.country || "") : (application === "expenses" ? "D2F Expenses" : "D2F Financial");
    const response = await fetch("/auth/support", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: isCountryPack ? "compliance" : "billing", priority: "normal", requestType: "need", locale: document.documentElement.lang || "fr",
        subject: isCountryPack
          ? tr("expenses.ticket.country_subject", "Qualification du {label}", { label: applicationLabel })
          : tr("expenses.ticket.activation_subject", "Activation de {label}", { label: applicationLabel }),
        description: isCountryPack
          ? tr("expenses.ticket.country_description", "Merci de qualifier et publier le Country Pack applicable à cet établissement avant toute décision réglementaire.")
          : tr("expenses.ticket.activation_description", "Merci d’activer le socle de données {application} afin de rendre les traitements D2F Platform opérationnels.", { application }),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || tr("platform.activation.failed", "La demande d’activation n’a pas pu être créée."));
    const ticket = payload.result?.tickets?.[0];
    window.parent?.postMessage({ type: "d2f-support-updated" }, location.origin);
    setText("appStatus", tr("platform.activation.created", "Demande créée") + (ticket?.number ? " · " + ticket.number : ""));
    return ticket;
  }

  function issuedInvoice(invoice) {
    const status = String(invoice.status || "").toLowerCase();
    const type = String(invoice.invoice_type || invoice.type || "invoice").toLowerCase();
    return status === "issued" && !["credit_note", "credit-note", "avoir"].includes(type);
  }
  function customerName(invoice, clients) {
    return invoice.customer_name || invoice.client_name || clients.get(String(invoice.client_id || invoice.clientId || "")) || "—";
  }
  function paymentAmount(payment) {
    if (String(payment.status || "").toLowerCase() === "cancelled") return 0;
    const amount = Math.abs(number(payment.amount || payment.total));
    return String(payment.direction || "in").toLowerCase() === "out" ? -amount : amount;
  }

  async function loadFinancial() {
    if (window.D2FPlatformPreview) return { summary: {}, invoices: [], proposals: [], reconciliation: [] };
    const [dashboard, invoicesRaw, clientsRaw, paymentsRaw] = await Promise.all([
      window.api.dashboard.get().catch(() => ({})),
      window.api.invoices.list().catch(() => []),
      window.api.clients.list().catch(() => []),
      window.api.payments.listAll().catch(() => []),
    ]);
    let workspace = { proposals: [], summary: {} };
    let foundationReady = true;
    try { workspace = await window.api.financial.workspace(); } catch (error) {
      foundationReady = false;
      console.info("[financial] foundation not active; Gestion cockpit remains available", error?.message || error);
    }
    const clients = new Map((clientsRaw || []).map((client) => [String(client.id || ""), client]));
    const receivables = window.D2FReceivables.buildReceivableRows(invoicesRaw || [], paymentsRaw || []);
    const invoices = receivables.map((entry) => {
      const invoice = entry.invoice || {};
      const client = clients.get(String(invoice.client_id || invoice.clientId || "")) || {};
      const id = String(invoice.id || "");
      return {
        id, invoice_number: invoice.invoice_number || invoice.number || "—", customer_name: customerName(invoice, new Map([[String(invoice.client_id || invoice.clientId || ""), client.legal_name || client.name || client.company_name || "—"]])),
        issue_date: invoice.date || invoice.issue_date || "", due_date: window.D2FReceivables.effectiveDueDate(invoice, client),
        gross_amount: entry.grossDue, credited_amount: entry.credited, credit_numbers: entry.creditNumbers || [],
        paid_amount: entry.paid, remaining_amount: entry.remaining, currency: invoice.currency || "EUR",
        match_status: entry.paymentStatus === "credited" ? "credited" : entry.remaining <= window.D2FReceivables.EPSILON ? "matched" : (entry.paid > window.D2FReceivables.EPSILON || entry.credited > window.D2FReceivables.EPSILON) ? "partial" : "open",
      };
    }).sort((left, right) => String(right.issue_date).localeCompare(String(left.issue_date)));
    return {
      invoices, reconciliation: invoices, proposals: workspace.proposals || [], foundationReady,
      summary: {
        revenue: number(dashboard.ca_recognized_ht), cash: number(dashboard.payments?.total),
        outstanding: number(dashboard.receivables?.outstanding_ttc), overdue: number(dashboard.receivables?.overdue_ttc),
        openCount: invoices.filter((item) => item.remaining_amount > .005).length,
        overdueCount: number(dashboard.receivables?.overdue_count),
        proposalDrafts: number(workspace.summary?.proposalDrafts),
        amountAwaitingValidation: number(workspace.summary?.amountAwaitingValidation),
      },
    };
  }

  function renderFinancial(data) {
    local.financial = data;
    local.financialFoundationReady = data.foundationReady !== false;
    showFoundation("financial", local.financialFoundationReady);
    setText("financial-revenue", money(data.summary?.revenue));
    setText("financial-cash", money(data.summary?.cash));
    setText("financial-outstanding", money(data.summary?.outstanding));
    setText("financial-overdue", money(data.summary?.overdue));
    setText("financial-open-count", (data.summary?.openCount || 0) + " " + tr("financial.kpi.invoice_count", "facture(s)"));
    setText("financial-overdue-count", (data.summary?.overdueCount || 0) + " " + tr("financial.kpi.invoice_count", "facture(s)"));
    setText("financial-proposal-count", data.summary?.proposalDrafts || 0);
    setText("financial-awaiting-amount", money(data.summary?.amountAwaitingValidation || 0));
    setText("financial-findings-count", (data.proposals || []).filter((proposal) => (proposal.findings || []).length).length);

    const invoicesBody = byId("financial-invoices-body"); clear(invoicesBody);
    for (const invoice of (data.invoices || []).slice(0, 12)) {
      const row = document.createElement("tr");
      row.append(cell(invoice.invoice_number), cell(invoice.customer_name), cell(String(invoice.issue_date).slice(0, 10)), cell(String(invoice.due_date || "—").slice(0, 10)), cell(money(invoice.gross_amount, invoice.currency), "numeric"));
      invoicesBody?.append(row);
    }
    toggleEmpty("financial-invoices-empty", (data.invoices || []).length);

    const proposalsBody = byId("financial-proposals-body"); clear(proposalsBody);
    for (const proposal of data.proposals || []) {
      const row = document.createElement("tr");
      row.append(cell(proposal.source_type === "ExpenseReport" ? tr("financial.source.expense", "Note de frais") : tr("financial.source.invoice", "Facture client")));
      row.append(cell(proposal.proposal?.sourceNumber || proposal.source_id));
      row.append(cell(proposal.proposal?.journal || proposal.proposal?.account || tr("financial.proposals.to_determine", "À déterminer")));
      row.append(cell(money(proposal.amount, proposal.currency), "numeric"));
      const status = document.createElement("td"); status.append(badge(proposal.status)); row.append(status);
      row.append(cell(proposal.rule_result_id || tr("financial.proposals.no_trace", "En attente")));
      proposalsBody?.append(row);
    }
    toggleEmpty("financial-proposals-empty", (data.proposals || []).length);
    const activationButton = byId("financial-proposals-empty")?.querySelector("[data-platform-action=\"platform:requestActivation\"]");
    if (activationButton) activationButton.hidden = local.financialFoundationReady || local.lifetimeLicense;

    const reconciliationBody = byId("financial-reconciliation-body"); clear(reconciliationBody);
    const today = new Date().toISOString().slice(0, 10);
    const reconciliations = (data.reconciliation || []).filter((invoice) => local.financialFilter === "all" || (local.financialFilter === "open" && invoice.remaining_amount > .005) || (local.financialFilter === "overdue" && invoice.remaining_amount > .005 && invoice.due_date && invoice.due_date < today));
    for (const invoice of reconciliations) {
      const row = document.createElement("tr");
      row.append(cell(invoice.invoice_number), cell(invoice.customer_name), cell(money(invoice.gross_amount, invoice.currency), "numeric"), cell(invoice.credited_amount > .005 ? "-" + money(invoice.credited_amount, invoice.currency) : "—", "numeric"), cell(money(invoice.paid_amount, invoice.currency), "numeric"), cell(money(invoice.remaining_amount, invoice.currency), "numeric"));
      const status = document.createElement("td"); status.append(badge(invoice.match_status)); row.append(status);
      const action = document.createElement("td"); action.className = "platformActions";
      if (invoice.remaining_amount > .005) action.append(actionButton(tr("financial.action.record_payment", "Enregistrer un règlement"), "financial:recordPayment", invoice.id, "primary"));
      else action.append(actionButton(invoice.match_status === "credited" ? tr("financial.action.view_credits", "Voir les avoirs") : tr("financial.action.view_payments", "Voir les règlements"), "financial:viewPayments", invoice.id, "secondary"));
      row.append(action); reconciliationBody?.append(row);
    }
    toggleEmpty("financial-reconciliation-empty", reconciliations.length);
    const queue = byId("financial-action-queue"); clear(queue);
    const overdue = (data.reconciliation || []).filter((invoice) => invoice.remaining_amount > .005 && invoice.due_date && invoice.due_date < today);
    const open = (data.reconciliation || []).filter((invoice) => invoice.remaining_amount > .005);
    if (overdue.length) queue?.append(taskButton(overdue.length + " " + tr("financial.task.overdue", "facture(s) échue(s)"), money(overdue.reduce((sum, invoice) => sum + invoice.remaining_amount, 0)) + " · " + tr("financial.task.payment", "enregistrer ou vérifier le règlement"), "financial:filterOverdue", { urgent: true }));
    if (open.length) queue?.append(taskButton(open.length + " " + tr("financial.task.open", "créance(s) ouverte(s)"), tr("financial.task.open_hint", "Rapprocher le solde ou enregistrer l’encaissement"), "financial:filterOpen"));
    if (!local.financialFoundationReady && !local.lifetimeLicense) queue?.append(taskButton(tr("financial.task.activate", "Activer les propositions comptables"), tr("financial.task.activate_hint", "Créer une demande suivie auprès de D2F"), "platform:requestActivation", { label: tr("platform.action.request", "Demander →") }));
    if (!queue?.children.length) queue?.append(taskButton(tr("platform.task.clear", "Aucun traitement urgent"), tr("platform.task.clear_hint", "Tous les soldes visibles sont rapprochés."), "financial:refresh", { label: tr("action.refresh", "Actualiser") }));
    renderPackState();
  }

  function reportLines(reportId) { return (local.expenses?.lines || []).filter((line) => String(line.report_id) === String(reportId)); }
  function reportReceipts(reportId) { return (local.expenses?.receipts || []).filter((receipt) => String(receipt.report_id) === String(reportId)); }

  function renderCaptureSelection(reports) {
    const select = byId("expense-capture-report-select");
    if (select) {
      const previous = String(local.selectedReportId || "");
      clear(select);
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = tr("expenses.capture.no_report", "Sélectionnez une note"); select.append(placeholder);
      for (const report of reports.filter((item) => item.can_edit === true)) {
        const option = document.createElement("option"); option.value = report.id; option.textContent = report.report_number + " · " + report.title; select.append(option);
      }
      if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    }
  }

  function renderExpenseDetail() {
    const report = (local.expenses?.reports || []).find((item) => String(item.id) === String(local.selectedReportId));
    const title = byId("expense-selected-title"), detail = byId("expense-selected-detail"), lineForm = byId("expense-line-form"), submit = byId("expense-submit-selected"), actionHint = byId("expense-action-hint");
    if (!report) {
      if (title) title.textContent = tr("expenses.detail.select", "Sélectionnez une note de frais");
      if (detail) detail.textContent = tr("expenses.detail.empty", "Les lignes et justificatifs apparaîtront ici.");
      setText("expense-capture-report", tr("expenses.capture.no_report", "Sélectionnez d’abord une note de frais"));
      if (lineForm) lineForm.hidden = true; if (submit) submit.hidden = true; if (actionHint) actionHint.hidden = true;
      clear(byId("expense-lines-body")); clear(byId("expense-receipts-list")); return;
    }
    const lines = reportLines(report.id), receipts = reportReceipts(report.id), missingReceipts = missingReceiptLines(report.id);
    if (title) title.textContent = report.report_number + " · " + report.title;
    if (detail) detail.textContent = (report.claimant_name || report.claimant_id) + " · " + statusLabel(report.status) + " · " + lines.length + " " + tr("expenses.detail.lines", "ligne(s)") + " · " + receipts.length + " " + tr("expenses.detail.receipts", "justificatif(s)");
    setText("expense-total-claimed", money(report.claimed_amount || report.total_gross, report.currency));
    setText("expense-total-personal", money(report.personal_amount, report.currency));
    setText("expense-total-eligible", money(report.eligible_amount || Math.max(0, number(report.total_gross) - number(report.personal_amount)), report.currency));
    setText("expense-total-reimbursable", money(report.reimbursable_amount, report.currency));
    setText("expense-capture-report", report.report_number + " · " + report.title);
    const receiptLine = byId("expense-receipt-line");
    if (receiptLine) {
      const selectedLine = receiptLine.value; clear(receiptLine);
      if (!lines.length) { const option = document.createElement("option"); option.value = ""; option.textContent = tr("expenses.capture.line_empty", "Ajoutez d’abord une ligne à la note"); receiptLine.append(option); }
      for (const line of lines) { const option = document.createElement("option"); option.value = line.id; option.textContent = line.occurred_on + " · " + line.merchant + " · " + money(line.gross_amount, line.currency); receiptLine.append(option); }
      if (lines.some((line) => String(line.id) === String(selectedLine))) receiptLine.value = selectedLine;
    }
    const editable = report.can_edit === true;
    if (lineForm) lineForm.hidden = !editable;
    const travel = byId("expense-travel-workflow"); if (travel) travel.hidden = report.document_type !== "travel_order" || !editable;
    ensureCompanyExpenseRateField(report, editable);
    const exportAccountant = byId("expense-export-accountant"), exportTravel = byId("expense-export-travel"), exportBank = byId("expense-export-bank");
    if (exportAccountant) {
      exportAccountant.hidden = false; exportAccountant.disabled = report.status !== "approved"; exportAccountant.dataset.reportId = report.id;
      exportAccountant.title = report.status === "approved" ? tr("expenses.export.accountant_ready", "Télécharger le fichier destiné au comptable") : tr("expenses.export.requires_approval", "Disponible après approbation de la note");
    }
    if (exportTravel) {
      exportTravel.hidden = report.document_type !== "travel_order"; exportTravel.disabled = !["submitted","approved"].includes(report.status); exportTravel.dataset.reportId = report.id;
      exportTravel.title = exportTravel.disabled ? tr("expenses.export.travel_requires_submission", "Disponible après soumission de l’ordre") : tr("expenses.export.travel_ready", "Télécharger l’ordre et le décompte de mission");
    }
    if (exportBank) {
      exportBank.hidden = report.document_type !== "travel_order"; exportBank.disabled = report.status !== "approved"; exportBank.dataset.reportId = report.id;
      exportBank.title = exportBank.disabled ? tr("expenses.export.requires_approval", "Disponible après approbation de la note") : tr("expenses.export.bank_ready", "Télécharger le dossier justificatif destiné à la banque");
    }
    if (report.document_type === "travel_order") {
      const workflow = report.workflow_data || {}, order = workflow.order || {}, settlement = workflow.settlement || {};
      const values = {
        "expense-travel-order-number": order.orderNumber, "expense-travel-order-date": order.orderDate, "expense-travel-traveler": order.traveler,
        "expense-travel-role": order.travelerRole, "expense-travel-destination-city": order.destinationCity, "expense-travel-destination-country": order.destinationCountry,
        "expense-travel-departure": order.departureAt, "expense-travel-expected-return": order.expectedReturnAt, "expense-travel-actual-return": settlement.actualReturnAt,
        "expense-travel-transport": order.transportMode, "expense-travel-route": order.route, "expense-travel-purpose": order.purpose,
        "expense-travel-perdiem-days": settlement.perDiemDays, "expense-travel-perdiem-rate": settlement.perDiemRate,
        "expense-travel-perdiem-currency": settlement.perDiemCurrency || "EUR", "expense-travel-duration": settlement.durationHours,
        "expense-travel-corporate-card": settlement.corporateCardAmount, "expense-travel-advance": settlement.advanceAmount,
        "expense-travel-reimbursement-rsd": settlement.reimbursementRsd, "expense-travel-reimbursement-fx": settlement.reimbursementForeign,
        "expense-travel-reimbursement-fx-currency": settlement.reimbursementForeignCurrency || "EUR",
        "expense-travel-rsd-account": order.rsdAccount, "expense-travel-fx-account": order.fxAccount,
        "expense-travel-company-activity": order.companyActivity, "expense-travel-necessity": report.business_necessity, "expense-travel-report": report.mission_report
      };
      Object.entries(values).forEach(([id,value])=>{ if (byId(id)) byId(id).value = value || ""; });
      autoCalculateTravelSettlement();
    }
    if (submit) {
      submit.hidden = false; submit.dataset.reportId = report.id; submit.dataset.platformAction = "expenses:validate";
      submit.textContent = tr("expenses.action.validate_submit", "Valider et soumettre");
      submit.disabled = !editable || !lines.length || missingReceipts.length > 0;
    }
    if (actionHint) {
      actionHint.hidden = false;
      actionHint.className = "expenseActionHint";
      if (!editable && report.status === "submitted") {
        actionHint.textContent = tr("expenses.action.awaiting_approval_hint", "La note alimente maintenant Approbations. Le responsable doit l’approuver ou la renvoyer pour correction.");
        actionHint.classList.add("is-waiting");
      } else if (report.status === "approved") {
        actionHint.textContent = tr("expenses.action.approved_exports_hint", "Note approuvée : les exports comptable et, pour une mission, banque sont maintenant disponibles.");
        actionHint.classList.add("is-ready");
      } else if (!lines.length) {
        actionHint.textContent = tr("expenses.action.add_line_hint", "Ajoutez au moins une dépense ci-dessous avant de pouvoir soumettre la note vers Approbations.");
      } else if (missingReceipts.length) {
        actionHint.textContent = tr("expenses.action.add_receipts_hint", "Rattachez un justificatif à chaque ligne requise. Il reste {count} justificatif(s) à ajouter.", { count: missingReceipts.length });
      } else if (editable) {
        actionHint.textContent = tr("expenses.action.ready_to_submit_hint", "La note est complète. Cliquez sur « Valider et soumettre » pour alimenter Approbations.");
        actionHint.classList.add("is-ready");
      } else {
        actionHint.textContent = tr("expenses.action.closed_hint", "Cette note n’est plus modifiable dans son statut actuel.");
      }
    }
    const proofByLine = new Map(receipts.filter((receipt) => receipt.expense_line_id).map((receipt) => [String(receipt.expense_line_id), receipt]));
    const body = byId("expense-lines-body"); clear(body);
    for (const line of lines) {
      const row = document.createElement("tr");
      row.append(cell(line.occurred_on), cell(line.merchant), cell(categoryLabel(line.category)), cell(paymentLabel(line.payment_method)), cell(line.business_purpose), cell(money(line.gross_amount, line.currency), "numeric"), cell(money(line.personal_amount, line.currency), "numeric"));
      const proof = document.createElement("td"); const receipt = proofByLine.get(String(line.id));
      if (receipt) proof.append(actionButton(tr("expenses.action.view", "Voir"), "expenses:viewReceipt", receipt.id, "secondary"));
      else proof.append(badge(line.receipt_required === false ? "approved" : "returned"));
      row.append(proof); body?.append(row);
    }
    const receiptList = byId("expense-receipts-list"); clear(receiptList);
    for (const receipt of receipts) {
      const card = document.createElement("article"); const meta = document.createElement("div"); const name = document.createElement("strong"); const info = document.createElement("small");
      name.textContent = receipt.original_filename; info.textContent = Math.max(1, Math.round(number(receipt.byte_size) / 1024)) + " " + tr("common.kilobyte", "KB") + " · " + String(receipt.sha256 || "").slice(0, 12) + "… · " + (receipt.extraction_status === "suggested" ? tr("expenses.receipt.extracted", "champs suggérés à contrôler") : receipt.security_status === "verified" ? tr("expenses.receipt.verified", "vérifié") : tr("expenses.receipt.checking", "en contrôle")); meta.append(name, info);
      const actions = document.createElement("div"); actions.className = "platformActions";
      actions.append(actionButton(tr("expenses.action.consult", "Consulter"), "expenses:viewReceipt", receipt.id, "secondary"));
      if (receipt.extraction_status === "suggested") actions.append(actionButton(tr("expenses.action.apply_extraction", "Reprendre les champs"), "expenses:applyExtraction", receipt.id, "primary"));
      else if (editable && receipt.security_status === "verified") actions.append(actionButton(tr("expenses.action.analyze", "Analyser"), "expenses:analyzeReceipt", receipt.id, "secondary"));
      card.append(meta, actions); receiptList?.append(card);
    }
    if (!receipts.length) { const empty = document.createElement("p"); empty.className = "platformEmpty"; empty.textContent = tr("expenses.receipt.none", "Aucun justificatif enregistré."); receiptList?.append(empty); }
  }

  function reportNumberButton(report) {
    const numberCell = document.createElement("td"), button = document.createElement("button");
    button.type = "button"; button.className = "platformLink"; button.dataset.platformAction = "expenses:select"; button.dataset.reportId = report.id; button.textContent = report.report_number; numberCell.append(button); return numberCell;
  }

  function renderExpenses(data) {
    local.expenses = data;
    const allReports = data.reports || [];
    const claimantSelect = byId("expense-claimant-filter");
    if (claimantSelect) {
      const value = claimantSelect.value; clear(claimantSelect); const all = document.createElement("option"); all.value = ""; all.textContent = data.access?.scope === "personal" ? tr("expenses.reports.mine", "Mes notes") : tr("expenses.reports.all_users", "Tous les utilisateurs"); claimantSelect.append(all);
      for (const claimant of data.claimants || []) { const option = document.createElement("option"); option.value = claimant.id; option.textContent = claimant.name; claimantSelect.append(option); }
      claimantSelect.value = [...claimantSelect.options].some((option) => option.value === value) ? value : ""; claimantSelect.disabled = data.access?.scope === "personal";
    }
    const search = String(byId("expense-report-search")?.value || "").trim().toLowerCase();
    const claimant = String(byId("expense-claimant-filter")?.value || ""); const statusFilter = String(byId("expense-status-filter")?.value || "");
    const reports = allReports.filter((report) => (!search || [report.report_number, report.title, report.claimant_name, report.claimant_id].some((value) => String(value || "").toLowerCase().includes(search))) && (!claimant || String(report.claimant_id) === claimant) && (!statusFilter || report.status === statusFilter));
    if (!allReports.some((item) => String(item.id) === String(local.selectedReportId))) local.selectedReportId = allReports[0]?.id || "";
    setText("expense-draft-count", data.summary?.draft || 0); setText("expense-submitted-count", data.summary?.submitted || 0);
    setText("expense-approved-count", data.summary?.approved || 0); setText("expense-approved-total", money(data.summary?.totalApproved || 0));
    const submitted = allReports.filter((report) => report.can_approve === true);
    setText("expense-approval-count", submitted.length); setText("expense-approval-findings", submitted.filter((report) => (report.findings || []).length).length);

    const body = byId("expense-reports-body"); clear(body); const mobile = byId("expense-mobile-reports"); clear(mobile);
    for (const report of reports) {
      const lines = reportLines(report.id), receipts = reportReceipts(report.id), missing = missingReceiptLines(report.id);
      const row = document.createElement("tr"); if (String(report.id) === String(local.selectedReportId)) row.classList.add("is-selected");
      row.append(reportNumberButton(report), cell(report.claimant_name || report.claimant_id), cell(reportTypeLabel(report.document_type)), cell(report.title), cell(String(report.updated_at || "").slice(0, 10)), cell(money(report.total_gross, report.currency), "numeric"), cell(money(report.personal_amount, report.currency), "numeric"), cell(money(report.reimbursable_amount, report.currency), "numeric"), cell(receipts.length + "/" + lines.filter((line) => line.receipt_required !== false).length));
      const status = document.createElement("td"); status.append(badge(report.status)); row.append(status);
      const actions = document.createElement("td"); actions.className = "platformActions";
      if (report.can_edit && !lines.length) actions.append(actionButton(tr("expenses.action.add_expense", "Ajouter une dépense"), "expenses:select", report.id, "primary"));
      else if (report.can_edit && missing.length) actions.append(actionButton(tr("expenses.action.add_receipt", "Ajouter un justificatif"), "expenses:openCapture", report.id, "primary"));
      else if (report.can_edit) actions.append(actionButton(tr("expenses.action.validate_submit", "Valider et soumettre"), "expenses:validate", report.id, "primary"));
      else if (report.can_approve) actions.append(actionButton(tr("expenses.action.review", "Examiner"), "expenses:openApproval", report.id, "secondary"));
      else actions.append(actionButton(tr("expenses.action.open", "Ouvrir"), "expenses:select", report.id, "secondary"));
      row.append(actions); body?.append(row);

      const card = document.createElement("article"); card.className = "expenseMobileCard"; const head = document.createElement("header"); const headText = document.createElement("div"); const numberLabel = document.createElement("strong"); const purpose = document.createElement("span");
      numberLabel.textContent = report.report_number; purpose.textContent = report.title; headText.append(numberLabel, purpose); head.append(headText, badge(report.status));
      const stats = document.createElement("div"); stats.className = "expenseMobileCard__stats"; stats.append(Object.assign(document.createElement("span"), { textContent: money(report.total_gross, report.currency) }), Object.assign(document.createElement("span"), { textContent: receipts.length + " " + tr("expenses.mobile.evidence_count", "preuve(s)") }), Object.assign(document.createElement("span"), { textContent: String(report.updated_at || "").slice(0, 10) }));
      const mobileActions = document.createElement("footer"); mobileActions.append(actionButton(tr("expenses.action.open", "Ouvrir"), "expenses:select", report.id, "secondary")); if (report.can_edit) mobileActions.append(actionButton(missing.length ? tr("expenses.action.add_evidence", "Ajouter une preuve") : tr("expenses.action.complete", "Compléter"), missing.length ? "expenses:openCapture" : "expenses:select", report.id, "primary"));
      card.append(head, stats, mobileActions); mobile?.append(card);
    }
    toggleEmpty("expense-reports-empty", reports.length);

    const approvals = byId("expense-approvals-body"); clear(approvals);
    for (const report of submitted) {
      const row = document.createElement("tr"); row.append(reportNumberButton(report), cell(report.title), cell(report.claimant_name || report.claimant_id), cell(money(report.eligible_amount || report.total_gross, report.currency), "numeric"));
      row.append(cell((report.findings || []).length ? (report.findings || []).length + " " + tr("expenses.approvals.finding_count", "constat(s)") : tr("expenses.approvals.no_finding", "Aucun constat")));
      const actions = document.createElement("td"); actions.className = "platformActions"; actions.append(actionButton(tr("expenses.action.approve", "Approuver"), "expenses:approve", report.id, "primary"), actionButton(tr("expenses.action.return", "À corriger"), "expenses:return", report.id, "secondary"), actionButton(tr("expenses.action.reject", "Refuser"), "expenses:reject", report.id, "danger")); row.append(actions); approvals?.append(row);
    }
    toggleEmpty("expense-approvals-empty", submitted.length);
    const queue = byId("expenses-action-queue"); clear(queue); const incomplete = allReports.filter((report) => report.can_edit && (!reportLines(report.id).length || missingReceiptLines(report.id).length));
    if (!local.expenseFoundationReady && !local.lifetimeLicense) queue?.append(taskButton(tr("expenses.task.activate", "Activer D2F Expenses"), tr("expenses.task.activate_hint", "Créer une demande suivie pour activer l’enregistrement"), "platform:requestActivation", { label: tr("platform.action.request", "Demander →"), application: "expenses" }));
    if (incomplete.length) queue?.append(taskButton(incomplete.length + " " + tr("expenses.task.incomplete", "note(s) à compléter"), tr("expenses.task.incomplete_hint", "Ajoutez les lignes ou justificatifs manquants"), "", { go: "expenses-reports" }));
    if (submitted.length) queue?.append(taskButton(submitted.length + " " + tr("expenses.task.approval", "note(s) à approuver"), tr("expenses.task.approval_hint", "Examiner les contrôles puis prendre une décision"), "", { go: "expenses-approvals", urgent: true }));
    if (!queue?.children.length) queue?.append(taskButton(tr("platform.task.clear", "Aucun traitement urgent"), tr("expenses.task.clear_hint", "Créez une note ou consultez l’historique."), "", { go: "expenses-reports", label: tr("expenses.action.create", "Créer une note →") }));
    renderCaptureSelection(allReports); renderExpenseDetail(); renderCountryPack(data.countryPack); renderPackState(data.countryPack);
  }

  function renderCountryPack(pack = {}) {
    const rules = byId("expenses-country-rules"), sources = byId("expenses-country-sources"); clear(rules); clear(sources);
    for (const rule of pack.rules || []) {
      const card = document.createElement("article"); card.className = "platformRuleCard" + (pack.status === "qualified" ? "" : " platformRuleCard--pending");
      const title = document.createElement("strong"); title.textContent = rule.id || "rule";
      const detail = document.createElement("p"); const limit = rule.limit || {}; detail.textContent = [rule.kind, rule.effect, limit.amount != null ? limit.amount + " " + (limit.currency || pack.currency || "") : ""].filter(Boolean).join(" · ");
      card.append(title, detail); rules?.append(card);
    }
    for (const source of pack.sources || []) { const row=document.createElement("div"); row.className="expenseReceiptItem"; const text=document.createElement("span"); const strong=document.createElement("strong"); strong.textContent=source.authority || tr("common.source", "Source"); const small=document.createElement("small"); small.textContent=source.title || source.id || ""; text.append(strong,small); const link=document.createElement("a"); link.className="btn btn--secondary btn--compact"; link.href=source.url; link.target="_blank"; link.rel="noopener noreferrer"; link.textContent=tr("expenses.rules.official_source", "Source officielle"); row.append(text,link); sources?.append(row); }
  }

  function renderPackState(workspacePack) {
    const capability = window.D2FPlatformCapabilities?.countryPack || {};
    const financial = capability.modules?.financial || { country: capability.country || "—", status: "not_qualified", reason: "no_published_financial_pack" };
    const expenses = workspacePack || capability.modules?.expenses || { country: capability.country || "—", status: "not_qualified", reason: "no_published_expenses_pack" };
    const stateLabel = (pack, module) => (pack.country || "—") + " · " + (pack.status === "qualified"
      ? tr("expenses.pack.qualified", "Country Pack " + module + " qualifié", { module })
      : tr("expenses.pack.unqualified", "Country Pack " + module + " non qualifié", { module }));
    setText("financial-country-pack", stateLabel(financial, "Financial"));
    setText("expense-country-pack", stateLabel(expenses, "Expenses"));
    setText("expenses-rules-pack", stateLabel(expenses, "Expenses"));
    setText("financial-pack-rule", financial.packId || "country." + String(financial.country || "").toLowerCase() + ".financial");
    setText("expenses-pack-rule", expenses.packId || "country." + String(expenses.country || "").toLowerCase() + ".expenses");
    setText("financial-pack-version", financial.version ? financial.version + " · " + tr("expenses.pack.qualified_short", "Qualifié") : tr("expenses.pack.unpublished", "Non publié") + " · " + (financial.reason || "qualification_required"));
    setText("expenses-pack-version", expenses.version ? expenses.version + " · " + (expenses.status === "qualified" ? tr("expenses.pack.qualified_short", "Qualifié") : tr("expenses.pack.validation_required", "Validation requise")) : tr("expenses.pack.unpublished", "Non publié") + " · " + (expenses.reason || "qualification_required"));
    const financialStatus = byId("financial-pack-status");
    if (financialStatus) { financialStatus.className = "platformStatus platformStatus--" + (financial.status === "qualified" ? "approved" : "submitted"); financialStatus.textContent = financial.status === "qualified" ? tr("expenses.pack.qualified_short", "Qualifié") : tr("expenses.pack.validation_required", "Validation requise"); }
    byId("financial-country-notice")?.toggleAttribute("hidden", financial.status === "qualified");
    byId("expenses-country-notice")?.toggleAttribute("hidden", expenses.status === "qualified");
  }

  async function refreshFinancial() { renderFinancial(await loadFinancial()); }
  async function refreshExpenses() {
    if (byId("expense-line-date") && !byId("expense-line-date").value) byId("expense-line-date").value = new Date().toISOString().slice(0, 10);
    if (window.D2FPlatformPreview) { local.expenseFoundationReady = false; showFoundation("expenses", false); renderExpenses({ reports: [], lines: [], receipts: [], summary: {} }); return; }
    try {
      local.expenseFoundationReady = true;
      showFoundation("expenses", true);
      const [workspace, company] = await Promise.all([window.api.expenses.workspace(), window.api.company.get().catch(() => ({}))]);
      local.companyCurrency = String(company?.currency || "EUR").toUpperCase();
      local.companyCountry = String(company?.country || "").toUpperCase();
      if (byId("expense-report-currency") && !byId("expense-report-currency").dataset.userEdited) byId("expense-report-currency").value = local.companyCurrency;
      renderExpenses(workspace);
    }
    catch (error) {
      const message = String(error?.message || error || "");
      const foundationMissing = /socle .*Expenses|relation .*d2f_expense_reports.*does not exist|d2f_expense_reports.*introuvable/i.test(message);
      local.expenseFoundationReady = !foundationMissing; showFoundation("expenses", !foundationMissing); console.info("[expenses] workspace unavailable", message);
      renderExpenses({ reports: [], lines: [], receipts: [], summary: {} });
      const status = byId("appStatus"); if (status) status.textContent = foundationMissing
        ? tr("expenses.foundation.pending", "Interface prête · activation de la base Expenses requise pour enregistrer")
        : tr("expenses.workspace.error", "Expenses indisponible : ") + message;
    }
  }

  function selectedExpenseReport() { return (local.expenses?.reports || []).find((item) => String(item.id) === String(local.selectedReportId)); }
  function applyReceiptExtraction(receiptId) {
    const receipt = (local.expenses?.receipts || []).find((item) => String(item.id) === String(receiptId));
    const fields = receipt?.extraction || {};
    const values = {
      "expense-line-date": fields.occurredOn,
      "expense-line-merchant": fields.merchant,
      "expense-line-description": fields.description || fields.merchant,
      "expense-line-country": fields.country,
      "expense-line-original-currency": fields.originalCurrency,
      "expense-line-original-gross": fields.originalGrossAmount,
      "expense-line-net": fields.netAmount,
      "expense-line-tax": fields.taxAmount,
    };
    Object.entries(values).forEach(([id, value]) => { if (byId(id) && value !== undefined && value !== null && value !== "") byId(id).value = value; });
    if (fields.category && byId("expense-line-category")?.querySelector(`option[value="${CSS.escape(String(fields.category))}"]`)) byId("expense-line-category").value = fields.category;
    byId("expense-line-merchant")?.focus();
  }
  function expenseInput() {
    const report = selectedExpenseReport();
    return { reportId: local.selectedReportId, occurredOn: byId("expense-line-date")?.value, merchant: byId("expense-line-merchant")?.value, description: byId("expense-line-description")?.value,
      category: byId("expense-line-category")?.value, paymentMethod: byId("expense-line-payment-method")?.value, personalAmount: byId("expense-line-personal")?.value, businessPurpose: byId("expense-line-purpose")?.value, netAmount: byId("expense-line-net")?.value, taxAmount: byId("expense-line-tax")?.value,
      grossAmount: number(byId("expense-line-net")?.value) + number(byId("expense-line-tax")?.value), country: byId("expense-line-country")?.value, currency: report?.currency || "EUR",
      originalCurrency: (byId("expense-line-original-currency")?.value || report?.currency || "EUR").toUpperCase(), originalGrossAmount: byId("expense-line-original-gross")?.value || number(byId("expense-line-net")?.value) + number(byId("expense-line-tax")?.value),
      tripScope: byId("expense-trip-scope")?.value, mealContext: byId("expense-meal-context")?.value, distanceKm: byId("expense-distance-km")?.value, vehicleFiscalPower: byId("expense-vehicle-power")?.value, annualBusinessKm: byId("expense-annual-km")?.value, durationHours: byId("expense-duration-hours")?.value, overnight: Boolean(byId("expense-overnight")?.checked), differentMunicipality: Boolean(byId("expense-different-municipality")?.checked), expenseTerritory: byId("expense-line-country")?.value, traceablePayment: !String(byId("expense-line-payment-method")?.value || "").includes("cash") };
  }
  function travelWorkflowInput() {
    return { order: {
      orderNumber: byId("expense-travel-order-number")?.value, orderDate: byId("expense-travel-order-date")?.value,
      traveler: byId("expense-travel-traveler")?.value, travelerRole: byId("expense-travel-role")?.value,
      destinationCity: byId("expense-travel-destination-city")?.value, destinationCountry: byId("expense-travel-destination-country")?.value,
      departureAt: byId("expense-travel-departure")?.value, expectedReturnAt: byId("expense-travel-expected-return")?.value,
      transportMode: byId("expense-travel-transport")?.value, route: byId("expense-travel-route")?.value,
      purpose: byId("expense-travel-purpose")?.value, rsdAccount: byId("expense-travel-rsd-account")?.value,
      fxAccount: byId("expense-travel-fx-account")?.value, companyActivity: byId("expense-travel-company-activity")?.value,
      costBearer: "Company"
    }, settlement: {
      actualReturnAt: byId("expense-travel-actual-return")?.value, durationHours: byId("expense-travel-duration")?.value,
      perDiemDays: byId("expense-travel-perdiem-days")?.value, perDiemRate: byId("expense-travel-perdiem-rate")?.value,
      perDiemCurrency: byId("expense-travel-perdiem-currency")?.value,
      corporateCardAmount: byId("expense-travel-corporate-card")?.value, advanceAmount: byId("expense-travel-advance")?.value,
      reimbursementRsd: byId("expense-travel-reimbursement-rsd")?.value,
      reimbursementForeign: byId("expense-travel-reimbursement-fx")?.value,
      reimbursementForeignCurrency: byId("expense-travel-reimbursement-fx-currency")?.value
    }};
  }
  function validationRates() {
    const rates = {};
    const values = [byId("expense-validation-rates")?.value, byId("expense-company-validation-rates")?.value].filter(Boolean).join(",");
    String(values).split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
      const [currency, rawRate] = part.split("="); const rate = Number(rawRate);
      if (currency && Number.isFinite(rate) && rate > 0) rates[currency.trim().toUpperCase()] = { rate };
    });
    return rates;
  }
  function ensureCompanyExpenseRateField(report, editable) {
    let box = byId("expense-company-rate-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "expense-company-rate-box";
      box.className = "platformFieldWide expenseRateBox";
      const title = document.createElement("strong");
      title.textContent = tr("expenses.travel.exchange_rate_title", "Taux de change à la validation");
      const hint = document.createElement("p");
      hint.textContent = tr("expenses.travel.exchange_rate_hint", "Indiquez le taux officiel sous la forme EUR=117.20 : 1 EUR = 117,20 RSD.");
      const input = document.createElement("input");
      input.id = "expense-company-validation-rates";
      input.type = "text";
      input.placeholder = "EUR=117.20";
      input.addEventListener("input", autoConvertExpenseLine);
      input.addEventListener("change", autoConvertExpenseLine);
      box.append(title, hint, input);
      byId("expense-line-form")?.insertBefore(box, byId("expense-line-form")?.querySelector("button") || null);
    }
    box.hidden = !editable || report?.document_type === "travel_order";
  }
  function autoCalculateTravelSettlement() {
    const report = selectedExpenseReport();
    if (!report || report.document_type !== "travel_order") return;
    const accountingCurrency = String(report.currency || "EUR").toUpperCase();
    const rates = validationRates();
    const lines = reportLines(report.id);
    const corporateCard = lines
      .filter((line) => line.payment_method === "corporate_card")
      .reduce((sum, line) => sum + number(line.gross_amount), 0);
    const personallyPaid = lines
      .filter((line) => ["personal_card", "personal_cash", "other"].includes(line.payment_method))
      .reduce((sum, line) => sum + Math.max(0, number(line.gross_amount) - number(line.personal_amount)), 0);
    const days = number(byId("expense-travel-perdiem-days")?.value);
    const daily = number(byId("expense-travel-perdiem-rate")?.value);
    const perDiemCurrency = String(byId("expense-travel-perdiem-currency")?.value || accountingCurrency).toUpperCase();
    const perDiemTotal = Math.round(days * daily * 100) / 100;
    const advance = number(byId("expense-travel-advance")?.value);
    let localReimbursement = Math.max(0, personallyPaid - advance);
    let foreignReimbursement = 0;
    if (perDiemCurrency === accountingCurrency) {
      localReimbursement += perDiemTotal;
    } else {
      foreignReimbursement = perDiemTotal;
      const rate = number(rates[perDiemCurrency]?.rate);
      if (rate > 0 && advance > personallyPaid) {
        foreignReimbursement = Math.max(0, foreignReimbursement - (advance - personallyPaid) / rate);
      }
    }
    if (byId("expense-travel-corporate-card")) byId("expense-travel-corporate-card").value = corporateCard.toFixed(2);
    if (byId("expense-travel-reimbursement-rsd")) byId("expense-travel-reimbursement-rsd").value = localReimbursement.toFixed(2);
    if (byId("expense-travel-reimbursement-fx")) byId("expense-travel-reimbursement-fx").value = foreignReimbursement.toFixed(2);
    if (byId("expense-travel-reimbursement-fx-currency")) byId("expense-travel-reimbursement-fx-currency").value = foreignReimbursement > 0 ? perDiemCurrency : accountingCurrency;
  }
  function applyPerDiemCurrencyForDestination() {
    const destination = String(byId("expense-travel-destination-country")?.value || "").toUpperCase();
    if (!destination) return;
    const currency = destination === local.companyCountry ? local.companyCurrency : "EUR";
    if (byId("expense-travel-perdiem-currency")) byId("expense-travel-perdiem-currency").value = currency;
    if (byId("expense-travel-reimbursement-fx-currency")) byId("expense-travel-reimbursement-fx-currency").value = currency;
    autoCalculateTravelSettlement();
  }
  function autoConvertExpenseLine() {
    const report = selectedExpenseReport();
    const accountingCurrency = String(report?.currency || local.companyCurrency || "EUR").toUpperCase();
    const originalCurrency = String(byId("expense-line-original-currency")?.value || accountingCurrency).toUpperCase();
    const originalGross = number(byId("expense-line-original-gross")?.value);
    if (!originalGross) return;
    const rate = originalCurrency === accountingCurrency ? 1 : number(validationRates()[originalCurrency]?.rate);
    if (!rate) return;
    const converted = Math.round(originalGross * rate * 100) / 100;
    if (byId("expense-line-net")) byId("expense-line-net").value = converted.toFixed(2);
    if (byId("expense-line-tax") && !number(byId("expense-line-tax").value)) byId("expense-line-tax").value = "0.00";
  }
  function downloadRpcFile(file) {
    if (!file?.downloadBase64) throw new Error(tr("expenses.error.file_unavailable", "Fichier indisponible"));
    const binary = atob(file.downloadBase64); const bytes = new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:file.mimeType||"application/octet-stream"}));
    const link=document.createElement("a"); link.href=url; link.download=file.fileName||"d2f-export"; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function receiptPayload(file) {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) throw new Error(tr("expenses.capture.too_large", "Le justificatif dépasse 10 Mo"));
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) throw new Error(tr("expenses.capture.invalid_type", "Utilisez JPEG, PNG, WebP ou PDF"));
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { filename: file.name, mimeType: file.type, size: file.size, contentBase64: btoa(binary), capturedAt: new Date().toISOString() };
  }
  function renderPendingReceipt() {
    const ready = byId("expense-receipt-ready"); if (!ready) return; ready.hidden = !local.pendingReceipt;
    setText("expense-receipt-name", local.pendingReceipt?.filename || ""); setText("expense-receipt-meta", local.pendingReceipt ? Math.max(1, Math.round(local.pendingReceipt.size / 1024)) + " " + tr("common.kilobyte", "KB") + " · " + local.pendingReceipt.mimeType : "");
  }
  async function selectReceiptFile(file) { local.pendingReceipt = await receiptPayload(file); renderPendingReceipt(); }
  function optionalLocation() {
    if (!byId("expense-location-consent")?.checked || !navigator.geolocation) return Promise.resolve(null);
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition((position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }), () => resolve(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }));
  }
  function assertExpenseFoundation() {
    if (!local.expenseFoundationReady) throw new Error(tr("expenses.foundation.required", "Le socle de données Expenses doit être activé avant l’enregistrement."));
  }

  async function handleAction(action, reportId, application) {
    if (reportId) { local.selectedReportId = reportId; local.selectedFinancialInvoiceId = reportId; }
    if (action === "financial:refresh") return refreshFinancial();
    if (action === "financial:exportAccounting") {
      downloadRpcFile(await window.api.financial.exportAccounting({ locale: locale() }));
      return;
    }
    if (action === "platform:requestActivation") return requestActivation(application || "financial");
    if (action === "financial:filterOpen" || action === "financial:filterOverdue") { local.financialFilter = action.endsWith("Overdue") ? "overdue" : "open"; renderFinancial(local.financial); window.D2FShowPage?.("financial-reconciliation"); return; }
    if (action === "financial:recordPayment" || action === "financial:viewPayments") { window.D2FOpenPayment?.(local.selectedFinancialInvoiceId || reportId); return; }
    if (action === "expenses:refresh") return refreshExpenses();
    if (action === "financial:simulate") {
      const amount = number(byId("financial-rule-amount")?.value);
      setText("financial-rule-result", amount > 0
        ? tr("financial.rules.result_incomplete", "Contrôles génériques réussis. Résultat comptable pays : incomplet tant que le Country Pack n’est pas qualifié.")
        : tr("financial.rules.result_missing", "Montant manquant : la simulation est incomplète, aucune valeur zéro n’est supposée."));
      return;
    }
    if (action === "expenses:pickReceipt") { byId("expense-receipt-file")?.click(); return; }
    if (action === "expenses:viewReceipt") { const access = await window.api.expenses.receiptAccess({ id: reportId }); const opened = window.open(access.url, "_blank", "noopener,noreferrer"); if (!opened) setText("appStatus", tr("expenses.error.popup_blocked", "Autorisez l’ouverture du justificatif dans un nouvel onglet.")); return; }
    if (action === "expenses:analyzeReceipt") { await window.api.expenses.analyzeReceipt({ id: reportId }); return refreshExpenses(); }
    if (action === "expenses:applyExtraction") { applyReceiptExtraction(reportId); return; }
    if (action === "expenses:openCapture") { renderExpenses(local.expenses || { reports: [], lines: [], receipts: [], summary: {} }); window.D2FShowPage?.("expenses-capture"); return; }
    if (action === "expenses:openApproval") { window.D2FShowPage?.("expenses-approvals"); return; }
    if (action === "expenses:focusLine") { byId("expense-line-merchant")?.focus(); return; }
    assertExpenseFoundation();
    if (action === "expenses:uploadReceipt") {
      if (!local.selectedReportId) throw new Error(tr("expenses.capture.no_report", "Sélectionnez d’abord une note de frais"));
      if (!local.pendingReceipt) throw new Error(tr("expenses.capture.no_file", "Prenez une photo ou choisissez un fichier"));
      const location = await optionalLocation();
      await window.api.expenses.uploadReceipt({ ...local.pendingReceipt, reportId: local.selectedReportId, expenseLineId: byId("expense-receipt-line")?.value || "", location,
        origin: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "smartphone_capture" : "manual_upload",
        deviceContext: { userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } } });
      local.pendingReceipt = null; if (byId("expense-receipt-file")) byId("expense-receipt-file").value = ""; renderPendingReceipt(); return refreshExpenses();
    }
    if (action === "expenses:select") { renderExpenses(local.expenses || { reports: [], lines: [], receipts: [], summary: {} }); window.D2FShowPage?.("expenses-reports"); return; }
    if (action === "expenses:createReport") {
      const created = await window.api.expenses.createReport({ title: byId("expense-report-title")?.value || "", currency: byId("expense-report-currency")?.value || "EUR", documentType: byId("expense-report-type")?.value || "company_expense" });
      local.selectedReportId = created.id; if (byId("expense-report-title")) byId("expense-report-title").value = ""; return refreshExpenses();
    }
    if (action === "expenses:addLine") {
      await window.api.expenses.addLine(expenseInput()); for (const id of ["expense-line-merchant", "expense-line-description", "expense-line-purpose", "expense-line-net", "expense-line-tax", "expense-line-personal", "expense-line-original-gross"]) if (byId(id)) byId(id).value = ""; return refreshExpenses();
    }
    if (action === "expenses:suggestNecessity") {
      const activity = byId("expense-travel-company-activity")?.value || tr("expenses.necessity.default_activity", "les activités déclarées de l’entreprise");
      const purpose = byId("expense-travel-purpose")?.value || selectedExpenseReport()?.title || tr("expenses.necessity.default_purpose", "la mission professionnelle");
      const destination = byId("expense-travel-destination-city")?.value || tr("expenses.necessity.default_destination", "la destination indiquée");
      if (byId("expense-travel-necessity")) byId("expense-travel-necessity").value = tr("expenses.necessity.template", "Le déplacement à {destination} est nécessaire pour {purpose}. Il est directement lié à {activity}.", { destination, purpose, activity });
      return;
    }
    if (action === "expenses:saveWorkflow") {
      await window.api.expenses.updateWorkflow({ id: local.selectedReportId, documentType: "travel_order", workflowData: travelWorkflowInput(), missionReport: byId("expense-travel-report")?.value, businessNecessity: byId("expense-travel-necessity")?.value });
      return refreshExpenses();
    }
    if (action === "expenses:validate") {
      const report = selectedExpenseReport();
      if (report?.document_type === "travel_order") await window.api.expenses.updateWorkflow({ id: local.selectedReportId, documentType: "travel_order", workflowData: travelWorkflowInput(), missionReport: byId("expense-travel-report")?.value, businessNecessity: byId("expense-travel-necessity")?.value });
      const validateExpense = window.api.expenses.validate || window.api.expenses.submit;
      await validateExpense({ id: local.selectedReportId, rates: validationRates(), idempotencyKey: "expense:validate:" + local.selectedReportId });
      return refreshExpenses();
    }
    if (action === "expenses:exportAccountant") { downloadRpcFile(await window.api.expenses.exportAccountant({ id: local.selectedReportId, locale: locale() })); return; }
    if (action === "expenses:exportTravel") {
      downloadRpcFile(await window.api.expenses.exportDocument({ id: local.selectedReportId, type: "travel_order", locale: locale() }));
      downloadRpcFile(await window.api.expenses.exportDocument({ id: local.selectedReportId, type: "travel_account", locale: locale() })); return;
    }
    if (action === "expenses:exportBank") { downloadRpcFile(await window.api.expenses.exportDocument({ id: local.selectedReportId, type: "bank_reimbursement", locale: locale() })); return; }
    const decisions = { "expenses:approve": "approved", "expenses:reject": "rejected", "expenses:return": "returned" };
    if (decisions[action]) {
      await window.api.expenses.decide({ id: local.selectedReportId, decision: decisions[action], note: byId("expense-decision-note")?.value || "", idempotencyKey: "expense:decision:" + decisions[action] + ":" + local.selectedReportId });
      if (byId("expense-decision-note")) byId("expense-decision-note").value = ""; return refreshExpenses();
    }
  }

  byId("expense-capture-report-select")?.addEventListener("change", (event) => { local.selectedReportId = event.target.value; renderExpenseDetail(); });
  byId("expense-receipt-file")?.addEventListener("change", (event) => selectReceiptFile(event.target.files?.[0]).catch((error) => setText("appStatus", error.message)));
  const drop = byId("expense-receipt-drop");
  drop?.addEventListener("click", (event) => { if (!event.target.closest("button")) byId("expense-receipt-file")?.click(); });
  drop?.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); byId("expense-receipt-file")?.click(); } });
  for (const name of ["dragenter", "dragover"]) drop?.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("is-dragging"); });
  for (const name of ["dragleave", "drop"]) drop?.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("is-dragging"); });
  drop?.addEventListener("drop", (event) => selectReceiptFile(event.dataTransfer?.files?.[0]).catch((error) => setText("appStatus", error.message)));

  for (const id of ["expense-report-search", "expense-claimant-filter", "expense-status-filter"]) byId(id)?.addEventListener(id === "expense-report-search" ? "input" : "change", () => { if (local.expenses) renderExpenses(local.expenses); });
  for (const id of ["expense-travel-perdiem-days", "expense-travel-perdiem-rate", "expense-travel-perdiem-currency", "expense-travel-advance", "expense-validation-rates"]) {
    byId(id)?.addEventListener("input", autoCalculateTravelSettlement);
    byId(id)?.addEventListener("change", autoCalculateTravelSettlement);
  }
  for (const id of ["expense-line-original-currency", "expense-line-original-gross", "expense-validation-rates"]) {
    byId(id)?.addEventListener("input", autoConvertExpenseLine);
    byId(id)?.addEventListener("change", autoConvertExpenseLine);
  }
  byId("expense-travel-destination-country")?.addEventListener("change", applyPerDiemCurrencyForDestination);
  byId("expense-report-currency")?.addEventListener("input", (event) => { event.currentTarget.dataset.userEdited = "true"; });

  document.addEventListener("click", async (event) => {
    const go = event.target.closest("[data-platform-go]");
    if (go) { event.preventDefault(); window.D2FShowPage?.(go.dataset.platformGo); return; }
    const button = event.target.closest("[data-platform-action]"); if (!button) return; event.preventDefault();
    try { button.disabled = true; await handleAction(button.dataset.platformAction, button.dataset.reportId, button.dataset.application); if (button.dataset.platformAction !== "platform:requestActivation") setText("appStatus", tr("platform.status.updated", "D2F Platform actualisée")); }
    catch (error) { setText("appStatus", error?.message || String(error)); } finally { button.disabled = false; }
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.data?.type !== "d2f-platform-license") return;
    local.licenseResolved = true;
    local.lifetimeLicense = event.data.account?.plan === "lifetime" || event.data.account?.billingTerm === "lifetime";
    document.documentElement.dataset.d2fLicense = local.lifetimeLicense ? "lifetime" : "subscription";
    showFoundation("financial", local.financialFoundationReady);
    showFoundation("expenses", local.expenseFoundationReady);
    if (local.financial) renderFinancial(local.financial);
    if (local.expenses) renderExpenses(local.expenses);
  });

  window.D2FFinancialExpenseUI = { refreshFinancial, refreshExpenses, handleAction };
})();
