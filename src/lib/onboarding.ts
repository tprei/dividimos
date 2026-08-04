const HANDLE_REGEX = /^[a-z0-9]([a-z0-9._]{0,18}[a-z0-9])?$/;

export function isValidHandle(value: string): boolean {
  if (value.length < 3 || value.length > 20) return false;
  if (value.length === 3) return /^[a-z0-9][a-z0-9._][a-z0-9]$/.test(value);
  return HANDLE_REGEX.test(value);
}

export function nameToHandle(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 20);
}
