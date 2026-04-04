import request from '../utils/request';

export interface DailyTrendItem {
  date: string;
  revenue: number;
  consultation_fee: number;
  drug_fee: number;
  record_count: number;
  new_patient_count: number;
  returning_patient_count: number;
}

export interface DashboardSummary {
  total_revenue: number;
  total_records: number;
  total_patients: number;
  avg_revenue_per_record: number;
  revenue_change_percent: number | null;
  records_change_percent: number | null;
  patients_change_percent: number | null;
  cure_rate: number | null;
  cure_rate_change_percent: number | null;
}

export interface RevenueBreakdown {
  consultation_fee_total: number;
  drug_fee_total: number;
}

export interface PatientBreakdown {
  new_patients: number;
  returning_patients: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  daily_trend: DailyTrendItem[];
  revenue_breakdown: RevenueBreakdown;
  patient_breakdown: PatientBreakdown;
}

export function getDashboard(startDate: string, endDate: string, tenantId?: number) {
  return request.get<{ code: number; data: DashboardData }>('/statistics/dashboard', {
    params: { start_date: startDate, end_date: endDate, ...(tenantId ? { tenant_id: tenantId } : {}) },
  });
}

export interface StaffRevenueItem {
  user_id: number;
  real_name: string;
  revenue: number;
  consultation_fee: number;
  drug_fee: number;
  record_count: number;
  avg_per_record: number;
  revenue_percent: number;
}

export interface StaffRevenueSummary {
  total_revenue: number;
  total_records: number;
  staff_count: number;
  avg_per_record: number;
}

export interface StaffRevenueData {
  summary: StaffRevenueSummary;
  staff: StaffRevenueItem[];
}

export function getStaffRevenue(startDate: string, endDate: string) {
  return request.get<{ code: number; data: StaffRevenueData }>('/statistics/staff', {
    params: { start_date: startDate, end_date: endDate },
  });
}

// ── Global stats (superAdmin only) ──────────────────────────────────────────

export interface GlobalTenantItem {
  tenant_id: number;
  tenant_name: string;
  revenue: number;
  records: number;
  patients: number;
  avg_per_record: number;
  revenue_percent: number;
}

export interface GlobalSummary {
  total_revenue: number;
  total_records: number;
  total_patients: number;
  avg_revenue_per_record: number;
  tenant_count: number;
}

export interface GlobalStatsData {
  total: number; // total tenant count for pagination (from GlobalStatsResult.Total)
  summary: GlobalSummary;
  tenants: GlobalTenantItem[];
}

export function getGlobalStats(
  startDate: string,
  endDate: string,
  page = 1,
  size = 50,
) {
  return request.get<{ code: number; data: GlobalStatsData }>(
    '/admin/statistics/global',
    { params: { start_date: startDate, end_date: endDate, page, size } },
  );
}
