// Designers, admins and their logins.
const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const v = require("../validation");
const router = express.Router();
router.use(requireAuth);

const publicSelect = { id: true, name: true, role: true };
const adminSelect = { id: true, name: true, email: true, role: true, createdAt: true };

// Everyone needs the team list for filters and hand-offs.
router.get("/team", async (_req, res) => {
  const users = await prisma.user.findMany({ select: publicSelect, orderBy: { name: "asc" } });
  res.json({ users });
});

router.get("/", requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({ select: adminSelect, orderBy: [{ role: "asc" }, { name: "asc" }] });
  const counts = await prisma.order.groupBy({ by: ["laborUserId"], where: { status: "IN_PROGRESS" }, _count: { _all: true } });
  res.json({ users: users.map(u => ({ ...u, activeOrders: counts.find(c => c.laborUserId === u.id)?._count._all || 0 })) });
});

router.post("/", requireAdmin, async (req, res) => {
  const data = v.parse(v.userCreate, req.body, res);
  if (!data) return;
  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, role: data.role, passwordHash },
    select: adminSelect
  });
  res.status(201).json({ user });
});

async function adminCount() { return prisma.user.count({ where: { role: "ADMIN" } }); }

router.patch("/:id", requireAdmin, async (req, res) => {
  const data = v.parse(v.userUpdate, req.body, res);
  if (!data) return;
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.role === "ADMIN" && data.role === "STAFF" && (await adminCount()) <= 1) {
    return res.status(409).json({ error: "You need at least one admin." });
  }
  const update = {};
  if (data.name) update.name = data.name;
  if (data.email) update.email = data.email;
  if (data.role) update.role = data.role;
  if (data.password) update.passwordHash = await bcrypt.hash(data.password, 12);
  const saved = await prisma.user.update({ where: { id: user.id }, data: update, select: adminSelect });
  if (data.name) await prisma.order.updateMany({ where: { laborUserId: user.id }, data: { laborName: data.name } });
  res.json({ user: saved });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(409).json({ error: "You cannot delete your own account." });
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.role === "ADMIN" && (await adminCount()) <= 1) return res.status(409).json({ error: "You need at least one admin." });
  // Their in-progress orders go back to "to be claimed" so nothing is lost.
  await prisma.order.updateMany({
    where: { laborUserId: user.id, status: "IN_PROGRESS" },
    data: { laborUserId: null, openToAll: true, laborName: "" }
  });
  await prisma.user.delete({ where: { id: user.id } });
  res.json({ ok: true });
});

module.exports = router;
