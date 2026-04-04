import request from '../utils/request';

export interface QueueDoctor {
  id: number;
  tenant_id: number;
  user_id: number;
  user_name: string;
  room: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppointmentConfig {
  slot_minutes: number;
  max_appt_per_slot: number;
  advance_days: number;
}

const tp = (tenantId?: number) => (tenantId ? { tenant_id: tenantId } : {});

export const listQueueDoctors = (tenantId?: number) =>
  request.get('/queue-doctors', { params: tp(tenantId) });

export const createQueueDoctor = (data: { user_id: number; room: string; enabled?: boolean }, tenantId?: number) =>
  request.post('/queue-doctors', data, { params: tp(tenantId) });

export const updateQueueDoctor = (id: number, data: { room: string; enabled: boolean }, tenantId?: number) =>
  request.put(`/queue-doctors/${id}`, data, { params: tp(tenantId) });

export const deleteQueueDoctor = (id: number, tenantId?: number) =>
  request.delete(`/queue-doctors/${id}`, { params: tp(tenantId) });

export const updateQueueDoctorSort = (orders: { id: number; sort_order: number }[], tenantId?: number) =>
  request.put('/queue-doctors/sort', { orders }, { params: tp(tenantId) });

export const getQueueEnabled = (tenantId?: number) =>
  request.get('/tenant/queue-enabled', { params: tp(tenantId) });

export const setQueueEnabled = (enabled: boolean, tenantId?: number) =>
  request.put('/tenant/queue-enabled', { enabled }, { params: tp(tenantId) });

export const getCallDisplayDuration = (tenantId?: number) =>
  request.get('/tenant/call-duration', { params: tp(tenantId) });

export const setCallDisplayDuration = (seconds: number, tenantId?: number) =>
  request.put('/tenant/call-duration', { seconds }, { params: tp(tenantId) });

export const getShowArrivalTime = (tenantId?: number) =>
  request.get('/tenant/show-arrival-time', { params: tp(tenantId) });

export const setShowArrivalTime = (show: boolean, tenantId?: number) =>
  request.put('/tenant/show-arrival-time', { show }, { params: tp(tenantId) });

export const getAppointmentEnabled = (tenantId?: number) =>
  request.get('/tenant/appointment-enabled', { params: tp(tenantId) });

export const setAppointmentEnabled = (enabled: boolean, tenantId?: number) =>
  request.put('/tenant/appointment-enabled', { enabled }, { params: tp(tenantId) });

export const getAppointmentConfig = (tenantId?: number) =>
  request.get('/tenant/appointment-config', { params: tp(tenantId) });

export const setAppointmentConfig = (data: AppointmentConfig, tenantId?: number) =>
  request.put('/tenant/appointment-config', data, { params: tp(tenantId) });

export const getCallSoundEnabled = (tenantId?: number) =>
  request.get<{ code: number; data: { enabled: boolean } }>('/tenant/call-sound-enabled', { params: tp(tenantId) });

export const setCallSoundEnabled = (enabled: boolean, tenantId?: number) =>
  request.put<{ code: number; data: null }>('/tenant/call-sound-enabled', { enabled }, { params: tp(tenantId) });

export interface DoctorScheduleConfig {
  doctor_id: number;
  weekdays: number;    // bitmask: bit0=Sun, bit1=Mon, ..., bit6=Sat; 0 = no restriction
  range_start: number; // days offset from today (>=1)
  range_end: number;   // days offset from today
}

export const getDoctorSchedule = (doctorId: number, tenantId?: number) =>
  request.get(`/queue-doctors/${doctorId}/schedule`, { params: tp(tenantId) });

export const setDoctorSchedule = (doctorId: number, data: Omit<DoctorScheduleConfig, 'doctor_id'>, tenantId?: number) =>
  request.put(`/queue-doctors/${doctorId}/schedule`, data, { params: tp(tenantId) });
