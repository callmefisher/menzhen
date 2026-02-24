import request from '../utils/request';

export interface RecordListParams {
  name?: string;
  date?: string;
  page?: number;
  size?: number;
}

export interface RecordListItem {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_age: number;
  diagnosis: string;
  visit_date: string;
  created_at: string;
}

export function listRecords(params: RecordListParams) {
  return request.get('/records', { params });
}

export function getRecord(id: number) {
  return request.get(`/records/${id}`);
}

export function createRecord(data: unknown) {
  return request.post('/records', data);
}

export function updateRecord(id: number, data: unknown) {
  return request.put(`/records/${id}`, data);
}

export function deleteRecord(id: number) {
  return request.delete(`/records/${id}`);
}
