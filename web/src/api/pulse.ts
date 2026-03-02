import request from '../utils/request';

export interface PulseListParams {
  name?: string;
  category?: string;
  page?: number;
  size?: number;
}

export interface PulseItem {
  id: number;
  name: string;
  category: string;
  description: string;
  clinical_meaning: string;
  common_conditions: string;
  created_at: string;
}

export function listPulses(params: PulseListParams) {
  return request.get('/pulses', { params });
}

export function getPulse(id: number) {
  return request.get(`/pulses/${id}`);
}

export function createPulse(data: Omit<PulseItem, 'id' | 'created_at'>) {
  return request.post('/pulses', data);
}

export function updatePulse(id: number, data: Partial<Omit<PulseItem, 'id' | 'created_at'>>) {
  return request.put(`/pulses/${id}`, data);
}

export function deletePulse(id: number) {
  return request.delete(`/pulses/${id}`);
}

export function listPulseCategories() {
  return request.get('/pulses/categories');
}
