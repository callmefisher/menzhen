export interface ParsedLicenseKey {
  licenseType: 'site' | 'clinic';
  clinicCode?: string;
  siteId: string;
  machineId: string;
}

export function parseLicenseKeyInput(value: string): ParsedLicenseKey | null {
  if (!value || !value.trim()) return null;

  const trimmed = value.trim();
  const underscoreIdx = trimmed.indexOf('_');
  const keyPart = underscoreIdx >= 0 ? trimmed.substring(0, underscoreIdx) : trimmed;
  const colonCount = (keyPart.match(/:/g) || []).length;

  if (colonCount >= 2) {
    const firstColon = trimmed.indexOf(':');
    const clinicCode = trimmed.substring(0, firstColon).trim();
    const rest = trimmed.substring(firstColon + 1);
    const secondColon = rest.indexOf(':');
    const siteId = rest.substring(0, secondColon).trim();
    const machineId = rest.substring(secondColon + 1).trim();
    return { licenseType: 'clinic', clinicCode, siteId, machineId };
  }

  if (colonCount === 1) {
    const idx = trimmed.indexOf(':');
    const siteId = trimmed.substring(0, idx).trim();
    const machineId = trimmed.substring(idx + 1).trim();
    return { licenseType: 'site', siteId, machineId };
  }

  return null;
}
