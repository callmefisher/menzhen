import patientRequest from '../utils/patientRequest';

export interface PatientUserDTO {
  id: number;
  phone: string;
  name: string;
  tenant_id: number;
  patient_id: number | null;
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
