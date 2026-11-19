/* Inkpress Order Manager — browser app (vanilla JS) */
const $ = id => document.getElementById(id);
const state = { me: null, view: "dashboard", orders: [], logistics: [], team: [], products: [], companies: [], range: "month", settingsTab: "team", chart: null, logisticsMethod: "", cache: {} };
const LOADING = `<div class="loading">Loading…</div>`;

// ---------- helpers ----------
const LABELS = {
  INTAKE: "Intake", IN_PROGRESS: "In Progress", DONE: "Done", CANCELED: "Canceled", RECEIVED: "Received",
  PAID: "Paid", NOT_PAID: "Not Paid", DOWN_PAYMENT: "Down Payment",
  DELIVERY: "Far Delivery", LOCAL_DELIVERY: "Local Delivery", PICK_UP: "Pickup",
  NORMAL: "Normal", HIGH: "High", URGENT: "Urgent", ADMIN: "Admin", STAFF: "Designer",
  CASH: "Cash", WHISH: "Whish", EXPENSE: "Expense", SETTLEMENT: "Settlement", ADJUSTMENT: "Adjustment",
  APPROVED: "Approved", REJECTED: "Rejected", PENDING: "Pending"
};
const pretty = v => LABELS[v] || v || "—";
const PRIORITY_RANK = { URGENT: 3, HIGH: 2, NORMAL: 1 };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = v => usd.format(Number(v) || 0);
const dateText = v => (v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const orderNo = n => `#${n}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAdmin = () => state.me?.role === "ADMIN";
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => localDate(new Date());
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.startsWith("/api/auth/")) { location.reload(); throw new Error("Please sign in."); }
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
const post = (url, body = {}) => api(url, { method: "POST", body: JSON.stringify(body) });
const patch = (url, body = {}) => api(url, { method: "PATCH", body: JSON.stringify(body) });
const put = (url, body = {}) => api(url, { method: "PUT", body: JSON.stringify(body) });
const del = url => api(url, { method: "DELETE" });

function toast(message, kind = "error") {
  const el = $("alert");
  el.textContent = message;
  el.className = `alert ${kind === "ok" ? "ok" : ""}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add("hidden"), 4500);
}
const run = fn => async (...args) => { try { await fn(...args); } catch (err) { toast(err.message); } };

function rangeDates(r) {
  const now = new Date(), d = new Date(now);
  if (r === "today") return { from: today(), to: today() };
  if (r === "week") { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: localDate(d), to: today() }; }
  if (r === "month") return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today() };
  if (r === "year") return { from: localDate(new Date(now.getFullYear(), 0, 1)), to: today() };
  return {};
}
const rangeQuery = r => new URLSearchParams(rangeDates(r)).toString();
const rangeSelect = (id, value) => `<select id="${id}" class="field compact">${[["today", "Today"], ["week", "This week"], ["month", "This month"], ["year", "This year"], ["all", "All time"]].map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;

// ---------- boot / auth ----------
async function loadReference() {
  const [team, products, companies] = await Promise.all([api("/api/users/team"), api("/api/catalog/product-types"), api("/api/catalog/delivery-companies")]);
  state.team = team.users; state.products = products.items; state.companies = companies.items;
}
async function showApp(user) {
  state.me = user;
  $("loginScreen").classList.add("hidden"); $("app").classList.remove("hidden");
  $("userName").textContent = user.name;
  $("userRole").textContent = user.role === "ADMIN" ? "Administrator" : "Designer";
  $("userAvatar").textContent = user.name.slice(0, 1).toUpperCase();
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("hidden", user.role !== "ADMIN"));
  $("pageDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  try { await loadReference(); } catch (err) { toast(err.message); }
  const fromHash = location.hash.slice(1);
  loadView(VIEWS[fromHash] && (!VIEWS[fromHash].admin || isAdmin()) ? fromHash : (isAdmin() ? "dashboard" : "progress"));
  setInterval(() => refreshCounts(), 30000);
  setTimeout(() => ["intake", "progress", "logistics"].forEach(v => {
    if (!state.cache[v]) api(`/api/orders?view=${v}`).then(r => { state.cache[v] ||= r.orders; }).catch(() => {});
  }), 800);
}
async function boot() {
  try { const data = await api("/api/auth/me"); await showApp(data.user); }
  catch { $("loginScreen").classList.remove("hidden"); }
}
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("loginError").textContent = "";
  try {
    const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: $("loginEmail").value, password: $("loginPassword").value }) });
    await showApp(d.user);
  } catch (err) { $("loginError").textContent = err.message; }
});
$("logoutBtn").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.hash = ""; location.reload(); });
$("passwordBtn").addEventListener("click", () => openForm({
  eyebrow: "ACCOUNT", title: "Change your password", submit: "Update password",
  fields: [{ id: "current", label: "Current password", type: "password", required: true }, { id: "next", label: "New password (8+ characters)", type: "password", required: true, minlength: 8 }],
  onSubmit: async v => { await post("/api/auth/password", v); toast("Password updated.", "ok"); }
}));

// ---------- navigation ----------
const VIEWS = {
  dashboard: { eyebrow: "OVERVIEW", title: "Dashboard", desc: "Orders, sales and where the money is.", panel: "dashboardPanel" },
  intake: { eyebrow: "NEW ORDERS", title: "Order Intake", desc: "Every new order lands here. Assign it to a designer to start production.", panel: "ordersPanel" },
  progress: { eyebrow: "PRODUCTION", title: "In Progress", desc: "Orders being designed and produced.", panel: "ordersPanel" },
  logistics: { eyebrow: "FULFILMENT", title: "Logistics", desc: "Orders to hand over or deliver. Print invoices from here.", panel: "logisticsPanel" },
  completed: { eyebrow: "COMPLETED", title: "Completed", desc: "Finished orders, waiting for or already received by the client.", panel: "ordersPanel" },
  canceled: { eyebrow: "ARCHIVE", title: "Canceled", desc: "Orders that were canceled.", panel: "ordersPanel" },
  clients: { eyebrow: "DATABASE", title: "Clients", desc: "Everyone who has ordered, with their history and spend.", panel: "clientsPanel" },
  approvals: { eyebrow: "ADMIN", title: "Hand-off approvals", desc: "Designers asking to send an order to another designer.", panel: "approvalsPanel", admin: true },
  settings: { eyebrow: "ADMIN", title: "Settings", desc: "Team, logins, analytics, products, delivery companies and printing.", panel: "settingsPanel", admin: true }
};
$("navigation").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) loadView(b.dataset.view); });
$("newOrderBtn").addEventListener("click", () => openOrder());
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (VIEWS[v] && v !== state.view) loadView(v); });

async function loadView(view) {
  const info = VIEWS[view];
  if (!info || (info.admin && !isAdmin())) return;
  if (state.view !== view) state.filtersFor = null;
  state.view = view;
  if (location.hash.slice(1) !== view) history.replaceState(null, "", `#${view}`);
  document.querySelectorAll(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $("sectionEyebrow").textContent = info.eyebrow; $("pageTitle").textContent = info.title; $("pageDescription").textContent = info.desc;
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("hidden", p.id !== info.panel));
  $("headingRight").innerHTML = "";
  refreshCounts();
  try {
    if (view === "dashboard") await renderDashboard();
    else if (view === "logistics") await loadLogistics();
    else if (view === "clients") await loadClients();
    else if (view === "approvals") await loadApprovals();
    else if (view === "settings") await renderSettings();
    else await loadOrders(view);
  } catch (err) { toast(err.message); }
}
async function refreshCounts() {
  try {
    const d = await api("/api/orders/counts");
    $("intakeCount").textContent = d.counts.INTAKE || 0;
    $("progressCount").textContent = d.counts.IN_PROGRESS || 0;
    $("approvalCount").textContent = d.pendingTransfers;
    $("approvalCount").classList.toggle("hidden", !d.pendingTransfers);
  } catch { /* ignore */ }
}
// After a change, other pages' copies are out of date; keep only the page on screen (it refreshes right away).
const reload = () => {
  const keep = state.cache[state.view];
  state.cache = keep ? { [state.view]: keep } : {};
  return loadView(state.view);
};

// ---------- dashboard ----------
async function renderDashboard() {
  $("headingRight").innerHTML = rangeSelect("dashRange", state.range);
  $("dashRange").onchange = e => { state.range = e.target.value; $("dashboardPanel").innerHTML = LOADING; renderDashboard().catch(err => toast(err.message)); };
  const q = rangeQuery(state.range), key = `dash:${q}`;
  if (state.cache[key]) drawDashboard(...state.cache[key]);
  else if (!$("dashboardPanel").innerHTML) $("dashboardPanel").innerHTML = LOADING;
  const data = await Promise.all([api(`/api/finance/summary?${q}`), isAdmin() ? api(`/api/finance/entries?${q}`) : null]);
  state.cache[key] = data;
  if (state.view === "dashboard" && rangeQuery(state.range) === q) drawDashboard(...data);
}
function drawDashboard(d, entryData) {
  const o = d.orders, p = d.performance;
  let html = `
  <div class="report-card">
    <div class="report-title">Orders report</div>
    <table class="report-table"><thead><tr><th>Total Orders</th><th>In Progress</th><th>Completed</th><th>Received</th><th>Canceled</th><th>Total Sales</th></tr></thead>
    <tbody><tr><td>${o.total}</td><td>${o.inProgress}</td><td>${o.completed}</td><td>${o.received}</td><td>${o.canceled}</td><td class="strong">${money(o.totalSales)}</td></tr></tbody></table>
    <p class="hint mt-2">${o.intake} order${o.intake === 1 ? "" : "s"} waiting in Order Intake · Total Sales = completed + received orders</p>
  </div>
  <div class="dash-grid">
    <div class="report-card">
      <div class="report-title">Performance</div>
      <table class="report-table left"><thead><tr><th>Performance</th><th class="num">Orders</th><th class="num">Sales</th></tr></thead><tbody>
        <tr><td>Far Delivery</td><td class="num">${p.far.orders}</td><td class="num">${money(p.far.sales)}</td></tr>
        <tr><td>Local Delivery</td><td class="num">${p.local.orders}</td><td class="num">${money(p.local.sales)}</td></tr>
        <tr><td>Pickup</td><td class="num">${p.pickup.orders}</td><td class="num">${money(p.pickup.sales)}</td></tr>
      </tbody></table>
      <p class="hint mt-2">Excludes canceled orders.</p>
    </div>`;
  if (d.money) {
    const m = d.money;
    html += `
    <div class="report-card">
      <div class="flex justify-between items-center mb-3"><div class="report-title mb-0">Money</div><div class="flex gap-2"><button class="action" id="addExpenseBtn">＋ Expense</button><button class="action" id="adjustBtn">± Adjust balance</button></div></div>
      <div class="tiles">
        <div class="tile"><div class="tile-label">Sales</div><div class="tile-value">${money(m.sales)}</div></div>
        <div class="tile"><div class="tile-label">Expenses</div><div class="tile-value red">${money(m.expenses)}</div></div>
        <div class="tile"><div class="tile-label">Net</div><div class="tile-value ${m.net < 0 ? "red" : "green"}">${money(m.net)}</div></div>
        <div class="tile"><div class="tile-label">Cash in drawer</div><div class="tile-value">${money(m.cash)}</div></div>
        <div class="tile"><div class="tile-label">Mobile money (Whish)</div><div class="tile-value">${money(m.whish)}</div></div>
        <div class="tile"><div class="tile-label">Held by delivery companies</div><div class="tile-value amber">${money(m.held)}</div></div>
      </div>
      <p class="hint mt-2">Sales and expenses follow the period above. Cash, Whish and held amounts are current balances.</p>
    </div>`;
  }
  html += `</div>`;
  if (d.companies) {
    html += `
    <div class="report-card">
      <div class="flex justify-between items-center mb-3"><div class="report-title mb-0">Held by delivery companies</div><button class="btn btn-primary btn-sm" id="addCompanyBtn">＋ Add delivery company</button></div>
      <table class="data-table"><thead><tr><th>Company</th><th>Phone</th><th class="num">Out for delivery</th><th class="num">Delivered, unpaid</th><th class="num">Amount held</th><th></th></tr></thead><tbody>
      ${d.companies.length ? d.companies.map(c => `<tr><td class="strong">${esc(c.name)}</td><td>${esc(c.phone || "—")}</td><td class="num">${c.upcoming}</td><td class="num">${c.orders}</td><td class="num strong">${money(c.held)}</td>
        <td class="right">${c.held > 0 ? `<button class="action green" data-settle="${c.id}" data-name="${esc(c.name)}" data-amount="${c.held}">Settle</button>` : ""}</td></tr>`).join("")
        : `<tr><td colspan="6" class="empty-row">No delivery companies yet. Add one to track the money they collect for you.</td></tr>`}
      </tbody></table>
    </div>
    <div class="report-card">
      <div class="report-title">Expenses & money movements</div>
      <div id="entriesBox" class="muted text-sm">Loading…</div>
    </div>`;
  }
  $("dashboardPanel").innerHTML = html;
  if (!d.money) return;
  $("addExpenseBtn").onclick = () => entryForm("EXPENSE");
  $("adjustBtn").onclick = () => entryForm("ADJUSTMENT");
  $("addCompanyBtn").onclick = () => companyForm(renderDashboard);
  $("dashboardPanel").querySelectorAll("[data-settle]").forEach(b => b.onclick = () => openForm({
    eyebrow: "SETTLEMENT", title: `Settle ${b.dataset.name}`, submit: `Receive ${money(b.dataset.amount)}`,
    intro: `${b.dataset.name} is handing over ${money(b.dataset.amount)} it collected from customers. Where is the money going?`,
    fields: [{ id: "method", label: "Received into", type: "select", options: [["CASH", "Cash drawer"], ["WHISH", "Whish"]] }],
    onSubmit: async v => { const r = await post(`/api/finance/settle/${b.dataset.id}`, v); toast(`Settled ${money(r.amount)} for ${r.orders} orders.`, "ok"); await renderDashboard(); }
  }));
  const entries = entryData?.entries || [];
  $("entriesBox").innerHTML = entries.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${entries.map(e => `<tr><td>${dateText(e.entryDate)}</td><td><span class="chip ${e.type.toLowerCase()}">${pretty(e.type)}</span></td><td>${esc(e.description || "—")}</td><td>${pretty(e.method)}</td>
      <td class="num strong ${e.type === "EXPENSE" || e.amount < 0 ? "red" : "green"}">${e.type === "EXPENSE" ? "−" : e.amount < 0 ? "" : "+"}${money(e.amount)}</td>
      <td class="right">${e.type !== "SETTLEMENT" ? `<button class="action red" data-del-entry="${e.id}">Delete</button>` : ""}</td></tr>`).join("")}</tbody></table>`
    : `<p class="empty-row">No expenses recorded in this period.</p>`;
  $("entriesBox").querySelectorAll("[data-del-entry]").forEach(b => b.onclick = run(async () => {
    if (!confirm("Delete this entry?")) return;
    await del(`/api/finance/entries/${b.dataset.delEntry}`); await renderDashboard();
  }));
}
function entryForm(type) {
  const expense = type === "EXPENSE";
  openForm({
    eyebrow: expense ? "EXPENSE" : "ADJUSTMENT", title: expense ? "Add an expense" : "Adjust a balance",
    intro: expense ? "Money paid out for the business (supplies, rent, salaries…)." : "Correct the cash drawer or Whish balance, e.g. opening balance (+) or money taken out (−).",
    fields: [
      { id: "amount", label: expense ? "Amount (USD)" : "Amount (USD, use − to subtract)", type: "number", step: "0.01", required: true },
      { id: "method", label: expense ? "Paid from" : "Account", type: "select", options: [["CASH", "Cash drawer"], ["WHISH", "Whish"]] },
      { id: "description", label: "Description", placeholder: expense ? "e.g. Paper stock" : "e.g. Opening balance" },
      { id: "entryDate", label: "Date", type: "date", value: today() }
    ],
    onSubmit: async v => { await post("/api/finance/entries", { ...v, type }); toast("Saved.", "ok"); await renderDashboard(); }
  });
}
function companyForm(after) {
  openForm({
    eyebrow: "DELIVERY", title: "Add delivery company",
    fields: [{ id: "name", label: "Company name", required: true }, { id: "phone", label: "Phone (optional)" }],
    onSubmit: async v => { await post("/api/catalog/delivery-companies", v); await loadReference(); toast("Delivery company added.", "ok"); await after(); }
  });
}

// ---------- order lists ----------
async function loadOrders(view) {
  const sameView = state.filtersFor === view;
  setupOrderFilters(view);
  // Show the last copy instantly, then refresh in the background.
  if (state.cache[view]) { state.orders = state.cache[view]; renderOrders(); }
  else if (!sameView) { state.orders = []; $("claimSection").classList.add("hidden"); $("ordersGrid").innerHTML = LOADING; }
  const { orders } = await api(`/api/orders?view=${view}`);
  state.cache[view] = orders;
  if (state.view === view) { state.orders = orders; renderOrders(); }
}
function setupOrderFilters(view) {
  if (state.filtersFor === view) return;
  state.filtersFor = view;
  $("searchInput").value = "";
  const df = $("designerFilter");
  const showDesigner = ["progress", "completed", "canceled"].includes(view);
  df.classList.toggle("hidden", !showDesigner);
  if (showDesigner) {
    const def = view === "progress" && !isAdmin() ? "me" : "all";
    df.innerHTML = `<option value="me">My orders</option><option value="all">All designers</option>${state.team.filter(u => u.id !== state.me.id).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}<option value="none">Unassigned</option>`;
    df.value = def;
  }
  $("priorityFilter").classList.toggle("hidden", !["intake", "progress"].includes(view));
  $("priorityFilter").value = "";
  $("sortSelect").value = view === "progress" ? "priority" : "newest";
}
$("searchInput").addEventListener("input", renderOrders);
$("sortSelect").addEventListener("change", renderOrders);
$("designerFilter").addEventListener("change", renderOrders);
$("priorityFilter").addEventListener("change", renderOrders);

function renderOrders() {
  const view = state.view, q = $("searchInput").value.trim().toLowerCase();
  let list = state.orders.filter(o => !q || [orderNo(o.orderNumber), o.orderNumber, o.customerName, o.phoneNumber, o.orderDetail, o.note, o.laborName, o.productType?.name].join(" ").toLowerCase().includes(q));
  const pf = $("priorityFilter").value;
  if (pf) list = list.filter(o => PRIORITY_RANK[o.priority] >= PRIORITY_RANK[pf]);

  let claim = [];
  if (view === "progress") { claim = list.filter(o => o.openToAll); list = list.filter(o => !o.openToAll); }
  const df = $("designerFilter").value;
  if (["progress", "completed", "canceled"].includes(view) && df !== "all") {
    list = list.filter(o => df === "me" ? o.laborUserId === state.me.id : df === "none" ? !o.laborUserId : o.laborUserId === df);
  }
  const sort = $("sortSelect").value;
  const byDate = (a, b) => new Date(a.orderDate) - new Date(b.orderDate) || a.orderNumber - b.orderNumber;
  const cmp = {
    priority: (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || byDate(a, b),
    newest: (a, b) => byDate(b, a), oldest: byDate,
    customer: (a, b) => a.customerName.localeCompare(b.customerName)
  }[sort];
  list.sort(cmp); claim.sort(cmp);

  $("claimSection").classList.toggle("hidden", !claim.length);
  $("claimCount").textContent = claim.length;
  $("claimGrid").innerHTML = claim.map(orderCard).join("");
  const emptyText = { intake: "No new orders. Click “New order” to add one.", progress: df === "me" ? "You have no orders in progress. Claim one above or switch the filter to all designers." : "No orders in progress.", completed: "No completed orders yet.", canceled: "No canceled orders." }[view];
  $("ordersGrid").innerHTML = list.length ? list.map(orderCard).join("") : `<div class="empty"><div class="text-3xl mb-3">▤</div><div class="font-bold text-slate-600">Nothing here</div><p class="text-xs mt-1">${emptyText}</p></div>`;
}

function orderCard(o) {
  const view = state.view, admin = isAdmin(), mine = o.laborUserId && o.laborUserId === state.me.id;
  const status = o.status.toLowerCase().replace("_", "-");
  const btn = (act, label, cls = "") => `<button class="action ${cls}" data-act="${act}" data-id="${o.id}">${label}</button>`;
  const a = [];
  if (view === "intake") {
    if (admin) {
      a.push(`<select class="mini-select" data-priority="${o.id}">${["NORMAL", "HIGH", "URGENT"].map(p => `<option value="${p}" ${o.priority === p ? "selected" : ""}>${pretty(p)} priority</option>`).join("")}</select>`);
      a.push(btn("assign", "Assign…", "green"), btn("edit", "Edit", "dark"), btn("delete", "Delete", "red"));
    } else a.push(btn("claim", "Take this order", "green"));
  } else if (view === "progress") {
    if (o.openToAll) { a.push(btn("claim", "Claim order", "green")); if (admin) a.push(btn("assign", "Assign…"), btn("edit", "Edit", "dark")); }
    else {
      if (mine || admin) a.push(btn("done", "Mark as done", "green"), btn("cancel", "Cancel", "red"));
      if (admin) a.push(btn("reassign", "Reassign…"), btn("edit", "Edit", "dark"));
      else if (mine) { if (!o.transfers?.length) a.push(btn("handoff", "Hand off…")); }
      else a.push(btn("take", "Take order"));
    }
  } else if (view === "completed") {
    if (admin && o.status === "DONE") a.push(btn("undo", "↶ Undo"), btn("received", "Mark as received", "green"));
    a.push(btn("print", "Print invoice"));
    if (admin) a.push(btn("edit", "Edit", "dark"));
  } else if (view === "canceled" && admin) a.push(btn("restore", "↶ Restore"), btn("edit", "Edit", "dark"), btn("delete", "Delete", "red"));

  const designer = o.openToAll ? `<span class="amber">To be claimed</span>` : esc(o.laborName || "Unassigned");
  const pay = o.paymentDetail === "PAID" ? "Paid" : o.paymentDetail === "DOWN_PAYMENT" ? `${money(o.amountPaid)} paid · ${money(o.balance)} due` : `${money(o.balance)} due`;
  const transfer = o.transfers?.[0];
  return `<article class="order-card ${o.priority !== "NORMAL" ? `prio-${o.priority.toLowerCase()}` : ""}">
    <div class="order-top"><div class="min-w-0"><div class="customer">${esc(o.customerName)}</div><div class="order-id">${orderNo(o.orderNumber)} · ${dateText(o.orderDate)}</div></div>
      <div class="flex gap-1 items-start flex-wrap justify-end">${o.priority !== "NORMAL" ? `<span class="prio ${o.priority.toLowerCase()}">${o.priority === "URGENT" ? "⚡ " : "▲ "}${pretty(o.priority)}</span>` : ""}<span class="status ${status}">${pretty(o.status)}</span></div></div>
    ${o.productType ? `<div class="product-chip">${esc(o.productType.name)}</div>` : ""}
    <p class="order-detail">${esc(o.orderDetail)}</p>
    ${o.note ? `<div class="note"><b>Note:</b> ${esc(o.note)}</div>` : ""}
    ${transfer ? `<div class="pending">⇄ Hand-off to ${esc(transfer.toUser.name)} waiting for admin approval</div>` : ""}
    <div class="meta-grid">
      <div><div class="meta-label">Designer</div><div class="meta-value">${designer}</div></div>
      <div><div class="meta-label">Phone</div><div class="meta-value">${esc(o.phoneNumber)}</div></div>
      <div><div class="meta-label">Receiving</div><div class="meta-value">${pretty(o.receivingMethod)}${o.deliveryCompany ? ` · ${esc(o.deliveryCompany.name)}` : ""}</div></div>
      <div><div class="meta-label">Payment</div><div class="meta-value">${pay} · ${esc(o.paymentMethod)}</div></div>
    </div>
    <div class="card-footer"><div><div class="meta-label">Order total</div><div class="price">${money(o.price)}</div></div><div class="card-actions">${a.join("")}</div></div>
  </article>`;
}

function handleCardClick(e) {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const o = state.orders.find(x => x.id === b.dataset.id); if (!o) return;
  const act = b.dataset.act;
  const actions = {
    edit: () => openOrder(o),
    print: () => printInvoice(o.id),
    claim: async () => { await post(`/api/orders/${o.id}/claim`); toast(`${orderNo(o.orderNumber)} is now yours.`, "ok"); },
    take: async () => { if (!confirm(`Take ${orderNo(o.orderNumber)} from ${o.laborName}?`)) return false; await post(`/api/orders/${o.id}/reassign`, { userId: state.me.id }); toast("Order moved to you.", "ok"); },
    done: async () => { if (!confirm(`Mark ${orderNo(o.orderNumber)} as done?`)) return false; await patch(`/api/orders/${o.id}/status`, { status: "DONE" }); toast("Moved to Completed.", "ok"); },
    cancel: async () => { if (!confirm(`Cancel ${orderNo(o.orderNumber)}?`)) return false; await patch(`/api/orders/${o.id}/status`, { status: "CANCELED" }); toast("Moved to Canceled.", "ok"); },
    undo: async () => { if (!confirm("Return this order to In Progress?")) return false; await patch(`/api/orders/${o.id}/status`, { status: "IN_PROGRESS" }); },
    restore: async () => { if (!confirm("Restore this order to In Progress?")) return false; await patch(`/api/orders/${o.id}/status`, { status: "IN_PROGRESS" }); },
    received: async () => { if (!confirm(o.deliveryCompanyId && o.receivingMethod !== "PICK_UP" ? `Mark as delivered? The ${money(o.balance)} balance will count as held by ${o.deliveryCompany?.name}.` : `Mark as received? The ${money(o.balance)} balance will be recorded as paid (${o.paymentMethod}).`)) return false; await patch(`/api/orders/${o.id}/received`); },
    delete: async () => { if (!confirm(`Permanently delete ${orderNo(o.orderNumber)}? This cannot be undone.`)) return false; await del(`/api/orders/${o.id}`); toast("Order deleted.", "ok"); },
    assign: () => assignPicker(o),
    reassign: () => reassignPicker(o),
    handoff: () => reassignPicker(o)
  };
  const fn = actions[act];
  if (!fn) return;
  const leaves = ["done", "cancel", "undo", "restore", "received", "delete"].includes(act) || (state.view === "intake" && act === "claim");
  Promise.resolve(fn()).then(r => {
    if (r === false || ["edit", "print", "assign", "reassign", "handoff"].includes(act)) return;
    // Take the card off the page immediately instead of waiting for the refresh.
    if (leaves) { state.orders = state.orders.filter(x => x.id !== o.id); state.cache[state.view] = state.orders; renderOrders(); }
    reload();
  }).catch(err => toast(err.message));
}
$("ordersGrid").addEventListener("click", handleCardClick);
$("claimGrid").addEventListener("click", handleCardClick);
$("ordersGrid").addEventListener("change", run(async e => {
  const s = e.target.closest("[data-priority]"); if (!s) return;
  await patch(`/api/orders/${s.dataset.priority}/priority`, { priority: s.value });
  const o = state.orders.find(x => x.id === s.dataset.priority); if (o) o.priority = s.value;
  renderOrders();
}));

// ---------- pickers ----------
function openPicker({ eyebrow, title, subtitle, options, onPick }) {
  $("pickEyebrow").textContent = eyebrow; $("pickTitle").textContent = title; $("pickSubtitle").textContent = subtitle || ""; $("pickError").textContent = "";
  $("pickList").innerHTML = options.map((op, i) => `<button class="pick ${op.special ? "special" : ""}" data-i="${i}"><span class="avatar sm">${op.icon || esc(op.label.slice(0, 1).toUpperCase())}</span><span class="min-w-0"><span class="block font-bold">${esc(op.label)}</span>${op.sub ? `<span class="block text-xs muted">${esc(op.sub)}</span>` : ""}</span></button>`).join("") || `<p class="muted text-sm">Nobody else to choose.</p>`;
  $("pickList").onclick = async e => {
    const b = e.target.closest("[data-i]"); if (!b) return;
    try { await onPick(options[b.dataset.i]); $("pickDialog").close(); reload(); }
    catch (err) { $("pickError").textContent = err.message; }
  };
  $("pickDialog").showModal();
}
const personOptions = (exclude = []) => state.team.filter(u => !exclude.includes(u.id)).map(u => ({ label: u.id === state.me.id ? `${u.name} (you)` : u.name, sub: pretty(u.role), userId: u.id }));
function assignPicker(o) {
  openPicker({
    eyebrow: "ASSIGN", title: `Assign ${orderNo(o.orderNumber)}`, subtitle: `${o.customerName} — choose who works on it.`,
    options: [{ label: "All designers", sub: "Shows first for everyone; the first to claim it gets it", icon: "★", special: true, all: true }, ...personOptions(o.openToAll ? [] : [o.laborUserId].filter(Boolean))],
    onPick: async op => { await post(`/api/orders/${o.id}/assign`, op.all ? { all: true } : { userId: op.userId }); toast(op.all ? "Sent to all designers." : `Assigned to ${op.label.replace(" (you)", "")}.`, "ok"); }
  });
}
function reassignPicker(o) {
  const admin = isAdmin();
  openPicker({
    eyebrow: admin ? "REASSIGN" : "HAND OFF", title: `${admin ? "Reassign" : "Hand off"} ${orderNo(o.orderNumber)}`,
    subtitle: admin ? `Currently with ${o.laborName || "nobody"}.` : "An admin must approve before the order moves.",
    options: personOptions([o.laborUserId, admin ? null : state.me.id].filter(Boolean)),
    onPick: async op => { const r = await post(`/api/orders/${o.id}/reassign`, { userId: op.userId }); toast(r.pendingApproval ? "Hand-off sent to the admin for approval." : `Moved to ${op.label.replace(" (you)", "")}.`, "ok"); }
  });
}

// ---------- order form ----------
const fillSelect = (el, items, placeholder, value) => { el.innerHTML = `<option value="">${placeholder}</option>` + items.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join(""); el.value = value || ""; };
function syncFormVisibility() {
  $("amountPaidWrap").classList.toggle("hidden", $("paymentDetail").value !== "DOWN_PAYMENT");
  $("companyWrap").classList.toggle("hidden", $("receivingMethod").value === "PICK_UP");
}
$("paymentDetail").addEventListener("change", syncFormVisibility);
$("receivingMethod").addEventListener("change", syncFormVisibility);
$("phoneNumber").addEventListener("blur", run(async () => {
  const phone = $("phoneNumber").value.trim(); $("clientHint").textContent = "";
  if (phone.length < 3) return;
  const { client } = await api(`/api/clients/lookup?phone=${encodeURIComponent(phone)}`);
  if (!client) { $("clientHint").textContent = "New client"; return; }
  if (!$("customerName").value.trim()) $("customerName").value = client.name;
  $("clientHint").textContent = `Returning client · ${client.orders} order${client.orders === 1 ? "" : "s"} · ${money(client.spent)} spent`;
}));

function openOrder(o) {
  const edit = !!o;
  $("orderForm").reset(); $("formError").textContent = ""; $("clientHint").textContent = "";
  $("orderId").value = o?.id || "";
  $("formTitle").textContent = edit ? `Edit order ${orderNo(o.orderNumber)}` : "Create new order";
  $("formSubtitle").textContent = edit ? "Admin edit — every field can be changed." : "New orders go to Order Intake.";
  document.querySelectorAll("#orderForm .edit-only").forEach(el => el.classList.toggle("hidden", !edit));
  document.querySelectorAll("#orderForm .admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin()));
  fillSelect($("productTypeId"), state.products, state.products.length ? "— Select product —" : "— No products yet (Settings) —", o?.productTypeId);
  fillSelect($("deliveryCompanyId"), state.companies, "— Own driver / none —", o?.deliveryCompanyId);
  $("assignee").innerHTML = `<option value="">Unassigned</option><option value="__all__">All designers (to be claimed)</option>` + state.team.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
  $("orderDate").value = o ? new Date(o.orderDate).toISOString().slice(0, 10) : today();
  for (const k of ["customerName", "phoneNumber", "orderDetail", "price"]) $(k).value = o ? o[k] : "";
  $("note").value = o?.note || "";
  $("paymentDetail").value = o?.paymentDetail || "NOT_PAID";
  $("amountPaid").value = o && o.paymentDetail === "DOWN_PAYMENT" ? o.amountPaid : "";
  $("paymentMethod").value = /whish/i.test(o?.paymentMethod || "") ? "Whish" : "Cash";
  $("receivingMethod").value = o && o.receivingMethod !== "RECEIVED" ? o.receivingMethod : "PICK_UP";
  $("priority").value = o?.priority || "NORMAL";
  if (edit) {
    $("status").value = o.status;
    $("assignee").value = o.openToAll ? "__all__" : o.laborUserId || "";
    $("deliverySettled").checked = !!o.deliverySettled;
  }
  syncFormVisibility();
  $("orderDialog").showModal();
}
$("orderForm").addEventListener("submit", async e => {
  e.preventDefault(); $("formError").textContent = "";
  const id = $("orderId").value;
  const body = {
    orderDate: $("orderDate").value, customerName: $("customerName").value, phoneNumber: $("phoneNumber").value,
    orderDetail: $("orderDetail").value, note: $("note").value, price: $("price").value,
    paymentDetail: $("paymentDetail").value, amountPaid: $("amountPaid").value || 0, paymentMethod: $("paymentMethod").value,
    receivingMethod: $("receivingMethod").value, deliveryCompanyId: $("deliveryCompanyId").value, productTypeId: $("productTypeId").value
  };
  if (isAdmin()) body.priority = $("priority").value;
  if (id) {
    const as = $("assignee").value;
    Object.assign(body, { status: $("status").value, laborUserId: as === "__all__" ? "" : as, openToAll: as === "__all__", deliverySettled: $("deliverySettled").checked });
  }
  try {
    await api(id ? `/api/orders/${id}` : "/api/orders", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
    $("orderDialog").close();
    toast(id ? "Order updated." : "Order added to Order Intake.", "ok");
    if (!id && state.view !== "intake" && state.view !== "dashboard") { state.cache = {}; loadView("intake"); } else reload();
  } catch (err) { $("formError").textContent = err.message; }
});
$("deleteOrderBtn").addEventListener("click", run(async () => {
  const id = $("orderId").value; if (!id) return;
  if (!confirm("Permanently delete this order? This cannot be undone.")) return;
  await del(`/api/orders/${id}`); $("orderDialog").close(); toast("Order deleted.", "ok"); reload();
}));

// ---------- generic small form ----------
function openForm({ eyebrow = "", title, intro, fields, submit = "Save", onSubmit }) {
  $("gEyebrow").textContent = eyebrow; $("gTitle").textContent = title; $("gError").textContent = ""; $("gSubmit").textContent = submit;
  $("gFields").innerHTML = (intro ? `<p class="muted text-sm">${esc(intro)}</p>` : "") + fields.map(f => {
    const attrs = `id="g_${f.id}" class="field" ${f.required ? "required" : ""} ${f.minlength ? `minlength="${f.minlength}"` : ""} ${f.step ? `step="${f.step}"` : ""} placeholder="${esc(f.placeholder || "")}"`;
    if (f.type === "select") return `<div><label class="field-label">${esc(f.label)}</label><select ${attrs}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`;
    if (f.type === "checkbox") return `<label class="check"><input type="checkbox" id="g_${f.id}" ${f.value ? "checked" : ""}> ${esc(f.label)}</label>`;
    return `<div><label class="field-label">${esc(f.label)}</label><input type="${f.type || "text"}" ${attrs} value="${esc(f.value ?? "")}"></div>`;
  }).join("");
  $("genericForm").onsubmit = async e => {
    e.preventDefault(); $("gError").textContent = "";
    const values = Object.fromEntries(fields.map(f => [f.id, f.type === "checkbox" ? $(`g_${f.id}`).checked : $(`g_${f.id}`).value]));
    try { await onSubmit(values); $("formDialog").close(); } catch (err) { $("gError").textContent = err.message; }
  };
  $("formDialog").showModal();
}

// ---------- logistics ----------
async function loadLogistics() {
  if (state.cache.logistics) { state.logistics = state.cache.logistics; renderLogistics(); }
  else $("logisticsBody").innerHTML = `<tr><td colspan="5">${LOADING}</td></tr>`;
  const { orders } = await api("/api/orders?view=logistics");
  state.cache.logistics = state.logistics = orders;
  if (state.view === "logistics") renderLogistics();
}
$("logisticsSearch").addEventListener("input", () => renderLogistics());
$("logisticsTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-m]"); if (!b) return;
  state.logisticsMethod = b.dataset.m;
  $("logisticsTabs").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
  renderLogistics();
});
function renderLogistics() {
  const q = $("logisticsSearch").value.trim().toLowerCase();
  const list = state.logistics.filter(o => (!state.logisticsMethod || o.receivingMethod === state.logisticsMethod) && (!q || [orderNo(o.orderNumber), o.customerName, o.phoneNumber].join(" ").toLowerCase().includes(q)));
  $("logisticsBody").innerHTML = list.length ? list.map(o => `<tr>
    <td class="strong">${orderNo(o.orderNumber)} ${o.status === "DONE" ? `<span class="chip ready">Ready</span>` : `<span class="chip">In production</span>`}</td>
    <td>${esc(o.customerName)}</td><td>${esc(o.phoneNumber)}</td><td class="num strong">${money(o.price)}</td>
    <td class="right"><button class="action" data-print="${o.id}">🖨 Print invoice</button>${isAdmin() && o.status === "DONE" ? ` <button class="action green" data-recv="${o.id}">Mark as received</button>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty-row">No orders waiting for pickup or delivery.</td></tr>`;
}
$("logisticsBody").addEventListener("click", run(async e => {
  const p = e.target.closest("[data-print]"); if (p) return printInvoice(p.dataset.print);
  const r = e.target.closest("[data-recv]");
  if (r) { if (!confirm("Mark this order as received / delivered?")) return; await patch(`/api/orders/${r.dataset.recv}/received`); toast("Marked as received.", "ok");
    state.logistics = state.logistics.filter(o => o.id !== r.dataset.recv); state.cache = { logistics: state.logistics }; renderLogistics(); await loadLogistics(); }
}));

// ---------- invoice printing ----------
async function printInvoice(id) {
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups for this site to print invoices.");
  w.document.write("<p style='font-family:sans-serif;padding:20px'>Preparing invoice…</p>");
  try {
    const { order: o, print: s } = await api(`/api/orders/${id}/invoice`);
    const page = { A4: "A4", A5: "A5", "80mm": "80mm auto" }[s.paperSize];
    const narrow = s.paperSize === "80mm";
    const one = `<section class="inv">
      <header><div><h1>${esc(s.businessName)}</h1>${s.address ? `<div>${esc(s.address)}</div>` : ""}${s.phone ? `<div>${esc(s.phone)}</div>` : ""}</div>
        <div class="r"><h2>INVOICE</h2><div>${orderNo(o.orderNumber)}</div><div>${dateText(o.orderDate)}</div></div></header>
      <div class="box"><b>Bill to</b><div>${esc(o.customerName)}</div><div>${esc(o.phoneNumber)}</div></div>
      <table><thead><tr><th>Item</th><th class="r">Amount</th></tr></thead><tbody>
        <tr><td><b>${esc(o.productType?.name || "Order")}</b>${s.showDetails ? `<div class="d">${esc(o.orderDetail)}</div>` : ""}</td><td class="r">${money(o.price)}</td></tr>
      </tbody><tfoot>
        <tr><td class="r">Total</td><td class="r"><b>${money(o.price)}</b></td></tr>
        <tr><td class="r">Paid</td><td class="r">${money(o.amountPaid)}</td></tr>
        <tr><td class="r"><b>Balance due</b></td><td class="r"><b>${money(o.balance)}</b></td></tr>
      </tfoot></table>
      <div class="meta">Payment: ${esc(o.paymentMethod)} · ${pretty(o.paymentDetail)} · ${pretty(o.receivingMethod)}${o.deliveryCompany ? ` (${esc(o.deliveryCompany.name)})` : ""}${s.showDesigner && o.laborName ? ` · Designer: ${esc(o.laborName)}` : ""}</div>
      ${s.footer ? `<footer>${esc(s.footer)}</footer>` : ""}
    </section>`;
    w.document.open();
    w.document.write(`<!doctype html><html><head><title>Invoice ${orderNo(o.orderNumber)}</title><style>
      @page{size:${page};margin:${narrow ? "4mm" : "14mm"}}
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:${narrow ? "11px" : "13px"}}
      .inv{page-break-after:always;padding:${narrow ? "0" : "4px"}}.inv:last-child{page-break-after:auto}
      header{display:flex;${narrow ? "flex-direction:column;gap:8px" : "justify-content:space-between"};border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}
      h1{margin:0 0 4px;font-size:${narrow ? "16px" : "22px"}}h2{margin:0 0 4px;font-size:${narrow ? "14px" : "18px"};letter-spacing:.1em}
      .r{text-align:${narrow ? "left" : "right"}}td.r,th.r{text-align:right}
      .box{background:#f3f3f3;padding:8px 10px;border-radius:4px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse}th,td{padding:6px 4px;border-bottom:1px solid #ddd;vertical-align:top}th{text-align:left;font-size:11px;text-transform:uppercase}
      tfoot td{border:0;padding:3px 4px}.d{color:#444;white-space:pre-wrap;margin-top:3px}
      .meta{margin-top:12px;color:#444}footer{margin-top:18px;text-align:center;color:#444;border-top:1px dashed #999;padding-top:8px}
    </style></head><body>${Array.from({ length: s.copies }, () => one).join("")}<script>window.onload=()=>{window.focus();window.print();}<\/script></body></html>`);
    w.document.close();
  } catch (err) { w.close(); toast(err.message); }
}

// ---------- clients ----------
async function loadClients() {
  const q = $("clientSearch").value.trim();
  if (!$("clientsBody").children.length) $("clientsBody").innerHTML = `<tr><td colspan="7">${LOADING}</td></tr>`;
  const { clients } = await api(`/api/clients?q=${encodeURIComponent(q)}`);
  $("clientsBody").innerHTML = clients.length ? clients.map(c => `<tr class="clickable" data-client="${c.id}"><td class="strong">${esc(c.name)}</td><td>${esc(c.phone)}</td><td class="num">${c.orders}</td><td class="num">${c.open}</td><td class="num strong">${money(c.spent)}</td><td>${dateText(c.lastOrder)}</td><td class="right"><button class="action">History</button></td></tr>`).join("")
    : `<tr><td colspan="7" class="empty-row">${q ? "No clients match that search." : "Clients are added automatically when you create orders."}</td></tr>`;
}
$("clientSearch").addEventListener("input", debounce(run(loadClients)));
$("clientsBody").addEventListener("click", run(async e => {
  const row = e.target.closest("[data-client]"); if (!row) return;
  const { client: c, orders } = await api(`/api/clients/${row.dataset.client}`);
  $("clientTitle").textContent = c.name; $("clientSub").textContent = `${c.phone} · client since ${dateText(c.createdAt)}`;
  $("clientStats").innerHTML = `<div class="tile"><div class="tile-label">Orders</div><div class="tile-value">${c.orders}</div></div><div class="tile"><div class="tile-label">Open orders</div><div class="tile-value">${c.open}</div></div><div class="tile"><div class="tile-label">Total spent</div><div class="tile-value green">${money(c.spent)}</div></div><div class="tile"><div class="tile-label">Average order</div><div class="tile-value">${money(c.spent / Math.max(1, orders.filter(o => ["DONE", "RECEIVED"].includes(o.status)).length))}</div></div>`;
  $("clientOrders").innerHTML = orders.map(o => `<tr><td class="strong">${orderNo(o.orderNumber)}</td><td>${dateText(o.orderDate)}</td><td>${esc(o.productType?.name || "—")}</td><td class="clip">${esc(o.orderDetail)}</td><td>${esc(o.laborName || "—")}</td><td><span class="status ${o.status.toLowerCase().replace("_", "-")}">${pretty(o.status)}</span></td><td class="num">${money(o.price)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty-row">No orders.</td></tr>`;
  $("clientDialog").showModal();
}));

// ---------- approvals ----------
async function loadApprovals() {
  const [{ transfers }, { transfers: history }] = await Promise.all([api("/api/transfers"), api("/api/transfers?history=1")]);
  $("approvalsList").innerHTML = transfers.length ? transfers.map(t => `<div class="approval">
    <div class="min-w-0"><div class="font-bold">${orderNo(t.order.orderNumber)} · ${esc(t.order.customerName)} <span class="muted font-normal">· ${money(t.order.price)}</span></div>
    <div class="text-sm mt-1"><b>${esc(t.requestedBy.name)}</b> wants to send it from <b>${esc(t.fromUser?.name || "—")}</b> to <b>${esc(t.toUser.name)}</b></div>
    <div class="text-xs muted mt-1 clip">${esc(t.order.orderDetail)}</div></div>
    <div class="flex gap-2"><button class="action green" data-approve="${t.id}">Approve</button><button class="action red" data-reject="${t.id}">Reject</button></div></div>`).join("")
    : `<div class="empty"><div class="text-3xl mb-3">⇄</div><div class="font-bold text-slate-600">No hand-offs waiting</div><p class="text-xs mt-1">When a designer sends an order to another designer, it shows up here.</p></div>`;
  $("approvalsHistory").innerHTML = history.map(t => `<tr><td class="strong">${orderNo(t.order.orderNumber)}</td><td>${esc(t.fromUser?.name || "—")}</td><td>${esc(t.toUser.name)}</td><td>${esc(t.requestedBy.name)}</td><td><span class="chip ${t.status.toLowerCase()}">${pretty(t.status)}</span></td><td>${esc(t.decidedBy?.name || "—")}</td></tr>`).join("") || `<tr><td colspan="6" class="empty-row">No decisions yet.</td></tr>`;
}
$("approvalsList").addEventListener("click", run(async e => {
  const a = e.target.closest("[data-approve]"), r = e.target.closest("[data-reject]");
  if (a) { await post(`/api/transfers/${a.dataset.approve}/approve`); toast("Hand-off approved.", "ok"); }
  else if (r) { await post(`/api/transfers/${r.dataset.reject}/reject`); toast("Hand-off rejected.", "ok"); }
  else return;
  await loadApprovals(); refreshCounts();
}));

// ---------- settings ----------
// Chart.js is only needed for staff analytics, so it is loaded on first use.
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  return (loadChartJs.p ||= new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/chart.js@4";
    sc.onload = resolve; sc.onerror = () => { loadChartJs.p = null; reject(new Error("Could not load charts.")); };
    document.head.appendChild(sc);
  }));
}
$("settingsTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  state.settingsTab = b.dataset.tab; renderSettings().catch(err => toast(err.message));
});
async function renderSettings() {
  $("settingsTabs").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.settingsTab));
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const box = $("settingsBody");
  const tab = state.settingsTab;

  if (tab === "team") {
    const { users } = await api("/api/users");
    box.innerHTML = `<div class="report-card"><div class="flex justify-between items-center mb-3"><div><div class="report-title mb-0">Team & logins</div><p class="hint">Designers can only take orders for themselves. Admins can assign, set priority, approve hand-offs and edit everything.</p></div><button class="btn btn-primary btn-sm" id="addUserBtn">＋ Add designer / login</button></div>
      <table class="data-table"><thead><tr><th>Name</th><th>Email (login)</th><th>Role</th><th class="num">Orders in progress</th><th>Added</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr><td class="strong">${esc(u.name)}${u.id === state.me.id ? ` <span class="chip">you</span>` : ""}</td><td>${esc(u.email)}</td><td><span class="chip ${u.role === "ADMIN" ? "admin" : ""}">${pretty(u.role)}</span></td><td class="num">${u.activeOrders}</td><td>${dateText(u.createdAt)}</td>
        <td class="right"><button class="action" data-edit-user="${u.id}">Edit / reset password</button>${u.id !== state.me.id ? ` <button class="action red" data-del-user="${u.id}">Delete</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>`;
    $("addUserBtn").onclick = () => openForm({
      eyebrow: "TEAM", title: "Add designer / login", submit: "Create login",
      fields: [{ id: "name", label: "Name", required: true }, { id: "email", label: "Email (used to sign in)", type: "email", required: true }, { id: "password", label: "Password (8+ characters)", type: "password", required: true, minlength: 8 }, { id: "role", label: "Role", type: "select", options: [["STAFF", "Designer"], ["ADMIN", "Admin"]], value: "STAFF" }],
      onSubmit: async v => { await post("/api/users", v); await loadReference(); toast("Login created.", "ok"); await renderSettings(); }
    });
    box.querySelectorAll("[data-edit-user]").forEach(b => b.onclick = () => {
      const u = users.find(x => x.id === b.dataset.editUser);
      openForm({
        eyebrow: "TEAM", title: `Edit ${u.name}`,
        fields: [{ id: "name", label: "Name", value: u.name, required: true }, { id: "email", label: "Email (login)", type: "email", value: u.email, required: true }, { id: "role", label: "Role", type: "select", options: [["STAFF", "Designer"], ["ADMIN", "Admin"]], value: u.role }, { id: "password", label: "New password (leave empty to keep)", type: "password", minlength: 8 }],
        onSubmit: async v => { await patch(`/api/users/${u.id}`, v); await loadReference(); toast("Saved.", "ok"); await renderSettings(); }
      });
    });
    box.querySelectorAll("[data-del-user]").forEach(b => b.onclick = run(async () => {
      const u = users.find(x => x.id === b.dataset.delUser);
      if (!confirm(`Delete ${u.name}? Their ${u.activeOrders} in-progress order(s) will go back to “to be claimed”. Past orders keep their name.`)) return;
      await del(`/api/users/${u.id}`); await loadReference(); toast("Deleted.", "ok"); await renderSettings();
    }));
  }

  if (tab === "analytics") {
    const r = state.analyticsRange || "month";
    const { staff } = await api(`/api/finance/staff?${rangeQuery(r)}`);
    const tot = staff.reduce((a, s) => ({ completed: a.completed + s.completed, revenue: a.revenue + s.revenue }), { completed: 0, revenue: 0 });
    box.innerHTML = `<div class="report-card"><div class="flex justify-between items-center mb-4"><div><div class="report-title mb-0">Staff analytics</div><p class="hint">Completed = done + received orders. Revenue = total value of those orders.</p></div>${rangeSelect("anRange", r)}</div>
      <div class="chart-wrap"><canvas id="staffChart"></canvas></div></div>
      <div class="report-card"><table class="data-table"><thead><tr><th>Designer</th><th class="num">Completed orders</th><th class="num">Revenue generated</th><th class="num">Avg. order</th><th class="num">In progress</th><th class="num">Canceled</th></tr></thead><tbody>
      ${staff.map(s => `<tr><td class="strong">${esc(s.name)}</td><td class="num">${s.completed}</td><td class="num strong">${money(s.revenue)}</td><td class="num">${money(s.average)}</td><td class="num">${s.inProgress}</td><td class="num">${s.canceled}</td></tr>`).join("")}
      </tbody><tfoot><tr><td>Total</td><td class="num">${tot.completed}</td><td class="num">${money(tot.revenue)}</td><td></td><td></td><td></td></tr></tfoot></table></div>`;
    $("anRange").onchange = e => { state.analyticsRange = e.target.value; renderSettings().catch(err => toast(err.message)); };
    await loadChartJs().catch(() => {});
    if (window.Chart && state.settingsTab === "analytics") {
      state.chart = new Chart($("staffChart"), {
        data: {
          labels: staff.map(s => s.name),
          datasets: [
            { type: "bar", label: "Revenue (USD)", data: staff.map(s => s.revenue), backgroundColor: "#a8e45f", borderRadius: 6, yAxisID: "y" },
            { type: "bar", label: "Completed orders", data: staff.map(s => s.completed), backgroundColor: "#26364b", borderRadius: 6, yAxisID: "y1" }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, font: { family: "DM Sans" } } }, tooltip: { callbacks: { label: c => c.dataset.yAxisID === "y" ? `Revenue: ${money(c.raw)}` : `Completed: ${c.raw}` } } },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: v => money(v) }, grid: { color: "#edf0f4" } }, y1: { beginAtZero: true, position: "right", ticks: { precision: 0 }, grid: { display: false } } }
        }
      });
    }
  }

  if (tab === "products" || tab === "companies") {
    const products = tab === "products";
    const items = products ? state.products : state.companies;
    box.innerHTML = `<div class="report-card"><div class="report-title">${products ? "Product types" : "Delivery companies"}</div>
      <p class="hint mb-3">${products ? "These appear in the product dropdown on every order. Deleting a product keeps past orders but removes the label from them." : "Used for Far / Local delivery orders. The dashboard tracks the money each company collects until you settle it."}</p>
      <form id="addItemForm" class="flex gap-2 mb-4 flex-wrap"><input id="itemName" class="field" style="max-width:320px" required placeholder="${products ? "e.g. Business cards" : "Company name"}">${products ? "" : `<input id="itemPhone" class="field" style="max-width:220px" placeholder="Phone (optional)">`}<button class="btn btn-primary">＋ Add</button></form>
      <table class="data-table"><thead><tr><th>Name</th>${products ? "" : "<th>Phone</th>"}<th class="num">Orders</th><th></th></tr></thead><tbody>
      ${items.map(i => `<tr><td class="strong">${esc(i.name)}</td>${products ? "" : `<td>${esc(i.phone || "—")}</td>`}<td class="num">${i.orders}</td><td class="right"><button class="action red" data-del-item="${i.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty-row">Nothing added yet.</td></tr>`}
      </tbody></table></div>`;
    const base = products ? "/api/catalog/product-types" : "/api/catalog/delivery-companies";
    $("addItemForm").onsubmit = run(async e => {
      e.preventDefault();
      await post(base, { name: $("itemName").value, phone: products ? undefined : $("itemPhone").value });
      await loadReference(); await renderSettings();
    });
    box.querySelectorAll("[data-del-item]").forEach(b => b.onclick = run(async () => {
      if (!confirm("Delete this item?")) return;
      await del(`${base}/${b.dataset.delItem}`); await loadReference(); await renderSettings();
    }));
  }

  if (tab === "printing") {
    const { settings: s } = await api("/api/finance/print-settings");
    box.innerHTML = `<form id="printForm" class="report-card"><div class="report-title">Invoice printing</div><p class="hint mb-4">Used whenever an invoice is printed from Logistics or Completed.</p>
      <div class="form-grid">
        <div><label class="field-label">Business name</label><input id="p_businessName" class="field" value="${esc(s.businessName)}"></div>
        <div><label class="field-label">Phone</label><input id="p_phone" class="field" value="${esc(s.phone)}"></div>
        <div class="full"><label class="field-label">Address</label><input id="p_address" class="field" value="${esc(s.address)}"></div>
        <div class="full"><label class="field-label">Footer message</label><input id="p_footer" class="field" value="${esc(s.footer)}"></div>
        <div><label class="field-label">Paper size</label><select id="p_paperSize" class="field">${["A4", "A5", "80mm"].map(p => `<option value="${p}" ${s.paperSize === p ? "selected" : ""}>${p === "80mm" ? "80mm receipt printer" : p}</option>`).join("")}</select></div>
        <div><label class="field-label">Copies per print</label><input id="p_copies" class="field" type="number" min="1" max="5" value="${s.copies}"></div>
        <label class="check"><input type="checkbox" id="p_showDetails" ${s.showDetails ? "checked" : ""}> Show order details on the invoice</label>
        <label class="check"><input type="checkbox" id="p_showDesigner" ${s.showDesigner ? "checked" : ""}> Show designer name</label>
      </div>
      <div class="flex justify-end mt-5"><button class="btn btn-primary">Save printing settings</button></div></form>`;
    $("printForm").onsubmit = run(async e => {
      e.preventDefault();
      await put("/api/finance/print-settings", {
        businessName: $("p_businessName").value, phone: $("p_phone").value, address: $("p_address").value, footer: $("p_footer").value,
        paperSize: $("p_paperSize").value, copies: $("p_copies").value, showDetails: $("p_showDetails").checked, showDesigner: $("p_showDesigner").checked
      });
      toast("Printing settings saved.", "ok");
    });
  }
}

boot();
