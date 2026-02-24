import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { login as loginApi, getMe, logout as logoutApi } from '../api/auth';

interface User {
  id: number;
  username: string;
  real_name: string;
  tenant_id: number;
}

interface AuthState {
  user: User | null;
  permissions: string[];
  token: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    permissions: [],
    token: localStorage.getItem('token'),
    loading: true,
  });

  // Restore session on mount
  useEffect(() => {
    if (state.token) {
      getMe()
        .then((res) => {
          // response interceptor already unwraps response.data
          const body = res as unknown as {
            data: { user: User; permissions: string[] };
          };
          setState((prev) => ({
            ...prev,
            user: body.data.user,
            permissions: body.data.permissions || [],
            loading: false,
          }));
        })
        .catch(() => {
          localStorage.removeItem('token');
          setState({
            user: null,
            permissions: [],
            token: null,
            loading: false,
          });
        });
    } else {
      setState((prev) => ({ ...prev, loading: false }));
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await loginApi({ username, password });
    // response interceptor already unwraps response.data
    const body = res as unknown as {
      data: { token: string; user: User; permissions: string[] };
    };
    localStorage.setItem('token', body.data.token);
    setState({
      user: body.data.user,
      permissions: body.data.permissions || [],
      token: body.data.token,
      loading: false,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } finally {
      localStorage.removeItem('token');
      setState({
        user: null,
        permissions: [],
        token: null,
        loading: false,
      });
    }
  }, []);

  const hasPermission = useCallback(
    (code: string) => {
      return state.permissions.includes(code);
    },
    [state.permissions]
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
