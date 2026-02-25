import request from '../utils/request';

export function listUsers(params: { page?: number; size?: number }) {
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
