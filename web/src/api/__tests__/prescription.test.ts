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
  createPrescription,
  getPrescription,
  listPrescriptionsByRecord,
  updatePrescription,
  deletePrescription,
} from '../prescription';

describe('prescription API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createPrescription calls POST /prescriptions with data', async () => {
    const data = {
      record_id: 1,
      formula_name: 'Test Formula',
      total_doses: 7,
      notes: 'note',
      items: [{ herb_name: 'Huang Qi', dosage: '15g', sort_order: 1 }],
    };
    await createPrescription(data);
    expect(request.post).toHaveBeenCalledWith('/prescriptions', data);
  });

  it('getPrescription calls GET /prescriptions/:id', async () => {
    await getPrescription(5);
    expect(request.get).toHaveBeenCalledWith('/prescriptions/5');
  });

  it('listPrescriptionsByRecord calls GET /records/:id/prescriptions', async () => {
    await listPrescriptionsByRecord(10);
    expect(request.get).toHaveBeenCalledWith('/records/10/prescriptions');
  });

  it('updatePrescription calls PUT /prescriptions/:id with data', async () => {
    const data = { formula_name: 'Updated', total_doses: 14 };
    await updatePrescription(5, data);
    expect(request.put).toHaveBeenCalledWith('/prescriptions/5', data);
  });

  it('deletePrescription calls DELETE /prescriptions/:id', async () => {
    await deletePrescription(5);
    expect(request.delete).toHaveBeenCalledWith('/prescriptions/5');
  });
});
