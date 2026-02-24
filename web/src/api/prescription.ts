import request from '../utils/request';

export interface PrescriptionItemReq {
  herb_name: string;
  dosage: string;
  sort_order: number;
  notes?: string;
}

export interface CreatePrescriptionReq {
  record_id: number;
  formula_name?: string;
  total_doses?: number;
  notes?: string;
  items: PrescriptionItemReq[];
}

export interface UpdatePrescriptionReq {
  formula_name?: string;
  total_doses?: number;
  notes?: string;
  items?: PrescriptionItemReq[];
}

export interface PrescriptionItemData {
  id: number;
  prescription_id: number;
  herb_name: string;
  dosage: string;
  sort_order: number;
  notes: string;
  created_at: string;
}

export interface PrescriptionData {
  id: number;
  record_id: number;
  tenant_id: number;
  formula_name: string;
  total_doses: number;
  notes: string;
  created_by: number;
  creator?: { id: number; real_name: string; username: string };
  items: PrescriptionItemData[];
  created_at: string;
  updated_at: string;
}

export function createPrescription(data: CreatePrescriptionReq) {
  return request.post('/prescriptions', data);
}

export function getPrescription(id: number) {
  return request.get(`/prescriptions/${id}`);
}

export function listPrescriptionsByRecord(recordId: number) {
  return request.get(`/records/${recordId}/prescriptions`);
}

export function updatePrescription(id: number, data: UpdatePrescriptionReq) {
  return request.put(`/prescriptions/${id}`, data);
}

export function deletePrescription(id: number) {
  return request.delete(`/prescriptions/${id}`);
}
