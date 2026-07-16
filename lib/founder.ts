// Recognize a tenant's owner (founder mode) by caller ID against the tenant's
// owner_numbers. Normalizes to the last 10 digits so +1856…, 1856…, and 856…
// all match.

function last10(num: string): string {
  return num.replace(/\D/g, "").slice(-10);
}

export function isOwnerNumber(
  num: string | undefined | null,
  ownerNumbers: string[],
): boolean {
  if (!num) return false;
  const n = last10(num);
  if (n.length !== 10) return false;
  return ownerNumbers.map(last10).filter((o) => o.length === 10).includes(n);
}
