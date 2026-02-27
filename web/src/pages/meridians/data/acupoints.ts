import type { AcupointData } from './types';

export const acupoints: AcupointData[] = [
  // ========== 手太阴肺经 (LU) ==========
  { code: 'LU1', name: '中府', meridianId: 'LU', position: [-0.15, 1.28, 0.10], effects: '宣肺止咳、清泻肺热', indications: '咳嗽、气喘、胸痛、肩背痛', method: '向外斜刺0.5-0.8寸' },
  { code: 'LU2', name: '云门', meridianId: 'LU', position: [-0.18, 1.30, 0.08], effects: '宣肺理气、清热除烦', indications: '咳嗽、气喘、胸痛', method: '向外斜刺0.5-0.8寸' },
  { code: 'LU3', name: '天府', meridianId: 'LU', position: [-0.24, 1.28, 0.03], effects: '宣肺止血、清热安神', indications: '气喘、鼻衄、上臂痛', method: '直刺0.5-1寸' },
  { code: 'LU5', name: '尺泽', meridianId: 'LU', position: [-0.30, 1.14, 0.02], effects: '清肺泻火、和胃降逆', indications: '咳嗽、咯血、肘臂痛', method: '直刺0.8-1.2寸' },
  { code: 'LU6', name: '孔最', meridianId: 'LU', position: [-0.33, 1.06, 0.02], effects: '清热止血、润肺理气', indications: '咳血、咽喉肿痛、肘臂痛', method: '直刺0.5-1寸' },
  { code: 'LU7', name: '列缺', meridianId: 'LU', position: [-0.37, 0.86, 0.02], effects: '宣肺解表、通经活络', indications: '头痛、咳嗽、手腕痛', method: '向肘方向斜刺0.3-0.5寸' },
  { code: 'LU9', name: '太渊', meridianId: 'LU', position: [-0.40, 0.80, 0.01], effects: '补肺益气、止咳化痰', indications: '咳嗽、气喘、腕痛、无脉症', method: '避开桡动脉，直刺0.3-0.5寸' },
  { code: 'LU10', name: '鱼际', meridianId: 'LU', position: [-0.42, 0.76, 0.01], effects: '清肺热、利咽喉', indications: '咳嗽、咯血、咽喉肿痛', method: '直刺0.5-0.8寸' },
  { code: 'LU11', name: '少商', meridianId: 'LU', position: [-0.44, 0.70, 0.02], effects: '清热利咽、开窍醒神', indications: '咽喉肿痛、中风昏迷、发热', method: '浅刺0.1寸或三棱针点刺放血' },

  // ========== 手阳明大肠经 (LI) ==========
  { code: 'LI1', name: '商阳', meridianId: 'LI', position: [-0.46, 0.72, 0.0], effects: '清热解表、开窍醒神', indications: '咽喉肿痛、牙痛、手指麻木', method: '浅刺0.1寸或点刺放血' },
  { code: 'LI4', name: '合谷', meridianId: 'LI', position: [-0.42, 0.76, -0.01], effects: '疏风解表、通络止痛', indications: '头痛、目赤、鼻衄、牙痛、面瘫', method: '直刺0.5-1寸，孕妇禁针' },
  { code: 'LI5', name: '阳溪', meridianId: 'LI', position: [-0.40, 0.78, -0.01], effects: '清热散风、通利关节', indications: '头痛、目赤、耳聋、腕痛', method: '直刺0.3-0.5寸' },
  { code: 'LI10', name: '手三里', meridianId: 'LI', position: [-0.34, 1.00, -0.01], effects: '通经活络、清热明目', indications: '手臂痛、腹泻、齿痛', method: '直刺0.8-1.2寸' },
  { code: 'LI11', name: '曲池', meridianId: 'LI', position: [-0.32, 1.08, -0.01], effects: '清热和营、降逆活络', indications: '发热、高血压、上肢痹痛、皮肤病', method: '直刺1-1.5寸' },
  { code: 'LI15', name: '肩髃', meridianId: 'LI', position: [-0.18, 1.30, -0.01], effects: '通经活络、疏散风热', indications: '肩臂痛、上肢不遂、风疹', method: '直刺或向下斜刺0.8-1.5寸' },
  { code: 'LI20', name: '迎香', meridianId: 'LI', position: [0.03, 1.54, 0.09], effects: '祛风通窍、宣肺利鼻', indications: '鼻塞、鼻衄、口歪、面痒', method: '略向内上方斜刺0.3-0.5寸' },

  // ========== 足阳明胃经 (ST) ==========
  { code: 'ST1', name: '承泣', meridianId: 'ST', position: [0.03, 1.56, 0.10], effects: '散风清热、明目止泪', indications: '近视、夜盲、迎风流泪、面瘫', method: '沿眶下缘直刺0.3-0.7寸，不宜提插' },
  { code: 'ST2', name: '四白', meridianId: 'ST', position: [0.04, 1.54, 0.10], effects: '祛风明目、通络止痛', indications: '目赤痛痒、面瘫、头痛眩晕', method: '直刺0.3-0.5寸' },
  { code: 'ST4', name: '地仓', meridianId: 'ST', position: [0.05, 1.50, 0.10], effects: '祛风止痛、舒筋活络', indications: '口歪、流涎、三叉神经痛', method: '斜刺或平刺0.5-0.8寸' },
  { code: 'ST6', name: '颊车', meridianId: 'ST', position: [0.06, 1.48, 0.10], effects: '祛风清热、开关通络', indications: '牙痛、面瘫、颊肿', method: '直刺0.3-0.5寸或斜刺向地仓' },
  { code: 'ST8', name: '头维', meridianId: 'ST', position: [0.04, 1.60, 0.08], effects: '清头明目、止痛镇痉', indications: '头痛、目眩、迎风流泪', method: '平刺0.5-1寸' },
  { code: 'ST25', name: '天枢', meridianId: 'ST', position: [0.10, 0.98, 0.08], effects: '调中和胃、理气健脾', indications: '腹痛、腹胀、便秘、泄泻、月经不调', method: '直刺1-1.5寸' },
  { code: 'ST34', name: '梁丘', meridianId: 'ST', position: [0.10, 0.52, 0.02], effects: '理气和胃、通经活络', indications: '膝肿痛、胃痛、乳痈', method: '直刺1-1.2寸' },
  { code: 'ST35', name: '犊鼻', meridianId: 'ST', position: [0.10, 0.46, 0.02], effects: '活血通络、疏利关节', indications: '膝痛、下肢麻痹、脚气', method: '向后内斜刺0.5-1寸' },
  { code: 'ST36', name: '足三里', meridianId: 'ST', position: [0.10, 0.40, 0.02], effects: '健脾和胃、扶正培元、通经活络', indications: '胃痛、呕吐、腹胀、泄泻、便秘、虚劳、中风', method: '直刺1-2寸' },
  { code: 'ST40', name: '丰隆', meridianId: 'ST', position: [0.10, 0.28, 0.02], effects: '化痰湿、清神志', indications: '头痛、眩晕、咳嗽多痰、癫狂', method: '直刺1-1.5寸' },
  { code: 'ST44', name: '内庭', meridianId: 'ST', position: [0.10, 0.04, 0.06], effects: '清胃泻热、理气止痛', indications: '牙痛、咽喉肿痛、口歪、腹痛', method: '直刺或斜刺0.5-0.8寸' },

  // ========== 足太阴脾经 (SP) ==========
  { code: 'SP1', name: '隐白', meridianId: 'SP', position: [-0.10, 0.02, 0.04], effects: '调经统血、健脾回阳', indications: '月经过多、崩漏、腹胀、尸厥', method: '浅刺0.1寸或艾灸' },
  { code: 'SP3', name: '太白', meridianId: 'SP', position: [-0.10, 0.06, 0.02], effects: '健脾和中、理气化湿', indications: '胃痛、腹胀、便秘、痢疾', method: '直刺0.5-0.8寸' },
  { code: 'SP4', name: '公孙', meridianId: 'SP', position: [-0.10, 0.10, 0.01], effects: '健脾和胃、调理冲任', indications: '胃痛、呕吐、腹痛、泄泻', method: '直刺0.6-1.2寸' },
  { code: 'SP6', name: '三阴交', meridianId: 'SP', position: [-0.10, 0.18, 0.0], effects: '健脾益血、调肝补肾', indications: '肠鸣腹胀、月经不调、带下、遗精、失眠', method: '直刺1-1.5寸，孕妇禁针' },
  { code: 'SP9', name: '阴陵泉', meridianId: 'SP', position: [-0.10, 0.42, 0.01], effects: '健脾利湿、通利小便', indications: '腹胀、水肿、黄疸、膝痛', method: '直刺1-2寸' },
  { code: 'SP10', name: '血海', meridianId: 'SP', position: [-0.10, 0.50, 0.01], effects: '调经统血、健脾化湿', indications: '月经不调、崩漏、皮肤瘙痒、湿疹', method: '直刺1-1.5寸' },
  { code: 'SP15', name: '大横', meridianId: 'SP', position: [-0.12, 1.00, 0.07], effects: '温中散寒、调理肠胃', indications: '腹痛、泄泻、便秘', method: '直刺1-1.5寸' },
  { code: 'SP21', name: '大包', meridianId: 'SP', position: [-0.18, 1.30, 0.06], effects: '统血脉、调气机', indications: '气喘、全身疼痛、四肢无力', method: '斜刺0.3-0.5寸' },

  // ========== 手少阴心经 (HT) ==========
  { code: 'HT1', name: '极泉', meridianId: 'HT', position: [-0.18, 1.32, 0.02], effects: '宽胸理气、活血通络', indications: '心痛、胁肋痛、上肢痹痛', method: '避开腋动脉，直刺0.3-0.5寸' },
  { code: 'HT3', name: '少海', meridianId: 'HT', position: [-0.30, 1.14, -0.01], effects: '理气通络、安神', indications: '心痛、肘臂痛、瘰疬', method: '直刺0.5-1寸' },
  { code: 'HT5', name: '通里', meridianId: 'HT', position: [-0.39, 0.82, -0.01], effects: '清心安神、通利舌窍', indications: '心悸、暴喑、舌强不语', method: '直刺0.3-0.5寸' },
  { code: 'HT7', name: '神门', meridianId: 'HT', position: [-0.40, 0.80, -0.02], effects: '安神宁心、通经活络', indications: '心烦、失眠、健忘、心悸、癫狂', method: '直刺0.3-0.5寸' },
  { code: 'HT9', name: '少冲', meridianId: 'HT', position: [-0.46, 0.70, -0.01], effects: '清热开窍、醒神回厥', indications: '心悸、心痛、中风昏迷、热病', method: '浅刺0.1寸或点刺放血' },

  // ========== 手太阳小肠经 (SI) ==========
  { code: 'SI1', name: '少泽', meridianId: 'SI', position: [-0.46, 0.70, -0.02], effects: '清热利湿、通乳开窍', indications: '头痛、咽喉肿痛、乳痈、乳汁不足', method: '浅刺0.1寸或点刺放血' },
  { code: 'SI3', name: '后溪', meridianId: 'SI', position: [-0.42, 0.76, -0.02], effects: '清心安神、通经活络', indications: '头项强痛、腰背痛、手指麻木、癫痫', method: '直刺0.5-0.8寸' },
  { code: 'SI5', name: '阳谷', meridianId: 'SI', position: [-0.39, 0.82, -0.03], effects: '清热消肿、安神定志', indications: '头痛、目眩、耳鸣、腕痛', method: '直刺0.3-0.5寸' },
  { code: 'SI8', name: '小海', meridianId: 'SI', position: [-0.28, 1.06, -0.03], effects: '清热通络、安神', indications: '肘臂痛、癫痫', method: '直刺0.3-0.5寸' },
  { code: 'SI11', name: '天宗', meridianId: 'SI', position: [-0.12, 1.24, -0.06], effects: '舒筋活络、理气消肿', indications: '肩胛疼痛、气喘、乳痈', method: '直刺或斜刺0.5-1寸' },
  { code: 'SI19', name: '听宫', meridianId: 'SI', position: [-0.08, 1.54, 0.08], effects: '开窍聪耳、宁神定志', indications: '耳鸣、耳聋、中耳炎', method: '张口，直刺0.5-1寸' },

  // ========== 足太阳膀胱经 (BL) ==========
  { code: 'BL1', name: '睛明', meridianId: 'BL', position: [0.02, 1.58, 0.10], effects: '泄热明目、祛风通络', indications: '目赤肿痛、迎风流泪、近视、夜盲', method: '嘱患者闭目，紧靠眶缘直刺0.5-1寸' },
  { code: 'BL2', name: '攒竹', meridianId: 'BL', position: [0.02, 1.60, 0.08], effects: '清热明目、祛风通络', indications: '头痛、目眩、目赤、面瘫', method: '平刺或斜刺0.5-0.8寸' },
  { code: 'BL10', name: '天柱', meridianId: 'BL', position: [0.04, 1.50, -0.08], effects: '清头明目、强筋骨', indications: '头痛、项强、鼻塞、肩背痛', method: '直刺0.5-0.8寸' },
  { code: 'BL13', name: '肺俞', meridianId: 'BL', position: [0.04, 1.28, -0.08], effects: '调肺理气、补虚清热', indications: '咳嗽、气喘、吐血、盗汗', method: '斜刺0.5-0.8寸' },
  { code: 'BL15', name: '心俞', meridianId: 'BL', position: [0.04, 1.22, -0.08], effects: '养心安神、理气止痛', indications: '心痛、心悸、失眠、健忘', method: '斜刺0.5-0.8寸' },
  { code: 'BL17', name: '膈俞', meridianId: 'BL', position: [0.04, 1.16, -0.08], effects: '活血化瘀、理气宽胸', indications: '呕吐、呃逆、气喘、贫血', method: '斜刺0.5-0.8寸' },
  { code: 'BL18', name: '肝俞', meridianId: 'BL', position: [0.04, 1.12, -0.08], effects: '疏肝理气、养血明目', indications: '胁痛、目赤、眩晕、癫狂', method: '斜刺0.5-0.8寸' },
  { code: 'BL20', name: '脾俞', meridianId: 'BL', position: [0.04, 1.06, -0.08], effects: '健脾化湿、和胃', indications: '腹胀、泄泻、痢疾、水肿', method: '斜刺0.5-0.8寸' },
  { code: 'BL21', name: '胃俞', meridianId: 'BL', position: [0.04, 1.04, -0.07], effects: '和胃健脾、理中降逆', indications: '胃脘痛、呕吐、腹胀', method: '斜刺0.5-0.8寸' },
  { code: 'BL23', name: '肾俞', meridianId: 'BL', position: [0.04, 0.98, -0.07], effects: '补肾益气、强腰壮骨', indications: '腰痛、遗精、阳痿、月经不调、耳鸣', method: '斜刺0.5-1寸' },
  { code: 'BL25', name: '大肠俞', meridianId: 'BL', position: [0.04, 0.92, -0.06], effects: '理气和中、强健腰膝', indications: '腹胀、泄泻、便秘、腰痛', method: '直刺0.8-1.2寸' },
  { code: 'BL40', name: '委中', meridianId: 'BL', position: [0.08, 0.46, -0.04], effects: '清热解毒、舒筋通络', indications: '腰背痛、下肢痿痹、腹痛吐泻', method: '直刺1-1.5寸或三棱针点刺放血' },
  { code: 'BL57', name: '承山', meridianId: 'BL', position: [0.08, 0.28, -0.03], effects: '理气止痛、舒筋活络', indications: '腰背痛、腿痛转筋、痔疮', method: '直刺1-2寸' },
  { code: 'BL60', name: '昆仑', meridianId: 'BL', position: [0.10, 0.10, 0.0], effects: '安神清热、舒筋活络', indications: '头痛、项强、腰骶痛、足跟痛', method: '直刺0.5-0.8寸，孕妇禁针' },
  { code: 'BL67', name: '至阴', meridianId: 'BL', position: [0.12, 0.02, -0.02], effects: '正胎催产、清头明目', indications: '头痛、目痛、鼻塞、胎位不正', method: '浅刺0.1寸或艾灸' },

  // ========== 足少阴肾经 (KI) ==========
  { code: 'KI1', name: '涌泉', meridianId: 'KI', position: [-0.08, 0.0, 0.02], effects: '滋阴益肾、平肝熄风、醒脑开窍', indications: '头痛、头晕、失眠、小便不利、休克', method: '直刺0.5-0.8寸' },
  { code: 'KI3', name: '太溪', meridianId: 'KI', position: [-0.10, 0.08, -0.01], effects: '滋阴补肾、壮阳强腰', indications: '肾虚腰痛、头晕目眩、耳鸣、失眠、遗精', method: '直刺0.5-0.8寸' },
  { code: 'KI6', name: '照海', meridianId: 'KI', position: [-0.10, 0.08, 0.0], effects: '滋阴清热、调经止痛', indications: '咽干、失眠、月经不调、小便频数', method: '直刺0.5-0.8寸' },
  { code: 'KI7', name: '复溜', meridianId: 'KI', position: [-0.10, 0.16, 0.01], effects: '补肾益阴、温阳利水', indications: '水肿、盗汗、腹胀、泄泻', method: '直刺0.5-1寸' },
  { code: 'KI10', name: '阴谷', meridianId: 'KI', position: [-0.10, 0.44, 0.02], effects: '益肾调经、理气止痛', indications: '膝痛、阳痿、月经不调', method: '直刺1-1.5寸' },
  { code: 'KI27', name: '俞府', meridianId: 'KI', position: [-0.06, 1.34, 0.06], effects: '降逆平喘、和胃利膈', indications: '咳嗽、气喘、胸痛', method: '斜刺0.3-0.5寸' },

  // ========== 手厥阴心包经 (PC) ==========
  { code: 'PC1', name: '天池', meridianId: 'PC', position: [-0.14, 1.26, 0.08], effects: '活血化瘀、宽胸理气', indications: '胸闷、心烦、腋下肿', method: '斜刺0.3-0.5寸' },
  { code: 'PC3', name: '曲泽', meridianId: 'PC', position: [-0.26, 1.20, 0.01], effects: '清心泻火、和胃降逆', indications: '心痛、心悸、胃痛、呕吐', method: '直刺0.8-1寸或点刺放血' },
  { code: 'PC4', name: '郄门', meridianId: 'PC', position: [-0.32, 1.04, 0.01], effects: '宁心安神、清营凉血', indications: '心痛、心悸、呕血', method: '直刺0.5-1寸' },
  { code: 'PC5', name: '间使', meridianId: 'PC', position: [-0.35, 0.92, 0.01], effects: '宽胸和胃、清心安神', indications: '心痛、心悸、胃痛、癫狂', method: '直刺0.5-1寸' },
  { code: 'PC6', name: '内关', meridianId: 'PC', position: [-0.36, 0.88, 0.01], effects: '宁心安神、理气止痛、和胃降逆', indications: '心痛、心悸、胃痛、呕吐、失眠、眩晕', method: '直刺0.5-1寸' },
  { code: 'PC7', name: '大陵', meridianId: 'PC', position: [-0.38, 0.80, 0.0], effects: '清心宁神、和营通络', indications: '心痛、心悸、癫狂、胸胁痛', method: '直刺0.3-0.5寸' },
  { code: 'PC8', name: '劳宫', meridianId: 'PC', position: [-0.42, 0.74, 0.0], effects: '清心泻火、开窍醒神', indications: '中风昏迷、中暑、口臭、口疮', method: '直刺0.3-0.5寸' },
  { code: 'PC9', name: '中冲', meridianId: 'PC', position: [-0.45, 0.70, 0.01], effects: '清心开窍、醒脑回厥', indications: '中风昏迷、舌强不语、中暑、心烦', method: '浅刺0.1寸或点刺放血' },

  // ========== 手少阳三焦经 (TE) ==========
  { code: 'TE1', name: '关冲', meridianId: 'TE', position: [-0.45, 0.72, -0.01], effects: '清热开窍、活血通络', indications: '头痛、目赤、耳鸣、咽喉肿痛', method: '浅刺0.1寸或点刺放血' },
  { code: 'TE3', name: '中渚', meridianId: 'TE', position: [-0.41, 0.76, -0.02], effects: '清热通络、开窍益聪', indications: '头痛、目赤、耳鸣耳聋、手臂痛', method: '直刺0.3-0.5寸' },
  { code: 'TE5', name: '外关', meridianId: 'TE', position: [-0.36, 0.90, -0.02], effects: '清热解表、通经活络', indications: '热病、头痛、耳鸣、胁肋痛、上肢痹痛', method: '直刺0.5-1寸' },
  { code: 'TE6', name: '支沟', meridianId: 'TE', position: [-0.34, 0.94, -0.02], effects: '清三焦热、通腑气', indications: '便秘、耳鸣、耳聋、胁肋痛', method: '直刺0.5-1寸' },
  { code: 'TE10', name: '天井', meridianId: 'TE', position: [-0.26, 1.14, -0.02], effects: '行气散结、安神通络', indications: '偏头痛、肘臂痛、瘰疬、癫痫', method: '直刺0.5-1寸' },
  { code: 'TE17', name: '翳风', meridianId: 'TE', position: [-0.08, 1.52, -0.04], effects: '聪耳通窍、散风泄热', indications: '耳鸣、耳聋、面瘫、牙关紧闭', method: '直刺0.5-1寸' },
  { code: 'TE23', name: '丝竹空', meridianId: 'TE', position: [-0.02, 1.58, 0.08], effects: '清头明目、散骨镇惊', indications: '头痛、目赤、眼睑动、癫痫', method: '平刺0.5-1寸，禁灸' },

  // ========== 足少阳胆经 (GB) ==========
  { code: 'GB1', name: '瞳子髎', meridianId: 'GB', position: [-0.06, 1.58, 0.08], effects: '明目退翳、祛风泻火', indications: '头痛、目赤、目翳、面瘫', method: '平刺0.3-0.5寸' },
  { code: 'GB2', name: '听会', meridianId: 'GB', position: [-0.08, 1.55, 0.06], effects: '开窍聪耳、活络通经', indications: '耳鸣、耳聋、牙痛、面瘫', method: '张口，直刺0.5-0.8寸' },
  { code: 'GB14', name: '阳白', meridianId: 'GB', position: [-0.04, 1.62, 0.06], effects: '清头明目、祛风泻火', indications: '头痛、目眩、眼睑下垂、面瘫', method: '平刺0.3-0.5寸' },
  { code: 'GB20', name: '风池', meridianId: 'GB', position: [-0.06, 1.54, -0.06], effects: '平肝熄风、祛风解毒、通利官窍', indications: '头痛、眩晕、感冒、鼻炎、颈项强痛', method: '向鼻尖方向斜刺0.8-1.2寸' },
  { code: 'GB21', name: '肩井', meridianId: 'GB', position: [-0.12, 1.38, 0.0], effects: '祛风清热、活络消肿', indications: '肩背痹痛、乳痈、难产', method: '直刺0.5-0.8寸，孕妇禁针' },
  { code: 'GB30', name: '环跳', meridianId: 'GB', position: [-0.14, 0.82, -0.02], effects: '祛风化湿、强健腰膝', indications: '腰腿痛、下肢痿痹、半身不遂', method: '直刺2-3寸' },
  { code: 'GB34', name: '阳陵泉', meridianId: 'GB', position: [-0.12, 0.46, 0.01], effects: '疏肝利胆、舒筋活络', indications: '胁痛、口苦、膝肿痛、下肢痹痛', method: '直刺1-1.5寸' },
  { code: 'GB39', name: '悬钟', meridianId: 'GB', position: [-0.12, 0.16, 0.02], effects: '平肝熄风、舒筋活络、补髓壮骨', indications: '颈项强痛、胸胁胀痛、下肢痿痹', method: '直刺0.5-0.8寸' },
  { code: 'GB41', name: '足临泣', meridianId: 'GB', position: [-0.12, 0.06, 0.04], effects: '清肝胆热、疏经通络', indications: '目赤、胁肋痛、月经不调、足跗肿痛', method: '直刺0.3-0.5寸' },

  // ========== 足厥阴肝经 (LR) ==========
  { code: 'LR1', name: '大敦', meridianId: 'LR', position: [-0.10, 0.02, 0.06], effects: '回阳救逆、调经止崩', indications: '疝气、崩漏、癫痫、小便不利', method: '斜刺0.1-0.2寸或三棱针放血' },
  { code: 'LR2', name: '行间', meridianId: 'LR', position: [-0.10, 0.04, 0.05], effects: '清肝泻火、凉血安神', indications: '头痛、目赤、失眠、月经不调', method: '斜刺0.5-0.8寸' },
  { code: 'LR3', name: '太冲', meridianId: 'LR', position: [-0.10, 0.06, 0.04], effects: '平肝泻热、舒肝养血、清利下焦', indications: '头痛、眩晕、高血压、月经不调、疝气', method: '直刺0.5-0.8寸' },
  { code: 'LR5', name: '蠡沟', meridianId: 'LR', position: [-0.10, 0.22, 0.01], effects: '疏肝理气、调经止带', indications: '月经不调、带下、小便不利', method: '平刺0.5-0.8寸' },
  { code: 'LR8', name: '曲泉', meridianId: 'LR', position: [-0.10, 0.46, 0.02], effects: '补肝滋肾、调经止带', indications: '月经不调、带下、阴痒、膝痛', method: '直刺1-1.5寸' },
  { code: 'LR13', name: '章门', meridianId: 'LR', position: [-0.14, 1.08, 0.06], effects: '疏肝健脾、理气散结', indications: '腹胀、泄泻、胁痛、痞块', method: '斜刺0.5-0.8寸' },
  { code: 'LR14', name: '期门', meridianId: 'LR', position: [-0.14, 1.12, 0.07], effects: '疏肝理气、活血化瘀', indications: '胸胁胀痛、呕吐、吞酸、腹胀', method: '斜刺0.5-0.8寸' },

  // ========== 任脉 (RN) ==========
  { code: 'RN1', name: '会阴', meridianId: 'RN', position: [0.0, 0.78, 0.06], effects: '醒神开窍、回阳固脱', indications: '溺水窒息、昏迷、癫狂', method: '直刺0.5-1寸' },
  { code: 'RN4', name: '关元', meridianId: 'RN', position: [0.0, 0.86, 0.09], effects: '培元固本、补益下焦', indications: '中风脱症、虚劳冷惫、遗精、月经不调', method: '直刺1-1.5寸，孕妇慎用' },
  { code: 'RN6', name: '气海', meridianId: 'RN', position: [0.0, 0.90, 0.09], effects: '温阳益气、化湿理气', indications: '腹痛、泄泻、遗尿、遗精、虚脱', method: '直刺1-1.5寸' },
  { code: 'RN8', name: '神阙', meridianId: 'RN', position: [0.0, 0.98, 0.09], effects: '温阳救逆、利水固脱', indications: '腹痛、泄泻、脱肛、中风脱症', method: '禁针，宜隔盐灸' },
  { code: 'RN12', name: '中脘', meridianId: 'RN', position: [0.0, 1.06, 0.09], effects: '和胃健脾、降逆利水', indications: '胃痛、腹胀、呕吐、泄泻', method: '直刺1-1.5寸' },
  { code: 'RN17', name: '膻中', meridianId: 'RN', position: [0.0, 1.22, 0.10], effects: '宽胸理气、活血通络', indications: '咳嗽、气喘、胸痹、乳少', method: '平刺0.3-0.5寸' },
  { code: 'RN22', name: '天突', meridianId: 'RN', position: [0.0, 1.38, 0.06], effects: '宣通肺气、消痰止咳', indications: '咳嗽、气喘、咽喉肿痛', method: '先直刺0.2寸再沿胸骨后向下刺1-1.5寸' },
  { code: 'RN24', name: '承浆', meridianId: 'RN', position: [0.0, 1.50, 0.10], effects: '祛风通络、生津止渴', indications: '面瘫、牙龈肿痛、流涎', method: '斜刺0.3-0.5寸' },

  // ========== 督脉 (DU) ==========
  { code: 'DU1', name: '长强', meridianId: 'DU', position: [0.0, 0.78, -0.06], effects: '解痉止痛、调畅通淋', indications: '泄泻、便血、痔疮、脱肛、癫狂', method: '斜刺0.5-1寸' },
  { code: 'DU4', name: '命门', meridianId: 'DU', position: [0.0, 0.96, -0.07], effects: '补肾壮阳、培元固本', indications: '腰痛、遗精、阳痿、月经不调', method: '直刺0.5-1寸' },
  { code: 'DU9', name: '至阳', meridianId: 'DU', position: [0.0, 1.14, -0.08], effects: '利胆退黄、宽胸利膈', indications: '胸胁胀痛、黄疸、脊背强痛', method: '斜刺0.5-1寸' },
  { code: 'DU14', name: '大椎', meridianId: 'DU', position: [0.0, 1.38, -0.08], effects: '清热解表、截疟止痫', indications: '热病、疟疾、咳嗽、气喘、癫痫、项强', method: '斜刺0.5-1寸' },
  { code: 'DU16', name: '风府', meridianId: 'DU', position: [0.0, 1.54, -0.06], effects: '疏风散邪、通关开窍', indications: '头痛、项强、眩晕、中风失语', method: '向下颌方向缓慢刺入0.5-1寸' },
  { code: 'DU20', name: '百会', meridianId: 'DU', position: [0.0, 1.65, 0.02], effects: '升阳固脱、开窍醒脑、宁神定志', indications: '头痛、眩晕、中风、脱肛、失眠、健忘', method: '平刺0.5-0.8寸' },
  { code: 'DU24', name: '神庭', meridianId: 'DU', position: [0.0, 1.64, 0.06], effects: '清头散风、镇静安神', indications: '头痛、眩晕、失眠、癫狂', method: '平刺0.3-0.5寸' },
  { code: 'DU26', name: '水沟', meridianId: 'DU', position: [0.0, 1.52, 0.10], effects: '醒神开窍、清热熄风', indications: '昏迷、中暑、中风、癫狂、急性腰扭伤', method: '向上斜刺0.3-0.5寸' },

  // ========== 冲脉 (CV) ==========
  { code: 'CV1', name: '气冲', meridianId: 'CV', position: [0.04, 0.82, 0.06], effects: '理气止痛、舒筋活络', indications: '腹痛、疝气、月经不调', method: '直刺0.5-1寸' },

  // ========== 带脉 (DM) ==========
  { code: 'DM1', name: '带脉穴', meridianId: 'DM', position: [-0.16, 1.02, 0.06], effects: '调经止带、疏肝行滞', indications: '月经不调、带下、腰胁痛', method: '直刺0.5-0.8寸' },

  // ========== 阳维脉 (YWM) ==========
  { code: 'YWM1', name: '金门', meridianId: 'YWM', position: [0.12, 0.10, 0.0], effects: '安神定志、舒筋活络', indications: '头痛、癫痫、腰痛、外踝痛', method: '直刺0.3-0.5寸' },

  // ========== 阴维脉 (YiWM) ==========
  { code: 'YiWM1', name: '筑宾', meridianId: 'YiWM', position: [-0.10, 0.26, 0.02], effects: '调补肝肾、清热利湿', indications: '癫狂、呕吐、小腿痛', method: '直刺0.5-0.8寸' },

  // ========== 阳跷脉 (YQM) ==========
  { code: 'YQM1', name: '申脉', meridianId: 'YQM', position: [0.12, 0.06, 0.0], effects: '清热安神、利腰膝', indications: '头痛、眩晕、癫狂、腰腿痛、失眠', method: '直刺0.3-0.5寸' },

  // ========== 阴跷脉 (YiQM) ==========
  { code: 'YiQM1', name: '照海', meridianId: 'YiQM', position: [-0.10, 0.06, 0.01], effects: '滋阴清热、调经止痛', indications: '咽干、失眠、月经不调、小便频数', method: '直刺0.5-0.8寸' },
];

// Index by meridian
export const acupointsByMeridian: Record<string, AcupointData[]> = {};
for (const a of acupoints) {
  if (!acupointsByMeridian[a.meridianId]) {
    acupointsByMeridian[a.meridianId] = [];
  }
  acupointsByMeridian[a.meridianId].push(a);
}
