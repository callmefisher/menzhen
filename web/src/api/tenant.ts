import request from '../utils/request';

export function listTenants(params: { page?: number; size?: number }) {
  return request.get('/tenants', { params });
}

export function createTenant(data: { name: string; code: string; group_name?: string }) {
  return request.post('/tenants', data);
}

export function updateTenant(id: number, data: { name?: string; code?: string; status?: number; group_name?: string }) {
  return request.put(`/tenants/${id}`, data);
}

export function deleteTenant(id: number) {
  return request.delete(`/tenants/${id}`);
}
