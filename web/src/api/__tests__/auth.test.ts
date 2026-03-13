import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/request', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import request from '../../utils/request';
import { login, register, getMe, logout, changePassword } from '../auth';

describe('auth API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('login calls POST /auth/login with credentials', async () => {
    const data = { username: 'admin', password: '123456' };
    await login(data);
    expect(request.post).toHaveBeenCalledWith('/auth/login', data);
  });

  it('register calls POST /auth/register with user data', async () => {
    const data = {
      tenant_code: 'T001',
      username: 'newuser',
      password: 'pass123',
      real_name: 'Test User',
      phone: '13800000000',
    };
    await register(data);
    expect(request.post).toHaveBeenCalledWith('/auth/register', data);
  });

  it('getMe calls GET /auth/me', async () => {
    await getMe();
    expect(request.get).toHaveBeenCalledWith('/auth/me');
  });

  it('logout calls POST /auth/logout', async () => {
    await logout();
    expect(request.post).toHaveBeenCalledWith('/auth/logout');
  });

  it('changePassword calls POST /auth/change-password with passwords', async () => {
    const data = { old_password: 'old123', new_password: 'new456' };
    await changePassword(data);
    expect(request.post).toHaveBeenCalledWith('/auth/change-password', data);
  });
});
