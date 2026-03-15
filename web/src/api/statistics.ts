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

export function getDashboard(startDate: string, endDate: string) {
  return request.get<{ code: number; data: DashboardData }>('/statistics/dashboard', {
    params: { start_date: startDate, end_date: endDate },
  });
}
