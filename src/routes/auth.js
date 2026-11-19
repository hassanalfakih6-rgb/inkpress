const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

const cookieOptions = () => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 * 1000
});

router.post("/login", async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
    const email = parsed.data.email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "8h" });
    res.cookie("inkpress_token", token, cookieOptions());
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) { next(e); }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("inkpress_token", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

// Any signed-in user can change their own password.
router.post("/password", requireAuth, async (req, res, next) => {
  try {
    const parsed = z.object({ current: z.string().min(1), next: z.string().min(8).max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "New password must be at least 8 characters." });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(parsed.data.current, user.passwordHash))) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.next, 12) } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Team accounts are managed from Settings → Team (see routes/users.js).

module.exports = router;
