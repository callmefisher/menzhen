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

export const listQueueDoctors = () =>
  request.get('/queue-doctors');

export const createQueueDoctor = (data: { user_id: number; room: string; enabled?: boolean }) =>
  request.post('/queue-doctors', data);

export const updateQueueDoctor = (id: number, data: { room: string; enabled: boolean }) =>
  request.put(`/queue-doctors/${id}`, data);

export const deleteQueueDoctor = (id: number) =>
  request.delete(`/queue-doctors/${id}`);

export const updateQueueDoctorSort = (orders: { id: number; sort_order: number }[]) =>
  request.put('/queue-doctors/sort', { orders });

export const getQueueEnabled = () =>
  request.get('/tenant/queue-enabled');

export const setQueueEnabled = (enabled: boolean) =>
  request.put('/tenant/queue-enabled', { enabled });

export const getCallDisplayDuration = () =>
  request.get('/tenant/call-duration');

export const setCallDisplayDuration = (seconds: number) =>
  request.put('/tenant/call-duration', { seconds });

export const getShowArrivalTime = () =>
  request.get('/tenant/show-arrival-time');

export const setShowArrivalTime = (show: boolean) =>
  request.put('/tenant/show-arrival-time', { show });

export const getAppointmentEnabled = () =>
  request.get('/tenant/appointment-enabled');

export const setAppointmentEnabled = (enabled: boolean) =>
  request.put('/tenant/appointment-enabled', { enabled });

export const getAppointmentConfig = () =>
  request.get('/tenant/appointment-config');

export const setAppointmentConfig = (data: AppointmentConfig) =>
  request.put('/tenant/appointment-config', data);

export const getCallSoundEnabled = () =>
  request.get<{ code: number; data: { enabled: boolean } }>('/tenant/call-sound-enabled');

export const setCallSoundEnabled = (enabled: boolean) =>
  request.put<{ code: number; data: null }>('/tenant/call-sound-enabled', { enabled });

export interface DoctorScheduleConfig {
  doctor_id: number;
  weekdays: number;    // bitmask: bit0=Sun, bit1=Mon, ..., bit6=Sat; 0 = no restriction
  range_start: number; // days offset from today (>=1)
  range_end: number;   // days offset from today
}

export const getDoctorSchedule = (doctorId: number) =>
  request.get(`/queue-doctors/${doctorId}/schedule`);

export const setDoctorSchedule = (doctorId: number, data: Omit<DoctorScheduleConfig, 'doctor_id'>) =>
  request.put(`/queue-doctors/${doctorId}/schedule`, data);
