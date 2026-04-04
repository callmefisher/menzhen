import request from '../utils/request';

export interface Appointment {
  id: number;
  tenant_id: number;
  patient_id?: number;
  patient_name: string;
  doctor_id: number;
  doctor_name: string;
  room: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
  status: 'pending' | 'queued' | 'cancelled' | 'no_show';
  queue_entry_id?: number;
  created_at: string;
}

export const createAppointment = (data: {
  patient_name: string;
  patient_id?: number;
  doctor_id: number;
  doctor_name: string;
  room?: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
}) => request.post<{ code: number; data: Appointment }>('/appointments', data);

export const listAppointments = (date: string, doctorId?: number) =>
  request.get<{ code: number; data: { list: Appointment[] } }>('/appointments', {
    params: { date, doctor_id: doctorId },
  });

export const checkinAppointment = (id: number) =>
  request.post<{ code: number; message?: string }>(`/appointments/${id}/checkin`);

export const cancelAppointment = (id: number) =>
  request.post<{ code: number; message?: string }>(`/appointments/${id}/cancel`);

export interface UpdateAppointmentInput {
  patient_name: string;
  patient_id?: number;
  doctor_id: number;
  doctor_name: string;
  room?: string;
  appoint_date: string;
  slot_start: string;
  slot_end: string;
}

export const updateAppointment = (id: number, data: UpdateAppointmentInput) =>
  request.put<{ code: number; data: Appointment }>(`/appointments/${id}`, data);

export interface SlotInfo {
  slot_start: string;
  slot_end: string;
  max_count: number;
  booked_count: number;
  available: boolean;
}

export const getSlots = (date: string, doctorId: number) =>
  request.get<{ code: number; data: { list: SlotInfo[] } }>('/appointments/slots', {
    params: { date, doctor_id: doctorId },
  });

export const enqueueToday = () =>
  request.post<{ code: number; data: { enqueued: number; failed: number[] } }>('/appointments/enqueue-today');

export interface MatrixDoctor {
  doctor_id: number;
  doctor_name: string;
}

export interface WeeklyMatrixResult {
  doctors: MatrixDoctor[];
  days: string[];                                   // ["2026-04-07", ..., "2026-04-13"]
  counts: Record<string, Record<string, number>>;   // counts[doctorId][date]
  row_totals: Record<string, number>;               // row_totals[doctorId]
  col_totals: Record<string, number>;               // col_totals[date]
  grand_total: number;
}

export const getAppointmentMatrix = (start?: string) =>
  request.get<{ code: number; data: WeeklyMatrixResult }>('/appointments/matrix', {
    params: start ? { start } : undefined,
  });
