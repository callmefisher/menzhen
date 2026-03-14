import request from '../utils/request';

export interface SolarTermItem {
  id: number;
  name: string;
  season: string;
  order_index: number;
  month: number;
  day: number;
  end_month: number;
  end_day: number;
  content: string;
  created_at: string;
  updated_at: string;
}

/** Get all 24 solar terms */
export function listSolarTerms() {
  return request.get<unknown, { code: number; data: SolarTermItem[] }>('/solar-terms');
}

/** Update solar term content (admin) */
export function updateSolarTerm(id: number, content: string) {
  return request.put(`/solar-terms/${id}`, { content });
}

/** Delete solar term content (admin) */
export function deleteSolarTermContent(id: number) {
  return request.delete(`/solar-terms/${id}/content`);
}
