import request from '../utils/request';

export interface BillingDetailItem {
  herb_name: string;
  category: string;
  dosage: string;
  dosage_val: number;
  unit: string;
  doses: number;
  unit_price: number;
  item_cost: number;
  in_stock: boolean;
}

export interface BillingDetail {
  prescription_id: number;
  record_id: number;
  formula_name: string;
  total_doses: number;
  items: BillingDetailItem[];
  drug_cost_total: number;
  consultation_fee: number;
  total_amount: number;
  actual_paid: number;
  stock_deducted: boolean;
  billing_id: number;
  created_by: number;
}

export interface CreateBillingReq {
  consultation_fee: number;
  actual_paid: number;
}

export interface BillingRecord {
  id: number;
  prescription_id: number;
  record_id: number;
  tenant_id: number;
  consultation_fee: number;
  actual_paid: number;
  stock_deducted: boolean;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export function getPrescriptionBilling(prescriptionId: number) {
  return request.get(`/prescriptions/${prescriptionId}/billing`);
}

export function createPrescriptionBilling(prescriptionId: number, data: CreateBillingReq) {
  return request.post(`/prescriptions/${prescriptionId}/billing`, data);
}

export function deductStockAndBill(prescriptionId: number, data: CreateBillingReq) {
  return request.post(`/prescriptions/${prescriptionId}/billing/deduct-stock`, data);
}

export function listRecordBillings(recordId: number) {
  return request.get(`/records/${recordId}/billings`);
}

export function getRecordBillingDetail(recordId: number) {
  return request.get(`/records/${recordId}/billing-detail`);
}

export function createRecordBilling(recordId: number, data: CreateBillingReq) {
  return request.post(`/records/${recordId}/billing`, data);
}
