import request from '../utils/request';

export interface SlotConfig {
  id: number;
  tenant_id: number;
  doctor_id: number;
  slot_start: string;
  slot_end: string;
  max_count: number;
}

export const listSlotConfigs = (doctorId?: number, tenantId?: number) =>
  request.get<{ code: number; data: { list: SlotConfig[] } }>('/appointment-slots', {
    params: { ...(doctorId !== undefined ? { doctor_id: doctorId } : {}), ...(tenantId ? { tenant_id: tenantId } : {}) },
  });

export const createSlotConfig = (data: {
  doctor_id: number;
  slot_start: string;
  slot_end: string;
  max_count: number;
}, tenantId?: number) => request.post<{ code: number; data: SlotConfig }>('/appointment-slots', data, { params: tenantId ? { tenant_id: tenantId } : {} });

export const updateSlotConfig = (
  id: number,
  data: { slot_start: string; slot_end: string; max_count: number },
  tenantId?: number,
) => request.put<{ code: number; data: SlotConfig }>(`/appointment-slots/${id}`, data, { params: tenantId ? { tenant_id: tenantId } : {} });

export const deleteSlotConfig = (id: number, tenantId?: number) =>
  request.delete<{ code: number; data: null }>(`/appointment-slots/${id}`, { params: tenantId ? { tenant_id: tenantId } : {} });
