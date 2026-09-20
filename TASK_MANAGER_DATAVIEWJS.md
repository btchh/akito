```dataviewjs
const DB_NAME = "Motion Tasks";
const WIP_LIMIT = 3;
const root = this.container;
const { Modal: NativeModal, Setting: NativeSetting, Notice: NativeNotice } = require("obsidian");
const obsidianApp = dv.app ?? globalThis.app;

if (!window.motiondb) {
  dv.paragraph("Motion Database is not enabled. Enable it and reload this note.");
  return;
}

const api = window.motiondb;
const STATUS = [
  { id: "inbox",   label: "Inbox",   icon: "○" },
  { id: "ready",   label: "Ready",   icon: "◎" },
  { id: "doing",   label: "Doing",   icon: "◐" },
  { id: "waiting", label: "Waiting", icon: "◑" },
  { id: "done",    label: "Done",    icon: "●" },
];
const PRIORITY = {
  1: { label: "Low",    icon: "↓", className: "low" },
  2: { label: "Normal", icon: "–", className: "normal" },
  3: { label: "High",   icon: "↑", className: "high" },
  4: { label: "Urgent", icon: "!", className: "urgent" },
};

const pad = value => String(value).padStart(2, "0");
const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const nowIso = () => new Date().toISOString();
const today = () => dayKey(new Date());
const esc = value => String(value ?? "");
const statusIndex = value => STATUS.findIndex(item => item.id === value);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (tag === "button") {
    if (node.classList.contains("primary")) node.classList.add("mod-cta");
    if (node.classList.contains("danger")) node.classList.add("mod-warning");
    if (node.classList.contains("icon")) node.classList.add("clickable-icon");
  }
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function option(value, label, selected = false) {
  const node = element("option", "", label);
  node.value = value;
  node.selected = selected;
  return node;
}

function formatDue(value) {
  if (!value) return "No due date";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueState(task) {
  if (!task.due_date || task.status === "done") return "";
  if (task.due_date < today()) return "overdue";
  if (task.due_date === today()) return "today";
  return "";
}

function relativeDate(value) {
  if (!value) return "";
  const target = new Date(`${value}T00:00:00`);
  const current = new Date(`${today()}T00:00:00`);
  const days = Math.round((target - current) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days < -1 && days > -7) return `${Math.abs(days)} days late`;
  return formatDue(value);
}

await api.create(DB_NAME);
const databases = await api.list();
const currentDb = databases.find(item => item.name === DB_NAME);
const tables = new Set((currentDb?.tables ?? []).map(name => name.toLowerCase()));

if (!["projects", "tasks", "task_events"].every(name => tables.has(name))) {
  await api.query(DB_NAME, `
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      color TEXT NOT NULL DEFAULT '#7c3aed',
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',
      priority INTEGER NOT NULL DEFAULT 2,
      due_date TEXT,
      estimate_minutes INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );
  `);
}

// Older dashboard versions retained completion history after task deletion.
// The UI now mirrors current database content, so remove those orphan rows.
const orphanEvents = await api.select(DB_NAME, "SELECT id FROM task_events WHERE task_id IS NULL");
if (orphanEvents.length) {
  await api.query(DB_NAME, "DELETE FROM task_events WHERE task_id IS NULL");
}

root.replaceChildren();
root.classList.add("motion-task-manager-host");

// Dataview/Minimal can report a content width wider than the visible split.
// Clamp the dashboard to the pixels remaining between its actual left edge
// and the right edge of the workspace pane, and update it as panes resize.
window.__motionTaskManagerResizeObservers ??= new WeakMap();
window.__motionTaskManagerResizeObservers.get(root)?.disconnect();
const workspacePane = root.closest(".workspace-leaf-content") || root.parentElement;
const noteScroller = root.closest(".markdown-preview-view")
  || root.closest(".markdown-source-view")?.querySelector(".cm-scroller")
  || root.closest(".view-content");
noteScroller?.style.setProperty("overflow-x", "hidden", "important");
const fitToPane = () => {
  if (!workspacePane || !root.isConnected) return;
  const paneRect = workspacePane.getBoundingClientRect();
  const gutter = paneRect.width < 600 ? 12 : 24;
  // Measure the Dataview block at its natural readable-line position first,
  // then shift it to the pane gutter and size it across the whole pane.
  root.style.setProperty("position", "relative", "important");
  root.style.setProperty("left", "0px", "important");
  const naturalRect = root.getBoundingClientRect();
  const offset = Math.floor(paneRect.left + gutter - naturalRect.left);
  const available = Math.max(280, Math.floor(paneRect.width - gutter * 2));
  root.style.setProperty("left", `${offset}px`, "important");
  root.style.setProperty("width", `${available}px`, "important");
  root.style.setProperty("max-width", `${available}px`, "important");
};
const paneObserver = new ResizeObserver(fitToPane);
paneObserver.observe(workspacePane);
window.__motionTaskManagerResizeObservers.set(root, paneObserver);
requestAnimationFrame(fitToPane);

const style = element("style");
style.textContent = `
  .motion-task-manager-host {
    --mtm-radius: 12px;
    --mtm-gap: 12px;
    width: 100%;
    min-width: 0;
    container: motion-tasks / inline-size;
    overflow-x: clip;
    box-sizing: border-box !important;
    font-family: var(--font-interface) !important;
    color: var(--text-normal);
  }
  .motion-task-manager-host * {
    box-sizing: border-box;
    min-width: 0;
    font-family: var(--font-interface) !important;
  }
  .mtm-shell {
    display: grid;
    gap: 18px;
    width: 100%;
    min-width: 0;
    font-family: var(--font-interface);
  }
  .mtm-header, .mtm-toolbar, .mtm-capture, .mtm-section-head,
  .mtm-card-head, .mtm-card-meta, .mtm-project-head, .mtm-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .mtm-header { justify-content: space-between; flex-wrap: wrap; }
  .mtm-title { margin: 0; font-size: 1.65em; letter-spacing: -0.025em; }
  .mtm-subtitle { color: var(--text-muted); font-size: var(--font-ui-small); }
  .mtm-tabs {
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%;
    padding: 3px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-wrap: wrap;
  }
  .mtm-tab {
    min-height: var(--input-height);
    padding: 5px 10px;
    border: 0;
    border-radius: var(--radius-s);
    color: var(--nav-item-color);
    background: transparent;
  }
  .mtm-tab:hover { color: var(--nav-item-color-hover); background: var(--nav-item-background-hover); }
  .mtm-tab.is-active {
    color: var(--nav-item-color-selected);
    background: var(--nav-item-background-selected);
    font-weight: var(--nav-item-weight-active);
  }
  .mtm-view { display: grid; gap: 18px; width: 100%; }
  .mtm-toolbar { justify-content: flex-end; flex: 1 1 420px; flex-wrap: wrap; }
  .mtm-input, .mtm-select {
    min-width: 0;
    min-height: 36px;
  }
  /* One enabled vault snippet gives every select z-index:9999. Keep dialogs sane. */
  .motion-task-manager-host select.mtm-select { z-index: auto !important; }
  .mtm-search { width: min(260px, 100%); }
  .mtm-button {
    min-height: 34px;
    cursor: pointer;
  }
  .mtm-button.icon { width: 30px; min-height: 28px; padding: 2px; }
  .mtm-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .mtm-stat, .mtm-panel {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--mtm-radius);
    background: var(--background-primary);
  }
  .mtm-stat { padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
  .mtm-stat-value { display: block; font-size: 1.45em; font-weight: 700; }
  .mtm-stat-label { color: var(--text-muted); font-size: var(--font-ui-smaller); }
  .mtm-stat.alert .mtm-stat-value { color: var(--text-error); }
  .mtm-capture { padding: 12px; flex-wrap: wrap; background: var(--background-secondary); }
  .mtm-capture .mtm-input[type='text'] { flex: 1 1 240px; }
  .mtm-capture .mtm-select { flex: 0 1 150px; }
  .mtm-section-head { justify-content: space-between; margin-bottom: 9px; }
  .mtm-section-title { margin: 0; font-size: 1.05em; }
  .mtm-projects { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .mtm-project { padding: 11px; cursor: pointer; overflow: hidden; }
  .mtm-project:hover { border-color: var(--interactive-accent); }
  .mtm-project.active { box-shadow: inset 0 0 0 1px var(--interactive-accent); }
  .mtm-project-dot { width: 9px; height: 9px; border-radius: 99px; flex: 0 0 auto; }
  .mtm-project-name { flex: 1; min-width: 0; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mtm-project-count { color: var(--text-muted); font-size: var(--font-ui-smaller); }
  .mtm-progress { height: 5px; margin-top: 10px; overflow: hidden; border-radius: 9px; background: var(--background-modifier-border); }
  .mtm-progress > span { display: block; height: 100%; border-radius: inherit; background: var(--interactive-accent); }
  .mtm-native-list {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    background: var(--background-primary);
    padding-inline: 12px;
  }
  .mtm-native-list .setting-item:first-child { border-top: 0; }
  .mtm-native-list .setting-item,
  .mtm-native-list .setting-item-info { min-width: 0; }
  .mtm-native-list .setting-item-name { overflow-wrap: anywhere; }
  .mtm-native-list .setting-item-description { display: flex; gap: 8px; flex-wrap: wrap; }
  .mtm-native-list .setting-item-control { flex-shrink: 0; }
  .mtm-task-groups { display: grid; gap: 16px; }
  .mtm-task-group { min-width: 0; }
  .mtm-task-group-head { margin: 0 2px 6px; }
  .mtm-task-group-name { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--font-ui-medium); }
  .mtm-task-group-count { color: var(--text-muted); font-size: var(--font-ui-smaller); }
  .mtm-board {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    min-width: 0;
    overflow: visible;
    padding: 1px;
  }
  .mtm-column { min-width: 0; min-height: 250px; padding: 9px; border: 1px solid var(--background-modifier-border); border-radius: var(--mtm-radius); background: var(--background-secondary); }
  .mtm-column.dragover { border-color: var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 8%, var(--background-secondary)); }
  .mtm-column-head { display: flex; align-items: center; gap: 8px; margin: 2px 2px 10px; font-weight: 700; }
  .mtm-column-count { margin-left: auto; min-width: 24px; border-radius: 999px; text-align: center; color: var(--text-muted); background: var(--background-modifier-border); font-size: var(--font-ui-smaller); }
  .mtm-wip { color: var(--text-error); font-size: var(--font-ui-smaller); }
  .mtm-cards { display: grid; gap: 8px; min-height: 220px; align-content: start; }
  .mtm-task { padding: 10px; border: 1px solid var(--background-modifier-border); border-radius: 9px; background: var(--background-primary); cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
  .mtm-task:hover { border-color: var(--interactive-accent); transform: translateY(-1px); }
  .mtm-task.dragging { opacity: .45; }
  .mtm-task-title { flex: 1; min-width: 0; font-weight: 620; line-height: 1.35; overflow-wrap: anywhere; }
  .mtm-task.done .mtm-task-title { color: var(--text-muted); text-decoration: line-through; }
  .mtm-priority { display: inline-grid; place-items: center; width: 21px; height: 21px; border-radius: 6px; font-weight: 800; font-size: .78em; }
  .mtm-priority.low { color: var(--text-muted); background: var(--background-modifier-hover); }
  .mtm-priority.normal { color: var(--text-accent); background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
  .mtm-priority.high { color: var(--color-orange); background: color-mix(in srgb, var(--color-orange) 15%, transparent); }
  .mtm-priority.urgent { color: var(--text-error); background: color-mix(in srgb, var(--text-error) 14%, transparent); }
  .mtm-card-meta { flex-wrap: wrap; margin-top: 8px; color: var(--text-muted); font-size: var(--font-ui-smaller); }
  .mtm-chip { max-width: 145px; padding: 2px 6px; border-radius: 999px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--background-modifier-hover); }
  .mtm-due.today { color: var(--color-orange); font-weight: 650; }
  .mtm-due.overdue { color: var(--text-error); font-weight: 650; }
  .mtm-card-actions { display: flex; gap: 4px; margin-top: 9px; opacity: .25; transition: opacity .15s; }
  .mtm-task:hover .mtm-card-actions, .mtm-task:focus-within .mtm-card-actions { opacity: 1; }
  .mtm-empty { padding: 28px 8px; text-align: center; color: var(--text-faint); font-size: var(--font-ui-small); }
  .mtm-heatmap { min-width: 0; padding: 14px; overflow: hidden; }
  .mtm-heatmap .heatmap-calendar-graph {
    display: grid !important;
    grid-template-columns: 30px minmax(0, 1fr) !important;
    grid-template-areas: 'year months' 'days boxes' !important;
    gap: 4px !important;
    width: 100% !important;
    min-width: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    font-size: 10px !important;
  }
  .mtm-heatmap .heatmap-calendar-graph > * {
    min-width: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    list-style: none !important;
  }
  .mtm-heatmap .heatmap-calendar-year { grid-area: year !important; font-weight: 650; }
  .mtm-heatmap .heatmap-calendar-months {
    grid-area: months !important;
    display: grid !important;
    grid-template-columns: repeat(12, minmax(0, 1fr)) !important;
    gap: 2px !important;
  }
  .mtm-heatmap .heatmap-calendar-months li {
    min-width: 0 !important;
    overflow: hidden;
    text-align: center;
    white-space: nowrap;
  }
  .mtm-heatmap .heatmap-calendar-days {
    grid-area: days !important;
    display: grid !important;
    grid-template-rows: repeat(7, minmax(0, 1fr)) !important;
    gap: 2px !important;
    align-items: center;
  }
  .mtm-heatmap .heatmap-calendar-days li { font-size: 9px; line-height: 1; }
  .mtm-heatmap .heatmap-calendar-boxes {
    grid-area: boxes !important;
    display: grid !important;
    grid-auto-flow: column !important;
    grid-template-columns: repeat(53, minmax(0, 1fr)) !important;
    grid-template-rows: repeat(7, minmax(0, 1fr)) !important;
    gap: clamp(1px, .25cqw, 3px) !important;
    width: 100% !important;
    aspect-ratio: 53 / 7;
  }
  .mtm-heatmap .heatmap-calendar-boxes li {
    width: auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    border-radius: 2px;
    overflow: hidden;
    background-color: var(--background-modifier-border);
  }
  .mtm-heatmap .heatmap-calendar-boxes li.isEmpty { background-color: var(--background-modifier-border) !important; }
  .mtm-heatmap .heatmap-calendar-content { display: none; }
  .mtm-heatmap-fallback { display: flex; align-items: end; gap: 3px; height: 64px; }
  .mtm-heatmap-fallback span { flex: 1; min-width: 4px; border-radius: 3px 3px 0 0; background: var(--interactive-accent); }
  @container motion-tasks (max-width: 700px) {
    .mtm-header { align-items: stretch; }
    .mtm-toolbar { justify-content: stretch; flex-basis: 100%; }
    .mtm-toolbar > * { flex: 1 1 150px; }
    .mtm-search { width: 100%; flex-basis: 100%; }
  }
  @container motion-tasks (min-width: 480px) {
    .mtm-projects, .mtm-board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container motion-tasks (min-width: 680px) {
    .mtm-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .mtm-projects, .mtm-board { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @container motion-tasks (min-width: 920px) {
    .mtm-projects { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .mtm-board { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
  @container motion-tasks (min-width: 1160px) {
    .mtm-board { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  }
  @media (hover: none) {
    .mtm-card-actions { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mtm-task { transition: none; }
  }
`;

const app = element("div", "mtm-shell");
root.append(style, app);

const state = {
  tab: root.dataset.mtmTab || "dashboard",
  search: "",
  projectId: "all",
  hideDone: false,
  draggedTaskId: null,
  renderTimer: null,
};

function toast(message) {
  return new NativeNotice(message, 3000);
}

function scheduleRender() {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => render().catch(error => {
    console.error("[Motion Task Manager]", error);
    toast(error.message || String(error));
  }), 60);
}

async function setTaskStatus(task, nextStatus) {
  if (!STATUS.some(item => item.id === nextStatus) || task.status === nextStatus) return;
  const stamp = nowIso();
  const completedAt = nextStatus === "done" ? stamp : null;
  if (task.status !== "done" && nextStatus === "done") {
    await api.query(DB_NAME, `
      BEGIN;
      UPDATE tasks SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4;
      INSERT INTO task_events (task_id, event_type, event_date, created_at)
      VALUES ($4, 'completed', $5, $3);
      COMMIT;
    `, [nextStatus, completedAt, stamp, Number(task.id), today()]);
  } else {
    await api.query(DB_NAME,
      "UPDATE tasks SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4",
      [nextStatus, completedAt, stamp, Number(task.id)]
    );
  }
  scheduleRender();
}

async function addTask(values) {
  const title = values.title.trim();
  if (!title) return toast("Give the task a title.");
  const stamp = nowIso();
  await api.query(DB_NAME, `
    INSERT INTO tasks
      (project_id, title, description, status, priority, due_date, estimate_minutes, sort_order, created_at, updated_at)
    VALUES ($1, $2, $3, 'inbox', $4, $5, $6, 0, $7, $7)
  `, [values.projectId || null, title, values.description || null,
      Number(values.priority || 2), values.dueDate || null,
      values.estimateMinutes ? Number(values.estimateMinutes) : null, stamp]);
  toast("Task captured.");
  scheduleRender();
}

async function addProject(name, color) {
  const trimmed = name.trim();
  if (!trimmed) return toast("Give the project a name.");
  const stamp = nowIso();
  try {
    await api.query(DB_NAME, `
      INSERT INTO projects (name, description, status, color, due_date, created_at, updated_at)
      VALUES ($1, NULL, 'active', $2, NULL, $3, $3)
    `, [trimmed, color || "#7c3aed", stamp]);
    toast("Project created.");
    scheduleRender();
  } catch (error) {
    toast(error.message || "Could not create project.");
  }
}

function confirmAction(title, message, confirmLabel = "Confirm") {
  return new Promise(resolve => {
    const modal = new NativeModal(obsidianApp);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value);
    };
    modal.onOpen = () => {
      modal.titleEl.textContent = title;
      modal.contentEl.empty();
      modal.contentEl.createEl("p", { text: message });
      const actions = new NativeSetting(modal.contentEl);
      actions.addButton(button => button
        .setButtonText("Cancel")
        .onClick(() => finish(false)));
      actions.addButton(button => button
        .setWarning()
        .setButtonText(confirmLabel)
        .onClick(() => finish(true)));
    };
    modal.onClose = () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    };
    modal.open();
  });
}

async function deleteTask(task) {
  const confirmed = await confirmAction(
    "Delete task?",
    `“${task.title}” will be permanently deleted. This cannot be undone.`,
    "Delete",
  );
  if (!confirmed) return false;
  await api.query(DB_NAME, `
    BEGIN;
    DELETE FROM task_events WHERE task_id = $1;
    DELETE FROM tasks WHERE id = $1;
    COMMIT;
  `, [Number(task.id)]);
  toast("Task deleted.");
  scheduleRender();
  return true;
}

function showTaskEditor(task, projects) {
  const isNew = !task;
  const values = {
    projectId: task?.project_id ? String(task.project_id) : "",
    title: esc(task?.title),
    description: esc(task?.description),
    status: task?.status || "inbox",
    priority: String(task?.priority ?? 2),
    dueDate: esc(task?.due_date),
    estimateMinutes: task?.estimate_minutes == null ? "" : String(task.estimate_minutes),
  };
  const modal = new NativeModal(obsidianApp);

  const saveTask = async () => {
    const nextStatus = values.status;
    const stamp = nowIso();
    const completedAt = nextStatus === "done" ? (task?.completed_at || stamp) : null;
    if (isNew) {
      const params = [
        values.projectId || null,
        values.title.trim(),
        values.description.trim() || null,
        nextStatus,
        Number(values.priority),
        values.dueDate || null,
        values.estimateMinutes ? Number(values.estimateMinutes) : null,
        stamp,
        completedAt,
        today(),
      ];
      const insertSql = `INSERT INTO tasks
        (project_id, title, description, status, priority, due_date, estimate_minutes,
         sort_order, created_at, updated_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $8, $9)`;
      if (nextStatus === "done") {
        await api.query(DB_NAME, `
          BEGIN;
          ${insertSql};
          INSERT INTO task_events (task_id, event_type, event_date, created_at)
          VALUES (LAST_INSERT_ROWID(), 'completed', $10, $8);
          COMMIT;
        `, params);
      } else {
        await api.query(DB_NAME, insertSql, params);
      }
      modal.close();
      toast("Task created.");
      scheduleRender();
      return;
    }

    const becameDone = task.status !== "done" && nextStatus === "done";
    const params = [
      values.projectId || null,
      values.title.trim(),
      values.description.trim() || null,
      nextStatus,
      Number(values.priority),
      values.dueDate || null,
      values.estimateMinutes ? Number(values.estimateMinutes) : null,
      stamp,
      completedAt,
      Number(task.id),
      today(),
    ];
    if (!params[1]) return toast("Give the task a title.");
    const updateSql = `UPDATE tasks SET project_id = $1, title = $2, description = $3,
      status = $4, priority = $5, due_date = $6, estimate_minutes = $7,
      updated_at = $8, completed_at = $9 WHERE id = $10`;
    if (becameDone) {
      await api.query(DB_NAME, `
        BEGIN;
        ${updateSql};
        INSERT INTO task_events (task_id, event_type, event_date, created_at)
        VALUES ($10, 'completed', $11, $8);
        COMMIT;
      `, params);
    } else {
      await api.query(DB_NAME, updateSql, params);
    }
    modal.close();
    toast("Task updated.");
    scheduleRender();
  };

  modal.onOpen = () => {
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.createEl("h2", { text: isNew ? "New task" : "Edit task" });
    if (!isNew && task.created_at) {
      contentEl.createDiv({
        cls: "setting-item-description",
        text: `Created ${new Date(task.created_at).toLocaleString()}`,
      });
    }
    new NativeSetting(contentEl).setName("Title").addText(component => component
      .setValue(values.title).onChange(value => { values.title = value; }));
    new NativeSetting(contentEl).setName("Project").addDropdown(component => {
      component.addOption("", "No project");
      projects.forEach(project => component.addOption(String(project.id), project.name));
      component.setValue(values.projectId).onChange(value => { values.projectId = value; });
    });
    new NativeSetting(contentEl).setName("Status").addDropdown(component => {
      STATUS.forEach(item => component.addOption(item.id, item.label));
      component.setValue(values.status).onChange(value => { values.status = value; });
    });
    new NativeSetting(contentEl).setName("Priority").addDropdown(component => {
      Object.entries(PRIORITY).forEach(([value, item]) => component.addOption(value, item.label));
      component.setValue(values.priority).onChange(value => { values.priority = value; });
    });
    new NativeSetting(contentEl).setName("Due date").addText(component => {
      component.inputEl.type = "date";
      component.setValue(values.dueDate).onChange(value => { values.dueDate = value; });
    });
    new NativeSetting(contentEl).setName("Estimate").setDesc("Minutes").addText(component => {
      component.inputEl.type = "number";
      component.inputEl.min = "0";
      component.inputEl.step = "5";
      component.setValue(values.estimateMinutes).onChange(value => { values.estimateMinutes = value; });
    });
    new NativeSetting(contentEl).setName("Notes").addTextArea(component => component
      .setPlaceholder("Next action or definition of done")
      .setValue(values.description)
      .onChange(value => { values.description = value; }));
    const actions = new NativeSetting(contentEl);
    if (!isNew) {
      actions.addButton(button => button.setWarning().setButtonText("Delete").onClick(async () => {
        if (await deleteTask(task)) modal.close();
      }));
    }
    actions.addButton(button => button.setButtonText("Cancel").onClick(() => modal.close()));
    actions.addButton(button => button.setCta().setButtonText(isNew ? "Create task" : "Save").onClick(async () => {
      if (!values.title.trim()) return toast("Give the task a title.");
      try { await saveTask(); } catch (error) { toast(error.message || String(error)); }
    }));
  };
  modal.open();
}

function showProjectCreator() {
  const values = { name: "", color: "#7c3aed" };
  const modal = new NativeModal(obsidianApp);
  modal.onOpen = () => {
    const { contentEl } = modal;
    contentEl.empty();
    contentEl.createEl("h2", { text: "New project" });
    new NativeSetting(contentEl).setName("Name").addText(component => component
      .setPlaceholder("Project name").onChange(value => { values.name = value; }));
    new NativeSetting(contentEl).setName("Color").addColorPicker(component => component
      .setValue(values.color).onChange(value => { values.color = value; }));
    const actions = new NativeSetting(contentEl);
    actions.addButton(button => button.setButtonText("Cancel").onClick(() => modal.close()));
    actions.addButton(button => button.setCta().setButtonText("Create project").onClick(async () => {
      if (!values.name.trim()) return toast("Give the project a name.");
      await addProject(values.name, values.color);
      modal.close();
    }));
  };
  modal.open();
}

function renderHeatmap(host, events) {
  const counts = new Map();
  events.filter(event => event.event_type === "completed").forEach(event => {
    counts.set(event.event_date, (counts.get(event.event_date) || 0) + 1);
  });
  const entries = [...counts].map(([date, intensity]) => ({
    date,
    intensity,
    content: String(intensity),
    color: "accent",
  }));

  if (typeof window.renderHeatmapCalendar === "function") {
    window.renderHeatmapCalendar(host, {
      year: new Date().getFullYear(),
      colors: {
        accent: [
          "color-mix(in srgb, var(--interactive-accent) 18%, var(--background-primary))",
          "color-mix(in srgb, var(--interactive-accent) 38%, var(--background-primary))",
          "color-mix(in srgb, var(--interactive-accent) 58%, var(--background-primary))",
          "color-mix(in srgb, var(--interactive-accent) 78%, var(--background-primary))",
          "var(--interactive-accent)",
        ],
      },
      showCurrentDayBorder: true,
      intensityScaleStart: 1,
      intensityScaleEnd: Math.max(5, ...entries.map(entry => entry.intensity)),
      entries,
    });
    return;
  }

  const fallback = element("div", "mtm-heatmap-fallback");
  for (let offset = 27; offset >= 0; offset--) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const count = counts.get(dayKey(date)) || 0;
    const bar = element("span");
    bar.style.height = `${Math.max(3, Math.min(64, count * 14))}px`;
    bar.style.opacity = count ? "1" : ".12";
    bar.title = `${dayKey(date)}: ${count} completed`;
    fallback.append(bar);
  }
  host.append(fallback, element("div", "mtm-subtitle", "Enable Heatmap Calendar for the full-year view."));
}

function renderTaskCard(task, projects) {
  const card = element("article", `mtm-task ${task.status === "done" ? "done" : ""}`);
  card.draggable = true;
  card.tabIndex = 0;
  card.setAttribute("aria-label", `${task.title}. ${STATUS.find(item => item.id === task.status)?.label || task.status}`);

  const head = element("div", "mtm-card-head");
  const priority = PRIORITY[Number(task.priority)] || PRIORITY[2];
  const priorityNode = element("span", `mtm-priority ${priority.className}`, priority.icon);
  priorityNode.title = `${priority.label} priority`;
  head.append(priorityNode, element("div", "mtm-task-title", task.title));
  card.append(head);

  const meta = element("div", "mtm-card-meta");
  if (task.project_name) {
    const project = element("span", "mtm-chip", task.project_name);
    project.style.borderLeft = `3px solid ${task.project_color || "var(--interactive-accent)"}`;
    meta.append(project);
  }
  if (task.due_date) {
    const due = element("span", `mtm-due ${dueState(task)}`, relativeDate(task.due_date));
    due.title = `Due ${task.due_date}`;
    meta.append(due);
  }
  if (task.estimate_minutes) meta.append(element("span", "", `${task.estimate_minutes}m`));
  if (meta.childElementCount) card.append(meta);

  const actions = element("div", "mtm-card-actions");
  const index = statusIndex(task.status);
  if (index > 0) {
    const back = element("button", "mtm-button icon", "←");
    back.type = "button";
    back.title = `Move to ${STATUS[index - 1].label}`;
    back.addEventListener("click", event => {
      event.stopPropagation();
      setTaskStatus(task, STATUS[index - 1].id).catch(error => toast(error.message));
    });
    actions.append(back);
  }
  if (index < STATUS.length - 1) {
    const forward = element("button", "mtm-button icon", task.status === "waiting" ? "✓" : "→");
    forward.type = "button";
    forward.title = `Move to ${STATUS[index + 1].label}`;
    forward.addEventListener("click", event => {
      event.stopPropagation();
      setTaskStatus(task, STATUS[index + 1].id).catch(error => toast(error.message));
    });
    actions.append(forward);
  }
  card.append(actions);

  card.addEventListener("click", () => showTaskEditor(task, projects));
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showTaskEditor(task, projects);
    }
  });
  card.addEventListener("dragstart", event => {
    state.draggedTaskId = Number(task.id);
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(task.id));
  });
  card.addEventListener("dragend", () => {
    state.draggedTaskId = null;
    card.classList.remove("dragging");
  });
  return card;
}

async function render() {
  const [projects, tasks, events] = await Promise.all([
    api.select(DB_NAME, "SELECT id, name, description, status, color, due_date, created_at, updated_at FROM projects ORDER BY name ASC"),
    api.select(DB_NAME, `
      SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
             t.due_date, t.estimate_minutes, t.sort_order, t.created_at,
             t.updated_at, t.completed_at, p.name AS project_name, p.color AS project_color
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      ORDER BY t.sort_order ASC, t.id DESC
    `),
    api.select(DB_NAME, "SELECT id, task_id, event_type, event_date, created_at FROM task_events WHERE task_id IS NOT NULL ORDER BY event_date ASC"),
  ]);

  const query = state.search.trim().toLowerCase();
  const filtered = tasks.filter(task => {
    if (state.projectId !== "all" && String(task.project_id ?? "none") !== state.projectId) return false;
    if (state.hideDone && task.status === "done") return false;
    if (!query) return true;
    return [task.title, task.description, task.project_name]
      .some(value => String(value ?? "").toLowerCase().includes(query));
  });

  const active = tasks.filter(task => task.status !== "done");
  const overdue = active.filter(task => task.due_date && task.due_date < today());
  const dueToday = active.filter(task => task.due_date === today());
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const completedWeek = tasks.filter(task =>
    task.status === "done"
    && task.completed_at
    && task.completed_at.slice(0, 10) >= dayKey(weekStart)
  ).length;

  const focusedControl = document.activeElement?.dataset?.mtmFocus;
  const focusedCaret = document.activeElement?.selectionStart;
  app.replaceChildren();

  const tabMeta = {
    dashboard: ["Dashboard", "Overview and quick capture"],
    projects: ["Projects", "Organize work by outcome"],
    board: ["Board", "Move tasks through the workflow"],
    activity: ["Activity", "Review completed work"],
  };
  const header = element("header", "mtm-header");
  const identity = element("div");
  identity.append(
    element("h2", "mtm-title", "Motion Tasks"),
    element("div", "mtm-subtitle", tabMeta[state.tab][1]),
  );
  const detailedAdd = element("button", "mtm-button primary", "New task");
  detailedAdd.type = "button";
  detailedAdd.title = "Create a task with full details";
  detailedAdd.addEventListener("click", () => showTaskEditor(null, projects));
  header.append(identity, detailedAdd);
  app.append(header);

  const tabs = element("nav", "mtm-tabs");
  tabs.setAttribute("role", "tablist");
  Object.entries(tabMeta).forEach(([id, [label]]) => {
    const button = element("button", `mtm-tab ${state.tab === id ? "is-active" : ""}`, label);
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(state.tab === id));
    button.addEventListener("click", () => {
      state.tab = id;
      root.dataset.mtmTab = id;
      scheduleRender();
    });
    tabs.append(button);
  });
  app.append(tabs);

  const view = element("div", "mtm-view");
  view.setAttribute("role", "tabpanel");
  app.append(view);

  const makeStats = () => {
    const stats = element("section", "mtm-stats");
    [
      [active.length, "Open tasks", ""],
      [dueToday.length, "Due today", dueToday.length ? "alert" : ""],
      [overdue.length, "Overdue", overdue.length ? "alert" : ""],
      [completedWeek, "Done in 7 days", ""],
    ].forEach(([value, label, cls]) => {
      const stat = element("div", `mtm-stat ${cls}`);
      stat.append(element("span", "mtm-stat-value", value), element("span", "mtm-stat-label", label));
      stats.append(stat);
    });
    return stats;
  };

  const makeCapture = () => {
    const capture = element("form", "mtm-panel mtm-capture");
    const captureTitle = element("input", "mtm-input");
    captureTitle.type = "text";
    captureTitle.placeholder = "Capture a task…";
    captureTitle.setAttribute("aria-label", "Task title");
    const captureProject = element("select", "dropdown mtm-select");
    captureProject.setAttribute("aria-label", "Project");
    captureProject.append(option("", "No project"));
    projects.forEach(project => captureProject.append(option(String(project.id), project.name)));
    const capturePriority = element("select", "dropdown mtm-select");
    capturePriority.setAttribute("aria-label", "Priority");
    Object.entries(PRIORITY).forEach(([value, item]) => capturePriority.append(option(value, item.label, value === "2")));
    const captureDue = element("input", "mtm-input");
    captureDue.type = "date";
    captureDue.setAttribute("aria-label", "Due date");
    const captureButton = element("button", "mtm-button primary", "Quick add");
    captureButton.type = "submit";
    capture.append(captureTitle, captureProject, capturePriority, captureDue, captureButton);
    capture.addEventListener("submit", async event => {
      event.preventDefault();
      await addTask({ title: captureTitle.value, projectId: captureProject.value, priority: capturePriority.value, dueDate: captureDue.value });
      captureTitle.value = "";
    });
    return capture;
  };

  if (state.tab === "dashboard") {
    view.append(makeStats(), makeCapture());
    const tasksSection = element("section");
    const tasksHead = element("div", "mtm-section-head");
    tasksHead.append(element("h3", "mtm-section-title", "Open tasks"), element("span", "mtm-subtitle", `${active.length} total`));
    const taskGroups = element("div", "mtm-task-groups");
    const groups = projects.map(project => ({
      id: String(project.id),
      name: project.name,
      color: project.color,
      tasks: active.filter(task => Number(task.project_id) === Number(project.id)),
    }));
    groups.push({
      id: "none",
      name: "No project",
      color: "var(--text-muted)",
      tasks: active.filter(task => task.project_id == null),
    });

    if (!active.length) {
      const emptyList = element("div", "mtm-native-list");
      const row = element("div", "setting-item");
      const info = element("div", "setting-item-info");
      info.append(element("div", "setting-item-name", "All clear"), element("div", "setting-item-description", "There are no open tasks."));
      row.append(info);
      emptyList.append(row);
      taskGroups.append(emptyList);
    }

    groups.filter(group => group.tasks.length).forEach(group => {
      const groupSection = element("section", "mtm-task-group");
      const groupHead = element("div", "mtm-section-head mtm-task-group-head");
      const groupName = element("h4", "mtm-task-group-name");
      const dot = element("span", "mtm-project-dot");
      dot.style.background = group.color || "var(--interactive-accent)";
      groupName.append(dot, element("span", "", group.name));
      groupHead.append(groupName, element("span", "mtm-task-group-count", `${group.tasks.length} open`));
      const list = element("div", "mtm-native-list");
      group.tasks
        .slice()
        .sort((a, b) => statusIndex(a.status) - statusIndex(b.status)
          || (a.due_date || "9999").localeCompare(b.due_date || "9999")
          || Number(b.priority) - Number(a.priority))
        .forEach(task => {
          const row = element("div", "setting-item");
          const info = element("div", "setting-item-info");
          const priority = PRIORITY[Number(task.priority)] || PRIORITY[2];
          const statusLabel = STATUS.find(item => item.id === task.status)?.label || task.status;
          const details = [statusLabel, priority.label, task.due_date ? relativeDate(task.due_date) : null].filter(Boolean).join(" · ");
          info.append(element("div", "setting-item-name", task.title), element("div", "setting-item-description", details));
          const control = element("div", "setting-item-control");
          const edit = element("button", "mtm-button", "Edit");
          edit.type = "button";
          edit.addEventListener("click", () => showTaskEditor(task, projects));
          const done = element("button", "mtm-button primary", "Done");
          done.type = "button";
          done.addEventListener("click", () => setTaskStatus(task, "done").catch(error => toast(error.message)));
          control.append(edit, done);
          row.append(info, control);
          list.append(row);
        });
      groupSection.append(groupHead, list);
      taskGroups.append(groupSection);
    });
    tasksSection.append(tasksHead, taskGroups);
    view.append(tasksSection);
  }

  if (state.tab === "projects") {
    const projectsSection = element("section");
    const projectsHead = element("div", "mtm-section-head");
    projectsHead.append(element("h3", "mtm-section-title", "Projects"));
    const newProject = element("button", "mtm-button primary", "New project");
    newProject.type = "button";
    newProject.addEventListener("click", showProjectCreator);
    projectsHead.append(newProject);
    const projectList = element("div", "mtm-native-list");
    if (!projects.length) {
      const row = element("div", "setting-item");
      const info = element("div", "setting-item-info");
      info.append(element("div", "setting-item-name", "No projects yet"), element("div", "setting-item-description", "Create a project to group related tasks."));
      row.append(info);
      projectList.append(row);
    }
    projects.forEach(project => {
      const projectTasks = tasks.filter(task => Number(task.project_id) === Number(project.id));
      const doneCount = projectTasks.filter(task => task.status === "done").length;
      const percent = projectTasks.length ? Math.round(doneCount / projectTasks.length * 100) : 0;
      const row = element("div", "setting-item");
      const info = element("div", "setting-item-info");
      const nameRow = element("div", "setting-item-name mtm-project-head");
      const dot = element("span", "mtm-project-dot");
      dot.style.background = project.color || "var(--interactive-accent)";
      nameRow.append(dot, element("span", "", project.name));
      info.append(nameRow, element("div", "setting-item-description", `${doneCount} of ${projectTasks.length} tasks complete · ${percent}%`));
      const progress = element("div", "mtm-progress");
      const fill = element("span");
      fill.style.width = `${percent}%`;
      fill.style.background = project.color || "var(--interactive-accent)";
      progress.append(fill);
      info.append(progress);
      const control = element("div", "setting-item-control");
      const open = element("button", "mtm-button", "Open board");
      open.type = "button";
      open.addEventListener("click", () => {
        state.projectId = String(project.id);
        state.tab = "board";
        root.dataset.mtmTab = "board";
        scheduleRender();
      });
      control.append(open);
      row.append(info, control);
      projectList.append(row);
    });
    projectsSection.append(projectsHead, projectList);
    view.append(projectsSection);
  }

  if (state.tab === "board") {
    const toolbar = element("div", "mtm-toolbar");
    const searchWrap = element("div", "search-input-container");
    const search = element("input", "mtm-search");
    search.type = "search";
    search.dataset.mtmFocus = "search";
    search.placeholder = "Search tasks…";
    search.value = state.search;
    search.addEventListener("input", () => { state.search = search.value; scheduleRender(); });
    searchWrap.append(search);
    const projectFilter = element("select", "dropdown mtm-select");
    projectFilter.append(option("all", "All projects", state.projectId === "all"), option("none", "No project", state.projectId === "none"));
    projects.forEach(project => projectFilter.append(option(String(project.id), project.name, state.projectId === String(project.id))));
    projectFilter.addEventListener("change", () => { state.projectId = projectFilter.value; scheduleRender(); });
    const hideDone = element("button", "mtm-button", state.hideDone ? "Show done" : "Hide done");
    hideDone.type = "button";
    hideDone.addEventListener("click", () => { state.hideDone = !state.hideDone; scheduleRender(); });
    toolbar.append(searchWrap, projectFilter, hideDone);

    const boardSection = element("section");
    const boardHead = element("div", "mtm-section-head");
    boardHead.append(element("h3", "mtm-section-title", "Board"), element("span", "mtm-subtitle", "Drag cards between stages"));
    boardSection.append(boardHead);
    const board = element("div", "mtm-board");
  STATUS.forEach(status => {
    const statusTasks = filtered.filter(task => task.status === status.id);
    const column = element("section", "mtm-column");
    column.dataset.status = status.id;
    const head = element("div", "mtm-column-head");
    head.append(element("span", "", status.icon), element("span", "", status.label));
    if (status.id === "doing" && statusTasks.length > WIP_LIMIT) {
      head.append(element("span", "mtm-wip", `WIP ${statusTasks.length}/${WIP_LIMIT}`));
    }
    head.append(element("span", "mtm-column-count", statusTasks.length));
    const cards = element("div", "mtm-cards");
    if (!statusTasks.length) cards.append(element("div", "mtm-empty", "Drop tasks here"));
    statusTasks.forEach(task => cards.append(renderTaskCard(task, projects)));
    column.append(head, cards);
    column.addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("dragover");
    });
    column.addEventListener("dragleave", event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("dragover");
    });
    column.addEventListener("drop", async event => {
      event.preventDefault();
      column.classList.remove("dragover");
      const id = Number(event.dataTransfer.getData("text/plain") || state.draggedTaskId);
      const task = tasks.find(item => Number(item.id) === id);
      if (task) await setTaskStatus(task, status.id);
    });
    board.append(column);
  });
    boardSection.append(board);
    view.append(toolbar, boardSection);
  }

  if (state.tab === "activity") {
    view.append(makeStats());
    const heatmapSection = element("section");
    const heatmapHead = element("div", "mtm-section-head");
    heatmapHead.append(element("h3", "mtm-section-title", "Completion activity"), element("span", "mtm-subtitle", `${events.length} completions recorded`));
    const heatmap = element("div", "mtm-panel mtm-heatmap");
    heatmapSection.append(heatmapHead, heatmap);
    view.append(heatmapSection);
    renderHeatmap(heatmap, events);
  }

  if (focusedControl === "search") {
    const search = view.querySelector('[data-mtm-focus="search"]');
    if (search) {
      search.focus();
      const caret = Math.min(focusedCaret ?? search.value.length, search.value.length);
      search.setSelectionRange(caret, caret);
    }
  }
}

// Keep the dashboard fresh when Motion DB changes, without leaking listeners
// when Dataview rebuilds this note.
window.__motionTaskManagerSubscriptions ??= new WeakMap();
window.__motionTaskManagerSubscriptions.get(root)?.();
const unsubscribe = api.subscribe(change => {
  if (!root.isConnected) {
    unsubscribe();
    return;
  }
  if (change.name === DB_NAME) scheduleRender();
});
window.__motionTaskManagerSubscriptions.set(root, unsubscribe);

try {
  await render();
} catch (error) {
  console.error("[Motion Task Manager]", error);
  app.replaceChildren(element("div", "mtm-panel mtm-empty", `Could not load Motion Tasks: ${error.message || error}`));
}
```
