import request from '../utils/request';

export interface SlotConfig {
  id: number;
  tenant_id: number;
  doctor_id: number;
  slot_start: string;
  slot_end: string;
  max_count: number;
}

export const listSlotConfigs = (doctorId?: number) =>
  request.get('/appointment-slots', { params: doctorId ? { doctor_id: doctorId } : {} });

export const createSlotConfig = (data: { doctor_id: number; slot_start: string; slot_end: string; max_count: number }) =>
  request.post('/appointment-slots', data);

export const updateSlotConfig = (id: number, data: { slot_start: string; slot_end: string; max_count: number }) =>
  request.put(`/appointment-slots/${id}`, data);

export const deleteSlotConfig = (id: number) =>
  request.delete(`/appointment-slots/${id}`);
