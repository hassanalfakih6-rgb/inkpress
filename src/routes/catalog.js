// Product types and delivery companies (lists are readable by everyone, managed by admins).
const express = require("express");
const prisma = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const v = require("../validation");
const router = express.Router();
router.use(requireAuth);

router.get("/product-types", async (_req, res) => {
  const items = await prisma.productType.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { orders: true } } } });
  res.json({ items: items.map(i => ({ id: i.id, name: i.name, orders: i._count.orders })) });
});
router.post("/product-types", requireAdmin, async (req, res) => {
  const data = v.parse(v.namedItem, req.body, res);
  if (!data) return;
  const item = await prisma.productType.create({ data: { name: data.name } });
  res.status(201).json({ item });
});
router.delete("/product-types/:id", requireAdmin, async (req, res) => {
  await prisma.productType.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.get("/delivery-companies", async (_req, res) => {
  const items = await prisma.deliveryCompany.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { orders: true } } } });
  res.json({ items: items.map(i => ({ id: i.id, name: i.name, phone: i.phone, orders: i._count.orders })) });
});
router.post("/delivery-companies", requireAdmin, async (req, res) => {
  const data = v.parse(v.namedItem, req.body, res);
  if (!data) return;
  const item = await prisma.deliveryCompany.create({ data });
  res.status(201).json({ item });
});
router.delete("/delivery-companies/:id", requireAdmin, async (req, res) => {
  const held = await prisma.order.count({
    where: { deliveryCompanyId: req.params.id, status: "RECEIVED", deliverySettled: false, receivingMethod: { not: "PICK_UP" } }
  });
  if (held) return res.status(409).json({ error: "This company still holds money for delivered orders. Settle it first." });
  await prisma.deliveryCompany.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
