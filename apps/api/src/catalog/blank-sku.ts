export function isBlankSku(sku: string | null | undefined): boolean {
  return sku == null || sku.trim() === '';
}
