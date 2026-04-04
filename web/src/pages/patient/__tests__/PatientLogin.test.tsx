import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PatientLogin from '../PatientLogin';

// Mock the patientAuth store
vi.mock('../../../store/patientAuth', () => ({
  usePatientAuth: vi.fn(),
}));

// Mock the patientAuth API
vi.mock('../../../api/patientAuth', () => ({
  getTenantInfo: vi.fn(),
  listTenantsByPhone: vi.fn(),
}));

import { usePatientAuth } from '../../../store/patientAuth';
import { getTenantInfo, listTenantsByPhone } from '../../../api/patientAuth';

const mockUsePatientAuth = vi.mocked(usePatientAuth);
const mockGetTenantInfo = vi.mocked(getTenantInfo);
const mockListTenantsByPhone = vi.mocked(listTenantsByPhone);

const mockLoginFn = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderWithRouter(url = '/patient/login') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PatientLogin />
    </MemoryRouter>
  );
}

describe('PatientLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUsePatientAuth.mockReturnValue({
      token: null,
      user: null,
      loading: false,
      login: mockLoginFn,
      logout: vi.fn(),
      tenantName: null,
    });
  });

  // 1. Default header shows "患者服务中心" with no code param
  it('shows default header when no code param', () => {
    mockGetTenantInfo.mockResolvedValue({ code: 0, data: { tenant_name: '', tenant_code: '' } });
    renderWithRouter('/patient/login');
    expect(screen.getByText('患者服务中心')).toBeInTheDocument();
    expect(screen.queryByText('患者端')).not.toBeInTheDocument();
  });

  // 2. With ?code=clinic01 fetches tenant info and shows clinic name
  it('fetches clinic name from ?code= param and shows it in header', async () => {
    mockGetTenantInfo.mockResolvedValue({
      code: 0,
      data: { tenant_name: '康德中医诊所', tenant_code: 'clinic01' },
    });

    renderWithRouter('/patient/login?code=clinic01');

    await waitFor(() => {
      expect(screen.getByText('康德中医诊所')).toBeInTheDocument();
    });

    expect(screen.getByText('患者端')).toBeInTheDocument();
    expect(mockGetTenantInfo).toHaveBeenCalledWith('clinic01');
  });

  // 3. getTenantInfo fails → silently falls back to default title
  it('falls back to default title when getTenantInfo fails', async () => {
    mockGetTenantInfo.mockRejectedValue(new Error('network error'));

    renderWithRouter('/patient/login?code=bad-code');

    await waitFor(() => {
      expect(mockGetTenantInfo).toHaveBeenCalled();
    });

    expect(screen.getByText('患者服务中心')).toBeInTheDocument();
    expect(screen.queryByText('患者端')).not.toBeInTheDocument();
  });

  // 4. Login with tenant_code directly calls login()
  it('logs in directly when tenant_code is filled', async () => {
    const user = userEvent.setup();
    mockLoginFn.mockResolvedValue(undefined);
    renderWithRouter('/patient/login');

    await user.type(screen.getByPlaceholderText('扫码自动填写（可选）'), 'clinic01');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000001');
    await user.type(screen.getByPlaceholderText('请输入就诊时使用的真实姓名'), '张三');
    await user.click(screen.getByText('登录 / 注册'));

    await waitFor(() => {
      expect(mockLoginFn).toHaveBeenCalledWith('clinic01', '13800000001', '张三');
    });
  });

  // 5. No tenant code + single tenant → auto login
  it('auto-logins when phone lookup returns exactly one tenant', async () => {
    const user = userEvent.setup();
    mockLoginFn.mockResolvedValue(undefined);
    mockListTenantsByPhone.mockResolvedValue({
      code: 0,
      data: [{ tenant_id: 10, tenant_name: '康德中医诊所', tenant_code: 'clinic01' }],
    });

    renderWithRouter('/patient/login');

    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000001');
    await user.type(screen.getByPlaceholderText('请输入就诊时使用的真实姓名'), '张三');
    await user.click(screen.getByText('登录 / 注册'));

    await waitFor(() => {
      expect(mockLoginFn).toHaveBeenCalledWith('clinic01', '13800000001', '张三');
    });
  });

  // 6. No tenant code + no records → shows warning
  it('shows warning when no clinics found for phone', async () => {
    const user = userEvent.setup();
    mockListTenantsByPhone.mockResolvedValue({ code: 0, data: [] });

    renderWithRouter('/patient/login');

    await user.type(screen.getByPlaceholderText('请输入手机号'), '13900000099');
    await user.type(screen.getByPlaceholderText('请输入就诊时使用的真实姓名'), '李四');
    await user.click(screen.getByText('登录 / 注册'));

    await waitFor(() => {
      expect(mockListTenantsByPhone).toHaveBeenCalledWith('13900000099');
    });

    expect(mockLoginFn).not.toHaveBeenCalled();
  });

  // 7. Multiple tenants → shows clinic selection modal
  it('opens clinic selection modal when multiple tenants found', async () => {
    const user = userEvent.setup();
    mockListTenantsByPhone.mockResolvedValue({
      code: 0,
      data: [
        { tenant_id: 10, tenant_name: '康德中医诊所', tenant_code: 'clinic01' },
        { tenant_id: 20, tenant_name: '仁心门诊', tenant_code: 'clinic02' },
      ],
    });

    renderWithRouter('/patient/login');

    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000001');
    await user.type(screen.getByPlaceholderText('请输入就诊时使用的真实姓名'), '张三');
    await user.click(screen.getByText('登录 / 注册'));

    await waitFor(() => {
      expect(screen.getByText('请选择诊所')).toBeInTheDocument();
    });

    expect(screen.getByText('康德中医诊所')).toBeInTheDocument();
    expect(screen.getByText('仁心门诊')).toBeInTheDocument();
  });

  // 8. Selecting clinic from modal calls login with correct tenant code
  it('calls login with selected tenant code from modal', async () => {
    const user = userEvent.setup();
    mockLoginFn.mockResolvedValue(undefined);
    mockListTenantsByPhone.mockResolvedValue({
      code: 0,
      data: [
        { tenant_id: 10, tenant_name: '康德中医诊所', tenant_code: 'clinic01' },
        { tenant_id: 20, tenant_name: '仁心门诊', tenant_code: 'clinic02' },
      ],
    });

    renderWithRouter('/patient/login');

    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000001');
    await user.type(screen.getByPlaceholderText('请输入就诊时使用的真实姓名'), '张三');
    await user.click(screen.getByText('登录 / 注册'));

    await waitFor(() => {
      expect(screen.getByText('仁心门诊')).toBeInTheDocument();
    });

    await user.click(screen.getByText('仁心门诊'));

    await waitFor(() => {
      expect(mockLoginFn).toHaveBeenCalledWith('clinic02', '13800000001', '张三');
    });
  });

  // 9. Form validation: phone required
  it('shows validation error for missing phone', async () => {
    const user = userEvent.setup();
    renderWithRouter('/patient/login');

    await user.type(screen.getByPlaceholderText('请输入就诊时使用的真实姓名'), '张三');
    await user.click(screen.getByText('登录 / 注册'));

    await waitFor(() => {
      expect(screen.getByText('请输入手机号')).toBeInTheDocument();
    });

    expect(mockLoginFn).not.toHaveBeenCalled();
    expect(mockListTenantsByPhone).not.toHaveBeenCalled();
  });

  // 10. Form validation: invalid phone format
  it('shows validation error for invalid phone format', async () => {
    const user = userEvent.setup();
    renderWithRouter('/patient/login');

    await user.type(screen.getByPlaceholderText('请输入手机号'), '12345');
    await user.type(screen.getByPlaceholderText('请输入就诊时使用的真实姓名'), '张三');
    await user.click(screen.getByText('登录 / 注册'));

    await waitFor(() => {
      expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument();
    });
  });

  // 11. localStorage pre-fill: all four values present → form pre-filled, no API call
  it('pre-fills all fields from localStorage when no ?code= param', async () => {
    localStorage.setItem('patient_last_tenant_code', 'clinic01');
    localStorage.setItem('patient_last_tenant_name', '康德中医诊所');
    localStorage.setItem('patient_last_phone', '13800000001');
    localStorage.setItem('patient_last_name', '张三');

    renderWithRouter('/patient/login');

    await waitFor(() => {
      expect(screen.getByText('康德中医诊所')).toBeInTheDocument();
    });

    expect(mockGetTenantInfo).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('13800000001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('张三')).toBeInTheDocument();
  });

  // 12. localStorage pre-fill: code without tenant_name → falls back to getTenantInfo
  it('calls getTenantInfo when localStorage has code but no tenant_name', async () => {
    localStorage.setItem('patient_last_tenant_code', 'clinic01');
    mockGetTenantInfo.mockResolvedValue({
      code: 0,
      data: { tenant_name: '康德中医诊所', tenant_code: 'clinic01' },
    });

    renderWithRouter('/patient/login');

    await waitFor(() => {
      expect(screen.getByText('康德中医诊所')).toBeInTheDocument();
    });

    expect(mockGetTenantInfo).toHaveBeenCalledWith('clinic01');
  });

  // 13. localStorage pre-fill: partial values (code+name only, no phone)
  it('pre-fills only available fields from localStorage', async () => {
    localStorage.setItem('patient_last_tenant_code', 'clinic01');
    localStorage.setItem('patient_last_tenant_name', '康德中医诊所');
    localStorage.setItem('patient_last_name', '李四');
    // no patient_last_phone

    renderWithRouter('/patient/login');

    await waitFor(() => {
      expect(screen.getByText('康德中医诊所')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('李四')).toBeInTheDocument();
    // phone field should be empty
    expect(screen.getByPlaceholderText('请输入手机号')).toHaveValue('');
  });

  // 14. ?code= param takes priority over localStorage
  it('URL ?code= param overrides localStorage pre-fill', async () => {
    localStorage.setItem('patient_last_tenant_code', 'old_clinic');
    localStorage.setItem('patient_last_tenant_name', '旧诊所');
    mockGetTenantInfo.mockResolvedValue({
      code: 0,
      data: { tenant_name: '新诊所', tenant_code: 'new_clinic' },
    });

    renderWithRouter('/patient/login?code=new_clinic');

    await waitFor(() => {
      expect(screen.getByText('新诊所')).toBeInTheDocument();
    });

    expect(mockGetTenantInfo).toHaveBeenCalledWith('new_clinic');
    expect(mockGetTenantInfo).not.toHaveBeenCalledWith('old_clinic');
  });
});
