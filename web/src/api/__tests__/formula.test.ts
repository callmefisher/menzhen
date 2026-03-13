import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/request', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import request from '../../utils/request';
import {
  listFormulas,
  getFormula,
  deleteFormula,
  updateFormulaComposition,
  updateFormulaName,
  updateFormulaNotes,
} from '../formula';

describe('formula API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listFormulas calls GET /formulas with params', async () => {
    const params = { name: 'gui', page: 1, size: 20 };
    await listFormulas(params);
    expect(request.get).toHaveBeenCalledWith('/formulas', { params });
  });

  it('getFormula calls GET /formulas/:id', async () => {
    await getFormula(8);
    expect(request.get).toHaveBeenCalledWith('/formulas/8');
  });

  it('deleteFormula calls DELETE /formulas/:id', async () => {
    await deleteFormula(8);
    expect(request.delete).toHaveBeenCalledWith('/formulas/8');
  });

  it('updateFormulaComposition calls PUT /formulas/:id/composition', async () => {
    const composition = [{ herb_name: 'Huang Qi', default_dosage: '15g' }];
    await updateFormulaComposition(8, composition);
    expect(request.put).toHaveBeenCalledWith('/formulas/8/composition', { composition });
  });

  it('updateFormulaName calls PUT /formulas/:id/name', async () => {
    await updateFormulaName(8, 'New Name');
    expect(request.put).toHaveBeenCalledWith('/formulas/8/name', { name: 'New Name' });
  });

  it('updateFormulaNotes calls PUT /formulas/:id/notes', async () => {
    await updateFormulaNotes(8, 'Some notes');
    expect(request.put).toHaveBeenCalledWith('/formulas/8/notes', { notes: 'Some notes' });
  });
});
