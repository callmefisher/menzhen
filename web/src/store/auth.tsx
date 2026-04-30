import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { login as loginApi, getMe, logout as logoutApi } from '../api/auth';
import { getQueueEnabled, getAppointmentEnabled } from '../api/queue-doctor';
import { getSiteLicense, getClinicLicense } from '../api/license';
import { LICENSE_EXPIRED_EVENT } from '../utils/request';

interface User {
  id: number;
  username: string;
  real_name: string;
  tenant_id: number;
  tenant_name?: string;
}

interface AuthState {
  user: User | null;
  permissions: string[];
  token: string | null;
  loading: boolean;
  queueEnabled: boolean;
  appointmentEnabled: boolean;
  managedGroups: string[];
  licenseExpired: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (code: string) => boolean;
  isGlobalAdmin: boolean;
  isSuperAdmin: boolean;
  isPowerAdmin: boolean;
  fetchQueueEnabled: () => Promise<void>;
  fetchAppointmentEnabled: () => Promise<void>;
  checkLicenseStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredToken(): string | null {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
}

function clearStoredToken() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    permissions: [],
    token: getStoredToken(),
    loading: true,
    queueEnabled: true,
    appointmentEnabled: true,
    managedGroups: [],
    licenseExpired: false,
  });

  const fetchQueueEnabled = useCallback(async () => {
    try {
      const res = await getQueueEnabled();
      const body = res as unknown as { data?: { enabled?: boolean } };
      setState(prev => ({ ...prev, queueEnabled: body.data?.enabled ?? true }));
    } catch {
      setState(prev => ({ ...prev, queueEnabled: true }));
    }
  }, []);

  const fetchAppointmentEnabled = useCallback(async () => {
    try {
      const res = await getAppointmentEnabled();
      const body = res as unknown as { data?: { enabled?: boolean } };
      setState(prev => ({ ...prev, appointmentEnabled: body.data?.enabled ?? true }));
    } catch {
      setState(prev => ({ ...prev, appointmentEnabled: true }));
    }
  }, []);

  const checkLicenseStatus = useCallback(async () => {
    try {
      const siteRes = await getSiteLicense() as any;
      const siteData = siteRes.data;
      const siteOk = siteData?.status === 'active' || siteData?.status === 'expiring';

      if (siteOk) {
        setState(prev => ({ ...prev, licenseExpired: false }));
        return;
      }

      try {
        const clinicRes = await getClinicLicense() as any;
        const clinicData = clinicRes.data;
        const clinicOk = clinicData?.status === 'active' || clinicData?.status === 'expiring';
        setState(prev => ({ ...prev, licenseExpired: !clinicOk }));
      } catch {
        setState(prev => ({ ...prev, licenseExpired: true }));
      }
    } catch (err: any) {
      if (err?.response?.status === 403 && err?.response?.data?.message === 'license_required') {
        try {
          const clinicRes = await getClinicLicense() as any;
          const clinicData = clinicRes.data;
          const clinicOk = clinicData?.status === 'active' || clinicData?.status === 'expiring';
          setState(prev => ({ ...prev, licenseExpired: !clinicOk }));
        } catch {
          setState(prev => ({ ...prev, licenseExpired: true }));
        }
      }
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { expired } = (e as CustomEvent).detail;
      setState(prev => ({ ...prev, licenseExpired: expired }));
    };
    window.addEventListener(LICENSE_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(LICENSE_EXPIRED_EVENT, handler);
  }, []);

  // Restore session on mount
  useEffect(() => {
    if (state.token) {
      getMe()
        .then((res) => {
          const meBody = res as unknown as {
            data: { user: User; permissions: string[]; managed_groups?: string[] };
          };
          setState((prev) => ({
            ...prev,
            user: meBody.data.user,
            permissions: meBody.data.permissions || [],
            managedGroups: meBody.data.managed_groups || [],
            loading: false,
          }));
          if (meBody.data.user.tenant_name) {
            document.title = meBody.data.user.tenant_name;
          }
          fetchQueueEnabled();
          fetchAppointmentEnabled();
          checkLicenseStatus();
        })
        .catch(() => {
          clearStoredToken();
          setState({
            user: null,
            permissions: [],
            token: null,
            loading: false,
            queueEnabled: true,
            appointmentEnabled: true,
            managedGroups: [],
            licenseExpired: false,
          });
        });
    } else {
      setState((prev) => ({ ...prev, loading: false }));
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (username: string, password: string, remember?: boolean) => {
    const res = await loginApi({ username, password });
    const body = res as unknown as {
      data: { token: string; user: User; permissions: string[]; managed_groups?: string[] };
    };
    // Clear both storages first, then store in the appropriate one
    clearStoredToken();
    if (remember) {
      localStorage.setItem('token', body.data.token);
    } else {
      sessionStorage.setItem('token', body.data.token);
    }
    setState({
      user: body.data.user,
      permissions: body.data.permissions || [],
      token: body.data.token,
      loading: false,
      queueEnabled: true,
      appointmentEnabled: true,
      managedGroups: body.data.managed_groups || [],
      licenseExpired: false,
    });
    if (body.data.user.tenant_name) {
      document.title = body.data.user.tenant_name;
    }
    // Fetch actual feature toggles after login
    try {
      const qRes = await getQueueEnabled();
      const qBody = qRes as unknown as { data?: { enabled?: boolean } };
      setState(prev => ({ ...prev, queueEnabled: qBody.data?.enabled ?? true }));
    } catch { /* keep default true */ }
    try {
      const aRes = await getAppointmentEnabled();
      const aBody = aRes as unknown as { data?: { enabled?: boolean } };
      setState(prev => ({ ...prev, appointmentEnabled: aBody.data?.enabled ?? true }));
    } catch { /* keep default true */ }
    checkLicenseStatus();
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } finally {
      clearStoredToken();
      setState({
        user: null,
        permissions: [],
        token: null,
        loading: false,
        queueEnabled: true,
        appointmentEnabled: true,
        managedGroups: [],
        licenseExpired: false,
      });
    }
  }, []);

  const hasPermission = useCallback(
    (code: string) => {
      return state.permissions.includes(code);
    },
    [state.permissions]
  );

  const isGlobalAdmin = state.permissions.includes('user:manage');
  const isSuperAdmin = state.user?.username === 'admin' && isGlobalAdmin;
  const isPowerAdmin = (state.managedGroups?.length ?? 0) > 0 && !isSuperAdmin;

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        hasPermission,
        isGlobalAdmin,
        isSuperAdmin,
        isPowerAdmin,
        fetchQueueEnabled,
        fetchAppointmentEnabled,
        checkLicenseStatus,
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
