import request from '../utils/request';

export interface FormulaListParams {
  name?: string;
  page?: number;
  size?: number;
}

export interface FormulaCompositionItem {
  herb_name: string;
  default_dosage: string;
}

export interface FormulaItem {
  id: number;
  name: string;
  effects: string;
  indications: string;
  composition: FormulaCompositionItem[];
  source: string;
  created_at: string;
}

export function listFormulas(params: FormulaListParams) {
  return request.get('/formulas', { params });
}

export function getFormula(id: number) {
  return request.get(`/formulas/${id}`);
}
