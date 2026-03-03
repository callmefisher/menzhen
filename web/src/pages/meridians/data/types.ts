export type Vec3 = [number, number, number];

export interface MeridianData {
  id: string;
  name: string;
  type: 'regular' | 'extraordinary';
  color: string;
  description: string;
  path: Vec3[];
  internalPath?: Vec3[];
  specialPoints?: Partial<Record<SpecialPointType, string>>;
}

export type SpecialPointType =
  | '井穴' | '荥穴' | '输穴' | '经穴' | '合穴'
  | '原穴' | '络穴' | '母穴' | '子穴';

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
