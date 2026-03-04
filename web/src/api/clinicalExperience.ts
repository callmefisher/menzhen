import request from '../utils/request';

export interface ClinicalExperienceListParams {
  keyword?: string;
  category?: string;
  page?: number;
  size?: number;
}

export interface ClinicalExperienceItem {
  id: number;
  source: string;
  category: string;
  herbs: string;
  formula: string;
  experience: string;
  created_at: string;
  updated_at: string;
}

export function listClinicalExperiences(params: ClinicalExperienceListParams) {
  return request.get('/clinical-experiences', { params });
}

export function getClinicalExperience(id: number) {
  return request.get(`/clinical-experiences/${id}`);
}

export function createClinicalExperience(data: Omit<ClinicalExperienceItem, 'id' | 'created_at' | 'updated_at'>) {
  return request.post('/clinical-experiences', data);
}

export function updateClinicalExperience(id: number, data: Partial<Omit<ClinicalExperienceItem, 'id' | 'created_at' | 'updated_at'>>) {
  return request.put(`/clinical-experiences/${id}`, data);
}

export function deleteClinicalExperience(id: number) {
  return request.delete(`/clinical-experiences/${id}`);
}

export function listClinicalExperienceCategories() {
  return request.get('/clinical-experiences/categories');
}
