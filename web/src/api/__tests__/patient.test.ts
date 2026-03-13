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
import { listPatients, getPatient, createPatient, updatePatient, deletePatient } from '../patient';

describe('patient API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listPatients calls GET /patients with params', async () => {
    const params = { name: 'Zhang', page: 1, size: 20 };
    await listPatients(params);
    expect(request.get).toHaveBeenCalledWith('/patients', { params });
  });

  it('getPatient calls GET /patients/:id', async () => {
    await getPatient(42);
    expect(request.get).toHaveBeenCalledWith('/patients/42');
  });

  it('createPatient calls POST /patients with data', async () => {
    const data = { name: 'Li Si', gender: 'male' };
    await createPatient(data);
    expect(request.post).toHaveBeenCalledWith('/patients', data);
  });

  it('updatePatient calls PUT /patients/:id with data', async () => {
    const data = { name: 'Li Si Updated' };
    await updatePatient(7, data);
    expect(request.put).toHaveBeenCalledWith('/patients/7', data);
  });

  it('deletePatient calls DELETE /patients/:id', async () => {
    await deletePatient(7);
    expect(request.delete).toHaveBeenCalledWith('/patients/7');
  });
});
