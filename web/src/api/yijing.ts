import request from '../utils/request';

export interface YaoText {
  position: number;
  name: string;
  text: string;
}

export interface RelatedHexagrams {
  mutual: string;
  opposite: string;
  reverse: string;
}

export interface HexagramItem {
  id: number;
  number: number;
  name: string;
  symbol: string;
  upper_trigram: string;
  lower_trigram: string;
  judgment: string;
  yao_texts: YaoText[] | null;
  commentary: string;
  tcm_application: string;
  related_hexagrams: RelatedHexagrams | null;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface HexagramListParams {
  name?: string;
  upper_trigram?: string;
  lower_trigram?: string;
  page?: number;
  size?: number;
}

export function listHexagrams(params: HexagramListParams) {
  return request.get('/hexagrams', { params });
}

export function getHexagram(id: number) {
  return request.get(`/hexagrams/${id}`);
}

export function createHexagram(data: Partial<HexagramItem>) {
  return request.post('/hexagrams', data);
}

export function updateHexagram(id: number, data: Partial<HexagramItem>) {
  return request.put(`/hexagrams/${id}`, data);
}

export function deleteHexagram(id: number) {
  return request.delete(`/hexagrams/${id}`);
}

export function listTrigrams() {
  return request.get('/hexagrams/trigrams');
}
