import request from '../utils/request';

export interface PrescriptionNotificationItem {
  id: number;
  tenant_id: number;
  prescription_id: number;
  record_id: number;
  patient_name: string;
  doctor_name: string;
  formula_name: string;
  total_doses: number;
  herb_count: number;
  patent_count: number;
  notes: string;
  status: 'pending' | 'done';
  done_at: string | null;
  created_at: string;
}

export interface DispenseDetailItem {
  shelf_no: string;
  herb_name: string;
  dosage: string;
  notes: string;
  category: string;
}

export interface DispenseDetail {
  notification: PrescriptionNotificationItem;
  herbs: DispenseDetailItem[];
  patents: DispenseDetailItem[];
}

export function listNotifications(status?: string) {
  return request.get('/prescription-notifications', { params: { status } });
}

export function getNotificationDetail(id: number) {
  return request.get(`/prescription-notifications/${id}/detail`);
}

export function markDone(id: number) {
  return request.post(`/prescription-notifications/${id}/done`);
}

export function batchMarkDone() {
  return request.post('/prescription-notifications/batch-done');
}

export function getPendingCount() {
  return request.get('/prescription-notifications/pending-count');
}
