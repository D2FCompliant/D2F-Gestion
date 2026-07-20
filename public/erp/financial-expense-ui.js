(function () {
  const local = { financial: null, expenses: null, selectedReportId: "", pendingReceipt: null, expenseFoundationReady: true, financialFoundationReady: true, financialFilter: "all", lifetimeLicense: false, licenseResolved: false };
  const tr = (key, fallback, vars) => window.__d2fT?.(key, fallback, vars) || fallback;
  const byId = (id) => document.getElementById(id);
  const money = (value, currency = "EUR") => new Intl.NumberFormat(document.documentElement.lang || "fr", {
    style: "currency", currency: currency || "EUR", maximumFractionDigits: 2,
  }).format(Number(value || 0));

  function clear(element) { if (element) element.replaceChildren(); }
  function setText(id, value) { const element = byId(id); if (element) element.textContent = String(value ?? ""); }
  function number(value) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
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
    const isCountryPack = application === "country-pack";
    const applicationLabel = isCountryPack ? "Country Pack " + (window.D2FPlatformCapabilities?.countryPack?.country || "") : (application === "expenses" ? "D2F Expenses" : "D2F Financial");
    const response = await fetch("/auth/support", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: isCountryPack ? "compliance" : "billing", priority: "normal", requestType: "need", locale: document.documentElement.lang || "fr",
        subject: (isCountryPack ? "Qualification du " : "Activation de ") + applicationLabel,
        description: isCountryPack ? "Merci de qualifier et publier le Country Pack applicable à cet établissement avant toute décision réglementaire." : "Merci d’activer le socle de données " + application + " pour rendre opérationnels les traitements proposés dans D2F Platform.",
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
    const title = byId("expense-selected-title"), detail = byId("expense-selected-detail"), lineForm = byId("expense-line-form"), submit = byId("expense-submit-selected");
    if (!report) {
      if (title) title.textContent = tr("expenses.detail.select", "Sélectionnez une note de frais");
      if (detail) detail.textContent = tr("expenses.detail.empty", "Les lignes et justificatifs apparaîtront ici.");
      setText("expense-capture-report", tr("expenses.capture.no_report", "Sélectionnez d’abord une note de frais"));
      if (lineForm) lineForm.hidden = true; if (submit) submit.hidden = true;
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
    if (submit) {
      submit.hidden = !editable; submit.dataset.reportId = report.id;
      if (!lines.length) { submit.dataset.platformAction = "expenses:focusLine"; submit.textContent = tr("expenses.action.add_first_line", "Ajouter la première dépense"); }
      else if (missingReceipts.length) { submit.dataset.platformAction = "expenses:openCapture"; submit.textContent = tr("expenses.action.add_receipts", "Ajouter " + missingReceipts.length + " justificatif(s)"); }
      else { submit.dataset.platformAction = "expenses:submit"; submit.textContent = tr("expenses.action.submit", "Soumettre pour approbation"); }
    }
    const proofByLine = new Map(receipts.filter((receipt) => receipt.expense_line_id).map((receipt) => [String(receipt.expense_line_id), receipt]));
    const body = byId("expense-lines-body"); clear(body);
    for (const line of lines) {
      const row = document.createElement("tr");
      row.append(cell(line.occurred_on), cell(line.merchant), cell(line.category), cell(line.payment_method || "—"), cell(line.business_purpose), cell(money(line.gross_amount, line.currency), "numeric"), cell(money(line.personal_amount, line.currency), "numeric"));
      const proof = document.createElement("td"); const receipt = proofByLine.get(String(line.id));
      if (receipt) proof.append(actionButton("Voir", "expenses:viewReceipt", receipt.id, "secondary"));
      else proof.append(badge(line.receipt_required === false ? "approved" : "returned"));
      row.append(proof); body?.append(row);
    }
    const receiptList = byId("expense-receipts-list"); clear(receiptList);
    for (const receipt of receipts) {
      const card = document.createElement("article"); const meta = document.createElement("div"); const name = document.createElement("strong"); const info = document.createElement("small");
      name.textContent = receipt.original_filename; info.textContent = Math.max(1, Math.round(number(receipt.byte_size) / 1024)) + " Ko · " + String(receipt.sha256 || "").slice(0, 12) + "… · " + (receipt.security_status === "verified" ? "vérifié" : "en contrôle"); meta.append(name, info);
      card.append(meta, actionButton("Consulter", "expenses:viewReceipt", receipt.id, "secondary")); receiptList?.append(card);
    }
    if (!receipts.length) { const empty = document.createElement("p"); empty.className = "platformEmpty"; empty.textContent = "Aucun justificatif enregistré."; receiptList?.append(empty); }
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
      const value = claimantSelect.value; clear(claimantSelect); const all = document.createElement("option"); all.value = ""; all.textContent = data.access?.scope === "personal" ? "Mes notes" : "Tous les utilisateurs"; claimantSelect.append(all);
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
      row.append(reportNumberButton(report), cell(report.claimant_name || report.claimant_id), cell(report.title), cell(String(report.updated_at || "").slice(0, 10)), cell(money(report.total_gross, report.currency), "numeric"), cell(money(report.personal_amount, report.currency), "numeric"), cell(money(report.reimbursable_amount, report.currency), "numeric"), cell(receipts.length + "/" + lines.filter((line) => line.receipt_required !== false).length));
      const status = document.createElement("td"); status.append(badge(report.status)); row.append(status);
      const actions = document.createElement("td"); actions.className = "platformActions";
      if (report.can_edit && !lines.length) actions.append(actionButton(tr("expenses.action.add_expense", "Ajouter une dépense"), "expenses:select", report.id, "primary"));
      else if (report.can_edit && missing.length) actions.append(actionButton(tr("expenses.action.add_receipt", "Ajouter un justificatif"), "expenses:openCapture", report.id, "primary"));
      else if (report.can_edit) actions.append(actionButton(tr("expenses.action.submit", "Soumettre"), "expenses:submit", report.id, "primary"));
      else if (report.can_approve) actions.append(actionButton(tr("expenses.action.review", "Examiner"), "expenses:openApproval", report.id, "secondary"));
      else actions.append(actionButton(tr("expenses.action.open", "Ouvrir"), "expenses:select", report.id, "secondary"));
      row.append(actions); body?.append(row);

      const card = document.createElement("article"); card.className = "expenseMobileCard"; const head = document.createElement("header"); const headText = document.createElement("div"); const numberLabel = document.createElement("strong"); const purpose = document.createElement("span");
      numberLabel.textContent = report.report_number; purpose.textContent = report.title; headText.append(numberLabel, purpose); head.append(headText, badge(report.status));
      const stats = document.createElement("div"); stats.className = "expenseMobileCard__stats"; stats.append(Object.assign(document.createElement("span"), { textContent: money(report.total_gross, report.currency) }), Object.assign(document.createElement("span"), { textContent: receipts.length + " preuve(s)" }), Object.assign(document.createElement("span"), { textContent: String(report.updated_at || "").slice(0, 10) }));
      const mobileActions = document.createElement("footer"); mobileActions.append(actionButton("Ouvrir", "expenses:select", report.id, "secondary")); if (report.can_edit) mobileActions.append(actionButton(missing.length ? "Ajouter une preuve" : "Compléter", missing.length ? "expenses:openCapture" : "expenses:select", report.id, "primary"));
      card.append(head, stats, mobileActions); mobile?.append(card);
    }
    toggleEmpty("expense-reports-empty", reports.length);

    const approvals = byId("expense-approvals-body"); clear(approvals);
    for (const report of submitted) {
      const row = document.createElement("tr"); row.append(reportNumberButton(report), cell(report.title), cell(report.claimant_name || report.claimant_id), cell(money(report.eligible_amount || report.total_gross, report.currency), "numeric"));
      row.append(cell((report.findings || []).length ? (report.findings || []).length + " constat(s)" : tr("expenses.approvals.no_finding", "Aucun constat")));
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
    for (const source of pack.sources || []) { const row=document.createElement("div"); row.className="expenseReceiptItem"; const text=document.createElement("span"); const strong=document.createElement("strong"); strong.textContent=source.authority || "Source"; const small=document.createElement("small"); small.textContent=source.title || source.id || ""; text.append(strong,small); const link=document.createElement("a"); link.className="btn btn--secondary btn--compact"; link.href=source.url; link.target="_blank"; link.rel="noopener noreferrer"; link.textContent="Source officielle"; row.append(text,link); sources?.append(row); }
  }

  function renderPackState(workspacePack) {
    const pack = workspacePack || window.D2FPlatformCapabilities?.countryPack || {};
    const country = pack.country || "—", version = pack.version || "preview";
    const label = country + " · " + (pack.status === "qualified" ? tr("expenses.country_pack.qualified", "Country Pack qualifié") : pack.status === "not_qualified" ? tr("expenses.country_pack.unqualified", "Règles pays non qualifiées") : tr("expenses.country_pack.validation", "Validation des règles pays requise"));
    for (const id of ["expense-country-pack", "expenses-rules-pack", "financial-country-pack"]) setText(id, label);
    setText("financial-pack-rule", "country." + String(country).toLowerCase() + ".accounting"); setText("expenses-pack-rule", "country." + String(country).toLowerCase() + ".expense");
    setText("financial-pack-version", version + " · " + (pack.status || "policy_validation_required")); setText("expenses-pack-version", version + " · " + (pack.status || "policy_validation_required"));
  }

  async function refreshFinancial() { renderFinancial(await loadFinancial()); }
  async function refreshExpenses() {
    if (byId("expense-line-date") && !byId("expense-line-date").value) byId("expense-line-date").value = new Date().toISOString().slice(0, 10);
    if (window.D2FPlatformPreview) { local.expenseFoundationReady = false; showFoundation("expenses", false); renderExpenses({ reports: [], lines: [], receipts: [], summary: {} }); return; }
    try { local.expenseFoundationReady = true; showFoundation("expenses", true); renderExpenses(await window.api.expenses.workspace()); }
    catch (error) {
      local.expenseFoundationReady = false; showFoundation("expenses", false); console.info("[expenses] foundation not active", error?.message || error);
      renderExpenses({ reports: [], lines: [], receipts: [], summary: {} });
      const status = byId("appStatus"); if (status) status.textContent = tr("expenses.foundation.pending", "Interface prête · activation de la base Expenses requise pour enregistrer");
    }
  }

  function expenseInput() {
    return { reportId: local.selectedReportId, occurredOn: byId("expense-line-date")?.value, merchant: byId("expense-line-merchant")?.value, description: byId("expense-line-description")?.value,
      category: byId("expense-line-category")?.value, paymentMethod: byId("expense-line-payment-method")?.value, personalAmount: byId("expense-line-personal")?.value, businessPurpose: byId("expense-line-purpose")?.value, netAmount: byId("expense-line-net")?.value, taxAmount: byId("expense-line-tax")?.value,
      grossAmount: number(byId("expense-line-net")?.value) + number(byId("expense-line-tax")?.value), country: byId("expense-line-country")?.value, currency: byId("expense-report-currency")?.value || "EUR", tripScope: byId("expense-trip-scope")?.value, mealContext: byId("expense-meal-context")?.value, distanceKm: byId("expense-distance-km")?.value, vehicleFiscalPower: byId("expense-vehicle-power")?.value, annualBusinessKm: byId("expense-annual-km")?.value, durationHours: byId("expense-duration-hours")?.value, overnight: Boolean(byId("expense-overnight")?.checked), differentMunicipality: Boolean(byId("expense-different-municipality")?.checked), expenseTerritory: byId("expense-line-country")?.value, traceablePayment: !String(byId("expense-line-payment-method")?.value || "").includes("cash") };
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
    setText("expense-receipt-name", local.pendingReceipt?.filename || ""); setText("expense-receipt-meta", local.pendingReceipt ? Math.max(1, Math.round(local.pendingReceipt.size / 1024)) + " Ko · " + local.pendingReceipt.mimeType : "");
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
    if (action === "expenses:viewReceipt") { const access = await window.api.expenses.receiptAccess({ id: reportId }); const opened = window.open(access.url, "_blank", "noopener,noreferrer"); if (!opened) setText("appStatus", "Autorisez l’ouverture du justificatif dans un nouvel onglet."); return; }
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
      const created = await window.api.expenses.createReport({ title: byId("expense-report-title")?.value || "", currency: byId("expense-report-currency")?.value || "EUR" });
      local.selectedReportId = created.id; if (byId("expense-report-title")) byId("expense-report-title").value = ""; return refreshExpenses();
    }
    if (action === "expenses:addLine") {
      await window.api.expenses.addLine(expenseInput()); for (const id of ["expense-line-merchant", "expense-line-description", "expense-line-purpose", "expense-line-net", "expense-line-tax", "expense-line-personal"]) if (byId(id)) byId(id).value = ""; return refreshExpenses();
    }
    if (action === "expenses:submit") { await window.api.expenses.submit({ id: local.selectedReportId, idempotencyKey: "expense:submit:" + local.selectedReportId }); return refreshExpenses(); }
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
