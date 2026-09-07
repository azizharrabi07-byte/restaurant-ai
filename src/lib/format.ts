const TND = new Intl.NumberFormat("fr-TN", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export function formatDT(amount: number): string {
  return `${TND.format(amount)} DT`;
}

export function formatDTShort(amount: number): string {
  return `${amount.toFixed(3)} DT`;
}