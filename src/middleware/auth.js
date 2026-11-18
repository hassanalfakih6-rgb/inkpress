const jwt = require("jsonwebtoken");
const prisma = require("../db");

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.inkpress_token;
    if (!token) return res.status(401).json({ error: "Please sign in." });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true }
    });
    if (!user) return res.status(401).json({ error: "Account not found." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Admin permission required." });
  next();
}
module.exports = { requireAuth, requireAdmin };
