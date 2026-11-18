const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
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

router.post("/staff", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = z.object({
      name: z.string().trim().min(1).max(100),
      email: z.string().email(),
      password: z.string().min(12).max(100)
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide a name, valid email, and password of at least 12 characters." });
    const { name, password } = parsed.data;
    const email = parsed.data.email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const staff = await prisma.user.create({
      data: { name, email, passwordHash, role: "STAFF" },
      select: { id: true, name: true, email: true, role: true }
    });
    res.status(201).json({ user: staff });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "That email is already in use." });
    next(e);
  }
});

module.exports = router;
