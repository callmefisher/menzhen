import request from '../utils/request';

export function listUsers(params: { page?: number; size?: number; tenant_id?: number }) {
  return request.get('/users', { params });
}

export function updateUser(id: number, data: { real_name?: string; phone?: string; status?: number; tenant_id?: number; notes?: string }) {
  return request.put(`/users/${id}`, data);
}

export function deleteUser(id: number) {
  return request.delete(`/users/${id}`);
}

export function assignRoles(userId: number, roleIds: number[]) {
  return request.post(`/users/${userId}/roles`, { role_ids: roleIds });
}

export function resetUserPassword(id: number, data: { new_password: string }) {
  return request.post(`/users/${id}/reset-password`, data);
}

export function createUser(data: { tenant_id: number; username: string; password: string; real_name: string; phone?: string }) {
  return request.post('/users', data);
}
