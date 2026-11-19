const express = require("express");
const prisma = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const v = require("../validation");
const perm = require("../permissions");
const { num, paidAmount, upsertClient, httpError } = require("../money");
const router = express.Router();
router.use(requireAuth);

const include = {
  labor: { select: { id: true, name: true } },
  productType: { select: { id: true, name: true } },
  deliveryCompany: { select: { id: true, name: true } },
  transfers: {
    where: { status: "PENDING" },
    select: { id: true, toUser: { select: { id: true, name: true } }, requestedBy: { select: { id: true, name: true } } }
  }
};
const serialize = o => ({
  ...o,
  price: num(o.price),
  amountPaid: num(o.amountPaid),
  balance: Math.max(0, Math.round((num(o.price) - num(o.amountPaid)) * 100) / 100)
});

const VIEWS = {
  intake: { status: "INTAKE" },
  progress: { status: "IN_PROGRESS" },
  logistics: { status: { in: ["IN_PROGRESS", "DONE"] }, receivingMethod: { not: "RECEIVED" } },
  completed: { status: { in: ["DONE", "RECEIVED"] } },
  done: { status: "DONE" },
  canceled: { status: "CANCELED" },
  received: { status: "RECEIVED" },
  all: {}
};

async function findOrder(id) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw httpError(404, "Order not found.");
  return order;
}
async function findUser(id) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!user) throw httpError(400, "That designer no longer exists.");
  return user;
}
const cancelPendingTransfers = (orderId, deciderId) =>
  prisma.transferRequest.updateMany({
    where: { orderId, status: "PENDING" },
    data: { status: "CANCELED", decidedAt: new Date(), decidedById: deciderId }
  });
const reply = async (res, id, extra = {}) => {
  const order = await prisma.order.findUnique({ where: { id }, include });
  res.json({ order: serialize(order), ...extra });
};

// ---------- Lists ----------
router.get("/", async (req, res) => {
  const view = req.query.view || "progress";
  const where = VIEWS[view];
  if (!where) return res.status(400).json({ error: "Unknown order view." });

  // Logistics is read-only and shows only what the counter needs.
  if (view === "logistics") {
    const orders = await prisma.order.findMany({
      where,
      select: { id: true, orderNumber: true, customerName: true, phoneNumber: true, price: true, status: true, receivingMethod: true, orderDate: true },
      orderBy: [{ orderDate: "desc" }, { orderNumber: "desc" }]
    });
    return res.json({ orders: orders.map(o => ({ ...o, price: num(o.price) })) });
  }

  const orderBy = view === "progress"
    ? [{ openToAll: "desc" }, { priority: "desc" }, { orderDate: "asc" }, { orderNumber: "asc" }]
    : [{ orderDate: "desc" }, { orderNumber: "desc" }];
  const orders = await prisma.order.findMany({ where, include, orderBy });
  res.json({ orders: orders.map(serialize) });
});

router.get("/counts", async (_req, res) => {
  const rows = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
  const counts = Object.fromEntries(rows.map(r => [r.status, r._count._all]));
  const pendingTransfers = await prisma.transferRequest.count({ where: { status: "PENDING" } });
  const toClaim = await prisma.order.count({ where: { status: "IN_PROGRESS", openToAll: true } });
  res.json({ counts, pendingTransfers, toClaim });
});

// Full order + print settings for printing an invoice.
router.get("/:id/invoice", async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include });
  if (!order) return res.status(404).json({ error: "Order not found." });
  const setting = await prisma.setting.findUnique({ where: { key: "print" } });
  res.json({ order: serialize(order), print: v.printSettings.parse(setting?.value || {}) });
});

// ---------- Create (always lands in Order Intake) ----------
router.post("/", async (req, res) => {
  const data = v.parse(v.orderCreate, req.body, res);
  if (!data) return;
  if (data.paymentDetail === "DOWN_PAYMENT" && !(data.amountPaid > 0 && data.amountPaid < data.price)) {
    return res.status(400).json({ error: "Enter a down payment greater than 0 and less than the price." });
  }
  const clientId = await upsertClient(prisma, data.customerName, data.phoneNumber);
  const order = await prisma.order.create({
    data: {
      orderDate: v.toDate(data.orderDate) || new Date(),
      customerName: data.customerName,
      phoneNumber: data.phoneNumber,
      orderDetail: data.orderDetail,
      note: data.note,
      price: data.price,
      amountPaid: paidAmount(data.paymentDetail, data.price, data.amountPaid),
      paymentDetail: data.paymentDetail,
      paymentMethod: data.paymentMethod,
      receivingMethod: data.receivingMethod,
      deliveryCompanyId: data.receivingMethod === "PICK_UP" ? null : data.deliveryCompanyId,
      productTypeId: data.productTypeId,
      priority: perm.canSetPriority(req.user) ? data.priority || "NORMAL" : "NORMAL",
      status: "INTAKE",
      laborName: "",
      createdById: req.user.id,
      clientId
    },
    include
  });
  res.status(201).json({ order: serialize(order) });
});

// ---------- Admin edit: absolutely everything ----------
router.patch("/:id", requireAdmin, async (req, res) => {
  const data = v.parse(v.orderAdminEdit, req.body, res);
  if (!data) return;
  if (data.paymentDetail === "DOWN_PAYMENT" && !(data.amountPaid > 0 && data.amountPaid < data.price)) {
    return res.status(400).json({ error: "Enter a down payment greater than 0 and less than the price." });
  }
  const existing = await findOrder(req.params.id);
  let laborName = "";
  if (data.laborUserId) laborName = (await findUser(data.laborUserId)).name;
  const openToAll = !data.laborUserId && data.openToAll;
  const clientId = await upsertClient(prisma, data.customerName, data.phoneNumber);
  const now = new Date();
  await prisma.order.update({
    where: { id: existing.id },
    data: {
      orderDate: v.toDate(data.orderDate),
      customerName: data.customerName,
      phoneNumber: data.phoneNumber,
      orderDetail: data.orderDetail,
      note: data.note,
      price: data.price,
      amountPaid: paidAmount(data.paymentDetail, data.price, data.amountPaid),
      paymentDetail: data.paymentDetail,
      paymentMethod: data.paymentMethod,
      receivingMethod: data.receivingMethod,
      deliveryCompanyId: data.receivingMethod === "PICK_UP" ? null : data.deliveryCompanyId,
      productTypeId: data.productTypeId,
      priority: data.priority || existing.priority,
      status: data.status,
      laborUserId: data.laborUserId,
      laborName,
      openToAll,
      deliverySettled: data.deliverySettled,
      deliverySettledAt: data.deliverySettled ? existing.deliverySettledAt || now : null,
      completedAt: ["DONE", "RECEIVED"].includes(data.status) ? existing.completedAt || now : null,
      receivedAt: data.status === "RECEIVED" ? existing.receivedAt || now : null,
      clientId
    }
  });
  if (existing.laborUserId !== data.laborUserId || data.status !== "IN_PROGRESS") await cancelPendingTransfers(existing.id, req.user.id);
  await reply(res, existing.id);
});

// Quick priority change from the intake list (admin only).
router.patch("/:id/priority", requireAdmin, async (req, res) => {
  const priority = req.body?.priority;
  if (!["NORMAL", "HIGH", "URGENT"].includes(priority)) return res.status(400).json({ error: "Unknown priority." });
  await prisma.order.update({ where: { id: req.params.id }, data: { priority } });
  await reply(res, req.params.id);
});

// Permanently delete (admin only).
router.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.order.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ---------- Assignment ----------
// Anyone: take an intake order, or claim an order sent to all designers.
router.post("/:id/claim", async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!perm.canClaim(req.user, order)) return res.status(409).json({ error: "This order can no longer be claimed." });
  const changed = await prisma.order.updateMany({
    where: { id: order.id, OR: [{ status: "INTAKE" }, { status: "IN_PROGRESS", openToAll: true }] },
    data: { status: "IN_PROGRESS", openToAll: false, laborUserId: req.user.id, laborName: req.user.name }
  });
  if (!changed.count) return res.status(409).json({ error: "Someone else just claimed this order." });
  await reply(res, order.id);
});

// Admin: assign an intake / in-progress order to one designer (or themselves), or to everyone.
router.post("/:id/assign", requireAdmin, async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!perm.canAssign(req.user, order)) return res.status(409).json({ error: "Only intake or in-progress orders can be assigned." });
  const { userId, all } = req.body || {};
  let data;
  if (all === true) data = { openToAll: true, laborUserId: null, laborName: "" };
  else if (userId) { const u = await findUser(userId); data = { openToAll: false, laborUserId: u.id, laborName: u.name }; }
  else return res.status(400).json({ error: "Choose a designer or all designers." });
  await prisma.order.update({ where: { id: order.id }, data: { ...data, status: "IN_PROGRESS" } });
  await cancelPendingTransfers(order.id, req.user.id);
  await reply(res, order.id);
});

// Move an in-progress order. Designers sending their own order to someone else create an approval request.
router.post("/:id/reassign", async (req, res) => {
  const order = await findOrder(req.params.id);
  const targetId = req.body?.userId;
  const decision = perm.reassignDecision(req.user, order, targetId);
  if (decision.error) return res.status(decision.status).json({ error: decision.error });
  const target = await findUser(targetId);

  if (decision.action === "direct") {
    const changed = await prisma.order.updateMany({
      where: { id: order.id, status: "IN_PROGRESS", laborUserId: order.laborUserId, openToAll: order.openToAll },
      data: { laborUserId: target.id, laborName: target.name, openToAll: false }
    });
    if (!changed.count) return res.status(409).json({ error: "The order changed. Refresh and try again." });
    await cancelPendingTransfers(order.id, req.user.id);
    return reply(res, order.id);
  }

  const pending = await prisma.transferRequest.findFirst({ where: { orderId: order.id, status: "PENDING" } });
  if (pending) return res.status(409).json({ error: "A hand-off for this order is already waiting for admin approval." });
  await prisma.transferRequest.create({
    data: { orderId: order.id, fromUserId: order.laborUserId, toUserId: target.id, requestedById: req.user.id }
  });
  await reply(res, order.id, { pendingApproval: true });
});

// ---------- Lifecycle ----------
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body || {};
  const order = await findOrder(req.params.id);
  const now = new Date();

  if (status === "DONE" || status === "CANCELED") {
    if (!perm.canFinish(req.user, order)) {
      return res.status(403).json({ error: "Only the assigned designer or an admin can finish or cancel this order." });
    }
    await prisma.order.update({ where: { id: order.id }, data: { status, completedAt: status === "DONE" ? now : null } });
    await cancelPendingTransfers(order.id, req.user.id);
    return reply(res, order.id);
  }
  if (status === "IN_PROGRESS") {
    if (!perm.isAdmin(req.user)) return res.status(403).json({ error: "Admin permission required." });
    if (!["DONE", "CANCELED"].includes(order.status)) return res.status(409).json({ error: "Only done or canceled orders can be returned." });
    await prisma.order.update({ where: { id: order.id }, data: { status, completedAt: null } });
    return reply(res, order.id);
  }
  res.status(400).json({ error: "Allowed status changes: DONE, CANCELED, IN_PROGRESS." });
});

// Handed to the customer / delivery company delivered it.
router.patch("/:id/received", requireAdmin, async (req, res) => {
  const order = await findOrder(req.params.id);
  if (order.status !== "DONE") return res.status(409).json({ error: "Only Done orders can be marked as Received." });
  const viaCompany = !!order.deliveryCompanyId && order.receivingMethod !== "PICK_UP";
  // Via a delivery company the remaining balance is now held by that company until settled.
  // Otherwise the customer paid the balance at the shop.
  const data = viaCompany
    ? { status: "RECEIVED", receivedAt: new Date(), deliverySettled: false }
    : { status: "RECEIVED", receivedAt: new Date(), amountPaid: order.price, paymentDetail: "PAID" };
  const changed = await prisma.order.updateMany({ where: { id: order.id, status: "DONE" }, data });
  if (!changed.count) return res.status(409).json({ error: "The order changed. Refresh and try again." });
  await reply(res, order.id);
});

module.exports = router;
