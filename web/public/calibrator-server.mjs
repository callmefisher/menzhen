#!/usr/bin/env node
/**
 * 经络校正工具 — 本地服务
 * 替代 python3 -m http.server 8899
 *
 * 功能:
 * - 静态文件服务 web/public/
 * - POST /api/save-calibration — 将校正数据写入 TS 源码
 *
 * 启动: cd web/public && node calibrator-server.mjs
 */

import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8899;

// 数据目录 (TS 源码)
const DATA_DIR = join(__dirname, '..', 'src', 'pages', 'meridians', 'data');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// ==================== TS 生成 ====================

function generatePathsTS(model, paths) {
  const modelLabel = model === 'female' ? 'sport-girl.glb 模型 (T-pose 女性)' : 'male.glb 模型 (T-pose 男性)';
  let ts = `import type { MeridianPathCoords } from './types';\n\n`;
  ts += `// ========================================================================\n`;
  ts += `// 经络路径坐标 — 适配 ${modelLabel}\n`;
  ts += `// ========================================================================\n`;
  ts += `// 坐标系: Y-up (0=脚底, 1.64=头顶), X=左右(负=左), Z=前后(正=前/腹)\n`;
  ts += `// ========================================================================\n\n`;
  ts += `const coords: Record<string, MeridianPathCoords> = {\n`;

  const meridianOrder = ['LU','LI','ST','SP','HT','SI','BL','KI','PC','TE','GB','LR','RN','DU','CV','DM','YWM','YiWM','YQM','YiQM'];
  for (const mid of meridianOrder) {
    const data = paths[mid];
    if (!data || !data.path || data.path.length === 0) continue;
    ts += `  '${mid}': {\n`;
    ts += `    path: [\n`;
    for (const pt of data.path) {
      ts += `      [${pt[0]}, ${pt[1]}, ${pt[2]}],\n`;
    }
    ts += `    ],\n`;
    if (data.internalPath && data.internalPath.length > 0) {
      ts += `    internalPath: [\n`;
      for (const pt of data.internalPath) {
        ts += `      [${pt[0]}, ${pt[1]}, ${pt[2]}],\n`;
      }
      ts += `    ],\n`;
    }
    ts += `  },\n`;
  }

  ts += `};\n\nexport default coords;\n`;
  return ts;
}

function generateAcupointsTS(model, acupoints) {
  const modelLabel = model === 'female' ? 'sport-girl.glb 模型 (T-pose 女性)' : 'male.glb 模型 (T-pose 男性)';
  let ts = `import type { Vec3 } from './types';\n\n`;
  ts += `// ========================================================================\n`;
  ts += `// 穴位坐标 — 适配 ${modelLabel}\n`;
  ts += `// ========================================================================\n\n`;
  ts += `const positions: Record<string, Vec3> = {\n`;

  // Sort acupoint codes by meridian order then number
  const meridianOrder = ['LU','LI','ST','SP','HT','SI','BL','KI','PC','TE','GB','LR','RN','DU','CV','DM','YWM','YiWM','YQM','YiQM'];
  const orderMap = {};
  meridianOrder.forEach((m, i) => orderMap[m] = i);

  const sortedCodes = Object.keys(acupoints).sort((a, b) => {
    const aMid = a.replace(/\d+$/, '');
    const bMid = b.replace(/\d+$/, '');
    const aNum = parseInt(a.replace(/\D+/, ''));
    const bNum = parseInt(b.replace(/\D+/, ''));
    const aOrder = orderMap[aMid] ?? 999;
    const bOrder = orderMap[bMid] ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return aNum - bNum;
  });

  for (const code of sortedCodes) {
    const pos = acupoints[code];
    if (!pos) continue;
    ts += `  '${code}': [${pos[0]}, ${pos[1]}, ${pos[2]}],\n`;
  }

  ts += `};\n\nexport default positions;\n`;
  return ts;
}

// ==================== HTTP 服务 ====================

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/save-calibration
  if (req.method === 'POST' && req.url === '/api/save-calibration') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { model, paths, acupoints } = data;
        if (!model || !paths || !acupoints) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing model, paths, or acupoints' }));
          return;
        }
        if (model !== 'female' && model !== 'male') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid model type' }));
          return;
        }

        const pathsFile = join(DATA_DIR, `meridian-paths-${model}.ts`);
        const acupointsFile = join(DATA_DIR, `acupoint-positions-${model}.ts`);

        const pathsTS = generatePathsTS(model, paths);
        const acupointsTS = generateAcupointsTS(model, acupoints);

        await writeFile(pathsFile, pathsTS, 'utf-8');
        await writeFile(acupointsFile, acupointsTS, 'utf-8');

        console.log(`[save] ${model} — paths → ${pathsFile}`);
        console.log(`[save] ${model} — acupoints → ${acupointsFile}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          files: [pathsFile, acupointsFile],
        }));
      } catch (e) {
        console.error('[save] Error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 静态文件服务
  if (req.method === 'GET') {
    let url = req.url.split('?')[0];
    if (url === '/') url = '/meridian-calibrator.html';

    // 支持 /models/ 路径 (模型文件在 web/public/models/)
    const filePath = join(__dirname, url);

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error('Not a file');

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const content = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`\n  校正工具服务已启动`);
  console.log(`  http://localhost:${PORT}/meridian-calibrator.html\n`);
  console.log(`  POST /api/save-calibration — 写入 TS 源码`);
  console.log(`  数据目录: ${DATA_DIR}\n`);
});
