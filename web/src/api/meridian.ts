import request from '../utils/request';

export interface MeridianResource {
  meridian_id: string;
  video_url: string;
  source_text: string;
  updated_by?: number;
  updated_at?: string;
}

export function getMeridianResource(meridianId: string) {
  return request.get(`/meridians/${meridianId}/resource`);
}

export function updateMeridianResource(meridianId: string, data: { video_url: string; source_text: string }) {
  return request.put(`/meridians/${meridianId}/resource`, data);
}
