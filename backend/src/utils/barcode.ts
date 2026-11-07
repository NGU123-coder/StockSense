/** EAN-13 check digit (GS1 standard): weights 1,3,1,3... over the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  const sum = first12.split('').reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Generates a valid EAN-13 with the Indian GS1 prefix 890. */
export function generateEan13(): string {
  let body = '890';
  while (body.length < 12) body += Math.floor(Math.random() * 10);
  return body + ean13CheckDigit(body);
}
