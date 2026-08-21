import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@oddsaura.com";
  const password = process.env.ADMIN_PASSWORD ?? "change-this-before-deploying";
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN" },
    create: { email, passwordHash, name: "OddsAura Admin", role: "ADMIN" },
  });
  console.log(`Admin user ready: ${email}`);
}

main().finally(() => prisma.$disconnect());
