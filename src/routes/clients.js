const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { num, normalizePhone } = require("../money");
const router = express.Router();
router.use(requireAuth);

const SPENT = ["DONE", "RECEIVED"];

async function statsFor(clientIds) {
  if (!clientIds.length) return {};
  const rows = await prisma.order.groupBy({
    by: ["clientId", "status"],
    where: { clientId: { in: clientIds } },
    _count: { _all: true },
    _sum: { price: true },
    _max: { orderDate: true }
  });
  const out = {};
  for (const r of rows) {
    const s = (out[r.clientId] ||= { orders: 0, spent: 0, open: 0, lastOrder: null });
    if (r.status !== "CANCELED") s.orders += r._count._all;
    if (SPENT.includes(r.status)) s.spent += num(r._sum.price);
    if (["INTAKE", "IN_PROGRESS"].includes(r.status)) s.open += r._count._all;
    if (!s.lastOrder || r._max.orderDate > s.lastOrder) s.lastOrder = r._max.orderDate;
  }
  return out;
}

// Search by name or number.
router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const digits = normalizePhone(q);
  const where = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(digits ? [{ phone: { contains: digits } }] : [])] }
    : {};
  const clients = await prisma.client.findMany({ where, orderBy: { updatedAt: "desc" }, take: 300 });
  const stats = await statsFor(clients.map(c => c.id));
  res.json({
    clients: clients.map(c => ({ ...c, ...(stats[c.id] || { orders: 0, spent: 0, open: 0, lastOrder: null }) }))
  });
});

// Used by the order form to auto-fill the name from a phone number.
router.get("/lookup", async (req, res) => {
  const phone = normalizePhone(req.query.phone);
  if (!phone) return res.json({ client: null });
  const client = await prisma.client.findUnique({ where: { phone } });
  if (!client) return res.json({ client: null });
  const stats = await statsFor([client.id]);
  res.json({ client: { ...client, ...(stats[client.id] || { orders: 0, spent: 0 }) } });
});

router.get("/:id", async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found." });
  const orders = await prisma.order.findMany({
    where: { clientId: client.id },
    select: {
      id: true, orderNumber: true, orderDate: true, orderDetail: true, price: true, amountPaid: true, status: true,
      laborName: true, receivingMethod: true, productType: { select: { name: true } }
    },
    orderBy: [{ orderDate: "desc" }, { orderNumber: "desc" }]
  });
  const stats = await statsFor([client.id]);
  res.json({
    client: { ...client, ...(stats[client.id] || { orders: 0, spent: 0, open: 0 }) },
    orders: orders.map(o => ({ ...o, price: num(o.price), amountPaid: num(o.amountPaid) }))
  });
});

module.exports = router;
