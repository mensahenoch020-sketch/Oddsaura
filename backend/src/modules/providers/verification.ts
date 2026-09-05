export type VerificationState = {
  verified: boolean;
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "MISMATCH";
  warning?: string;
};

// A failed reload must never erase a booking code already returned by the bookmaker.
export async function verifyCreatedCode(check: () => Promise<boolean | null>): Promise<VerificationState> {
  try {
    const exact = await check();
    if (exact === true) return { verified: true, verificationStatus: "VERIFIED" };
    if (exact === false) return { verified: false, verificationStatus: "MISMATCH", warning: "Created code does not match the requested selections. Do not use it without checking every pick." };
  } catch { /* transport or unreadable reload: keep the code, never claim success */ }
  return { verified: false, verificationStatus: "UNVERIFIED", warning: "Code created, but verification is incomplete. Open the bookmaker and check every selection before using it." };
}

export function compareSelectionIds(expected: string[], actual: string[]): boolean | null {
  if (actual.some((id) => !id)) return null;
  if (actual.length !== expected.length) return false;
  const remaining = [...actual];
  for (const id of expected) {
    const index = remaining.indexOf(id);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}
