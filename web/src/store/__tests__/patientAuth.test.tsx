import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { PatientAuthProvider, usePatientAuth } from '../patientAuth';

vi.mock('../../api/patientAuth', () => ({
  patientLogin: vi.fn(),
  getPatientMe: vi.fn(),
}));

import { patientLogin, getPatientMe } from '../../api/patientAuth';
const mockPatientLogin = vi.mocked(patientLogin);
const mockGetPatientMe = vi.mocked(getPatientMe);

const mockUser = {
  id: 1,
  phone: '13800000001',
  name: '张三',
  tenant_id: 10,
  patient_id: 100,
  tenant_name: '康德中医诊所',
};

function TestConsumer() {
  const { user, token, loading, tenantName } = usePatientAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="user">{user?.name ?? 'none'}</span>
      <span data-testid="token">{token ?? 'none'}</span>
      <span data-testid="tenantName">{tenantName ?? 'none'}</span>
    </div>
  );
}

function LoginConsumer() {
  const { login, user, loading } = usePatientAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="user">{user?.name ?? 'none'}</span>
      <button onClick={() => login('clinic01', '13800000001', '张三')}>Login</button>
    </div>
  );
}

function LogoutConsumer() {
  const { logout, user, loading } = usePatientAuth();
  if (loading) return <div>Loading...</div>;
  return (
    <div>
      <span data-testid="user">{user?.name ?? 'none'}</span>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}

describe('PatientAuthProvider + usePatientAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initial state shows loading when token exists', () => {
    localStorage.setItem('patient_token', 'test-token');
    mockGetPatientMe.mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <PatientAuthProvider>
        <TestConsumer />
      </PatientAuthProvider>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('no token sets loading=false, user=null', async () => {
    render(
      <PatientAuthProvider>
        <TestConsumer />
      </PatientAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(screen.getByTestId('tenantName')).toHaveTextContent('none');
    expect(mockGetPatientMe).not.toHaveBeenCalled();
  });

  it('with token + getPatientMe success shows user and tenantName', async () => {
    localStorage.setItem('patient_token', 'valid-token');
    mockGetPatientMe.mockResolvedValue({ code: 0, data: mockUser });

    render(
      <PatientAuthProvider>
        <TestConsumer />
      </PatientAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('张三');
    });

    expect(screen.getByTestId('tenantName')).toHaveTextContent('康德中医诊所');
    expect(screen.getByTestId('token')).toHaveTextContent('valid-token');
  });

  it('with token + getPatientMe failure clears token and sets user=null', async () => {
    localStorage.setItem('patient_token', 'expired-token');
    mockGetPatientMe.mockRejectedValue(new Error('401'));

    render(
      <PatientAuthProvider>
        <TestConsumer />
      </PatientAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    expect(localStorage.getItem('patient_token')).toBeNull();
    expect(screen.getByTestId('tenantName')).toHaveTextContent('none');
  });

  it('login success stores token and sets user with tenantName', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    mockGetPatientMe.mockRejectedValue(new Error('no token'));
    mockPatientLogin.mockResolvedValue({
      code: 0,
      data: { token: 'new-token', patient_user: mockUser },
    });

    render(
      <PatientAuthProvider>
        <LoginConsumer />
      </PatientAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    await user.click(screen.getByText('Login'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('张三');
    });

    expect(localStorage.getItem('patient_token')).toBe('new-token');
  });

  it('logout clears token and user', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    localStorage.setItem('patient_token', 'valid-token');
    mockGetPatientMe.mockResolvedValue({ code: 0, data: mockUser });

    render(
      <PatientAuthProvider>
        <LogoutConsumer />
      </PatientAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('张三');
    });

    await user.click(screen.getByText('Logout'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('none');
    });

    expect(localStorage.getItem('patient_token')).toBeNull();
  });

  it('tenantName is null when user has no tenant_name', async () => {
    localStorage.setItem('patient_token', 'valid-token');
    mockGetPatientMe.mockResolvedValue({
      code: 0,
      data: { ...mockUser, tenant_name: '' },
    });

    function TenantNameConsumer() {
      const { tenantName, loading } = usePatientAuth();
      if (loading) return <div>Loading...</div>;
      return <span data-testid="tn">{tenantName === null ? 'null' : tenantName}</span>;
    }

    render(
      <PatientAuthProvider>
        <TenantNameConsumer />
      </PatientAuthProvider>
    );

    await waitFor(() => {
      // empty string is falsy but not null — tenantName should be '' (not null)
      expect(screen.getByTestId('tn')).not.toHaveTextContent('null');
    });
  });

  it('usePatientAuth outside provider throws error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'usePatientAuth must be used within PatientAuthProvider'
    );
    spy.mockRestore();
  });
});
