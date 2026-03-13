import request from '../utils/request';

export interface InventoryDrug {
  id: number;
  tenant_id: number;
  name: string;
  category: 'herb' | 'patent';
  stock: number;
  purchase_price: number;
  selling_price: number;
  alert_threshold: number | null;
  remark: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryDrugListParams {
  name?: string;
  category?: string;
  page?: number;
  size?: number;
}

export interface CreateInventoryDrugReq {
  name: string;
  category: 'herb' | 'patent';
  stock: number;
  purchase_price: number;
  selling_price: number;
  alert_threshold?: number | null;
  remark?: string;
}

export interface UpdateInventoryDrugReq {
  name?: string;
  category?: string;
  stock?: number;
  purchase_price?: number;
  selling_price?: number;
  alert_threshold?: number | null;
  remark?: string;
}

export function listInventoryDrugs(params: InventoryDrugListParams) {
  return request.get('/inventory/drugs', { params });
}

export function createInventoryDrug(data: CreateInventoryDrugReq) {
  return request.post('/inventory/drugs', data);
}

export function updateInventoryDrug(id: number, data: UpdateInventoryDrugReq) {
  return request.put(`/inventory/drugs/${id}`, data);
}

export function deleteInventoryDrug(id: number) {
  return request.delete(`/inventory/drugs/${id}`);
}
