# Codebase 文档 + 药物方剂预录入脚本 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建项目全局 codebase 文档并编写药物/方剂预录入 Shell 脚本。

**Architecture:** 两个独立交付物：(1) `docs/codebase.md` 全局上下文文档，外链到 CLAUDE.md；(2) `scripts/seed-herbs-formulas.sh` 通过 HTTP API 调用后端的药物方剂批量录入脚本，内嵌覆盖伤寒论、温病条辨等经典的药物/方剂列表。

**Tech Stack:** Shell (bash), curl, jq (可选)

---

## Task 1: 创建 docs/codebase.md 全局上下文文档

**Files:**
- Create: `docs/codebase.md`

**Step 1: 编写 codebase.md**

创建 `docs/codebase.md`，内容涵盖以下章节：

```markdown
# Codebase 全局上下文

> 本文件供每次任务执行前快速扫描，保持与代码同步。

## 项目总览
- 患者病历管理系统，中小诊所局域网部署 + 多租户云端共享
- 技术栈：React 19 + TypeScript + Ant Design 6 / Go + Gin + GORM / MySQL 8 / MinIO / JWT + RBAC / DeepSeek AI

## 目录结构详解

### server/（Go 后端）
| 目录 | 用途 | 关键文件 |
|------|------|----------|
| config/ | 环境变量配置加载 | config.go — Config struct, Load() |
| database/ | DB 连接、迁移、种子数据 | database.go — Init(), seed.go — Seed() |
| handler/ | HTTP 处理器 | auth.go, patient.go, record.go, herb.go, formula.go, prescription.go, ai_analysis.go, oplog.go, user.go, role.go, tenant.go, file.go |
| middleware/ | 中间件 | auth.go (JWT), rbac.go (权限), tenant.go (租户隔离), oplog.go (操作日志) |
| model/ | GORM 数据模型 | patient.go, medical_record.go, herb.go, formula.go, prescription.go, prescription_item.go, user.go, role.go, permission.go, tenant.go, op_log.go, record_attachment.go |
| router/ | 路由注册 | router.go — SetupRouter() |
| service/ | 业务逻辑 | deepseek.go (AI), herb.go, formula.go, prescription.go 等 |
| storage/ | MinIO 客户端 | minio.go |

### web/src/（React 前端）
| 目录 | 用途 |
|------|------|
| api/ | axios 请求封装，按模块拆分 |
| components/ | 通用组件（处方弹窗、打印等） |
| pages/ | 页面组件（患者、诊疗、中药查询等） |
| store/ | 状态管理 |
| test/ | 测试配置（setup.ts 含 polyfill） |
| utils/ | 工具函数（request.ts 等） |

### 其他
| 目录/文件 | 用途 |
|-----------|------|
| scripts/ | 备份(backup.sh)、恢复(restore.sh)、定时备份(backup-loop.sh)、药物方剂预录入(seed-herbs-formulas.sh) |
| nginx/ | Nginx 反向代理配置 |
| docs/ | 运维手册、设计方案、实施计划 |
| docker-compose.yml | 服务编排 |
| deploy.sh | 一键部署脚本 |

## 数据模型

### 全局表（无租户隔离）

**herbs** — 中药
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint64 PK | 自增 |
| name | varchar(100) UNIQUE | 药名 |
| alias | varchar(500) | 别名 |
| category | varchar(50) INDEX | 归类 |
| properties | varchar(200) | 性味归经 |
| effects | text | 功效 |
| indications | text | 主治 |
| source | varchar(20) default "manual" | 来源(manual/deepseek) |

**formulas** — 方剂
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint64 PK | 自增 |
| name | varchar(100) UNIQUE | 方剂名 |
| effects | text | 功效 |
| indications | text | 主治 |
| composition | json | 组成 [{herb_name, default_dosage}] |
| source | varchar(20) default "manual" | 来源 |

### 租户隔离表

**tenants** — 租户 (id, name, code UNIQUE, status)
**users** — 用户 (id, tenant_id, username, password_hash, real_name, status)
**roles** — 角色 (id, tenant_id, name, description)
**permissions** — 权限 (id, name, code UNIQUE, description)
**patients** — 患者 (id, tenant_id, name, gender, birth_date, phone, address, allergy_history, medical_history, notes)
**medical_records** — 诊疗记录 (id, tenant_id, patient_id, record_date, chief_complaint, present_illness, past_history, examination, tongue_diagnosis, pulse_diagnosis, tcm_diagnosis, western_diagnosis, treatment_principle, notes, created_by)
**prescriptions** — 处方 (id, tenant_id, record_id, formula_name, total_doses, notes, created_by)
**prescription_items** — 处方药物明细 (id, prescription_id, herb_name, dosage, sort_order, notes)
**op_logs** — 操作日志 (id, tenant_id, user_id, method, path, status_code, latency, request_body)
**record_attachments** — 附件 (id, record_id, file_key, file_name, file_size, content_type)

## API 路由清单

### 公开路由
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/auth/login | 登录 → {token, user, permissions} |
| POST | /api/v1/auth/register | 注册 |
| GET | /api/v1/files/*key | 文件下载 |

### 认证路由
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | /api/v1/auth/logout | auth | 登出 |
| GET | /api/v1/auth/me | auth | 当前用户信息 |
| POST | /api/v1/auth/change-password | auth | 修改密码 |

### 患者管理
| 方法 | 路径 | 权限 |
|------|------|------|
| GET/POST | /api/v1/patients | patient:read / patient:create |
| GET/PUT/DELETE | /api/v1/patients/:id | patient:read/update/delete |

### 诊疗记录
| 方法 | 路径 | 权限 |
|------|------|------|
| GET/POST | /api/v1/records | record:read / record:create |
| GET/PUT/DELETE | /api/v1/records/:id | record:read/update/delete |

### 中药
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/herbs?name=&category=&page=&size= | auth | 搜索（DB+AI回退） |
| GET | /api/v1/herbs/:id | auth | 详情 |
| DELETE | /api/v1/herbs/:id | role:manage | 删除 |

### 方剂
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/formulas?name=&page=&size= | auth | 搜索（DB+AI回退） |
| GET | /api/v1/formulas/:id | auth | 详情 |
| DELETE | /api/v1/formulas/:id | role:manage | 删除 |

### 处方
| 方法 | 路径 | 权限 |
|------|------|------|
| POST | /api/v1/prescriptions | prescription:create |
| GET | /api/v1/prescriptions/:id | prescription:read |
| PUT/DELETE | /api/v1/prescriptions/:id | prescription:create |
| GET | /api/v1/records/:id/prescriptions | prescription:read |

### AI 分析
| 方法 | 路径 | 权限 |
|------|------|------|
| POST | /api/v1/ai/analyze-diagnosis | record:read |

### 管理
| 方法 | 路径 | 权限 |
|------|------|------|
| GET/PUT/DELETE | /api/v1/users, users/:id | user:manage |
| GET/POST/PUT | /api/v1/roles, roles/:id | role:manage |
| GET | /api/v1/permissions | role:manage |
| GET/POST/PUT/DELETE | /api/v1/tenants, tenants/:id | tenant:manage |
| GET | /api/v1/oplogs | oplog:read |

## 核心业务流程

### 药物查询（DB + AI 回退）
1. 收到 `GET /api/v1/herbs?name=xxx`
2. DB 查询：`WHERE name LIKE ? OR alias LIKE ?`
3. 有结果 → 返回分页数据
4. 无结果 + name 非空 + 无 category 过滤 + DeepSeek 已配置 →
5. 调用 DeepSeek AI 查询，返回 JSON {name, alias, category, properties, effects, indications}
6. 校验有效性（需有 effects 或 indications）
7. 自动保存到 DB（source="deepseek"），处理重复键
8. 返回 AI 结果给客户端

### 方剂查询流程同上
- 校验条件：至少 1 个 composition item
- 保存 composition 为 JSON

### 租户隔离
- JWT 中包含 tenant_id
- 中间件自动注入 tenant_id 到查询条件
- herbs/formulas 全局共享，不隔离

## 配置与环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DB_HOST | localhost | 数据库地址 |
| DB_PORT | 3306 | 数据库端口 |
| DB_USER | menzhen | 数据库用户 |
| DB_PASSWORD | menzhen123 | 数据库密码 |
| DB_NAME | menzhen | 数据库名 |
| JWT_SECRET | change-me-in-production | JWT 密钥 |
| SERVER_PORT | 8080 | 后端端口 |
| MINIO_ENDPOINT | localhost:9000 | MinIO 地址 |
| MINIO_ACCESS_KEY | minioadmin | MinIO 用户 |
| MINIO_SECRET_KEY | minioadmin | MinIO 密码 |
| MINIO_BUCKET | menzhen | MinIO 桶名 |
| DEEPSEEK_API_KEY | (内置) | DeepSeek API 密钥 |
| DEEPSEEK_BASE_URL | https://api.qnaigc.com/v1/messages | DeepSeek 地址 |
| DEEPSEEK_MODEL | deepseek/deepseek-v3.2-251201 | DeepSeek 模型 |
| BACKUP_HOUR | 2 | 自动备份时间 |

## 脚本与部署

| 脚本 | 用途 |
|------|------|
| deploy.sh | 一键部署（生成 .env、docker-compose up） |
| scripts/backup.sh | 数据库 + MinIO 备份 |
| scripts/restore.sh | 从备份恢复 |
| scripts/backup-loop.sh | 定时备份守护进程 |
| scripts/seed-herbs-formulas.sh | 中药/方剂预录入 |
```

**Step 2: Commit**

```bash
git add docs/codebase.md
git commit -m "docs: add codebase context document for task scanning"
```

---

## Task 2: 更新 CLAUDE.md — 添加开发原则和文档链接

**Files:**
- Modify: `CLAUDE.md`

**Step 1: 在 CLAUDE.md 的"开发原则"章节末尾添加新原则**

在 `### 7. 文档精简高效` 之后添加：

```markdown
### 8. Codebase 文档同步
每次项目变更后必须检查并更新 `docs/codebase.md`，确保文档与代码同步。该文档作为任务执行前的上下文扫描入口。
```

**Step 2: 在 CLAUDE.md 的"详细文档"章节添加链接**

在 `- [实施计划]` 行之后添加：

```markdown
- [Codebase 全局上下文](docs/codebase.md)
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add codebase sync principle and link to CLAUDE.md"
```

---

## Task 3: 创建药物/方剂预录入脚本 — 框架和登录逻辑

**Files:**
- Create: `scripts/seed-herbs-formulas.sh`

**Step 1: 编写脚本框架**

```bash
#!/bin/bash
# seed-herbs-formulas.sh — 中药/方剂预录入脚本
# 通过调用后端 API 触发 DB+AI 回退机制，批量录入常见中药和方剂
#
# 用法:
#   ./scripts/seed-herbs-formulas.sh [options]
#
# 选项:
#   --api-url URL       后端 API 地址 (默认 http://localhost:8080)
#   --username USER     登录用户名 (默认 admin)
#   --password PASS     登录密码 (默认 admin123)
#   --herbs-only        只录入中药
#   --formulas-only     只录入方剂
#   --dry-run           预览模式，不实际调用
#   --delay SECONDS     请求间隔秒数 (默认 3)
#   --help              显示帮助

set -euo pipefail

# ============================================================
# 配置
# ============================================================
API_URL="${API_URL:-http://localhost:8080}"
USERNAME="${USERNAME:-admin}"
PASSWORD="${PASSWORD:-admin123}"
DELAY="${DELAY:-3}"
HERBS_ONLY=false
FORMULAS_ONLY=false
DRY_RUN=false
PROGRESS_FILE="/tmp/seed-herbs-formulas-progress.log"
LOG_FILE="/tmp/seed-herbs-formulas-$(date +%Y%m%d-%H%M%S).log"

# 计数器
HERB_SUCCESS=0
HERB_FAIL=0
HERB_SKIP=0
FORMULA_SUCCESS=0
FORMULA_FAIL=0
FORMULA_SKIP=0

# ============================================================
# 参数解析
# ============================================================
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url)   API_URL="$2"; shift 2 ;;
        --username)  USERNAME="$2"; shift 2 ;;
        --password)  PASSWORD="$2"; shift 2 ;;
        --herbs-only)    HERBS_ONLY=true; shift ;;
        --formulas-only) FORMULAS_ONLY=true; shift ;;
        --dry-run)       DRY_RUN=true; shift ;;
        --delay)     DELAY="$2"; shift 2 ;;
        --help)
            head -20 "$0" | grep '^#' | sed 's/^# \?//'
            exit 0
            ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

# ============================================================
# 工具函数
# ============================================================
log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg"
    echo "$msg" >> "$LOG_FILE"
}

# 检查是否已处理过（断点续传）
is_processed() {
    local type="$1" name="$2"
    if [[ -f "$PROGRESS_FILE" ]]; then
        grep -qF "${type}:${name}" "$PROGRESS_FILE" 2>/dev/null
        return $?
    fi
    return 1
}

# 标记为已处理
mark_processed() {
    local type="$1" name="$2"
    echo "${type}:${name}" >> "$PROGRESS_FILE"
}

# ============================================================
# 登录获取 Token
# ============================================================
login() {
    log "正在登录 ${API_URL} ..."

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY-RUN] 跳过登录"
        TOKEN="dry-run-token"
        return
    fi

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "${API_URL}/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

    local http_code
    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" != "200" ]]; then
        log "登录失败 (HTTP ${http_code}): ${body}"
        exit 1
    fi

    # 提取 token — 兼容有无 jq
    if command -v jq &>/dev/null; then
        TOKEN=$(echo "$body" | jq -r '.data.token')
    else
        TOKEN=$(echo "$body" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi

    if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
        log "无法提取 token: ${body}"
        exit 1
    fi

    log "登录成功"
}

# ============================================================
# 查询单个药物（触发 AI 回退自动录入）
# ============================================================
query_herb() {
    local name="$1"

    if is_processed "herb" "$name"; then
        ((HERB_SKIP++)) || true
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY-RUN] 药物: ${name}"
        mark_processed "herb" "$name"
        ((HERB_SUCCESS++)) || true
        return
    fi

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ${TOKEN}" \
        "${API_URL}/api/v1/herbs?name=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${name}'))" 2>/dev/null || echo "${name}")")

    local http_code
    http_code=$(echo "$response" | tail -1)

    if [[ "$http_code" == "200" ]]; then
        mark_processed "herb" "$name"
        ((HERB_SUCCESS++)) || true
        log "✓ 药物: ${name}"
    else
        ((HERB_FAIL++)) || true
        log "✗ 药物: ${name} (HTTP ${http_code})"
    fi
}

# ============================================================
# 查询单个方剂（触发 AI 回退自动录入）
# ============================================================
query_formula() {
    local name="$1"

    if is_processed "formula" "$name"; then
        ((FORMULA_SKIP++)) || true
        return
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY-RUN] 方剂: ${name}"
        mark_processed "formula" "$name"
        ((FORMULA_SUCCESS++)) || true
        return
    fi

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ${TOKEN}" \
        "${API_URL}/api/v1/formulas?name=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${name}'))" 2>/dev/null || echo "${name}")")

    local http_code
    http_code=$(echo "$response" | tail -1)

    if [[ "$http_code" == "200" ]]; then
        mark_processed "formula" "$name"
        ((FORMULA_SUCCESS++)) || true
        log "✓ 方剂: ${name}"
    else
        ((FORMULA_FAIL++)) || true
        log "✗ 方剂: ${name} (HTTP ${http_code})"
    fi
}

# ============================================================
# 打印统计
# ============================================================
print_summary() {
    log "========================================"
    log "预录入完成"
    log "----------------------------------------"
    if [[ "$FORMULAS_ONLY" != true ]]; then
        log "药物: 成功=${HERB_SUCCESS} 失败=${HERB_FAIL} 跳过=${HERB_SKIP}"
    fi
    if [[ "$HERBS_ONLY" != true ]]; then
        log "方剂: 成功=${FORMULA_SUCCESS} 失败=${FORMULA_FAIL} 跳过=${FORMULA_SKIP}"
    fi
    log "日志: ${LOG_FILE}"
    log "进度: ${PROGRESS_FILE}"
    log "========================================"
}
```

**Step 2: Commit**

```bash
git add scripts/seed-herbs-formulas.sh
git commit -m "feat: add herb/formula seeding script framework with login and progress tracking"
```

---

## Task 4: 添加中药列表（≤800 种）

**Files:**
- Modify: `scripts/seed-herbs-formulas.sh`

**Step 1: 在脚本中添加 HERBS 数组**

在"工具函数"部分之前插入完整的中药列表。列表按来源/分类组织，覆盖：

- **解表药**：麻黄、桂枝、紫苏、荆芥、防风、羌活、白芷、细辛、辛夷、苍耳子、葛根、柴胡、升麻、薄荷、牛蒡子、蝉蜕、桑叶、菊花、蔓荆子、淡豆豉、浮萍、木贼
- **清热药**：石膏、知母、栀子、芦根、天花粉、竹叶、夏枯草、决明子、黄芩、黄连、黄柏、龙胆草、苦参、秦皮、白鲜皮、金银花、连翘、蒲公英、紫花地丁、板蓝根、大青叶、青黛、鱼腥草、射干、山豆根、马勃、白头翁、败酱草、红藤、土茯苓、熊胆、穿心莲、半边莲、白花蛇舌草、生地黄、玄参、牡丹皮、赤芍、紫草、水牛角、青蒿、白薇、地骨皮、银柴胡、胡黄连
- **泻下药**：大黄、芒硝、番泻叶、芦荟、火麻仁、郁李仁、甘遂、大戟、牵牛子、商陆、巴豆
- **祛风湿药**：独活、威灵仙、川乌、蕲蛇、木瓜、秦艽、防己、桑枝、豨莶草、臭梧桐、海风藤、络石藤、丝瓜络、桑寄生、五加皮、狗脊
- **化湿药**：藿香、佩兰、苍术、厚朴、砂仁、白豆蔻、草豆蔻、草果
- **利水渗湿药**：茯苓、猪苓、泽泻、薏苡仁、车前子、滑石、木通、通草、金钱草、海金沙、石韦、萆薢、瞿麦、地肤子、萹蓄、灯心草、冬瓜皮、茵陈、虎杖
- **温里药**：附子、干姜、肉桂、吴茱萸、花椒、小茴香、丁香、高良姜、胡椒、荜茇、荜澄茄
- **理气药**：陈皮、青皮、枳实、枳壳、木香、香附、乌药、沉香、檀香、川楝子、荔枝核、佛手、薤白、柿蒂、大腹皮、甘松、刀豆
- **消食药**：山楂、神曲、麦芽、谷芽、莱菔子、鸡内金、鸡矢藤
- **驱虫药**：使君子、苦楝皮、槟榔、南瓜子、鹤草芽、雷丸
- **止血药**：大蓟、小蓟、地榆、槐花、侧柏叶、白茅根、苎麻根、三七、茜草、蒲黄、花蕊石、降香、白及、仙鹤草、棕榈炭、血余炭、藕节、艾叶、炮姜
- **活血化瘀药**：川芎、延胡索、郁金、姜黄、乳香、没药、五灵脂、丹参、红花、桃仁、益母草、泽兰、牛膝、鸡血藤、王不留行、月季花、凌霄花、土鳖虫、自然铜、苏木、骨碎补、血竭、儿茶、刘寄奴、三棱、莪术、水蛭、斑蝥、穿山甲
- **化痰止咳平喘药**：半夏、天南星、白芥子、旋覆花、白前、桔梗、前胡、瓜蒌、贝母（川贝母）、浙贝母、竹茹、竹沥、天竺黄、海蛤壳、海浮石、瓦楞子、昆布、海藻、礞石、黄药子、胖大海、杏仁、紫苏子、百部、紫菀、款冬花、马兜铃、枇杷叶、桑白皮、葶苈子、白果、洋金花、矮地茶
- **安神药**：朱砂、磁石、龙骨、琥珀、酸枣仁、柏子仁、远志、合欢皮、夜交藤、灵芝
- **平肝息风药**：石决明、珍珠母、牡蛎、代赭石、刺蒺藜、罗布麻叶、羚羊角、钩藤、天麻、地龙、全蝎、蜈蚣、僵蚕
- **开窍药**：麝香、冰片、石菖蒲、苏合香
- **补气药**：人参、党参、太子参、西洋参、黄芪、白术、山药、甘草、大枣、蜂蜜、白扁豆、绞股蓝、红景天、刺五加
- **补血药**：当归、熟地黄、白芍、阿胶、何首乌、龙眼肉
- **补阴药**：北沙参、南沙参、百合、麦冬、天冬、石斛、玉竹、黄精、枸杞子、墨旱莲、女贞子、桑椹、龟甲、鳖甲
- **补阳药**：鹿茸、紫河车、淫羊藿、巴戟天、仙茅、杜仲、续断、肉苁蓉、锁阳、补骨脂、益智仁、菟丝子、沙苑子、蛤蚧、核桃仁、冬虫夏草、海马、韭菜子、阳起石
- **收涩药**：五味子、乌梅、诃子、石榴皮、肉豆蔻、赤石脂、禹余粮、山茱萸、覆盆子、桑螵蛸、金樱子、海螵蛸、莲子、芡实、椿皮、鸡冠花、刺猬皮
- **涌吐药**：常山、瓜蒂、胆矾
- **外用药**：硫磺、雄黄、蛇床子、明矾、硼砂、炉甘石、樟脑、木鳖子、蟾酥
- **其他常用**：络石藤、鬼箭羽、穿破石、八角茴香、肉桂、皂角刺、路路通、王不留行、漏芦、急性子、冬葵子、石韦、萹蓄、瞿麦

共约 550-600 种药物（去重后）。

**Step 2: Commit**

```bash
git add scripts/seed-herbs-formulas.sh
git commit -m "feat: add comprehensive herb list covering TCM classics"
```

---

## Task 5: 添加方剂列表（≤800 种）

**Files:**
- Modify: `scripts/seed-herbs-formulas.sh`

**Step 1: 在脚本中添加 FORMULAS 数组**

覆盖经典来源：

- **伤寒论方剂**（约120首）：桂枝汤、麻黄汤、葛根汤、小柴胡汤、大柴胡汤、白虎汤、承气汤类（大/小/调胃）、四逆汤、真武汤、理中汤、五苓散、猪苓汤、桃核承气汤、抵当汤、小建中汤、炙甘草汤、半夏泻心汤、黄芩汤、黄连汤、乌梅丸、当归四逆汤、吴茱萸汤、白头翁汤、四逆散、芍药甘草汤、麻杏石甘汤、越婢汤、苓桂术甘汤、柴胡桂枝汤等
- **金匮要略方剂**（约80首）：肾气丸、当归芍药散、桂枝茯苓丸、温经汤、酸枣仁汤、薯蓣丸、大黄蛰虫丸、鳖甲煎丸、甘麦大枣汤、半夏厚朴汤、瓜蒌薤白白酒汤、枳术汤、橘皮竹茹汤、排脓散等
- **温病条辨方剂**（约60首）：银翘散、桑菊饮、清营汤、犀角地黄汤、安宫牛黄丸、紫雪丹、至宝丹、三仁汤、藿朴夏苓汤、甘露消毒丹、清暑益气汤、沙参麦冬汤、增液汤、青蒿鳖甲汤、加减复脉汤、大定风珠、宣白承气汤、导赤承气汤等
- **太平惠民和剂局方**（约50首）：四君子汤、四物汤、八珍汤、十全大补汤、逍遥散、藿香正气散、参苓白术散、归脾汤、平胃散、二陈汤、消风散、苏合香丸等
- **千金方/外台秘要**（约30首）：温胆汤、犀角散、独活寄生汤等
- **丹溪心法**（约20首）：越鞠丸、大补阴丸、二妙散、左金丸等
- **景岳全书**（约20首）：左归丸、右归丸、左归饮、右归饮、济川煎、金水六君煎等
- **医学心悟**（约10首）：半夏白术天麻汤、启膈散等
- **其他经典**（约100首）：补中益气汤、六味地黄丸、知柏地黄丸、杞菊地黄丸、都气丸、龙胆泻肝汤、导赤散、泻白散、清胃散、玉女煎、普济消毒饮、仙方活命饮、阳和汤、小金丹、苇茎汤、泻心汤、保和丸、枳实导滞丸、木香槟榔丸、健脾丸、痛泻要方、天王补心丹、朱砂安神丸、甘露饮、一贯煎、大秦艽汤、川芎茶调散、牵正散、镇肝熄风汤、天麻钩藤饮、桑杏汤、杏苏散、止嗽散、清金化痰汤、滚痰丸、指迷茯苓丸、苓甘五味姜辛汤、定喘汤、苏子降气汤、小青龙汤、射干麻黄汤、月华丸、百合固金汤、养阴清肺汤、麦门冬汤、清燥救肺汤、生脉散、炙甘草汤、失笑散、血府逐瘀汤、膈下逐瘀汤、少腹逐瘀汤、身痛逐瘀汤、通窍活血汤、补阳还五汤、复元活血汤、温经汤、生化汤、桃红四物汤、丹参饮、旋覆代赭汤、橘核丸、天台乌药散、暖肝煎、四磨汤、金铃子散、瓜蒌薤白半夏汤、厚朴温中汤、苏子降气汤、定喘汤、玉屏风散、牡蛎散、当归六黄汤、九仙散、四神丸、真人养脏汤、桑螵蛸散、缩泉丸、完带汤、易黄汤、固冲汤、固经丸

共约 500-600 首方剂。

**Step 2: Commit**

```bash
git add scripts/seed-herbs-formulas.sh
git commit -m "feat: add comprehensive formula list covering TCM classics"
```

---

## Task 6: 添加主流程和执行入口

**Files:**
- Modify: `scripts/seed-herbs-formulas.sh`

**Step 1: 在脚本末尾添加主流程**

```bash
# ============================================================
# 主流程
# ============================================================
main() {
    log "========================================"
    log "中药/方剂预录入脚本"
    log "API: ${API_URL}"
    log "用户: ${USERNAME}"
    log "间隔: ${DELAY}s"
    log "模式: $(if [[ "$DRY_RUN" == true ]]; then echo '预览'; else echo '正式'; fi)"
    if [[ "$HERBS_ONLY" == true ]]; then log "范围: 仅药物"; fi
    if [[ "$FORMULAS_ONLY" == true ]]; then log "范围: 仅方剂"; fi
    log "========================================"

    # 登录
    login

    # 录入药物
    if [[ "$FORMULAS_ONLY" != true ]]; then
        log "开始录入药物 (共 ${#HERBS[@]} 种)..."
        local i=0
        for herb in "${HERBS[@]}"; do
            ((i++)) || true
            log "[药物 ${i}/${#HERBS[@]}] 查询: ${herb}"
            query_herb "$herb"
            sleep "$DELAY"
        done
    fi

    # 录入方剂
    if [[ "$HERBS_ONLY" != true ]]; then
        log "开始录入方剂 (共 ${#FORMULAS[@]} 种)..."
        local j=0
        for formula in "${FORMULAS[@]}"; do
            ((j++)) || true
            log "[方剂 ${j}/${#FORMULAS[@]}] 查询: ${formula}"
            query_formula "$formula"
            sleep "$DELAY"
        done
    fi

    # 统计
    print_summary
}

main "$@"
```

**Step 2: 设置脚本可执行权限**

```bash
chmod +x scripts/seed-herbs-formulas.sh
```

**Step 3: Commit**

```bash
git add scripts/seed-herbs-formulas.sh
git commit -m "feat: add main execution flow for herb/formula seeding script"
```

---

## Task 7: 测试脚本

**Step 1: 运行 dry-run 模式验证脚本语法和流程**

```bash
cd /Users/xiayanji/qbox/menzhen
bash scripts/seed-herbs-formulas.sh --dry-run --herbs-only
```

Expected: 看到药物列表逐个输出 `[DRY-RUN] 药物: xxx`，最终显示统计。

**Step 2: 验证方剂 dry-run**

```bash
bash scripts/seed-herbs-formulas.sh --dry-run --formulas-only
```

Expected: 看到方剂列表逐个输出 `[DRY-RUN] 方剂: xxx`，最终显示统计。

**Step 3: 验证 --help**

```bash
bash scripts/seed-herbs-formulas.sh --help
```

Expected: 显示用法说明。

---

## Task 8: 最终提交

**Step 1: 确保所有文件已提交**

```bash
git status
git log --oneline -5
```

**Step 2: 如有遗漏，补充提交**
