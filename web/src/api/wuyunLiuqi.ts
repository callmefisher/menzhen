import request from '../utils/request';

export interface WuyunLiuqiItem {
  id: number;
  year: number;
  content: string;
  source: string;
  updated_by: number;
  created_at: string;
  updated_at: string;
}

/** Get cached data for a year */
export function getWuyunLiuqi(year: number) {
  return request.get('/wuyun-liuqi', { params: { year } });
}

/** Update content (admin) */
export function updateWuyunLiuqi(id: number, content: string) {
  return request.put(`/wuyun-liuqi/${id}`, { content });
}

/** Delete record (admin) */
export function deleteWuyunLiuqi(id: number) {
  return request.delete(`/wuyun-liuqi/${id}`);
}
