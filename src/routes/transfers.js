// Admin approval of designer → designer hand-offs.
const express = require("express");
const prisma = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const router = express.Router();
router.use(requireAuth, requireAdmin);

const select = {
  id: true, status: true, createdAt: true, decidedAt: true,
  order: { select: { id: true, orderNumber: true, customerName: true, orderDetail: true, price: true, status: true, priority: true, laborUserId: true } },
  fromUser: { select: { id: true, name: true } },
  toUser: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } }
};
const serialize = t => ({ ...t, order: t.order && { ...t.order, price: Number(t.order.price) } });

router.get("/", async (req, res) => {
  const history = req.query.history === "1";
  const transfers = await prisma.transferRequest.findMany({
    where: history ? { status: { not: "PENDING" } } : { status: "PENDING" },
    select,
    orderBy: { createdAt: history ? "desc" : "asc" },
    take: history ? 50 : undefined
  });
  res.json({ transfers: transfers.map(serialize) });
});

router.post("/:id/approve", async (req, res) => {
  const t = await prisma.transferRequest.findUnique({ where: { id: req.params.id }, include: { toUser: true } });
  if (!t || t.status !== "PENDING") return res.status(409).json({ error: "This request was already handled." });
  const moved = await prisma.order.updateMany({
    where: { id: t.orderId, status: "IN_PROGRESS", laborUserId: t.fromUserId },
    data: { laborUserId: t.toUserId, laborName: t.toUser.name, openToAll: false }
  });
  const now = new Date();
  if (!moved.count) {
    await prisma.transferRequest.update({ where: { id: t.id }, data: { status: "CANCELED", decidedAt: now, decidedById: req.user.id } });
    return res.status(409).json({ error: "The order changed since this request was made, so the request was canceled." });
  }
  await prisma.transferRequest.update({ where: { id: t.id }, data: { status: "APPROVED", decidedAt: now, decidedById: req.user.id } });
  res.json({ ok: true });
});

router.post("/:id/reject", async (req, res) => {
  const changed = await prisma.transferRequest.updateMany({
    where: { id: req.params.id, status: "PENDING" },
    data: { status: "REJECTED", decidedAt: new Date(), decidedById: req.user.id }
  });
  if (!changed.count) return res.status(409).json({ error: "This request was already handled." });
  res.json({ ok: true });
});

module.exports = router;
