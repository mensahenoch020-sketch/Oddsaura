import { headers } from "next/headers";

export type OddsAuraUser = { displayName: string; email: string };

export async function getOddsAuraUser(): Promise<OddsAuraUser> {
  const requestHeaders = await headers();
  const email = requestHeaders.get("x-oddsaura-user-email") || "";
  const displayName = requestHeaders.get("x-oddsaura-user-name") || email || "OddsAura member";
  return { email, displayName };
}
