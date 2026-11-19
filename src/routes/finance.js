// Dashboard report, money balances, expenses, delivery-company settlements, staff analytics, print settings.
const express = require("express");
const prisma = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const v = require("../validation");
const { num, round, methodKey } = require("../money");
const router = express.Router();
router.use(requireAuth);

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (dates are computed in the browser's local time zone)
function range(q, field) {
  const ok = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const cond = {};
  if (ok(q.from)) cond.gte = v.toDate(q.from);
  if (ok(q.to)) cond.lte = v.toDate(q.to);
  return Object.keys(cond).length ? { [field]: cond } : {};
}

const HELD_WHERE = { status: "RECEIVED", deliverySettled: false, deliveryCompanyId: { not: null }, receivingMethod: { not: "PICK_UP" } };

async function balances() {
  const paid = await prisma.order.groupBy({ by: ["paymentMethod"], where: { status: { not: "CANCELED" } }, _sum: { amountPaid: true } });
  const entries = await prisma.cashEntry.groupBy({ by: ["type", "method"], _sum: { amount: true } });
  const b = { CASH: 0, WHISH: 0 };
  for (const p of paid) b[methodKey(p.paymentMethod)] += num(p._sum.amountPaid);
  for (const e of entries) b[e.method] += (e.type === "EXPENSE" ? -1 : 1) * num(e._sum.amount);
  return { cash: round(b.CASH), whish: round(b.WHISH) };
}

async function heldByCompanies() {
  const companies = await prisma.deliveryCompany.findMany({ orderBy: { name: "asc" } });
  const rows = await prisma.order.groupBy({ by: ["deliveryCompanyId"], where: HELD_WHERE, _sum: { price: true, amountPaid: true }, _count: { _all: true } });
  const inTransit = await prisma.order.groupBy({
    by: ["deliveryCompanyId"],
    where: { status: { in: ["IN_PROGRESS", "DONE"] }, deliveryCompanyId: { not: null }, receivingMethod: { not: "PICK_UP" } },
    _count: { _all: true }
  });
  return companies.map(c => {
    const r = rows.find(x => x.deliveryCompanyId === c.id);
    return {
      id: c.id, name: c.name, phone: c.phone,
      orders: r?._count._all || 0,
      held: r ? round(num(r._sum.price) - num(r._sum.amountPaid)) : 0,
      upcoming: inTransit.find(x => x.deliveryCompanyId === c.id)?._count._all || 0
    };
  });
}

router.get("/summary", async (req, res) => {
  const orderRange = range(req.query, "orderDate");
  const byStatus = await prisma.order.groupBy({ by: ["status"], where: orderRange, _count: { _all: true }, _sum: { price: true } });
  const count = s => byStatus.find(r => r.status === s)?._count._all || 0;
  const sum = s => num(byStatus.find(r => r.status === s)?._sum.price);
  const orders = {
    total: byStatus.reduce((a, r) => a + r._count._all, 0),
    intake: count("INTAKE"),
    inProgress: count("IN_PROGRESS"),
    completed: count("DONE"),
    received: count("RECEIVED"),
    canceled: count("CANCELED"),
    totalSales: round(sum("DONE") + sum("RECEIVED"))
  };
  const perf = await prisma.order.groupBy({
    by: ["receivingMethod"], where: { ...orderRange, status: { not: "CANCELED" } }, _count: { _all: true }, _sum: { price: true }
  });
  const p = m => ({ orders: perf.find(r => r.receivingMethod === m)?._count._all || 0, sales: round(num(perf.find(r => r.receivingMethod === m)?._sum.price)) });
  const performance = { far: p("DELIVERY"), local: p("LOCAL_DELIVERY"), pickup: p("PICK_UP") };

  const result = { orders, performance };
  if (req.user.role === "ADMIN") {
    const exp = await prisma.cashEntry.aggregate({ where: { type: "EXPENSE", ...range(req.query, "entryDate") }, _sum: { amount: true } });
    const expenses = round(num(exp._sum.amount));
    const companies = await heldByCompanies();
    result.money = {
      sales: orders.totalSales,
      expenses,
      net: round(orders.totalSales - expenses),
      ...(await balances()),
      held: round(companies.reduce((a, c) => a + c.held, 0))
    };
    result.companies = companies;
  }
  res.json(result);
});

// ---------- Expenses & adjustments (admin) ----------
router.get("/entries", requireAdmin, async (req, res) => {
  const entries = await prisma.cashEntry.findMany({
    where: range(req.query, "entryDate"),
    include: { deliveryCompany: { select: { name: true } }, createdBy: { select: { name: true } } },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 200
  });
  res.json({ entries: entries.map(e => ({ ...e, amount: num(e.amount) })) });
});
router.post("/entries", requireAdmin, async (req, res) => {
  const data = v.parse(v.cashEntry, req.body, res);
  if (!data) return;
  const entry = await prisma.cashEntry.create({
    data: { ...data, entryDate: v.toDate(data.entryDate) || new Date(), createdById: req.user.id }
  });
  res.status(201).json({ entry: { ...entry, amount: num(entry.amount) } });
});
router.delete("/entries/:id", requireAdmin, async (req, res) => {
  const entry = await prisma.cashEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) return res.status(404).json({ error: "Entry not found." });
  if (entry.type === "SETTLEMENT") return res.status(409).json({ error: "Settlements cannot be deleted. Add an adjustment instead." });
  await prisma.cashEntry.delete({ where: { id: entry.id } });
  res.json({ ok: true });
});

// Delivery company hands over the money it collected → goes into Cash or Whish.
router.post("/settle/:companyId", requireAdmin, async (req, res) => {
  const method = req.body?.method === "WHISH" ? "WHISH" : "CASH";
  const result = await prisma.$transaction(async tx => {
    const company = await tx.deliveryCompany.findUnique({ where: { id: req.params.companyId } });
    if (!company) return { status: 404, error: "Delivery company not found." };
    const orders = await tx.order.findMany({ where: { ...HELD_WHERE, deliveryCompanyId: company.id }, select: { id: true, price: true, amountPaid: true } });
    const amount = round(orders.reduce((a, o) => a + num(o.price) - num(o.amountPaid), 0));
    if (!orders.length || amount <= 0) return { status: 409, error: "Nothing to settle for this company." };
    await tx.order.updateMany({ where: { id: { in: orders.map(o => o.id) } }, data: { deliverySettled: true, deliverySettledAt: new Date() } });
    await tx.cashEntry.create({
      data: { type: "SETTLEMENT", method, amount, description: `Settlement from ${company.name} (${orders.length} orders)`, deliveryCompanyId: company.id, createdById: req.user.id }
    });
    return { amount, orders: orders.length };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// ---------- Staff analytics (admin) ----------
router.get("/staff", requireAdmin, async (req, res) => {
  const rows = await prisma.order.groupBy({
    by: ["laborUserId", "laborName", "status"],
    where: { ...range(req.query, "orderDate"), status: { not: "INTAKE" } },
    _count: { _all: true },
    _sum: { price: true }
  });
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  const map = new Map(users.map(u => [u.id, { id: u.id, name: u.name, role: u.role, completed: 0, revenue: 0, inProgress: 0, canceled: 0 }]));
  for (const r of rows) {
    if (!r.laborUserId && !r.laborName) continue; // unassigned / to be claimed
    const key = r.laborUserId && map.has(r.laborUserId) ? r.laborUserId : `former:${r.laborName}`;
    if (!map.has(key)) map.set(key, { id: null, name: `${r.laborName} (removed)`, role: null, completed: 0, revenue: 0, inProgress: 0, canceled: 0 });
    const s = map.get(key);
    if (["DONE", "RECEIVED"].includes(r.status)) { s.completed += r._count._all; s.revenue += num(r._sum.price); }
    if (r.status === "IN_PROGRESS") s.inProgress += r._count._all;
    if (r.status === "CANCELED") s.canceled += r._count._all;
  }
  const staff = [...map.values()].map(s => ({ ...s, revenue: round(s.revenue), average: s.completed ? round(s.revenue / s.completed) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  res.json({ staff });
});

// ---------- Print settings ----------
router.get("/print-settings", async (_req, res) => {
  const s = await prisma.setting.findUnique({ where: { key: "print" } });
  res.json({ settings: v.printSettings.parse(s?.value || {}) });
});
router.put("/print-settings", requireAdmin, async (req, res) => {
  const data = v.parse(v.printSettings, req.body, res);
  if (!data) return;
  await prisma.setting.upsert({ where: { key: "print" }, update: { value: data }, create: { key: "print", value: data } });
  res.json({ settings: data });
});

module.exports = router;
