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
import { listTenants, createTenant, updateTenant, deleteTenant } from '../tenant';

describe('tenant API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listTenants calls GET /tenants with params', async () => {
    const params = { page: 1, size: 10 };
    await listTenants(params);
    expect(request.get).toHaveBeenCalledWith('/tenants', { params });
  });

  it('createTenant calls POST /tenants with data', async () => {
    const data = { name: 'Test Clinic', code: 'TC001' };
    await createTenant(data);
    expect(request.post).toHaveBeenCalledWith('/tenants', data);
  });

  it('updateTenant calls PUT /tenants/:id with data', async () => {
    const data = { name: 'Updated Clinic', status: 1 };
    await updateTenant(3, data);
    expect(request.put).toHaveBeenCalledWith('/tenants/3', data);
  });

  it('deleteTenant calls DELETE /tenants/:id', async () => {
    await deleteTenant(3);
    expect(request.delete).toHaveBeenCalledWith('/tenants/3');
  });
});
