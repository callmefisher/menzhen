import request from '../utils/request';

export interface FollowUp {
  id: number;
  tenant_id: number;
  patient_id: number;
  record_id: number | null;
  planned_date: string;
  actual_date: string | null;
  status: 'pending' | 'completed' | 'overdue';
  method: string;
  content: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface FollowUpListItem {
  id: number;
  tenant_id: number;
  patient_id: number;
  patient_name: string;
  record_id: number | null;
  record_diagnosis: string;
  record_visit_date: string | null;
  planned_date: string;
  actual_date: string | null;
  status: 'pending' | 'completed' | 'overdue';
  method: string;
  content: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface FollowUpListParams {
  patient_name?: string;
  status?: string;
  planned_date_from?: string;
  planned_date_to?: string;
  page?: number;
  size?: number;
}

export interface CreateFollowUpReq {
  patient_id: number;
  record_id?: number | null;
  planned_date: string;
  method: string;
  content?: string;
}

export interface UpdateFollowUpReq {
  patient_id?: number;
  record_id?: number | null;
  planned_date?: string;
  actual_date?: string | null;
  method?: string;
  content?: string;
}

export interface FollowUpStats {
  pending_count: number;
  overdue_count: number;
  today_count: number;
  completed_count: number;
}

export function listFollowUps(params: FollowUpListParams) {
  return request.get('/follow-ups', { params });
}

export function createFollowUp(data: CreateFollowUpReq) {
  return request.post('/follow-ups', data);
}

export function getFollowUp(id: number) {
  return request.get(`/follow-ups/${id}`);
}

export function updateFollowUp(id: number, data: UpdateFollowUpReq) {
  return request.put(`/follow-ups/${id}`, data);
}

export function deleteFollowUp(id: number) {
  return request.delete(`/follow-ups/${id}`);
}

export function getFollowUpStats() {
  return request.get('/follow-ups/stats');
}
