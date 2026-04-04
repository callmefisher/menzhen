import {
  createContext, useContext, useState, useEffect, useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { patientLogin, getPatientMe } from '../api/patientAuth';
import type { PatientUserDTO } from '../api/patientAuth';

interface PatientAuthState {
  user: PatientUserDTO | null;
  token: string | null;
  loading: boolean;
}

interface PatientAuthContextValue extends PatientAuthState {
  login: (tenantCode: string, phone: string, name: string) => Promise<void>;
  logout: () => void;
  tenantName: string | null;  // derived from user?.tenant_name
}

const PatientAuthContext = createContext<PatientAuthContextValue | null>(null);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PatientAuthState>({
    user: null,
    token: localStorage.getItem('patient_token'),
    loading: true,
  });

  useEffect(() => {
    if (state.token) {
      getPatientMe()
        .then((res) => {
          setState((prev) => ({ ...prev, user: res.data, loading: false }));
        })
        .catch(() => {
          localStorage.removeItem('patient_token');
          setState({ user: null, token: null, loading: false });
        });
    } else {
      setState((prev) => ({ ...prev, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (tenantCode: string, phone: string, name: string) => {
    const res = await patientLogin({ tenant_code: tenantCode, phone, name });
    localStorage.setItem('patient_token', res.data.token);
    // Persist last-used credentials so login page can pre-fill after logout
    localStorage.setItem('patient_last_tenant_code', tenantCode);
    localStorage.setItem('patient_last_phone', phone);
    localStorage.setItem('patient_last_name', name);
    const tenantName = res.data.patient_user?.tenant_name ?? '';
    if (tenantName) {
      localStorage.setItem('patient_last_tenant_name', tenantName);
    } else {
      localStorage.removeItem('patient_last_tenant_name');
    }
    setState({
      user: res.data.patient_user,
      token: res.data.token,
      loading: false,
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('patient_token');
    setState({ user: null, token: null, loading: false });
  }, []);

  const value: PatientAuthContextValue = {
    ...state,
    login,
    logout,
    tenantName: state.user?.tenant_name ?? null,
  };

  return (
    <PatientAuthContext.Provider value={value}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth(): PatientAuthContextValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
