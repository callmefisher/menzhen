import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import { AuthProvider, useAuth } from './store/auth';
import { ThemeProvider } from './store/theme';
import { AccessibilityProvider, useAccessibility } from './store/accessibility';
import { largeTheme, xlargeTheme, highContrastTokenOverrides } from './theme/accessibilityThemes';
import './styles/accessibility.css';
import AppLayout from './components/Layout';
import { PatientAuthProvider } from './store/patientAuth';
import PatientLayout from './components/PatientLayout';
import type { ReactNode } from 'react';

// Lazy-loaded page components
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));

const RecordList = lazy(() => import('./pages/records/RecordList'));
const RecordForm = lazy(() => import('./pages/records/RecordForm'));
const PatientList = lazy(() => import('./pages/patients/PatientList'));
const PatientDetail = lazy(() => import('./pages/patients/PatientDetail'));
const PatientForm = lazy(() => import('./pages/patients/PatientForm'));
const OpLogList = lazy(() => import('./pages/OpLogList'));
const UserList = lazy(() => import('./pages/settings/UserList'));
const RoleList = lazy(() => import('./pages/settings/RoleList'));
const TenantList = lazy(() => import('./pages/settings/TenantList'));
const SystemConfig = lazy(() => import('./pages/settings/SystemConfig'));
const BackupRestore = lazy(() => import('./pages/settings/BackupRestore'));
const QueueSettings = lazy(() => import('./pages/settings/QueueSettings'));
const AppointmentSlots = lazy(() => import('./pages/settings/AppointmentSlots'));
const PatientPortalSettings = lazy(() => import('./pages/settings/PatientPortalSettings'));
const PowerAdminList = lazy(() => import('./pages/settings/PowerAdminList'));
const HerbSearch = lazy(() => import('./pages/herbs/HerbSearch'));
const FormulaSearch = lazy(() => import('./pages/formulas/FormulaSearch'));
const PulseList = lazy(() => import('./pages/pulses/PulseList'));
const WuyunLiuqi = lazy(() => import('./pages/wuyun/WuyunLiuqi'));
const ClinicalExperienceList = lazy(() => import('./pages/clinical-experience/ClinicalExperienceList'));
const DrugList = lazy(() => import('./pages/inventory/DrugList'));
const SolarTerms = lazy(() => import('./pages/solar-terms/SolarTerms'));
const YijingList = lazy(() => import('./pages/yijing/YijingList'));
const InventoryAlert = lazy(() => import('./pages/inventory/InventoryAlert'));
const FollowUpList = lazy(() => import('./pages/followup/FollowUpList'));
const StatsDashboard = lazy(() => import('./pages/statistics/StatsDashboard'));
const QueueDashboard = lazy(() => import('./pages/queue/QueueDashboard'));
const AppointmentManage = lazy(() => import('./pages/appointments/AppointmentManage'));

const PatientLogin = lazy(() => import('./pages/patient/PatientLogin'));
const PatientHome = lazy(() => import('./pages/patient/PatientHome'));
const PatientAppointment = lazy(() => import('./pages/patient/PatientAppointment'));
const PatientQueue = lazy(() => import('./pages/patient/PatientQueue'));
const PatientRecords = lazy(() => import('./pages/patient/PatientRecords'));
const PatientRecordDetail = lazy(() => import('./pages/patient/PatientRecordDetail'));
const PatientBilling = lazy(() => import('./pages/patient/PatientBilling'));
const PatientMe = lazy(() => import('./pages/patient/PatientMe'));

const MeridianView = lazy(() => import('./pages/meridians/MeridianView'));

function PageLoading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Spin size="large" />
    </div>
  );
}

function PrivateRoute({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/patients" replace />} />
          <Route path="records" element={<RecordList />} />
          <Route path="records/new" element={<RecordForm />} />
          <Route path="records/:id" element={<RecordForm />} />
          <Route path="patients" element={<PatientList />} />
          <Route path="patients/new" element={<PatientForm />} />
          <Route path="patients/:id" element={<PatientDetail />} />
          <Route path="herbs" element={<HerbSearch />} />
          <Route path="formulas" element={<FormulaSearch />} />
          <Route path="pulses" element={<PulseList />} />
          <Route path="meridians" element={<Suspense fallback={<Spin />}><MeridianView /></Suspense>} />
          <Route path="wuyun" element={<WuyunLiuqi />} />
          <Route path="clinical-experience" element={<ClinicalExperienceList />} />
          <Route path="solar-terms" element={<SolarTerms />} />
          <Route path="yijing" element={<YijingList />} />
          <Route path="inventory/drugs" element={<DrugList />} />
          <Route path="inventory/alerts" element={<InventoryAlert />} />
          <Route path="follow-ups" element={<FollowUpList />} />
          <Route path="statistics" element={<StatsDashboard />} />
          <Route path="queue" element={<QueueDashboard />} />
          <Route path="appointments" element={<AppointmentManage />} />
          <Route path="oplogs" element={<OpLogList />} />
          <Route path="settings/users" element={<UserList />} />
          <Route path="settings/roles" element={<RoleList />} />
          <Route path="settings/tenants" element={<TenantList />} />
          <Route path="settings/config" element={<SystemConfig />} />
          <Route path="settings/backup" element={<BackupRestore />} />
          <Route path="settings/queue" element={<QueueSettings />} />
          <Route path="settings/appointment-slots" element={<AppointmentSlots />} />
          <Route path="settings/patient-portal" element={<PatientPortalSettings />} />
          <Route path="settings/power-admins" element={<PowerAdminList />} />
        </Route>
        <Route
          path="/patient/*"
          element={
            <PatientAuthProvider>
              <Routes>
                <Route path="login" element={<PatientLogin />} />
                <Route element={<PatientLayout />}>
                  <Route path="home" element={<PatientHome />} />
                  <Route path="appointments" element={<PatientAppointment />} />
                  <Route path="queue" element={<PatientQueue />} />
                  <Route path="records" element={<PatientRecords />} />
                  <Route path="records/:id" element={<PatientRecordDetail />} />
                  <Route path="billing" element={<PatientBilling />} />
                  <Route path="me" element={<PatientMe />} />
                  <Route index element={<Navigate to="home" replace />} />
                  <Route path="*" element={<Navigate to="home" replace />} />
                </Route>
              </Routes>
            </PatientAuthProvider>
          }
        />
        <Route path="*" element={<Navigate to="/patients" replace />} />
      </Routes>
    </Suspense>
  );
}

const warmTheme = {
  token: {
    colorPrimary: '#52C41A',
    colorBgLayout: '#FAFAF5',
    colorBgContainer: '#FFFEF9',
    borderRadius: 12,
    colorLink: '#52C41A',
    colorLinkHover: '#73D13D',
    fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  },
  components: {
    Table: {
      rowHoverBg: '#FFFEF0',
    },
    Card: {
      colorBgContainer: '#FFFEF9',
    },
    Button: {
      colorPrimary: '#52C41A',
      colorPrimaryHover: '#73D13D',
      colorPrimaryActive: '#389E0D',
      borderRadius: 8,
    },
    Input: {
      borderRadius: 8,
    },
    Select: {
      borderRadius: 8,
    },
    Tag: {
      borderRadiusSM: 10,
    },
    Pagination: {
      colorPrimary: '#52C41A',
    },
  },
};

export default function App() {
  return (
    <AccessibilityProvider>
      <AppInner />
    </AccessibilityProvider>
  );
}

function AppInner() {
  const { mode, highContrast } = useAccessibility();
  const baseTheme = mode === 'xlarge' ? xlargeTheme : mode === 'large' ? largeTheme : warmTheme;
  const currentTheme = highContrast
    ? { ...baseTheme, token: { ...baseTheme.token, ...highContrastTokenOverrides } }
    : baseTheme;

  return (
    <ConfigProvider theme={currentTheme} locale={zhCN}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ConfigProvider>
  );
}
