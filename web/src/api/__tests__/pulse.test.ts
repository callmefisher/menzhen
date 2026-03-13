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
import { listPulses, getPulse, createPulse, updatePulse, deletePulse, listPulseCategories } from '../pulse';

describe('pulse API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listPulses calls GET /pulses with params', async () => {
    const params = { name: 'fu', category: 'basic', page: 1, size: 20 };
    await listPulses(params);
    expect(request.get).toHaveBeenCalledWith('/pulses', { params });
  });

  it('getPulse calls GET /pulses/:id', async () => {
    await getPulse(6);
    expect(request.get).toHaveBeenCalledWith('/pulses/6');
  });

  it('createPulse calls POST /pulses with data', async () => {
    const data = {
      name: 'Fu Mai',
      category: 'basic',
      description: 'Floating pulse',
      clinical_meaning: 'Exterior syndrome',
      common_conditions: 'Common cold',
    };
    await createPulse(data);
    expect(request.post).toHaveBeenCalledWith('/pulses', data);
  });

  it('updatePulse calls PUT /pulses/:id with data', async () => {
    const data = { description: 'Updated description' };
    await updatePulse(6, data);
    expect(request.put).toHaveBeenCalledWith('/pulses/6', data);
  });

  it('deletePulse calls DELETE /pulses/:id', async () => {
    await deletePulse(6);
    expect(request.delete).toHaveBeenCalledWith('/pulses/6');
  });

  it('listPulseCategories calls GET /pulses/categories', async () => {
    await listPulseCategories();
    expect(request.get).toHaveBeenCalledWith('/pulses/categories');
  });
});
