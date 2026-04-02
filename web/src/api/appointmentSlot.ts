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
  request.get<{ code: number; data: { list: SlotConfig[] } }>('/appointment-slots', {
    params: doctorId !== undefined ? { doctor_id: doctorId } : {},
  });

export const createSlotConfig = (data: {
  doctor_id: number;
  slot_start: string;
  slot_end: string;
  max_count: number;
}) => request.post<{ code: number; data: SlotConfig }>('/appointment-slots', data);

export const updateSlotConfig = (
  id: number,
  data: { slot_start: string; slot_end: string; max_count: number },
) => request.put<{ code: number; data: SlotConfig }>(`/appointment-slots/${id}`, data);

export const deleteSlotConfig = (id: number) =>
  request.delete<{ code: number; data: null }>(`/appointment-slots/${id}`);
