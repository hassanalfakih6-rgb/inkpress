require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const prisma = require("./src/db");

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("DATABASE_URL and a JWT_SECRET of at least 32 characters are required.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/orders", require("./src/routes/orders"));
app.use(express.static(path.join(__dirname, "public")));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === "P2025") return res.status(404).json({ error: "Order not found." });
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`Inkpress running on port ${port}`));
process.on("SIGTERM", async () => { server.close(); await prisma.$disconnect(); });
