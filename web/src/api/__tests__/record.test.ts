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
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  aiAnalyzeDiagnosis,
  getCachedAiAnalysis,
  saveAiAnalysis,
  analyzeTongue,
  findRecordPage,
} from '../record';

describe('record API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listRecords calls GET /records with params', async () => {
    const params = { name: 'Wang', date: '2026-01-01', page: 1, size: 20 };
    await listRecords(params);
    expect(request.get).toHaveBeenCalledWith('/records', { params });
  });

  it('getRecord calls GET /records/:id', async () => {
    await getRecord(10);
    expect(request.get).toHaveBeenCalledWith('/records/10');
  });

  it('createRecord calls POST /records with data', async () => {
    const data = { patient_id: 1, diagnosis: 'test' };
    await createRecord(data);
    expect(request.post).toHaveBeenCalledWith('/records', data);
  });

  it('updateRecord calls PUT /records/:id with data', async () => {
    const data = { diagnosis: 'updated' };
    await updateRecord(10, data);
    expect(request.put).toHaveBeenCalledWith('/records/10', data);
  });

  it('deleteRecord calls DELETE /records/:id', async () => {
    await deleteRecord(10);
    expect(request.delete).toHaveBeenCalledWith('/records/10');
  });

  it('aiAnalyzeDiagnosis calls POST /ai/analyze-diagnosis with timeout', async () => {
    await aiAnalyzeDiagnosis('headache', 5, true);
    expect(request.post).toHaveBeenCalledWith(
      '/ai/analyze-diagnosis',
      { diagnosis: 'headache', record_id: 5, force: true },
      { timeout: 120000 },
    );
  });

  it('aiAnalyzeDiagnosis uses undefined for optional params', async () => {
    await aiAnalyzeDiagnosis('cough');
    expect(request.post).toHaveBeenCalledWith(
      '/ai/analyze-diagnosis',
      { diagnosis: 'cough', record_id: undefined, force: undefined },
      { timeout: 120000 },
    );
  });

  it('getCachedAiAnalysis calls GET /records/:id/ai-analysis', async () => {
    await getCachedAiAnalysis(15);
    expect(request.get).toHaveBeenCalledWith('/records/15/ai-analysis');
  });

  it('saveAiAnalysis calls POST /records/:id/ai-analysis with body', async () => {
    await saveAiAnalysis(15, 'headache', 'analysis result');
    expect(request.post).toHaveBeenCalledWith('/records/15/ai-analysis', {
      diagnosis: 'headache',
      analysis: 'analysis result',
    });
  });

  it('analyzeTongue calls POST /ai/analyze-tongue with timeout', async () => {
    const data = { description: 'red tongue', record_id: 3, force: false };
    await analyzeTongue(data);
    expect(request.post).toHaveBeenCalledWith('/ai/analyze-tongue', data, { timeout: 120000 });
  });

  it('findRecordPage calls GET /records/:id/page with size param', async () => {
    await findRecordPage(10, 30);
    expect(request.get).toHaveBeenCalledWith('/records/10/page', { params: { size: 30 } });
  });

  it('findRecordPage uses default size=20', async () => {
    await findRecordPage(10);
    expect(request.get).toHaveBeenCalledWith('/records/10/page', { params: { size: 20 } });
  });
});
