export function assertSourceAuthorized(policy, sourceId, requiredUse) {
  const source = policy?.sources?.[sourceId];
  const allowed = source?.status === "owner-confirmed" && Array.isArray(source.permittedUses) && source.permittedUses.includes(requiredUse);
  if (!allowed) throw new Error(`${sourceId} is not authorized for ${requiredUse}. Update data/source-authorizations.json only after the project owner confirms permission.`);
  return source;
}
