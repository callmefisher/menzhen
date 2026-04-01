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
