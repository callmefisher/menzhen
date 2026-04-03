import request from '../utils/request';

export interface PowerAdminItem {
  user_id: number;
  username: string;
  real_name: string;
  status: number;
  groups: string[];
  created_at: string;
}

export function listPowerAdmins() {
  return request.get<{ code: number; data: PowerAdminItem[] }>(
    '/settings/power-admins',
  );
}

export function deletePowerAdmin(userId: number) {
  return request.delete(`/settings/power-admins/${userId}`);
}

export function assignPowerAdminGroups(userId: number, groups: string[]) {
  return request.put(`/settings/power-admins/${userId}/groups`, { groups });
}

export interface GroupInfo {
  name: string;
  count: number;
}

export function listAllGroups() {
  return request.get<{ code: number; data: GroupInfo[] }>(
    '/settings/power-admins/groups',
  );
}
