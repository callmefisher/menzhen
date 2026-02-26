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
  notes: string;
  source: string;
  created_at: string;
}

export function listFormulas(params: FormulaListParams) {
  return request.get('/formulas', { params });
}

export function getFormula(id: number) {
  return request.get(`/formulas/${id}`);
}

export function deleteFormula(id: number) {
  return request.delete(`/formulas/${id}`);
}

export function updateFormulaComposition(id: number, composition: FormulaCompositionItem[]) {
  return request.put(`/formulas/${id}/composition`, { composition });
}

export function updateFormulaName(id: number, name: string) {
  return request.put(`/formulas/${id}/name`, { name });
}

export function updateFormulaNotes(id: number, notes: string) {
  return request.put(`/formulas/${id}/notes`, { notes });
}
