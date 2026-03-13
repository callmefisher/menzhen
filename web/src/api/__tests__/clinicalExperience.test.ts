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
  listClinicalExperiences,
  getClinicalExperience,
  createClinicalExperience,
  updateClinicalExperience,
  deleteClinicalExperience,
  listClinicalExperienceCategories,
} from '../clinicalExperience';

describe('clinicalExperience API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listClinicalExperiences calls GET /clinical-experiences with params', async () => {
    const params = { keyword: 'headache', category: 'internal', page: 1, size: 20 };
    await listClinicalExperiences(params);
    expect(request.get).toHaveBeenCalledWith('/clinical-experiences', { params });
  });

  it('getClinicalExperience calls GET /clinical-experiences/:id', async () => {
    await getClinicalExperience(9);
    expect(request.get).toHaveBeenCalledWith('/clinical-experiences/9');
  });

  it('createClinicalExperience calls POST /clinical-experiences with data', async () => {
    const data = {
      source: 'Dr. Zhang',
      category: 'internal',
      herbs: 'Huang Qi, Dang Gui',
      formula: 'Bu Zhong Yi Qi Tang',
      experience: 'Effective for qi deficiency',
    };
    await createClinicalExperience(data);
    expect(request.post).toHaveBeenCalledWith('/clinical-experiences', data);
  });

  it('updateClinicalExperience calls PUT /clinical-experiences/:id with data', async () => {
    const data = { experience: 'Updated experience text' };
    await updateClinicalExperience(9, data);
    expect(request.put).toHaveBeenCalledWith('/clinical-experiences/9', data);
  });

  it('deleteClinicalExperience calls DELETE /clinical-experiences/:id', async () => {
    await deleteClinicalExperience(9);
    expect(request.delete).toHaveBeenCalledWith('/clinical-experiences/9');
  });

  it('listClinicalExperienceCategories calls GET /clinical-experiences/categories', async () => {
    await listClinicalExperienceCategories();
    expect(request.get).toHaveBeenCalledWith('/clinical-experiences/categories');
  });
});
