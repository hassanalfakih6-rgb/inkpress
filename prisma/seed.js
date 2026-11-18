require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const name = process.env.ADMIN_NAME || "Inkpress Admin";
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || password.length < 12) {
    console.log("Seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters).");
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name, email, passwordHash, role: "ADMIN" }
  });
  console.log(`Admin account ensured: ${email}`);
}
main().catch(err => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
