import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/request', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import request from '../../utils/request';
import {
  listTenantUsers,
  updateTenantUser,
  deleteTenantUser,
  assignTenantUserRoles,
  listTenantRoles,
  createTenantRole,
  updateTenantRole,
  listTenantPermissions,
} from '../tenant-admin';

describe('tenant-admin API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listTenantUsers calls GET /tenant/users with params', async () => {
    await listTenantUsers({ page: 1, size: 20 });
    expect(request.get).toHaveBeenCalledWith('/tenant/users', { params: { page: 1, size: 20 } });
  });

  it('listTenantUsers works with empty params', async () => {
    await listTenantUsers({});
    expect(request.get).toHaveBeenCalledWith('/tenant/users', { params: {} });
  });

  it('updateTenantUser calls PUT /tenant/users/:id with data', async () => {
    const data = { real_name: '张三', phone: '13800000000', status: 1, notes: '备注' };
    await updateTenantUser(5, data);
    expect(request.put).toHaveBeenCalledWith('/tenant/users/5', data);
  });

  it('updateTenantUser works with partial data', async () => {
    await updateTenantUser(3, { status: 0 });
    expect(request.put).toHaveBeenCalledWith('/tenant/users/3', { status: 0 });
  });

  it('deleteTenantUser calls DELETE /tenant/users/:id', async () => {
    await deleteTenantUser(7);
    expect(request.delete).toHaveBeenCalledWith('/tenant/users/7');
  });

  it('assignTenantUserRoles calls POST /tenant/users/:userId/roles with role_ids', async () => {
    await assignTenantUserRoles(5, [1, 2, 3]);
    expect(request.post).toHaveBeenCalledWith('/tenant/users/5/roles', { role_ids: [1, 2, 3] });
  });

  it('assignTenantUserRoles works with empty role list', async () => {
    await assignTenantUserRoles(5, []);
    expect(request.post).toHaveBeenCalledWith('/tenant/users/5/roles', { role_ids: [] });
  });

  it('listTenantRoles calls GET /tenant/roles', async () => {
    await listTenantRoles();
    expect(request.get).toHaveBeenCalledWith('/tenant/roles');
  });

  it('createTenantRole calls POST /tenant/roles with data', async () => {
    const data = { name: '诊所管理员', description: '管理诊所用户', permission_ids: [1, 2] };
    await createTenantRole(data);
    expect(request.post).toHaveBeenCalledWith('/tenant/roles', data);
  });

  it('createTenantRole works with only required name field', async () => {
    await createTenantRole({ name: '普通员工' });
    expect(request.post).toHaveBeenCalledWith('/tenant/roles', { name: '普通员工' });
  });

  it('updateTenantRole calls PUT /tenant/roles/:id with data', async () => {
    const data = { name: '更新角色', permission_ids: [3, 4] };
    await updateTenantRole(2, data);
    expect(request.put).toHaveBeenCalledWith('/tenant/roles/2', data);
  });

  it('updateTenantRole works with partial data', async () => {
    await updateTenantRole(2, { description: '更新描述' });
    expect(request.put).toHaveBeenCalledWith('/tenant/roles/2', { description: '更新描述' });
  });

  it('listTenantPermissions calls GET /tenant/permissions', async () => {
    await listTenantPermissions();
    expect(request.get).toHaveBeenCalledWith('/tenant/permissions');
  });
});
