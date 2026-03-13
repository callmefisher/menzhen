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
import { listUsers, updateUser, deleteUser, assignRoles } from '../user';

describe('user API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listUsers calls GET /users with params', async () => {
    const params = { page: 1, size: 20 };
    await listUsers(params);
    expect(request.get).toHaveBeenCalledWith('/users', { params });
  });

  it('updateUser calls PUT /users/:id with data', async () => {
    const data = { real_name: 'Updated Name', phone: '13900000000', status: 1 };
    await updateUser(5, data);
    expect(request.put).toHaveBeenCalledWith('/users/5', data);
  });

  it('deleteUser calls DELETE /users/:id', async () => {
    await deleteUser(5);
    expect(request.delete).toHaveBeenCalledWith('/users/5');
  });

  it('assignRoles calls POST /users/:id/roles with role_ids', async () => {
    await assignRoles(5, [1, 2, 3]);
    expect(request.post).toHaveBeenCalledWith('/users/5/roles', { role_ids: [1, 2, 3] });
  });
});
