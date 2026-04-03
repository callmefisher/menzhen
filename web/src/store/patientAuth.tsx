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
  tenantName: string | null;
}

interface PatientAuthContextValue extends PatientAuthState {
  login: (tenantCode: string, phone: string, name: string) => Promise<void>;
  logout: () => void;
}

const PatientAuthContext = createContext<PatientAuthContextValue | null>(null);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PatientAuthState>({
    user: null,
    token: localStorage.getItem('patient_token'),
    loading: true,
    tenantName: null,
  });

  useEffect(() => {
    if (state.token) {
      getPatientMe()
        .then((res) => {
          setState((prev) => ({ ...prev, user: res.data, tenantName: res.data.tenant_name, loading: false }));
        })
        .catch(() => {
          localStorage.removeItem('patient_token');
          setState({ user: null, token: null, loading: false, tenantName: null });
        });
    } else {
      setState((prev) => ({ ...prev, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (tenantCode: string, phone: string, name: string) => {
    const res = await patientLogin({ tenant_code: tenantCode, phone, name });
    localStorage.setItem('patient_token', res.data.token);
    setState({
      user: res.data.patient_user,
      token: res.data.token,
      loading: false,
      tenantName: res.data.patient_user.tenant_name,
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('patient_token');
    setState({ user: null, token: null, loading: false, tenantName: null });
  }, []);

  return (
    <PatientAuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth(): PatientAuthContextValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
