import type { MeridianData, BodyModelType, MeridianPathCoords } from './types';
import femaleCoords from './meridian-paths-female';
import maleCoords from './meridian-paths-male';

// ========================================================================
// 经络数据 — 共享元数据 + 模型专属坐标组装
// ========================================================================

/** 经络共享元数据（不含坐标） */
const meridiansMeta: Omit<MeridianData, 'path' | 'internalPath'>[] = [
  {
    id: 'LU',
    name: '手太阴肺经',
    type: 'regular',
    color: '#FF6B6B',
    description: '起于中焦，下络大肠，还循胃口，上膈属肺，从肺系横出腋下，沿上肢内侧前缘下行至拇指端。',
    specialPoints: {
      '井穴': 'LU11', '荥穴': 'LU10', '输穴': 'LU9', '经穴': 'LU8', '合穴': 'LU5',
      '原穴': 'LU9', '络穴': 'LU7', '母穴': 'LU9', '子穴': 'LU5',
    },
  },
  {
    id: 'LI',
    name: '手阳明大肠经',
    type: 'regular',
    color: '#FF9F43',
    description: '起于食指末端，沿上肢外侧前缘上行，经肩、颈，至对侧鼻翼旁。',
    specialPoints: {
      '井穴': 'LI1', '荥穴': 'LI2', '输穴': 'LI3', '经穴': 'LI5', '合穴': 'LI11',
      '原穴': 'LI4', '络穴': 'LI6', '母穴': 'LI11', '子穴': 'LI2',
    },
  },
  {
    id: 'ST',
    name: '足阳明胃经',
    type: 'regular',
    color: '#FECA57',
    description: '起于鼻翼旁，上行至鼻根，沿面部下行至下颌，经颈、胸、腹，沿下肢外侧前缘下行至第二趾端。',
    specialPoints: {
      '井穴': 'ST45', '荥穴': 'ST44', '输穴': 'ST43', '经穴': 'ST41', '合穴': 'ST36',
      '原穴': 'ST42', '络穴': 'ST40', '母穴': 'ST41', '子穴': 'ST45',
    },
  },
  {
    id: 'SP',
    name: '足太阴脾经',
    type: 'regular',
    color: '#FFA502',
    description: '起于足大趾内侧端，沿下肢内侧中线上行，经腹部、胸部至腋下。',
    specialPoints: {
      '井穴': 'SP1', '荥穴': 'SP2', '输穴': 'SP3', '经穴': 'SP5', '合穴': 'SP9',
      '原穴': 'SP3', '络穴': 'SP4', '母穴': 'SP2', '子穴': 'SP5',
    },
  },
  {
    id: 'HT',
    name: '手少阴心经',
    type: 'regular',
    color: '#EE5A24',
    description: '起于心中，出属心系，下膈络小肠，从心系上挟咽，从心系横出至腋下，沿上肢内侧后缘至小指端。',
    specialPoints: {
      '井穴': 'HT9', '荥穴': 'HT8', '输穴': 'HT7', '经穴': 'HT4', '合穴': 'HT3',
      '原穴': 'HT7', '络穴': 'HT5', '母穴': 'HT9', '子穴': 'HT7',
    },
  },
  {
    id: 'SI',
    name: '手太阳小肠经',
    type: 'regular',
    color: '#F368E0',
    description: '起于小指尺侧端，沿上肢外侧后缘上行，经肩胛，绕行面颊至耳前。',
    specialPoints: {
      '井穴': 'SI1', '荥穴': 'SI2', '输穴': 'SI3', '经穴': 'SI5', '合穴': 'SI8',
      '原穴': 'SI4', '络穴': 'SI7', '母穴': 'SI3', '子穴': 'SI8',
    },
  },
  {
    id: 'BL',
    name: '足太阳膀胱经',
    type: 'regular',
    color: '#0ABDE3',
    description: '起于目内眦，上额交巅，从巅入络脑，下项沿脊柱两侧下行至足小趾外侧端。经脉最长，穴位最多。',
    specialPoints: {
      '井穴': 'BL67', '荥穴': 'BL66', '输穴': 'BL65', '经穴': 'BL60', '合穴': 'BL40',
      '原穴': 'BL64', '络穴': 'BL58', '母穴': 'BL67', '子穴': 'BL65',
    },
  },
  {
    id: 'KI',
    name: '足少阴肾经',
    type: 'regular',
    color: '#5F27CD',
    description: '起于足小趾之下，斜走足心涌泉，沿下肢内侧后缘上行，经腹、胸至锁骨下。',
    specialPoints: {
      '井穴': 'KI1', '荥穴': 'KI2', '输穴': 'KI3', '经穴': 'KI7', '合穴': 'KI10',
      '原穴': 'KI3', '络穴': 'KI4', '母穴': 'KI7', '子穴': 'KI1',
    },
  },
  {
    id: 'PC',
    name: '手厥阴心包经',
    type: 'regular',
    color: '#E74C3C',
    description: '起于胸中，出属心包络，下膈，从胸走腋，沿上肢内侧中线至中指端。',
    specialPoints: {
      '井穴': 'PC9', '荥穴': 'PC8', '输穴': 'PC7', '经穴': 'PC5', '合穴': 'PC3',
      '原穴': 'PC7', '络穴': 'PC6', '母穴': 'PC9', '子穴': 'PC7',
    },
  },
  {
    id: 'TE',
    name: '手少阳三焦经',
    type: 'regular',
    color: '#10AC84',
    description: '起于无名指尺侧端，沿上肢外侧中线上行，经肩、颈至耳后、眉梢。',
    specialPoints: {
      '井穴': 'TE1', '荥穴': 'TE2', '输穴': 'TE3', '经穴': 'TE6', '合穴': 'TE10',
      '原穴': 'TE4', '络穴': 'TE5', '母穴': 'TE3', '子穴': 'TE10',
    },
  },
  {
    id: 'GB',
    name: '足少阳胆经',
    type: 'regular',
    color: '#2ED573',
    description: '起于目外眦，上至头角，下耳后，沿颈、肩至躯干侧面，经下肢外侧至第四趾端。',
    specialPoints: {
      '井穴': 'GB44', '荥穴': 'GB43', '输穴': 'GB41', '经穴': 'GB38', '合穴': 'GB34',
      '原穴': 'GB40', '络穴': 'GB37', '母穴': 'GB43', '子穴': 'GB38',
    },
  },
  {
    id: 'LR',
    name: '足厥阴肝经',
    type: 'regular',
    color: '#1DD1A1',
    description: '起于足大趾背侧，沿下肢内侧上行，经阴部绕腹部至胁肋部。',
    specialPoints: {
      '井穴': 'LR1', '荥穴': 'LR2', '输穴': 'LR3', '经穴': 'LR4', '合穴': 'LR8',
      '原穴': 'LR3', '络穴': 'LR5', '母穴': 'LR8', '子穴': 'LR2',
    },
  },
  {
    id: 'RN',
    name: '任脉',
    type: 'extraordinary',
    color: '#54A0FF',
    description: '起于胞中，下出会阴，沿腹胸正中线上行至下唇，为"阴脉之海"。',
  },
  {
    id: 'DU',
    name: '督脉',
    type: 'extraordinary',
    color: '#C8D6E5',
    description: '起于胞中，下出于会阴，沿脊柱里面上行至风府入脑，上巅顶沿前额下行至鼻柱，为"阳脉之海"。',
  },
  {
    id: 'CV',
    name: '冲脉',
    type: 'extraordinary',
    color: '#D980FA',
    description: '起于胞中，与任脉同出，上行挟脐两旁至胸中而散，为"十二经脉之海"。',
  },
  {
    id: 'DM',
    name: '带脉',
    type: 'extraordinary',
    color: '#FDA7DF',
    description: '起于季胁，环绕腰腹一周如束带，约束纵行诸经。',
  },
  {
    id: 'YWM',
    name: '阳维脉',
    type: 'extraordinary',
    color: '#7BED9F',
    description: '起于诸阳之会，维络诸阳经，从外踝上行至头部。',
  },
  {
    id: 'YiWM',
    name: '阴维脉',
    type: 'extraordinary',
    color: '#70A1FF',
    description: '起于诸阴之交，维络诸阴经，从内踝上行至咽喉。',
  },
  {
    id: 'YQM',
    name: '阳跷脉',
    type: 'extraordinary',
    color: '#FFC312',
    description: '起于跟中，从外踝上行，经腿外侧、肩、颈至目内眦。主司下肢运动。',
  },
  {
    id: 'YiQM',
    name: '阴跷脉',
    type: 'extraordinary',
    color: '#9980FA',
    description: '起于跟中，从内踝上行，经腿内侧、腹、胸至目内眦。主司眼睑开合。',
  },
];

// ========================================================================
// 坐标映射表
// ========================================================================
const coordsMap: Record<BodyModelType, Record<string, MeridianPathCoords>> = {
  female: femaleCoords,
  male: maleCoords,
};

// ========================================================================
// 组装函数 — 元数据 + 坐标
// ========================================================================
export function getMeridians(model: BodyModelType = 'female'): MeridianData[] {
  const coords = coordsMap[model];
  return meridiansMeta.map(meta => {
    const c = coords[meta.id];
    return {
      ...meta,
      path: c?.path ?? [],
      internalPath: c?.internalPath,
    };
  });
}

// ========================================================================
// 默认导出 — 兼容现有代码（默认 female 模型）
// ========================================================================
export const meridians: MeridianData[] = getMeridians('female');

export const meridianMap: Record<string, MeridianData> = {};
for (const m of meridians) {
  meridianMap[m.id] = m;
}

export const regularMeridians = meridians.filter(m => m.type === 'regular');
export const extraordinaryMeridians = meridians.filter(m => m.type === 'extraordinary');

/** 按模型获取经络 Map */
export function getMeridianMap(model: BodyModelType): Record<string, MeridianData> {
  const map: Record<string, MeridianData> = {};
  for (const m of getMeridians(model)) {
    map[m.id] = m;
  }
  return map;
}
