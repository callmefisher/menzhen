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
import { listRoles, createRole, updateRole, listPermissions } from '../role';

describe('role API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listRoles calls GET /roles', async () => {
    await listRoles();
    expect(request.get).toHaveBeenCalledWith('/roles');
  });

  it('createRole calls POST /roles with data', async () => {
    const data = { name: 'Admin', description: 'Administrator', permission_ids: [1, 2] };
    await createRole(data);
    expect(request.post).toHaveBeenCalledWith('/roles', data);
  });

  it('updateRole calls PUT /roles/:id with data', async () => {
    const data = { name: 'Updated Role', permission_ids: [3, 4] };
    await updateRole(2, data);
    expect(request.put).toHaveBeenCalledWith('/roles/2', data);
  });

  it('listPermissions calls GET /permissions', async () => {
    await listPermissions();
    expect(request.get).toHaveBeenCalledWith('/permissions');
  });
});
