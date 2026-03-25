import request from '../utils/request';

export function listRoles(params?: { tenant_id?: number }) {
  return request.get('/roles', { params });
}

export function createRole(data: { name: string; description?: string; permission_ids?: number[] }) {
  return request.post('/roles', data);
}

export function updateRole(id: number, data: { name?: string; description?: string; permission_ids?: number[] }) {
  return request.put(`/roles/${id}`, data);
}

export function listPermissions() {
  return request.get('/permissions');
}

export function deleteRole(id: number) {
  return request.delete(`/roles/${id}`);
}
