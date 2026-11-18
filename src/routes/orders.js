const express = require("express");
const prisma = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { orderInput } = require("../validation");
const router = express.Router();
router.use(requireAuth);

const include = { labor: { select: { id: true, name: true } } };
const serialize = o => ({ ...o, price: Number(o.price) });

router.get("/", async (req, res, next) => {
  try {
    const view = req.query.view || "progress";
    const where = {
      progress: { status: "IN_PROGRESS" },
      logistics: { receivingMethod: { in: ["DELIVERY", "LOCAL_DELIVERY", "PICK_UP"] }, status: { not: "RECEIVED" } },
      done: { status: "DONE" },
      canceled: { status: "CANCELED" },
      received: { status: "RECEIVED" },
      all: {}
    }[view];
    if (!where) return res.status(400).json({ error: "Unknown order view." });
    const orders = await prisma.order.findMany({ where, include, orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }] });
    res.json({ orders: orders.map(serialize) });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid order." });
    const data = parsed.data;
    const order = await prisma.order.create({
      data: {
        ...data,
        orderDate: data.orderDate ? new Date(`${data.orderDate}T00:00:00.000Z`) : new Date(),
        status: "IN_PROGRESS",
        laborUserId: req.user.role === "STAFF" ? req.user.id : null
      },
      include
    });
    res.status(201).json({ order: serialize(order) });
  } catch (e) { next(e); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid order." });
    const data = parsed.data;
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { ...data, orderDate: data.orderDate ? new Date(`${data.orderDate}T00:00:00.000Z`) : undefined },
      include
    });
    res.json({ order: serialize(order) });
  } catch (e) { next(e); }
});

// All lifecycle changes are separate Admin-only endpoints.
// This prevents a staff member from smuggling a status change in an edit request.
router.patch("/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["DONE", "CANCELED", "IN_PROGRESS"].includes(status)) {
      return res.status(400).json({ error: "Allowed status changes: DONE, CANCELED, IN_PROGRESS." });
    }
    const order = await prisma.order.update({ where: { id: req.params.id }, data: { status }, include });
    res.json({ order: serialize(order) });
  } catch (e) { next(e); }
});

router.patch("/:id/received", requireAdmin, async (req, res, next) => {
  try {
    const changed = await prisma.order.updateMany({
      where: { id: req.params.id, status: "DONE" },
      data: { status: "RECEIVED", receivingMethod: "RECEIVED" }
    });
    if (changed.count === 0) {
      const exists = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true } });
      return res.status(exists ? 409 : 404).json({
        error: exists ? "Only Done orders can be marked as Received." : "Order not found."
      });
    }
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include });
    res.json({ order: serialize(order) });
  } catch (e) { next(e); }
});

router.get("/analytics/staff", requireAdmin, async (_req, res, next) => {
  try {
    const rows = await prisma.order.groupBy({
      by: ["laborName", "status"],
      where: { status: { in: ["DONE", "CANCELED"] } },
      _count: { _all: true }
    });
    const names = [...new Set(rows.map(r => r.laborName))].sort();
    const done = names.map(name => rows.find(r => r.laborName === name && r.status === "DONE")?._count._all || 0);
    const canceled = names.map(name => rows.find(r => r.laborName === name && r.status === "CANCELED")?._count._all || 0);
    res.json({ labels: names, done, canceled });
  } catch (e) { next(e); }
});

module.exports = router;
