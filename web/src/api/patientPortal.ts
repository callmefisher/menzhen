import request from '../utils/request';
import patientRequest from '../utils/patientRequest';

// --- Types ---
export interface Doctor {
  id: number;
  doctor_name: string;
  room: string;
  sort_order: number;
}

export interface Appointment {
  id: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  room: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
  status: string;
  created_at: string;
}

export interface SlotInfo {
  slot_start: string;
  slot_end: string;
  max_count: number;
  booked_count: number;
  available: boolean;
}

export interface QueueEntry {
  id: number;
  seq_number: number;
  doctor_id: number;
  patient_name: string;
  doctor_name: string;
  room: string;
  status: string;
}

export interface MedicalRecord {
  id: number;
  visit_date: string;
  diagnosis: string;
  treatment: string;
  chief_complaint: string;
  notes: string;
}

export interface Billing {
  id: number;
  record_id: number;
  consultation_fee: number;
  drug_cost_total: number;
  total_amount: number;
  actual_paid: number;
  created_at: string;
}

export interface PatientPortalConfig {
  tenant_id: number;
  login_enabled: boolean;
  register_enabled: boolean;
  appointment_enabled: boolean;
  queue_enabled: boolean;
  records_enabled: boolean;
  tenant_code?: string;
  tenant_name?: string;
}

// --- API calls ---
export const listDoctors = () =>
  patientRequest.get('/doctors') as Promise<{ data: Doctor[] }>;

export const getDoctorSchedule = (doctorId: number) =>
  patientRequest.get(`/doctors/${doctorId}/schedule`) as Promise<{
    data: { weekdays: number; range_start: number; range_end: number };
  }>;

export const listAppointments = () =>
  patientRequest.get('/appointments') as Promise<{ data: Appointment[] }>;

export const createAppointment = (data: {
  doctor_id: number;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
}) => patientRequest.post('/appointments', data);

export const getAppointmentSlots = (doctorId: number, date: string) =>
  patientRequest.get('/appointments/slots', { params: { doctor_id: doctorId, date } }) as Promise<{ data: SlotInfo[] }>;

export const cancelAppointment = (id: number) =>
  patientRequest.post(`/appointments/${id}/cancel`);

export const takeQueueNumber = (doctorId: number) =>
  patientRequest.post('/queue/take', { doctor_id: doctorId });

export const getMyQueueStatus = () =>
  patientRequest.get('/queue/my-status');

export const listPatientQueue = (doctorId: number) =>
  patientRequest.get('/queue/list', { params: { doctor_id: doctorId } }) as Promise<{ data: QueueEntry[] }>;

export const listRecords = () =>
  patientRequest.get('/records') as Promise<{ data: MedicalRecord[] }>;

export const getRecord = (id: number) =>
  patientRequest.get(`/records/${id}`);

export const listBillings = () =>
  patientRequest.get('/billings') as Promise<{ data: Billing[] }>;

// Admin portal config (uses main request instance)
export const getPatientPortalConfig = (tenantId?: number) =>
  request.get('/tenant/patient-portal-config', { params: tenantId ? { tenant_id: tenantId } : {} }) as Promise<{ data: PatientPortalConfig }>;

export const updatePatientPortalConfig = (data: Partial<PatientPortalConfig>, tenantId?: number) =>
  request.put('/tenant/patient-portal-config', data, { params: tenantId ? { tenant_id: tenantId } : {} });
