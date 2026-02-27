export type Vec3 = [number, number, number];

export interface MeridianData {
  id: string;
  name: string;
  type: 'regular' | 'extraordinary';
  color: string;
  description: string;
  path: Vec3[];
  internalPath?: Vec3[];
}

export interface AcupointData {
  code: string;
  name: string;
  meridianId: string;
  position: Vec3;
  effects: string;
  indications: string;
  contraindications?: string;
  method: string;
  location?: string;
}
