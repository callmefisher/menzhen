import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { AuthProvider, useAuth } from './store/auth';
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
import HerbSearch from './pages/herbs/HerbSearch';
import FormulaSearch from './pages/formulas/FormulaSearch';
import type { ReactNode } from 'react';

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
        <Route index element={<Navigate to="/records" replace />} />
        <Route path="records" element={<RecordList />} />
        <Route path="records/new" element={<RecordForm />} />
        <Route path="records/:id" element={<RecordForm />} />
        <Route path="patients" element={<PatientList />} />
        <Route path="patients/new" element={<PatientForm />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="herbs" element={<HerbSearch />} />
        <Route path="formulas" element={<FormulaSearch />} />
        <Route path="oplogs" element={<OpLogList />} />
        <Route path="settings/users" element={<UserList />} />
        <Route path="settings/roles" element={<RoleList />} />
        <Route path="settings/tenants" element={<TenantList />} />
      </Route>
      <Route path="*" element={<Navigate to="/records" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
