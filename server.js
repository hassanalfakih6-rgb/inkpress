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
app.set("trust proxy", 1); // Render sits behind a proxy; needed for correct rate limiting
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
app.use("/api/transfers", require("./src/routes/transfers"));
app.use("/api/users", require("./src/routes/users"));
app.use("/api/catalog", require("./src/routes/catalog"));
app.use("/api/clients", require("./src/routes/clients"));
app.use("/api/finance", require("./src/routes/finance"));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, _req, res, _next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.code === "P2025") return res.status(404).json({ error: "Not found." });
  if (err.code === "P2002") return res.status(409).json({ error: "That name or email is already in use." });
  if (err.code === "P2003") return res.status(400).json({ error: "A linked record no longer exists. Refresh and try again." });
  if (err.code === "P2023") return res.status(400).json({ error: "Invalid id." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request body." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`Inkpress running on port ${port}`));
process.on("SIGTERM", async () => { server.close(); await prisma.$disconnect(); });
