import request from '../utils/request';

export interface HerbListParams {
  name?: string;
  category?: string;
  page?: number;
  size?: number;
}

export interface HerbItem {
  id: number;
  name: string;
  alias: string;
  category: string;
  properties: string;
  effects: string;
  indications: string;
  origin: string;
  source: string;
  created_at: string;
}

export function listHerbs(params: HerbListParams) {
  return request.get('/herbs', { params });
}

export function getHerb(id: number) {
  return request.get(`/herbs/${id}`);
}

export function deleteHerb(id: number) {
  return request.delete(`/herbs/${id}`);
}

export function listHerbCategories() {
  return request.get('/herbs/categories');
}

export function updateHerb(id: number, data: Partial<Omit<HerbItem, 'id' | 'source' | 'created_at'>>) {
  return request.put(`/herbs/${id}`, data);
}

export function aiRefreshHerb(id: number) {
  return request.post(`/herbs/${id}/ai-refresh`);
}
