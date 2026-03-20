import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Set up mocks BEFORE importing the module under test ---

const requestInterceptorUse = vi.fn();
const responseInterceptorUse = vi.fn();

const mockInstance = {
  interceptors: {
    request: { use: requestInterceptorUse },
    response: { use: responseInterceptorUse },
  },
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockInstance),
  },
}));

const mockMessageError = vi.fn();
vi.mock('antd', () => ({
  message: { error: mockMessageError },
}));

// Import AFTER mocks are registered so side effects use the mocked modules
import axios from 'axios';

// Force the module to execute (registers interceptors on the mock)
await import('../request');

// Extract interceptor callbacks captured by the mock
const requestFn = requestInterceptorUse.mock.calls[0][0];
const responseFn = responseInterceptorUse.mock.calls[0][0];
const errorFn = responseInterceptorUse.mock.calls[0][1];

// Capture axios.create args before beforeEach clears mock history
const createCallArgs = (axios.create as ReturnType<typeof vi.fn>).mock.calls[0][0];

// --- Tests ---

describe('request utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // Reset location to a non-login page
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { pathname: '/patients', href: '' },
    });
  });

  // 1. Instance config
  it('creates axios instance with baseURL and timeout', () => {
    expect(createCallArgs).toEqual({
      baseURL: '/api/v1',
      timeout: 30000,
    });
  });

  // 2. Token from localStorage
  it('request interceptor attaches token from localStorage', () => {
    localStorage.setItem('token', 'ls-token');
    const config = { headers: {} as Record<string, string> };
    const result = requestFn(config);
    expect(result.headers.Authorization).toBe('Bearer ls-token');
  });

  // 3. Token from sessionStorage
  it('request interceptor attaches token from sessionStorage', () => {
    sessionStorage.setItem('token', 'ss-token');
    const config = { headers: {} as Record<string, string> };
    const result = requestFn(config);
    expect(result.headers.Authorization).toBe('Bearer ss-token');
  });

  // 4. No token
  it('request interceptor sends no auth header when no token', () => {
    const config = { headers: {} as Record<string, string> };
    const result = requestFn(config);
    expect(result.headers.Authorization).toBeUndefined();
  });

  // 5. Success response
  it('response interceptor returns response.data on success', () => {
    const payload = { code: 0, data: { id: 1 } };
    const result = responseFn({ data: payload });
    expect(result).toEqual(payload);
  });

  // 6. 401 redirects when not on /login
  it('response interceptor redirects on 401 (not on login page)', async () => {
    localStorage.setItem('token', 'old-token');
    sessionStorage.setItem('token', 'old-token');
    window.location.pathname = '/patients';

    const error = {
      response: { status: 401, data: { message: 'unauthorized' } },
    };

    await expect(errorFn(error)).rejects.toBe(error);

    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  // 7. 401 on /login does NOT redirect
  it('response interceptor does NOT redirect on 401 when on /login', async () => {
    localStorage.setItem('token', 'old-token');
    window.location.pathname = '/login';

    const error = {
      response: { status: 401, data: { message: '用户名或密码错误' } },
    };

    await expect(errorFn(error)).rejects.toBe(error);

    // Tokens still cleared
    expect(localStorage.getItem('token')).toBeNull();
    // But href should NOT be changed to /login (stays as initial)
    expect(window.location.href).toBe('');
    // Error message shown
    expect(mockMessageError).toHaveBeenCalledWith('用户名或密码错误');
  });

  // 8. 403 with required_permissions
  it('response interceptor shows permission names on 403', async () => {
    const error = {
      response: {
        status: 403,
        data: {
          message: 'forbidden',
          required_permissions: ['patient:read', 'record:create'],
        },
      },
    };

    await expect(errorFn(error)).rejects.toBe(error);

    expect(mockMessageError).toHaveBeenCalledWith(
      '没有操作权限，需要以下权限：查看患者、创建诊疗记录'
    );
  });

  // 9. 409 tenant name already exists → Chinese message
  it('response interceptor maps tenant name duplicate to Chinese', async () => {
    const error = {
      response: {
        status: 409,
        data: { code: 409, message: 'tenant name already exists' },
      },
    };

    await expect(errorFn(error)).rejects.toBe(error);

    expect(mockMessageError).toHaveBeenCalledWith('诊所名称已存在');
  });

  // 10. 409 tenant code already exists → Chinese message
  it('response interceptor maps tenant code duplicate to Chinese', async () => {
    const error = {
      response: {
        status: 409,
        data: { code: 409, message: 'tenant code already exists' },
      },
    };

    await expect(errorFn(error)).rejects.toBe(error);

    expect(mockMessageError).toHaveBeenCalledWith('诊所编码已存在');
  });
});
