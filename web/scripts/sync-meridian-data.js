#!/usr/bin/env node
/**
 * 经络数据同步脚本
 * 
 * 用法: node sync-meridian-data.js <meridian-id> <model-type>
 * 示例: node sync-meridian-data.js LU male
 * 
 * 从导出工具生成的数据文件同步到正式环境
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  // 数据源（从导出工具复制）
  sourceDir: path.join(__dirname, '../temp'),
  
  // 目标文件
  targets: {
    paths: {
      male: path.join(__dirname, '../src/pages/meridians/data/meridian-paths-male.ts'),
      female: path.join(__dirname, '../src/pages/meridians/data/meridian-paths-female.ts'),
    },
    positions: {
      male: path.join(__dirname, '../src/pages/meridians/data/acupoint-positions-male.ts'),
      female: path.join(__dirname, '../src/pages/meridians/data/acupoint-positions-female.ts'),
    }
  }
};

// 经络信息
const MERIDIANS = {
  'LU': { name: '手太阴肺经', acupoints: ['LU1', 'LU2', 'LU3', 'LU4', 'LU5', 'LU6', 'LU7', 'LU8', 'LU9', 'LU10', 'LU11'] },
  'LI': { name: '手阳明大肠经', acupoints: ['LI1', 'LI2', 'LI3', 'LI4', 'LI5', 'LI6', 'LI7', 'LI8', 'LI9', 'LI10', 'LI11', 'LI12', 'LI13', 'LI14', 'LI15', 'LI16', 'LI17', 'LI18', 'LI19', 'LI20'] },
  'ST': { name: '足阳明胃经', acupoints: ['ST1', 'ST2', 'ST3', 'ST4', 'ST5', 'ST6', 'ST7', 'ST8', 'ST9', 'ST10', 'ST11', 'ST12', 'ST13', 'ST14', 'ST15', 'ST16', 'ST17', 'ST18', 'ST19', 'ST20', 'ST21', 'ST22', 'ST23', 'ST24', 'ST25', 'ST26', 'ST27', 'ST28', 'ST29', 'ST30', 'ST31', 'ST32', 'ST33', 'ST34', 'ST35', 'ST36', 'ST37', 'ST38', 'ST39', 'ST40', 'ST41', 'ST42', 'ST43', 'ST44', 'ST45'] },
  'SP': { name: '足太阴脾经', acupoints: ['SP1', 'SP2', 'SP3', 'SP4', 'SP5', 'SP6', 'SP7', 'SP8', 'SP9', 'SP10', 'SP11', 'SP12', 'SP13', 'SP14', 'SP15', 'SP16', 'SP17', 'SP18', 'SP19', 'SP20', 'SP21'] },
  'HT': { name: '手少阴心经', acupoints: ['HT1', 'HT2', 'HT3', 'HT4', 'HT5', 'HT6', 'HT7', 'HT8', 'HT9'] },
  'SI': { name: '手太阳小肠经', acupoints: ['SI1', 'SI2', 'SI3', 'SI4', 'SI5', 'SI6', 'SI7', 'SI8', 'SI9', 'SI10', 'SI11', 'SI12', 'SI13', 'SI14', 'SI15', 'SI16', 'SI17', 'SI18', 'SI19'] },
  'BL': { name: '足太阳膀胱经', acupoints: ['BL1', 'BL2', 'BL3', 'BL4', 'BL5', 'BL6', 'BL7', 'BL8', 'BL9', 'BL10', 'BL11', 'BL12', 'BL13', 'BL14', 'BL15', 'BL16', 'BL17', 'BL18', 'BL19', 'BL20', 'BL21', 'BL22', 'BL23', 'BL24', 'BL25', 'BL26', 'BL27', 'BL28', 'BL29', 'BL30', 'BL31', 'BL32', 'BL33', 'BL34', 'BL35', 'BL36', 'BL37', 'BL38', 'BL39', 'BL40', 'BL41', 'BL42', 'BL43', 'BL44', 'BL45', 'BL46', 'BL47', 'BL48', 'BL49', 'BL50', 'BL51', 'BL52', 'BL53', 'BL54', 'BL55', 'BL56', 'BL57', 'BL58', 'BL59', 'BL60', 'BL61', 'BL62', 'BL63', 'BL64', 'BL65', 'BL66', 'BL67'] },
  'KI': { name: '足少阴肾经', acupoints: ['KI1', 'KI2', 'KI3', 'KI4', 'KI5', 'KI6', 'KI7', 'KI8', 'KI9', 'KI10', 'KI11', 'KI12', 'KI13', 'KI14', 'KI15', 'KI16', 'KI17', 'KI18', 'KI19', 'KI20', 'KI21', 'KI22', 'KI23', 'KI24', 'KI25', 'KI26', 'KI27'] },
  'PC': { name: '手厥阴心包经', acupoints: ['PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6', 'PC7', 'PC8', 'PC9'] },
  'TE': { name: '手少阳三焦经', acupoints: ['TE1', 'TE2', 'TE3', 'TE4', 'TE5', 'TE6', 'TE7', 'TE8', 'TE9', 'TE10', 'TE11', 'TE12', 'TE13', 'TE14', 'TE15', 'TE16', 'TE17', 'TE18', 'TE19', 'TE20', 'TE21', 'TE22', 'TE23'] },
  'GB': { name: '足少阳胆经', acupoints: ['GB1', 'GB2', 'GB3', 'GB4', 'GB5', 'GB6', 'GB7', 'GB8', 'GB9', 'GB10', 'GB11', 'GB12', 'GB13', 'GB14', 'GB15', 'GB16', 'GB17', 'GB18', 'GB19', 'GB20', 'GB21', 'GB22', 'GB23', 'GB24', 'GB25', 'GB26', 'GB27', 'GB28', 'GB29', 'GB30', 'GB31', 'GB32', 'GB33', 'GB34', 'GB35', 'GB36', 'GB37', 'GB38', 'GB39', 'GB40', 'GB41', 'GB42', 'GB43', 'GB44'] },
  'LR': { name: '足厥阴肝经', acupoints: ['LR1', 'LR2', 'LR3', 'LR4', 'LR5', 'LR6', 'LR7', 'LR8', 'LR9', 'LR10', 'LR11', 'LR12', 'LR13', 'LR14'] },
  'RN': { name: '任脉', acupoints: ['RN1', 'RN2', 'RN3', 'RN4', 'RN5', 'RN6', 'RN7', 'RN8', 'RN9', 'RN10', 'RN11', 'RN12', 'RN13', 'RN14', 'RN15', 'RN16', 'RN17', 'RN18', 'RN19', 'RN20', 'RN21', 'RN22', 'RN23', 'RN24'] },
  'DU': { name: '督脉', acupoints: ['DU1', 'DU2', 'DU3', 'DU4', 'DU5', 'DU6', 'DU7', 'DU8', 'DU9', 'DU10', 'DU11', 'DU12', 'DU13', 'DU14', 'DU15', 'DU16', 'DU17', 'DU18', 'DU19', 'DU20', 'DU21', 'DU22', 'DU23', 'DU24', 'DU25', 'DU26', 'DU27', 'DU28'] },
};

/**
 * 生成经络路径文件内容
 */
function generatePathFileContent(meridianId, pathData, acupointIndices) {
  const meridian = MERIDIANS[meridianId];
  if (!meridian) throw new Error(`未知的经络: ${meridianId}`);

  const indexComments = Object.entries(acupointIndices)
    .map(([code, idx]) => `${code}@${idx}`)
    .join(', ');

  const pathLines = pathData.map((p, i) => 
    `      [${p.map(v => v.toFixed(3)).join(', ')}],  // ${i}`
  ).join('\n');

  return `  '${meridianId}': {
    // ${meridian.name} — ${indexComments}
    path: [
${pathLines}
    ],
  },`;
}

/**
 * 生成穴位坐标文件内容
 */
function generatePositionFileContent(meridianId, pathData, acupointIndices) {
  const meridian = MERIDIANS[meridianId];
  if (!meridian) throw new Error(`未知的经络: ${meridianId}`);

  const lines = Object.entries(acupointIndices)
    .map(([code, idx]) => {
      const pos = pathData[idx] || [0, 0, 0];
      const isLast = code === meridian.acupoints[meridian.acupoints.length - 1];
      const comment = isLast ? '（末端）' : '';
      return `  '${code}': [${pos.map(v => v.toFixed(3)).join(', ')}],  // ${idx}${comment}`;
    })
    .join('\n');

  return `  // ${meridian.name} (${meridianId}) - 坐标与经络路径对应
${lines}`;
}

/**
 * 更新经络路径文件
 */
function updatePathFile(meridianId, modelType, pathData, acupointIndices) {
  const filePath = CONFIG.targets.paths[modelType];
  if (!filePath) throw new Error(`不支持的模型类型: ${modelType}`);

  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 生成新的经络数据
  const newData = generatePathFileContent(meridianId, pathData, acupointIndices);
  
  // 检查是否已存在该经络
  const regex = new RegExp(`['"]${meridianId}['"]:\\s*\\{[\\s\\S]*?\\},?`);
  
  if (regex.test(content)) {
    // 替换现有数据
    content = content.replace(regex, newData);
    console.log(`✓ 更新现有经络数据: ${meridianId}`);
  } else {
    // 添加新数据（在最后一个条目后面）
    const lastEntryRegex = /(}\s*,?\s*)(};?\s*)$/;
    content = content.replace(lastEntryRegex, `$1\n${newData}\n$2`);
    console.log(`✓ 添加新经络数据: ${meridianId}`);
  }

  fs.writeFileSync(filePath, content);
  console.log(`✓ 已保存到: ${filePath}`);
}

/**
 * 更新穴位坐标文件
 */
function updatePositionFile(meridianId, modelType, pathData, acupointIndices) {
  const filePath = CONFIG.targets.positions[modelType];
  if (!filePath) throw new Error(`不支持的模型类型: ${modelType}`);

  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 生成新的穴位数据
  const newData = generatePositionFileContent(meridianId, pathData, acupointIndices);
  
  // 检查是否已存在该经络的注释
  const regex = new RegExp(`// ${MERIDIANS[meridianId].name}.*?\n([\\s\\S]*?)(?=//|const positions)`);
  
  if (regex.test(content)) {
    // 替换现有数据
    content = content.replace(regex, newData + '\n');
    console.log(`✓ 更新现有穴位数据: ${meridianId}`);
  } else {
    // 添加新数据（在文件末尾，positions 对象之前）
    const insertRegex = /(const positions: Record<string, Vec3> = \{)/;
    content = content.replace(insertRegex, `${newData}\n\n$1`);
    console.log(`✓ 添加新穴位数据: ${meridianId}`);
  }

  fs.writeFileSync(filePath, content);
  console.log(`✓ 已保存到: ${filePath}`);
}

/**
 * 主函数
 */
function main() {
  const meridianId = process.argv[2];
  const modelType = process.argv[3] || 'male';
  
  if (!meridianId) {
    console.log('用法: node sync-meridian-data.js <meridian-id> [model-type]');
    console.log('示例: node sync-meridian-data.js LU male');
    console.log('\n支持的经络:');
    Object.entries(MERIDIANS).forEach(([id, info]) => {
      console.log(`  ${id} - ${info.name} (${info.acupoints.length}个穴位)`);
    });
    process.exit(1);
  }

  if (!MERIDIANS[meridianId]) {
    console.error(`错误: 未知的经络ID "${meridianId}"`);
    process.exit(1);
  }

  console.log(`=== 同步经络数据: ${meridianId} (${MERIDIANS[meridianId].name}) ===\n`);

  // 从标准输入读取数据（JSON格式）
  let inputData = '';
  process.stdin.setEncoding('utf-8');
  
  process.stdin.on('data', chunk => {
    inputData += chunk;
  });
  
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(inputData);
      
      if (!data.path || !data.acupoints) {
        throw new Error('数据格式错误: 需要包含 path 和 acupoints 字段');
      }

      // 构建穴位索引映射
      const acupointIndices = {};
      Object.entries(data.acupoints).forEach(([code, info]) => {
        acupointIndices[code] = info.index;
      });

      // 更新文件
      updatePathFile(meridianId, modelType, data.path, acupointIndices);
      updatePositionFile(meridianId, modelType, data.path, acupointIndices);

      console.log('\n✅ 数据同步完成！');
      console.log(`经络: ${meridianId} (${MERIDIANS[meridianId].name})`);
      console.log(`模型: ${modelType}`);
      console.log(`路径点数: ${data.path.length}`);
      console.log(`穴位数量: ${Object.keys(data.acupoints).length}`);
      
    } catch (err) {
      console.error('错误:', err.message);
      console.log('\n请从导出工具复制数据，然后通过管道输入:');
      console.log('cat data.json | node sync-meridian-data.js LU male');
      process.exit(1);
    }
  });
}

main();
