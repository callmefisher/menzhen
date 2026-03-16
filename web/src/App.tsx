import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin, ConfigProvider } from 'antd';
import { AuthProvider, useAuth } from './store/auth';
import { ThemeProvider } from './store/theme';
import AppLayout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import RecordList from './pages/records/RecordList';
import RecordForm from './pages/records/RecordForm';
import PatientList from './pages/patients/PatientList';
import PatientDetail from './pages/patients/PatientDetail';
import PatientForm from './pages/patients/PatientForm';
import OpLogList from './pages/OpLogList';
import UserList from './pages/settings/UserList';
import RoleList from './pages/settings/RoleList';
import TenantList from './pages/settings/TenantList';
import SystemConfig from './pages/settings/SystemConfig';
import HerbSearch from './pages/herbs/HerbSearch';
import FormulaSearch from './pages/formulas/FormulaSearch';
import PulseList from './pages/pulses/PulseList';
import WuyunLiuqi from './pages/wuyun/WuyunLiuqi';
import ClinicalExperienceList from './pages/clinical-experience/ClinicalExperienceList';
import DrugList from './pages/inventory/DrugList';
import SolarTerms from './pages/solar-terms/SolarTerms';
import YijingList from './pages/yijing/YijingList';
import InventoryAlert from './pages/inventory/InventoryAlert';
import FollowUpList from './pages/followup/FollowUpList';
import StatsDashboard from './pages/statistics/StatsDashboard';
import type { ReactNode } from 'react';

const MeridianView = lazy(() => import('./pages/meridians/MeridianView'));

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
        <Route path="oplogs" element={<OpLogList />} />
        <Route path="settings/users" element={<UserList />} />
        <Route path="settings/roles" element={<RoleList />} />
        <Route path="settings/tenants" element={<TenantList />} />
        <Route path="settings/config" element={<SystemConfig />} />
      </Route>
      <Route path="*" element={<Navigate to="/patients" replace />} />
    </Routes>
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
    <ConfigProvider theme={warmTheme}>
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
