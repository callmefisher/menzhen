import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../auth';

// Mock the auth API
vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
}));

import { login as loginApi, getMe, logout as logoutApi } from '../../api/auth';

const mockLogin = vi.mocked(loginApi);
const mockGetMe = vi.mocked(getMe);
const mockLogout = vi.mocked(logoutApi);

// Test helper components
function TestConsumer() {
  const { user, loading, permissions, hasPermission } = useAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="user">{user?.username || 'none'}</span>
      <span data-testid="perms">{permissions.join(',')}</span>
      <span data-testid="has-read">{String(hasPermission('patient:read'))}</span>
    </div>
  );
}

function LoginConsumer() {
  const { login, user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="user">{user?.username || 'none'}</span>
      <button onClick={() => login('admin', 'pass123', false)}>Login</button>
      <button onClick={() => login('admin', 'pass123', true)}>Login Remember</button>
    </div>
  );
}

function LogoutConsumer() {
  const { logout, user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="user">{user?.username || 'none'}</span>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}

const mockUser = {
  id: 1,
  username: 'admin',
  real_name: '管理员',
  tenant_id: 1,
};

const mockPermissions = ['patient:read'];

describe('AuthProvider + useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // 1. Initial state shows loading
  it('initial state shows loading', () => {
    mockGetMe.mockReturnValue(new Promise(() => {})); // never resolves
    localStorage.setItem('token', 'test-token');

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  // 2. No token -> loading=false, user=null
  it('no token sets loading=false and user=null', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    expect(mockGetMe).not.toHaveBeenCalled();
  });

  // 3. With token + getMe success -> shows user + permissions
  it('with token and getMe success shows user and permissions', async () => {
    localStorage.setItem('token', 'valid-token');
    mockGetMe.mockResolvedValue({
      data: { user: mockUser, permissions: mockPermissions },
    } as any);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('admin');
    });

    expect(screen.getByTestId('perms')).toHaveTextContent('patient:read');
    expect(screen.getByTestId('has-read')).toHaveTextContent('true');
  });

  // 4. With token + getMe failure -> clears token, user=null
  it('with token and getMe failure clears token and sets user=null', async () => {
    localStorage.setItem('token', 'expired-token');
    mockGetMe.mockRejectedValue(new Error('401'));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  // 5. Login success -> stores token in sessionStorage (no remember)
  it('login success stores token in sessionStorage when remember=false', async () => {
    const user = userEvent.setup();
    mockGetMe.mockRejectedValue(new Error('no token'));
    mockLogin.mockResolvedValue({
      data: { token: 'jwt-token', user: mockUser, permissions: mockPermissions },
    } as any);

    render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    await user.click(screen.getByText('Login'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('admin');
    });

    expect(sessionStorage.getItem('token')).toBe('jwt-token');
    expect(localStorage.getItem('token')).toBeNull();
  });

  // 6. Login success with remember -> stores token in localStorage
  it('login success with remember stores token in localStorage', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      data: { token: 'jwt-token', user: mockUser, permissions: mockPermissions },
    } as any);

    render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    await user.click(screen.getByText('Login Remember'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('admin');
    });

    expect(localStorage.getItem('token')).toBe('jwt-token');
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  // 7. Logout -> clears token + user
  it('logout clears token and user', async () => {
    const user = userEvent.setup();
    localStorage.setItem('token', 'valid-token');
    mockGetMe.mockResolvedValue({
      data: { user: mockUser, permissions: mockPermissions },
    } as any);
    mockLogout.mockResolvedValue({} as any);

    render(
      <AuthProvider>
        <LogoutConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('admin');
    });

    await user.click(screen.getByText('Logout'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  // 8. hasPermission returns true/false correctly
  it('hasPermission returns true for granted and false for missing permissions', async () => {
    localStorage.setItem('token', 'valid-token');
    mockGetMe.mockResolvedValue({
      data: { user: mockUser, permissions: ['patient:read'] },
    } as any);

    function PermConsumer() {
      const { hasPermission, loading } = useAuth();
      if (loading) return <div>Loading...</div>;
      return (
        <div>
          <span data-testid="p-read">{String(hasPermission('patient:read'))}</span>
          <span data-testid="p-delete">{String(hasPermission('patient:delete'))}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <PermConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('p-read')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('p-delete')).toHaveTextContent('false');
  });

  // 9. useAuth outside AuthProvider -> throws error
  it('useAuth outside AuthProvider throws error', () => {
    // Suppress console.error from React's error boundary
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useAuth must be used within an AuthProvider');

    spy.mockRestore();
  });
});

describe('isPowerAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should be false when managedGroups is empty', async () => {
    mockLogin.mockResolvedValue({
      data: {
        token: 'tok',
        user: { id: 1, username: 'lisi', real_name: 'LS', tenant_id: 1 },
        permissions: ['user:manage'],
        managed_groups: [],
      },
    } as never);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });
    await act(async () => {
      await result.current.login('lisi', 'pass');
    });
    expect(result.current.isPowerAdmin).toBe(false);
  });

  it('should be true when managedGroups is non-empty and not superAdmin', async () => {
    mockLogin.mockResolvedValue({
      data: {
        token: 'tok',
        user: { id: 2, username: 'wangwu', real_name: 'WW', tenant_id: 1 },
        permissions: [],
        managed_groups: ['华北分组', '华南分组'],
      },
    } as never);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });
    await act(async () => {
      await result.current.login('wangwu', 'pass');
    });
    expect(result.current.isPowerAdmin).toBe(true);
    expect(result.current.managedGroups).toEqual(['华北分组', '华南分组']);
  });

  it('should be false when user is superAdmin even with managedGroups', async () => {
    mockLogin.mockResolvedValue({
      data: {
        token: 'tok',
        user: { id: 3, username: 'admin', real_name: 'Admin', tenant_id: 1 },
        permissions: ['user:manage'],
        managed_groups: ['华北分组'],
      },
    } as never);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });
    await act(async () => {
      await result.current.login('admin', 'pass');
    });
    expect(result.current.isSuperAdmin).toBe(true);
    expect(result.current.isPowerAdmin).toBe(false);
  });
});
