/**
 * Formats a BRL amount the way Brazilian prices are conventionally written:
 * "R$499" for whole numbers, "R$49,90" when there are cents — matching the
 * commercial copy in the plans spec exactly (no trailing ",00", comma decimal,
 * period thousands separator).
 */
export function formatBRL(value: number): string {
  const hasCents = Math.round(value * 100) % 100 !== 0;
  const formatted = value.toLocaleString('pt-BR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `R$${formatted}`;
}
