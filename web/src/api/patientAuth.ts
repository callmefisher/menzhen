import patientRequest from '../utils/patientRequest';

export interface PatientUserDTO {
  id: number;
  phone: string;
  name: string;
  tenant_id: number;
  patient_id: number | null;
  tenant_name: string;
}

export interface PatientLoginResponse {
  token: string;
  patient_user: PatientUserDTO;
}

export function patientLogin(data: {
  tenant_code: string;
  phone: string;
  name: string;
}): Promise<{ code: number; data: PatientLoginResponse }> {
  return patientRequest.post('/auth/login', data) as Promise<{ code: number; data: PatientLoginResponse }>;
}

export function getPatientMe(): Promise<{ code: number; data: PatientUserDTO }> {
  return patientRequest.get('/me') as Promise<{ code: number; data: PatientUserDTO }>;
}

export interface TenantItem {
  // tenant_id comes from Go uint64; safe in JS for values < 2^53 (actual IDs are small)
  tenant_id: number;
  tenant_name: string;
  tenant_code: string;
}

export function listTenantsByPhone(phone: string): Promise<{ code: number; data: TenantItem[] }> {
  return patientRequest.get('/auth/tenant-list', { params: { phone } }) as Promise<{ code: number; data: TenantItem[] }>;
}

export interface TenantInfo {
  tenant_name: string;
  tenant_code: string;
}

export function getTenantInfo(code: string): Promise<{ code: number; data: TenantInfo }> {
  return patientRequest.get('/auth/tenant-info', { params: { code } }) as Promise<{ code: number; data: TenantInfo }>;
}
