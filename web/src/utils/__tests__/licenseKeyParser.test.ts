import { describe, it, expect } from 'vitest';
import { parseLicenseKeyInput } from '../licenseKeyParser';

describe('parseLicenseKeyInput', () => {
  it('returns null for empty input', () => {
    expect(parseLicenseKeyInput('')).toBeNull();
    expect(parseLicenseKeyInput('   ')).toBeNull();
  });

  it('returns null for input without colons', () => {
    expect(parseLicenseKeyInput('abc')).toBeNull();
    expect(parseLicenseKeyInput('abc_def')).toBeNull();
  });

  describe('site type (1 colon in key part)', () => {
    it('parses simple site key without timestamp', () => {
      const result = parseLicenseKeyInput('siteId123:machineId456');
      expect(result).toEqual({
        licenseType: 'site',
        siteId: 'siteId123',
        machineId: 'machineId456',
      });
    });

    it('parses site key with timestamp (xxx:yyy_2026-05-10 21:44:22)', () => {
      const result = parseLicenseKeyInput('xyj:kL0Wxn_2026-05-10 21:44:22');
      expect(result).toEqual({
        licenseType: 'site',
        siteId: 'xyj',
        machineId: 'kL0Wxn_2026-05-10 21:44:22',
      });
    });

    it('parses site key with timestamp containing colons', () => {
      const result = parseLicenseKeyInput('abc:def_2026-01-01 12:30:00');
      expect(result).not.toBeNull();
      expect(result!.licenseType).toBe('site');
      expect(result!.siteId).toBe('abc');
      expect(result!.machineId).toBe('def_2026-01-01 12:30:00');
    });

    it('trims whitespace', () => {
      const result = parseLicenseKeyInput('  sid : mid_2026-05-10 21:44:22  ');
      expect(result).toEqual({
        licenseType: 'site',
        siteId: 'sid',
        machineId: 'mid_2026-05-10 21:44:22',
      });
    });
  });

  describe('clinic type (2+ colons in key part)', () => {
    it('parses simple clinic key without timestamp', () => {
      const result = parseLicenseKeyInput('clinicCode:siteId:machineId');
      expect(result).toEqual({
        licenseType: 'clinic',
        clinicCode: 'clinicCode',
        siteId: 'siteId',
        machineId: 'machineId',
      });
    });

    it('parses clinic key with timestamp (xxx:yyy:zzz_2026-05-10 21:44:22)', () => {
      const result = parseLicenseKeyInput('xyj:kL0Wxn:abc123_2026-05-10 21:44:22');
      expect(result).toEqual({
        licenseType: 'clinic',
        clinicCode: 'xyj',
        siteId: 'kL0Wxn',
        machineId: 'abc123_2026-05-10 21:44:22',
      });
    });

    it('parses clinic key with timestamp containing colons', () => {
      const result = parseLicenseKeyInput('cc:sid:mid_2026-01-01 12:30:00');
      expect(result).not.toBeNull();
      expect(result!.licenseType).toBe('clinic');
      expect(result!.clinicCode).toBe('cc');
      expect(result!.siteId).toBe('sid');
      expect(result!.machineId).toBe('mid_2026-01-01 12:30:00');
    });

    it('trims whitespace for clinic key', () => {
      const result = parseLicenseKeyInput('  cc : sid : mid_2026-05-10 21:44:22  ');
      expect(result).toEqual({
        licenseType: 'clinic',
        clinicCode: 'cc',
        siteId: 'sid',
        machineId: 'mid_2026-05-10 21:44:22',
      });
    });
  });

  describe('edge cases', () => {
    it('handles key with only underscore and no timestamp', () => {
      const result = parseLicenseKeyInput('abc:def_');
      expect(result).toEqual({
        licenseType: 'site',
        siteId: 'abc',
        machineId: 'def_',
      });
    });

    it('handles clinic key with underscore but no timestamp after it', () => {
      const result = parseLicenseKeyInput('abc:def:ghi_');
      expect(result).toEqual({
        licenseType: 'clinic',
        clinicCode: 'abc',
        siteId: 'def',
        machineId: 'ghi_',
      });
    });

    it('distinguishes site vs clinic by colon count in key part only', () => {
      const siteInput = 'a:b_2026-05-10 21:44:22';
      const clinicInput = 'a:b:c_2026-05-10 21:44:22';

      const siteResult = parseLicenseKeyInput(siteInput);
      const clinicResult = parseLicenseKeyInput(clinicInput);

      expect(siteResult?.licenseType).toBe('site');
      expect(clinicResult?.licenseType).toBe('clinic');

      expect(siteResult?.machineId).toBe('b_2026-05-10 21:44:22');
      expect(clinicResult?.machineId).toBe('c_2026-05-10 21:44:22');
    });

    it('handles real-world example: site type', () => {
      const result = parseLicenseKeyInput('xyj:kL0Wxn_2026-04-29 17:55:46');
      expect(result).toEqual({
        licenseType: 'site',
        siteId: 'xyj',
        machineId: 'kL0Wxn_2026-04-29 17:55:46',
      });
    });

    it('handles real-world example: clinic type', () => {
      const result = parseLicenseKeyInput('testclinic:xyj:kL0Wxn_2026-04-29 17:55:46');
      expect(result).toEqual({
        licenseType: 'clinic',
        clinicCode: 'testclinic',
        siteId: 'xyj',
        machineId: 'kL0Wxn_2026-04-29 17:55:46',
      });
    });
  });
});
