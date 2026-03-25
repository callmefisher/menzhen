import request from '../utils/request';

export function listTenantUsers(params: { page?: number; size?: number }) {
  return request.get('/tenant/users', { params });
}

export function updateTenantUser(id: number, data: { real_name?: string; phone?: string; status?: number; notes?: string }) {
  return request.put(`/tenant/users/${id}`, data);
}

export function deleteTenantUser(id: number) {
  return request.delete(`/tenant/users/${id}`);
}

export function assignTenantUserRoles(userId: number, roleIds: number[]) {
  return request.post(`/tenant/users/${userId}/roles`, { role_ids: roleIds });
}

export function resetTenantUserPassword(id: number, data: { new_password: string }) {
  return request.post(`/tenant/users/${id}/reset-password`, data);
}

export function createTenantUser(data: { username: string; password: string; real_name: string; phone?: string }) {
  return request.post('/tenant/users', data);
}

export function listTenantRoles() {
  return request.get('/tenant/roles');
}

export function createTenantRole(data: { name: string; description?: string; permission_ids?: number[] }) {
  return request.post('/tenant/roles', data);
}

export function updateTenantRole(id: number, data: { name?: string; description?: string; permission_ids?: number[] }) {
  return request.put(`/tenant/roles/${id}`, data);
}

export function deleteTenantRole(id: number) {
  return request.delete(`/tenant/roles/${id}`);
}

export function listTenantPermissions() {
  return request.get('/tenant/permissions');
}
