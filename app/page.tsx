"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ClientStatus = "Actif" | "Prospect" | "En pause";
type DossierStatus = "À qualifier" | "En cours" | "En revue" | "Terminé";
type Priority = "Haute" | "Normale" | "Basse";

type Client = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  status: ClientStatus;
  monthly_revenue: number;
  created_at: string;
};

type Dossier = {
  id: string;
  client_id: string;
  title: string;
  status: DossierStatus;
  due_date: string;
  amount: number;
  progress: number;
  created_at: string;
};

type Task = {
  id: string;
  dossier_id: string | null;
  title: string;
  due_date: string;
  priority: Priority;
  completed: boolean;
  created_at: string;
};

type DashboardData = {
  clients: Client[];
  dossiers: Dossier[];
  tasks: Task[];
};

type Tab = "overview" | "clients" | "dossiers" | "tasks";
type Dialog = "client" | "dossier" | "task" | null;

const today = new Date();
const day = 24 * 60 * 60 * 1000;
const isoDate = (offset: number) =>
  new Date(today.getTime() + offset * day).toISOString().slice(0, 10);

const previewData: DashboardData = {
  clients: [
    { id: "c1", name: "Sofia Martin", company: "Atelier Nova", email: "sofia@atelier-nova.fr", phone: "+33 6 42 18 73 09", status: "Actif", monthly_revenue: 4200, created_at: isoDate(-120) },
    { id: "c2", name: "Thomas Leroy", company: "Kanso Studio", email: "thomas@kanso.studio", phone: "+33 7 80 24 15 62", status: "Actif", monthly_revenue: 2850, created_at: isoDate(-78) },
    { id: "c3", name: "Inès Bernard", company: "Maison Pollen", email: "ines@maisonpollen.com", phone: "+33 6 11 92 40 38", status: "Prospect", monthly_revenue: 1600, created_at: isoDate(-18) },
    { id: "c4", name: "Marc Aubry", company: "Osmose Conseil", email: "marc@osmose-conseil.fr", phone: null, status: "En pause", monthly_revenue: 950, created_at: isoDate(-210) },
  ],
  dossiers: [
    { id: "d1", client_id: "c1", title: "Refonte du parcours client", status: "En cours", due_date: isoDate(8), amount: 12800, progress: 68, created_at: isoDate(-42) },
    { id: "d2", client_id: "c2", title: "Audit conformité T3", status: "En revue", due_date: isoDate(3), amount: 7400, progress: 87, created_at: isoDate(-28) },
    { id: "d3", client_id: "c3", title: "Cadrage opérationnel", status: "À qualifier", due_date: isoDate(16), amount: 3600, progress: 20, created_at: isoDate(-9) },
    { id: "d4", client_id: "c1", title: "Plan de déploiement", status: "Terminé", due_date: isoDate(-5), amount: 5200, progress: 100, created_at: isoDate(-62) },
  ],
  tasks: [
    { id: "t1", dossier_id: "d2", title: "Valider les pièces de contrôle", due_date: isoDate(0), priority: "Haute", completed: false, created_at: isoDate(-4) },
    { id: "t2", dossier_id: "d1", title: "Envoyer le compte rendu à Sofia", due_date: isoDate(1), priority: "Normale", completed: false, created_at: isoDate(-2) },
    { id: "t3", dossier_id: "d3", title: "Préparer l’atelier de cadrage", due_date: isoDate(3), priority: "Normale", completed: false, created_at: isoDate(-1) },
    { id: "t4", dossier_id: "d4", title: "Archiver les livrables", due_date: isoDate(-1), priority: "Basse", completed: true, created_at: isoDate(-6) },
  ],
};

const navItems: Array<{ id: Tab; label: string; marker: string }> = [
  { id: "overview", label: "Vue d’ensemble", marker: "◫" },
  { id: "clients", label: "Clients", marker: "◎" },
  { id: "dossiers", label: "Dossiers", marker: "▤" },
  { id: "tasks", label: "Actions", marker: "✓" },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`));

function daysUntil(value: string) {
  return Math.ceil((new Date(`${value}T23:59:59`).getTime() - Date.now()) / day);
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [data, setData] = useState<DashboardData>(previewData);
  const [mode, setMode] = useState<"loading" | "preview" | "live">("loading");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Configuration indisponible");
        return response.json() as Promise<DashboardData & { mode?: "preview" | "live" }>;
      })
      .then((result) => {
        if (cancelled) return;
        const nextMode = result.mode ?? "live";
        if (nextMode === "live") {
          setData({ clients: result.clients, dossiers: result.dossiers, tasks: result.tasks });
        }
        setMode(nextMode);
      })
      .catch(() => {
        if (!cancelled) setMode("preview");
      });
    return () => { cancelled = true; };
  }, []);

  const metrics = useMemo(() => {
    const openDossiers = data.dossiers.filter((item) => item.status !== "Terminé");
    const urgent = data.tasks.filter((item) => !item.completed && daysUntil(item.due_date) <= 7);
    return {
      revenue: data.clients.reduce((sum, client) => sum + client.monthly_revenue, 0),
      open: openDossiers.length,
      pipeline: openDossiers.reduce((sum, dossier) => sum + dossier.amount, 0),
      urgent: urgent.length,
    };
  }, [data]);

  const clientById = useMemo(
    () => new Map(data.clients.map((client) => [client.id, client])),
    [data.clients],
  );

  const dossierById = useMemo(
    () => new Map(data.dossiers.map((dossier) => [dossier.id, dossier])),
    [data.dossiers],
  );

  const filteredClients = data.clients.filter((client) =>
    `${client.name} ${client.company} ${client.email}`.toLowerCase().includes(search.toLowerCase()),
  );

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3200);
  }

  async function createRecord(entity: "clients" | "dossiers" | "tasks", record: Record<string, unknown>) {
    setSaving(true);
    try {
      if (mode === "live") {
        const response = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entity, record }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Enregistrement impossible");
        setData((current) => ({ ...current, [entity]: [payload.record, ...current[entity]] }));
      } else {
        const localRecord = {
          ...record,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        };
        setData((current) => ({ ...current, [entity]: [localRecord, ...current[entity]] } as DashboardData));
      }
      setDialog(null);
      showNotice(mode === "live" ? "Enregistré dans Supabase" : "Ajouté à l’aperçu local");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Une erreur est survenue");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    const completed = !task.completed;
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? { ...item, completed } : item),
    }));
    if (mode !== "live") return;
    const response = await fetch("/api/dashboard", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "tasks", id: task.id, record: { completed } }),
    });
    if (!response.ok) {
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((item) => item.id === task.id ? task : item),
      }));
      showNotice("La modification n’a pas pu être synchronisée");
    }
  }

  const primaryAction = activeTab === "clients" ? "client" : activeTab === "tasks" ? "task" : "dossier";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">D2F</span>
          <span className="brand-name">Gestion</span>
        </div>
        <nav aria-label="Navigation principale">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activeTab === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(item.id)}
              type="button"
            >
              <span className="nav-marker" aria-hidden="true">{item.marker}</span>
              {item.label}
              {item.id === "tasks" && metrics.urgent > 0 && <span className="nav-count">{metrics.urgent}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sync-card">
            <span className={`sync-dot ${mode}`} />
            <div>
              <strong>{mode === "live" ? "Supabase connecté" : mode === "loading" ? "Connexion…" : "Mode aperçu"}</strong>
              <small>{mode === "live" ? "Données synchronisées" : "Données de démonstration"}</small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">PG</span>
            <div><strong>Mon espace</strong><small>Administrateur</small></div>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Vendredi 10 juillet</p>
            <h1>{navItems.find((item) => item.id === activeTab)?.label}</h1>
          </div>
          <div className="top-actions">
            <label className="searchbox">
              <span aria-hidden="true">⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher…" />
            </label>
            <button className="icon-button" aria-label="Notifications" type="button">◦</button>
            <button className="primary-button" onClick={() => setDialog(primaryAction)} type="button">
              <span aria-hidden="true">＋</span>
              {primaryAction === "client" ? "Nouveau client" : primaryAction === "task" ? "Nouvelle action" : "Nouveau dossier"}
            </button>
          </div>
        </header>

        <div className="content">
          {activeTab === "overview" && (
            <Overview
              data={data}
              metrics={metrics}
              clientById={clientById}
              dossierById={dossierById}
              onToggleTask={toggleTask}
              onOpenTab={setActiveTab}
            />
          )}
          {activeTab === "clients" && (
            <Clients clients={filteredClients} dossierCount={data.dossiers} />
          )}
          {activeTab === "dossiers" && (
            <Dossiers dossiers={data.dossiers} clientById={clientById} />
          )}
          {activeTab === "tasks" && (
            <Tasks tasks={data.tasks} dossierById={dossierById} onToggle={toggleTask} />
          )}
        </div>
      </section>

      {dialog && (
        <RecordDialog
          dialog={dialog}
          clients={data.clients}
          dossiers={data.dossiers}
          saving={saving}
          onClose={() => setDialog(null)}
          onCreate={createRecord}
        />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function Overview({ data, metrics, clientById, dossierById, onToggleTask, onOpenTab }: {
  data: DashboardData;
  metrics: { revenue: number; open: number; pipeline: number; urgent: number };
  clientById: Map<string, Client>;
  dossierById: Map<string, Dossier>;
  onToggleTask: (task: Task) => void;
  onOpenTab: (tab: Tab) => void;
}) {
  const activeDossiers = data.dossiers.filter((item) => item.status !== "Terminé").slice(0, 4);
  const nextTasks = data.tasks.filter((item) => !item.completed).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 4);
  return (
    <>
      <section className="welcome-row">
        <div>
          <h2>Bonjour, votre activité est sur les rails.</h2>
          <p>Voici les indicateurs et priorités qui méritent votre attention aujourd’hui.</p>
        </div>
        <div className="period-pill">30 derniers jours <span>⌄</span></div>
      </section>

      <section className="metric-grid" aria-label="Indicateurs clés">
        <Metric label="Revenu mensuel" value={formatCurrency(metrics.revenue)} trend="+12,4 %" tone="lime" />
        <Metric label="Dossiers actifs" value={String(metrics.open)} trend="2 à livrer bientôt" tone="ink" />
        <Metric label="Pipeline ouvert" value={formatCurrency(metrics.pipeline)} trend="+8,1 %" tone="cream" />
        <Metric label="Actions prioritaires" value={String(metrics.urgent)} trend="Cette semaine" tone="coral" />
      </section>

      <section className="overview-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div><p className="panel-kicker">Performance</p><h3>Activité commerciale</h3></div>
            <span className="panel-total">{formatCurrency(metrics.revenue)}</span>
          </div>
          <div className="chart" aria-label="Évolution simulée du revenu mensuel">
            {[42, 58, 50, 68, 63, 78, 71, 84, 74, 92, 88, 96].map((height, index) => (
              <span key={index} className={index === 11 ? "bar current" : "bar"} style={{ height: `${height}%` }} />
            ))}
          </div>
          <div className="chart-axis"><span>Août</span><span>Oct.</span><span>Déc.</span><span>Fév.</span><span>Avr.</span><span>Juil.</span></div>
        </article>

        <article className="panel tasks-panel">
          <div className="panel-heading">
            <div><p className="panel-kicker">À faire</p><h3>Prochaines actions</h3></div>
            <button className="text-button" onClick={() => onOpenTab("tasks")} type="button">Tout voir →</button>
          </div>
          <div className="task-list">
            {nextTasks.map((task) => (
              <label className="task-row" key={task.id}>
                <input type="checkbox" checked={task.completed} onChange={() => onToggleTask(task)} />
                <span className="custom-check">✓</span>
                <span className="task-copy"><strong>{task.title}</strong><small>{dossierById.get(task.dossier_id ?? "")?.title ?? "Action interne"}</small></span>
                <span className={daysUntil(task.due_date) <= 1 ? "due urgent" : "due"}>{daysUntil(task.due_date) === 0 ? "Aujourd’hui" : formatDate(task.due_date)}</span>
              </label>
            ))}
          </div>
        </article>
      </section>

      <section className="panel dossiers-panel">
        <div className="panel-heading">
          <div><p className="panel-kicker">Portefeuille</p><h3>Dossiers en cours</h3></div>
          <button className="text-button" onClick={() => onOpenTab("dossiers")} type="button">Voir les dossiers →</button>
        </div>
        <div className="dossier-table">
          <div className="table-row table-head"><span>Dossier</span><span>Client</span><span>Échéance</span><span>Progression</span><span>Budget</span></div>
          {activeDossiers.map((dossier) => (
            <div className="table-row" key={dossier.id}>
              <span className="dossier-title"><i className={`status-pip status-${dossier.status.replaceAll(" ", "-").toLowerCase()}`} />{dossier.title}</span>
              <span>{clientById.get(dossier.client_id)?.company ?? "—"}</span>
              <span className={daysUntil(dossier.due_date) <= 3 ? "date-danger" : ""}>{formatDate(dossier.due_date)}</span>
              <span className="progress-cell"><i><b style={{ width: `${dossier.progress}%` }} /></i><small>{dossier.progress}%</small></span>
              <span className="money">{formatCurrency(dossier.amount)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, trend, tone }: { label: string; value: string; trend: string; tone: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-label"><span>{label}</span><i>↗</i></div>
      <strong>{value}</strong>
      <p><span>{trend}</span> vs. période précédente</p>
    </article>
  );
}

function Clients({ clients, dossierCount }: { clients: Client[]; dossierCount: Dossier[] }) {
  return (
    <section className="list-page">
      <div className="section-intro"><div><h2>Votre portefeuille clients</h2><p>{clients.length} contacts dans votre espace de gestion.</p></div><span className="soft-badge">Mis à jour à l’instant</span></div>
      <div className="client-grid">
        {clients.map((client) => (
          <article className="client-card" key={client.id}>
            <div className="client-top"><span className="client-avatar">{client.company.slice(0, 2).toUpperCase()}</span><span className={`status-badge ${client.status.replace(" ", "-").toLowerCase()}`}>{client.status}</span></div>
            <h3>{client.company}</h3><p>{client.name}</p>
            <div className="client-contact"><span>{client.email}</span><span>{client.phone ?? "Téléphone non renseigné"}</span></div>
            <div className="client-meta"><div><small>Revenu mensuel</small><strong>{formatCurrency(client.monthly_revenue)}</strong></div><div><small>Dossiers</small><strong>{dossierCount.filter((item) => item.client_id === client.id).length}</strong></div></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Dossiers({ dossiers, clientById }: { dossiers: Dossier[]; clientById: Map<string, Client> }) {
  const columns: DossierStatus[] = ["À qualifier", "En cours", "En revue", "Terminé"];
  return (
    <section className="list-page">
      <div className="section-intro"><div><h2>Pipeline des dossiers</h2><p>Suivez chaque mission, du cadrage à la livraison.</p></div><span className="soft-badge">{formatCurrency(dossiers.reduce((sum, item) => sum + item.amount, 0))} engagés</span></div>
      <div className="kanban">
        {columns.map((column) => (
          <div className="kanban-column" key={column}>
            <div className="kanban-head"><span>{column}</span><b>{dossiers.filter((item) => item.status === column).length}</b></div>
            {dossiers.filter((item) => item.status === column).map((dossier) => (
              <article className="kanban-card" key={dossier.id}>
                <span className="kanban-company">{clientById.get(dossier.client_id)?.company ?? "Client"}</span>
                <h3>{dossier.title}</h3>
                <div className="kanban-progress"><i><b style={{ width: `${dossier.progress}%` }} /></i><span>{dossier.progress}%</span></div>
                <div className="kanban-foot"><span>{formatDate(dossier.due_date)}</span><strong>{formatCurrency(dossier.amount)}</strong></div>
              </article>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Tasks({ tasks, dossierById, onToggle }: { tasks: Task[]; dossierById: Map<string, Dossier>; onToggle: (task: Task) => void }) {
  const orderedTasks = [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || a.due_date.localeCompare(b.due_date));
  return (
    <section className="list-page narrow-page">
      <div className="section-intro"><div><h2>Plan d’action</h2><p>{tasks.filter((task) => !task.completed).length} actions restent à traiter.</p></div><span className="soft-badge">Triées par échéance</span></div>
      <div className="action-groups">
        {orderedTasks.map((task) => (
          <label className={`action-card ${task.completed ? "completed" : ""}`} key={task.id}>
            <input type="checkbox" checked={task.completed} onChange={() => onToggle(task)} />
            <span className="action-check">✓</span>
            <span className="action-main"><strong>{task.title}</strong><small>{dossierById.get(task.dossier_id ?? "")?.title ?? "Action interne"}</small></span>
            <span className={`priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
            <span className={daysUntil(task.due_date) < 0 && !task.completed ? "action-date overdue" : "action-date"}>{formatDate(task.due_date)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function RecordDialog({ dialog, clients, dossiers, saving, onClose, onCreate }: {
  dialog: Exclude<Dialog, null>;
  clients: Client[];
  dossiers: Dossier[];
  saving: boolean;
  onClose: () => void;
  onCreate: (entity: "clients" | "dossiers" | "tasks", record: Record<string, unknown>) => Promise<void>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (dialog === "client") {
      void onCreate("clients", { ...values, monthly_revenue: Number(values.monthly_revenue) });
    } else if (dialog === "dossier") {
      void onCreate("dossiers", { ...values, amount: Number(values.amount), progress: 10 });
    } else {
      void onCreate("tasks", { ...values, dossier_id: values.dossier_id || null, completed: false });
    }
  }
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head"><div><p className="panel-kicker">Création rapide</p><h2 id="dialog-title">{dialog === "client" ? "Nouveau client" : dialog === "dossier" ? "Nouveau dossier" : "Nouvelle action"}</h2></div><button onClick={onClose} aria-label="Fermer" type="button">×</button></div>
        <form onSubmit={submit}>
          {dialog === "client" && <>
            <Field label="Entreprise"><input name="company" required autoFocus placeholder="Nom de l’entreprise" /></Field>
            <div className="field-pair"><Field label="Contact"><input name="name" required placeholder="Prénom et nom" /></Field><Field label="Statut"><select name="status" defaultValue="Actif"><option>Actif</option><option>Prospect</option><option>En pause</option></select></Field></div>
            <Field label="E-mail"><input name="email" type="email" required placeholder="contact@entreprise.fr" /></Field>
            <div className="field-pair"><Field label="Téléphone"><input name="phone" placeholder="+33 6…" /></Field><Field label="Revenu mensuel"><input name="monthly_revenue" type="number" min="0" defaultValue="0" /></Field></div>
          </>}
          {dialog === "dossier" && <>
            <Field label="Intitulé"><input name="title" required autoFocus placeholder="Ex. Audit de conformité" /></Field>
            <Field label="Client"><select name="client_id" required defaultValue=""><option value="" disabled>Sélectionner un client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.company}</option>)}</select></Field>
            <div className="field-pair"><Field label="Étape"><select name="status" defaultValue="À qualifier"><option>À qualifier</option><option>En cours</option><option>En revue</option><option>Terminé</option></select></Field><Field label="Échéance"><input name="due_date" type="date" required defaultValue={isoDate(14)} /></Field></div>
            <Field label="Budget"><input name="amount" type="number" min="0" defaultValue="0" /></Field>
          </>}
          {dialog === "task" && <>
            <Field label="Action"><input name="title" required autoFocus placeholder="Ce qu’il faut accomplir" /></Field>
            <Field label="Dossier lié"><select name="dossier_id" defaultValue=""><option value="">Action interne</option>{dossiers.filter((item) => item.status !== "Terminé").map((dossier) => <option key={dossier.id} value={dossier.id}>{dossier.title}</option>)}</select></Field>
            <div className="field-pair"><Field label="Priorité"><select name="priority" defaultValue="Normale"><option>Haute</option><option>Normale</option><option>Basse</option></select></Field><Field label="Échéance"><input name="due_date" type="date" required defaultValue={isoDate(3)} /></Field></div>
          </>}
          <div className="dialog-actions"><button className="secondary-button" onClick={onClose} type="button">Annuler</button><button className="primary-button" disabled={saving} type="submit">{saving ? "Enregistrement…" : "Enregistrer"}</button></div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
