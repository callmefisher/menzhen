package service

import (
	"bufio"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ─── Data Structures ──────────────────────────────────────────────────────────

// MigrateTaskStatus defines lifecycle states for a migration task.
type MigrateTaskStatus string

const (
	MigrateStatusParsing  MigrateTaskStatus = "parsing"
	MigrateStatusParsed   MigrateTaskStatus = "parsed"
	MigrateStatusRunning  MigrateTaskStatus = "running"
	MigrateStatusSuccess  MigrateTaskStatus = "success"
	MigrateStatusFailed   MigrateTaskStatus = "failed"
)

// TenantTableCount holds per-table row counts for one tenant.
type TenantTableCount struct {
	TenantID   uint64         `json:"tenant_id"`
	TenantName string         `json:"tenant_name"`
	Counts     map[string]int `json:"counts"`
	TotalRows  int            `json:"total_rows"`
}

// MigrateParseResult is the output of the parse phase.
type MigrateParseResult struct {
	Tenants []*TenantTableCount `json:"tenants"`
}

// MigrateTask tracks an async parse or execute operation.
type MigrateTask struct {
	TaskID      string            `json:"task_id"`
	Status      MigrateTaskStatus `json:"status"`
	Output      string            `json:"output"`
	ParseResult *MigrateParseResult `json:"parse_result,omitempty"`
	FilePath    string            `json:"-"` // temp file path on disk
	FileName    string            `json:"file_name,omitempty"`
	StartAt     string            `json:"start_at"`
}

// ─── Table Definitions ────────────────────────────────────────────────────────

// tenantTableInfo describes how to extract tenant_id from a mysqldump INSERT row.
// colIdx is 0-based position of the tenant_id column in the dumped column order.
// For the `tenants` table, the id column IS the tenant identifier.
type tenantTableInfo struct {
	table    string
	colIdx   int  // 0-based index of tenant_id column (or id for tenants table)
	isTenantsTable bool
}

// tenantTables lists all tables that contain a direct tenant_id column.
// Column order matches GORM AutoMigrate output (CreatedAt/UpdatedAt/DeletedAt come
// from BaseModel which adds id,created_at,updated_at,deleted_at first).
//
// BaseModel columns: id(0), created_at(1), updated_at(2), deleted_at(3)
// Then struct fields in declaration order.
var tenantTables = []tenantTableInfo{
	// tenants: id(0), name(1), code(2), status(3), group_name(4), queue_enabled(5)...
	// The "tenant" IS the row itself; we identify by id column.
	{table: "tenants", colIdx: 0, isTenantsTable: true},

	// users: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),username(5),...
	{table: "users", colIdx: 4},

	// roles: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),name(5),...
	{table: "roles", colIdx: 4},

	// patients: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "patients", colIdx: 4},

	// medical_records: id(0),created_at(1),updated_at(2),deleted_at(3),patient_id(4),tenant_id(5),...
	{table: "medical_records", colIdx: 5},

	// prescriptions: id(0),created_at(1),updated_at(2),deleted_at(3),record_id(4),tenant_id(5),...
	{table: "prescriptions", colIdx: 5},

	// billings: id(0),created_at(1),updated_at(2),deleted_at(3),prescription_id(4),record_id(5),tenant_id(6),...
	{table: "billings", colIdx: 6},

	// inventory_drugs: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "inventory_drugs", colIdx: 4},

	// daily_stats: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "daily_stats", colIdx: 4},

	// daily_staff_stats: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "daily_staff_stats", colIdx: 4},

	// ai_analyses: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "ai_analyses", colIdx: 4},

	// follow_ups: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "follow_ups", colIdx: 4},

	// prescription_notifications: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "prescription_notifications", colIdx: 4},

	// op_logs: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "op_logs", colIdx: 4},

	// appointments: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "appointments", colIdx: 4},

	// appointment_slot_configs: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "appointment_slot_configs", colIdx: 4},

	// doctor_schedule_configs: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "doctor_schedule_configs", colIdx: 4},

	// queue_entries: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "queue_entries", colIdx: 4},

	// queue_seqs: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "queue_seqs", colIdx: 4},

	// queue_doctors: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "queue_doctors", colIdx: 4},

	// patient_users: id(0),created_at(1),updated_at(2),deleted_at(3),tenant_id(4),...
	{table: "patient_users", colIdx: 4},

	// patient_portal_configs: tenant_id(0) IS the primary key
	{table: "patient_portal_configs", colIdx: 0},
}

// build lookup map once at init time.
var tenantTableMap map[string]*tenantTableInfo

func init() {
	tenantTableMap = make(map[string]*tenantTableInfo, len(tenantTables))
	for i := range tenantTables {
		tenantTableMap[tenantTables[i].table] = &tenantTables[i]
	}
}

// ─── Service ──────────────────────────────────────────────────────────────────

// TenantMigrateService manages tenant migration tasks (parse + execute).
// Completely independent from BackupService.
type TenantMigrateService struct {
	db    *gorm.DB
	mu    sync.RWMutex
	tasks map[string]*MigrateTask
}

// NewTenantMigrateService creates a new service instance.
func NewTenantMigrateService(db *gorm.DB) *TenantMigrateService {
	return &TenantMigrateService{
		db:    db,
		tasks: make(map[string]*MigrateTask),
	}
}

// CreateTask allocates a new task with the given file path and returns its ID.
func (s *TenantMigrateService) CreateTask(filePath, fileName string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := uuid.New().String()
	s.tasks[id] = &MigrateTask{
		TaskID:   id,
		Status:   MigrateStatusParsing,
		FilePath: filePath,
		FileName: fileName,
		StartAt:  time.Now().Format(time.RFC3339),
	}
	return id
}

// GetTask returns a snapshot of the task (safe copy).
func (s *TenantMigrateService) GetTask(taskID string) (*MigrateTask, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tasks[taskID]
	if !ok {
		return nil, fmt.Errorf("task %s not found", taskID)
	}
	cp := *t
	return &cp, nil
}

// appendLog appends a timestamped log line to a task's output.
func (s *TenantMigrateService) appendLog(taskID, msg string) {
	ts := time.Now().Format("15:04:05")
	line := fmt.Sprintf("[%s] %s\n", ts, msg)
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tasks[taskID]; ok {
		t.Output += line
	}
	log.Printf("[tenant-migrate] %s", msg)
}

// setStatus updates a task's status (and optionally its parse result).
func (s *TenantMigrateService) setStatus(taskID string, status MigrateTaskStatus, result *MigrateParseResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tasks[taskID]; ok {
		t.Status = status
		if result != nil {
			t.ParseResult = result
		}
	}
}

// CleanupOldTasks removes completed tasks older than 1 hour.
func (s *TenantMigrateService) CleanupOldTasks() {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-1 * time.Hour)
	for id, t := range s.tasks {
		if t.Status == MigrateStatusSuccess || t.Status == MigrateStatusFailed {
			if start, err := time.Parse(time.RFC3339, t.StartAt); err == nil && start.Before(cutoff) {
				// Remove temp file if still on disk.
				if t.FilePath != "" {
					_ = os.Remove(t.FilePath)
				}
				delete(s.tasks, id)
			}
		}
	}
}

// ─── Phase 1: Parsing ─────────────────────────────────────────────────────────

// reInsertHeader matches the start of an INSERT block:
//
//	INSERT INTO `tableName` VALUES           (values on same line or next line)
//	INSERT INTO `tableName` VALUES (1,2,...) (values on same line)
var reInsertHeader = regexp.MustCompile(`(?i)^INSERT INTO \x60([^\x60]+)\x60 VALUES`)

// scanInsertBlock reads the complete VALUES string for one INSERT statement.
// mysqldump may emit:
//
//	INSERT INTO `t` VALUES\n(r1),(r2);          — values start on next line
//	INSERT INTO `t` VALUES (r1),(r2);            — values on same line
//
// It returns (tableName, valuesString, error).
// valuesString is the raw CSV of tuples, with the trailing ";" stripped.
// The scanner is left positioned at the line that contained the final ";".
func scanInsertBlock(scanner *bufio.Scanner, firstLine string) (string, string, error) {
	m := reInsertHeader.FindStringSubmatchIndex(firstLine)
	if m == nil {
		return "", "", fmt.Errorf("not an INSERT line")
	}
	tableName := firstLine[m[2]:m[3]]

	// Everything after "VALUES" on the first line.
	afterValues := strings.TrimSpace(firstLine[m[1]:])

	var sb strings.Builder
	sb.WriteString(afterValues)

	// If the first line already ends with ";" the INSERT is complete.
	if strings.HasSuffix(strings.TrimSpace(afterValues), ";") {
		val := strings.TrimRight(strings.TrimSpace(sb.String()), ";")
		return tableName, val, nil
	}

	// Otherwise keep reading lines until we hit one ending with ";"
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		sb.WriteByte('\n')
		sb.WriteString(trimmed)
		if strings.HasSuffix(trimmed, ";") {
			break
		}
	}

	val := strings.TrimRight(strings.TrimSpace(sb.String()), ";")
	return tableName, val, nil
}

// ParseSQLAsync launches async SQL parsing for a given task.
func (s *TenantMigrateService) ParseSQLAsync(taskID string) {
	go func() {
		task, err := s.GetTask(taskID)
		if err != nil {
			return
		}
		s.appendLog(taskID, fmt.Sprintf("开始解析文件：%s", task.FileName))
		result, err := s.parseSQLFile(taskID, task.FilePath)
		if err != nil {
			s.appendLog(taskID, "解析失败："+err.Error())
			s.setStatus(taskID, MigrateStatusFailed, nil)
			return
		}
		s.appendLog(taskID, fmt.Sprintf("解析完成，发现 %d 个诊所", len(result.Tenants)))
		s.setStatus(taskID, MigrateStatusParsed, result)
	}()
}

// parseSQLFile reads the SQL file and counts rows per (tenant_id, table).
func (s *TenantMigrateService) parseSQLFile(taskID, filePath string) (*MigrateParseResult, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("无法打开文件: %w", err)
	}
	defer f.Close()

	var reader io.Reader = f
	if strings.HasSuffix(strings.ToLower(filePath), ".gz") {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return nil, fmt.Errorf("gzip 解压失败: %w", err)
		}
		defer gz.Close()
		reader = gz
	}

	// tenantID -> (tableName -> count)
	counts := make(map[uint64]map[string]int)
	// tenantID -> name (from tenants table)
	names := make(map[uint64]string)

	// Track column positions from CREATE TABLE statements.
	// dynamicCols[tableName] = map[colName]index
	dynamicCols := make(map[string]map[string]int)

	scanner := bufio.NewScanner(reader)
	// Increase scanner buffer for long INSERT lines (up to 64 MB).
	buf := make([]byte, 0, 1*1024*1024)
	scanner.Buffer(buf, 64*1024*1024)

	lineNum := 0
	for scanner.Scan() {
		line := scanner.Text()
		lineNum++

		// Parse CREATE TABLE to get dynamic column positions.
		if strings.HasPrefix(line, "CREATE TABLE `") {
			tableName, cols := parseCreateTable(scanner, line)
			if tableName != "" {
				dynamicCols[tableName] = cols
			}
			continue
		}

		// Only process INSERT INTO lines.
		if !reInsertHeader.MatchString(line) {
			continue
		}

		tableName, valuesStr, err := scanInsertBlock(scanner, line)
		if err != nil || valuesStr == "" {
			continue
		}

		info, ok := tenantTableMap[tableName]
		if !ok {
			continue // not a tenant table, skip
		}

		// Determine actual tenant_id column index, preferring dynamic parse.
		tidIdx := info.colIdx
		if cols, hasDyn := dynamicCols[tableName]; hasDyn {
			if idx, ok := cols["tenant_id"]; ok {
				tidIdx = idx
			} else if info.isTenantsTable {
				if idx, ok := cols["id"]; ok {
					tidIdx = idx
				}
			}
		}

		tuples := splitTuples(valuesStr)
		for _, tuple := range tuples {
			tenantID, err := extractUint64Col(tuple, tidIdx)
			if err != nil {
				continue
			}
			if _, exists := counts[tenantID]; !exists {
				counts[tenantID] = make(map[string]int)
			}
			counts[tenantID][tableName]++

			// For tenants table, also capture the name.
			if info.isTenantsTable {
				nameIdx := 1
				if cols, hasDyn := dynamicCols[tableName]; hasDyn {
					if idx, ok := cols["name"]; ok {
						nameIdx = idx
					}
				}
				if name, err := extractStringCol(tuple, nameIdx); err == nil && name != "" {
					names[tenantID] = name
				}
			}
		}

		if lineNum%50000 == 0 {
			s.appendLog(taskID, fmt.Sprintf("已扫描 %d 行...", lineNum))
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取文件出错: %w", err)
	}

	// Build result.
	result := &MigrateParseResult{}
	for tid, tableMap := range counts {
		tc := &TenantTableCount{
			TenantID:   tid,
			TenantName: names[tid],
			Counts:     tableMap,
		}
		for _, n := range tableMap {
			tc.TotalRows += n
		}
		result.Tenants = append(result.Tenants, tc)
	}

	// Sort by tenant_id for stable output.
	for i := 0; i < len(result.Tenants); i++ {
		for j := i + 1; j < len(result.Tenants); j++ {
			if result.Tenants[i].TenantID > result.Tenants[j].TenantID {
				result.Tenants[i], result.Tenants[j] = result.Tenants[j], result.Tenants[i]
			}
		}
	}

	return result, nil
}

// ─── Phase 2: Execution ───────────────────────────────────────────────────────

// ExecuteRequest holds parameters for the migration execution phase.
type ExecuteRequest struct {
	TaskID         string `json:"task_id"`
	SourceTenantID uint64 `json:"source_tenant_id"`
	TargetTenantID uint64 `json:"target_tenant_id"`
}

// ExecuteAsync launches async tenant data migration.
func (s *TenantMigrateService) ExecuteAsync(req ExecuteRequest) error {
	task, err := s.GetTask(req.TaskID)
	if err != nil {
		return fmt.Errorf("task not found: %w", err)
	}
	if task.Status != MigrateStatusParsed {
		return fmt.Errorf("任务状态不正确（需为 parsed），当前：%s", task.Status)
	}

	s.setStatus(req.TaskID, MigrateStatusRunning, nil)
	go func() {
		if err := s.executeMigrate(req); err != nil {
			s.appendLog(req.TaskID, "迁移失败："+err.Error())
			s.setStatus(req.TaskID, MigrateStatusFailed, nil)
			return
		}
		s.setStatus(req.TaskID, MigrateStatusSuccess, nil)
		s.appendLog(req.TaskID, "迁移完成 ✓")
	}()
	return nil
}

// executeMigrate performs the actual DELETE + INSERT migration inside a transaction.
func (s *TenantMigrateService) executeMigrate(req ExecuteRequest) error {
	task, err := s.GetTask(req.TaskID)
	if err != nil {
		return err
	}

	s.appendLog(req.TaskID, fmt.Sprintf(
		"开始迁移：源诊所 ID=%d → 目标诊所 ID=%d", req.SourceTenantID, req.TargetTenantID))

	// Re-parse file to collect actual row data grouped by table.
	s.appendLog(req.TaskID, "读取备份文件，提取数据行...")
	rowsByTable, tenantsRow, dynamicCols, err := s.collectRows(task.FilePath, req.SourceTenantID)
	if err != nil {
		return fmt.Errorf("读取备份数据失败: %w", err)
	}

	totalTables := len(rowsByTable)
	s.appendLog(req.TaskID, fmt.Sprintf("已提取 %d 张表的数据，开始写入数据库...", totalTables))

	// Execute inside a transaction.
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET FOREIGN_KEY_CHECKS = 0").Error; err != nil {
			return fmt.Errorf("禁用 FK 检查失败: %w", err)
		}
		migrateErr := s.doMigrate(tx, req, rowsByTable, tenantsRow, dynamicCols)
		// Always restore FK checks on this connection regardless of outcome,
		// so the connection is clean when returned to the pool.
		if restoreErr := tx.Exec("SET FOREIGN_KEY_CHECKS = 1").Error; restoreErr != nil {
			s.appendLog(req.TaskID, fmt.Sprintf("警告：恢复 FK 检查失败: %v", restoreErr))
		}
		return migrateErr
	})
}

// doMigrate performs the actual DELETE + INSERT steps inside the transaction.
func (s *TenantMigrateService) doMigrate(tx *gorm.DB, req ExecuteRequest, rowsByTable map[string][]string, tenantsRow string, dynamicCols map[string]map[string]int) error {
	// ── Step 1: delete target tenant data ──────────────────────────────
	s.appendLog(req.TaskID, "清除目标诊所旧数据...")

	// record_attachments (via medical_records)
	if err := tx.Exec(
		"DELETE ra FROM record_attachments ra "+
			"INNER JOIN medical_records mr ON ra.record_id = mr.id "+
			"WHERE mr.tenant_id = ?", req.TargetTenantID).Error; err != nil {
		return fmt.Errorf("删除 record_attachments 失败: %w", err)
	}

	// op_logs cross-tenant: powerAdmin users from this tenant may have acted on
	// other tenants, leaving op_logs with tenant_id≠target but user_id pointing
	// to a user being deleted. Must clean these up before deleting users.
	// (Must run before directDeleteOrder touches users.)
	if err := tx.Exec(
		"DELETE FROM op_logs WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)",
		req.TargetTenantID).Error; err != nil {
		return fmt.Errorf("删除跨租户 op_logs 失败: %w", err)
	}

	// prescription_items (via prescriptions)
	if err := tx.Exec(
		"DELETE pi FROM prescription_items pi "+
			"INNER JOIN prescriptions p ON pi.prescription_id = p.id "+
			"WHERE p.tenant_id = ?", req.TargetTenantID).Error; err != nil {
		return fmt.Errorf("删除 prescription_items 失败: %w", err)
	}

	// user_roles (via users)
	if err := tx.Exec(
		"DELETE ur FROM user_roles ur "+
			"INNER JOIN users u ON ur.user_id = u.id "+
			"WHERE u.tenant_id = ?", req.TargetTenantID).Error; err != nil {
		return fmt.Errorf("删除 user_roles 失败: %w", err)
	}

	// role_permissions (via roles)
	if err := tx.Exec(
		"DELETE rp FROM role_permissions rp "+
			"INNER JOIN roles r ON rp.role_id = r.id "+
			"WHERE r.tenant_id = ?", req.TargetTenantID).Error; err != nil {
		return fmt.Errorf("删除 role_permissions 失败: %w", err)
	}

	// Direct tenant_id tables (reverse dependency order).
	// Indirect tables (record_attachments, prescription_items, user_roles,
	// role_permissions) have no tenant_id column and are already handled
	// by the JOIN deletes above — do NOT include them here.
	directDeleteOrder := []string{
		"op_logs", "ai_analyses", "daily_staff_stats", "daily_stats",
		"billings", "prescription_notifications", "prescriptions",
		"medical_records", "follow_ups", "appointments",
		"appointment_slot_configs", "doctor_schedule_configs",
		"queue_entries", "queue_seqs", "queue_doctors",
		"patient_users", "patient_portal_configs",
		"inventory_drugs", "patients",
		"users", "roles",
	}
	for _, tbl := range directDeleteOrder {
		col := "tenant_id"
		if tbl == "patient_portal_configs" {
			col = "tenant_id" // PK is tenant_id, same DELETE syntax
		}
		if err := tx.Exec(
			fmt.Sprintf("DELETE FROM `%s` WHERE `%s` = ?", tbl, col),
			req.TargetTenantID).Error; err != nil {
			return fmt.Errorf("删除 %s 失败: %w", tbl, err)
		}
	}

	// Delete from tenants last.
	if err := tx.Exec("DELETE FROM `tenants` WHERE `id` = ?", req.TargetTenantID).Error; err != nil {
		return fmt.Errorf("删除 tenants 失败: %w", err)
	}

	// ── Step 2: insert tenants row ──────────────────────────────────────
	if tenantsRow != "" {
		rewritten, err := rewriteCol(tenantsRow, 0, strconv.FormatUint(req.TargetTenantID, 10))
		if err != nil {
			s.appendLog(req.TaskID, fmt.Sprintf("警告：改写 tenants 行 tenant_id 失败: %v", err))
			rewritten = tenantsRow
		}
		sql := fmt.Sprintf("INSERT IGNORE INTO `tenants` VALUES %s", rewritten)
		if err := tx.Exec(sql).Error; err != nil {
			return fmt.Errorf("写入 tenants 失败: %w", err)
		}
		s.appendLog(req.TaskID, "已写入诊所基本信息")
	}

	// ── Step 3: insert direct tenant tables in dependency order ─────────
	insertOrder := []string{
		"users", "roles",
		"patients",
		"medical_records",
		"prescriptions",
		"billings",
		"inventory_drugs",
		"daily_stats", "daily_staff_stats",
		"ai_analyses",
		"follow_ups",
		"prescription_notifications",
		// op_logs intentionally excluded: not needed for clinic migration
		"appointments", "appointment_slot_configs",
		"doctor_schedule_configs",
		"queue_entries", "queue_seqs", "queue_doctors",
		"patient_users", "patient_portal_configs",
	}

	for _, tbl := range insertOrder {
		rows, ok := rowsByTable[tbl]
		if !ok || len(rows) == 0 {
			continue
		}

		info := tenantTableMap[tbl]
		tidCol := "tenant_id"
		// Use dynamic column position from CREATE TABLE parse; fall back to hardcoded.
		tidIdx := info.colIdx
		if cols, ok := dynamicCols[tbl]; ok {
			if info.isTenantsTable {
				if idx, ok2 := cols["id"]; ok2 {
					tidIdx = idx
				}
			} else {
				if idx, ok2 := cols["tenant_id"]; ok2 {
					tidIdx = idx
				}
			}
		}
		if info.isTenantsTable {
			tidCol = "id"
		}

		inserted := 0
		batchSize := 200
		for start := 0; start < len(rows); start += batchSize {
			end := start + batchSize
			if end > len(rows) {
				end = len(rows)
			}
			batch := rows[start:end]

			rewritten := make([]string, 0, len(batch))
			targetIDStr := strconv.FormatUint(req.TargetTenantID, 10)
			for _, tuple := range batch {
				rw, err := rewriteCol(tuple, tidIdx, targetIDStr)
				if err != nil {
					s.appendLog(req.TaskID, fmt.Sprintf("警告：改写 %s.%s 失败: %v", tbl, tidCol, err))
					rw = tuple
				}
				rewritten = append(rewritten, rw)
			}

			sql := fmt.Sprintf("INSERT IGNORE INTO `%s` VALUES %s",
				tbl, strings.Join(rewritten, ","))
			if err := tx.Exec(sql).Error; err != nil {
				return fmt.Errorf("写入 %s 失败: %w", tbl, err)
			}
			inserted += len(batch)
		}
		s.appendLog(req.TaskID, fmt.Sprintf("已写入 %s: %d 行 ✓", tbl, inserted))
	}

	// ── Step 4: handle indirect tables ─────────────────────────────────
	for _, tbl := range []string{"prescription_items", "record_attachments", "user_roles", "role_permissions"} {
		rows, ok := rowsByTable[tbl]
		if !ok || len(rows) == 0 {
			continue
		}
		for start := 0; start < len(rows); start += 200 {
			end := start + 200
			if end > len(rows) {
				end = len(rows)
			}
			sql := fmt.Sprintf("INSERT IGNORE INTO `%s` VALUES %s",
				tbl, strings.Join(rows[start:end], ","))
			if err := tx.Exec(sql).Error; err != nil {
				return fmt.Errorf("写入 %s 失败: %w", tbl, err)
			}
		}
		s.appendLog(req.TaskID, fmt.Sprintf("已写入 %s: %d 行 ✓", tbl, len(rows)))
	}

	return nil
}

// collectRows re-reads the SQL file and collects all row tuples for the given
// source tenant, grouped by table name.
// Also returns the raw tuple string for the tenants table row and the dynamic
// column-position map (used by doMigrate to rewrite tenant_id at the correct index).
func (s *TenantMigrateService) collectRows(filePath string, sourceTenantID uint64) (
	rowsByTable map[string][]string, tenantsRow string, dynamicCols map[string]map[string]int, err error,
) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, "", nil, fmt.Errorf("无法打开文件: %w", err)
	}
	defer f.Close()

	var reader io.Reader = f
	if strings.HasSuffix(strings.ToLower(filePath), ".gz") {
		gz, gzErr := gzip.NewReader(f)
		if gzErr != nil {
			return nil, "", nil, fmt.Errorf("gzip 解压失败: %w", gzErr)
		}
		defer gz.Close()
		reader = gz
	}

	rowsByTable = make(map[string][]string)
	dynamicCols = make(map[string]map[string]int)

	scanner := bufio.NewScanner(reader)
	buf := make([]byte, 0, 1*1024*1024)
	scanner.Buffer(buf, 64*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "CREATE TABLE `") {
			tableName, cols := parseCreateTable(scanner, line)
			if tableName != "" {
				dynamicCols[tableName] = cols
			}
			continue
		}

		if !reInsertHeader.MatchString(line) {
			continue
		}

		tableName, valuesStr, err := scanInsertBlock(scanner, line)
		if err != nil || valuesStr == "" {
			continue
		}

		// For indirect tables, collect all rows (we'll filter by FK later).
		isIndirect := tableName == "prescription_items" ||
			tableName == "record_attachments" ||
			tableName == "user_roles" ||
			tableName == "role_permissions"

		info, hasTenantInfo := tenantTableMap[tableName]
		if !hasTenantInfo && !isIndirect {
			continue
		}

		tuples := splitTuples(valuesStr)

		if isIndirect {
			rowsByTable[tableName] = append(rowsByTable[tableName], tuples...)
			continue
		}

		tidIdx := info.colIdx
		if cols, hasDyn := dynamicCols[tableName]; hasDyn {
			if idx, ok := cols["tenant_id"]; ok {
				tidIdx = idx
			} else if info.isTenantsTable {
				if idx, ok := cols["id"]; ok {
					tidIdx = idx
				}
			}
		}

		for _, tuple := range tuples {
			tid, err := extractUint64Col(tuple, tidIdx)
			if err != nil {
				continue
			}
			if tid != sourceTenantID {
				continue
			}
			if info.isTenantsTable {
				tenantsRow = tuple
				continue
			}
			rowsByTable[tableName] = append(rowsByTable[tableName], tuple)
		}
	}

	return rowsByTable, tenantsRow, dynamicCols, scanner.Err()
}

// ─── SQL Parsing Helpers ──────────────────────────────────────────────────────

// parseCreateTable reads until the closing ");" / ") ENGINE=" of a CREATE TABLE
// statement and returns the table name + a map of colName -> 0-based index.
// It correctly skips KEY/INDEX/PRIMARY KEY/UNIQUE KEY constraint lines.
func parseCreateTable(scanner *bufio.Scanner, firstLine string) (string, map[string]int) {
	reTable := regexp.MustCompile("CREATE TABLE `([^`]+)`")
	m := reTable.FindStringSubmatch(firstLine)
	if m == nil {
		return "", nil
	}
	tableName := m[1]
	cols := make(map[string]int)
	colIdx := 0

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// End of CREATE TABLE block.
		if strings.HasPrefix(line, ")") {
			break
		}
		// Column definition lines start with a backtick.
		// Skip constraint lines: PRIMARY KEY, KEY, UNIQUE KEY, INDEX, CONSTRAINT.
		upper := strings.ToUpper(line)
		if strings.HasPrefix(upper, "PRIMARY") ||
			strings.HasPrefix(upper, "KEY") ||
			strings.HasPrefix(upper, "UNIQUE") ||
			strings.HasPrefix(upper, "INDEX") ||
			strings.HasPrefix(upper, "CONSTRAINT") ||
			strings.HasPrefix(upper, "FULLTEXT") {
			continue
		}
		if strings.HasPrefix(line, "`") {
			end := strings.Index(line[1:], "`")
			if end >= 0 {
				colName := line[1 : end+1]
				cols[colName] = colIdx
				colIdx++
			}
		}
	}
	return tableName, cols
}

// splitTuples splits a VALUES clause "(a,b),(c,d),..." into individual tuple strings.
// Each returned string includes the surrounding parentheses: "(a,b)".
func splitTuples(values string) []string {
	var result []string
	depth := 0
	inStr := false
	escape := false
	start := -1

	for i := 0; i < len(values); i++ {
		ch := values[i]
		if escape {
			escape = false
			continue
		}
		if ch == '\\' && inStr {
			escape = true
			continue
		}
		if ch == '\'' && !inStr {
			inStr = true
			continue
		}
		if ch == '\'' && inStr {
			// Handle escaped quote ''
			if i+1 < len(values) && values[i+1] == '\'' {
				i++
				continue
			}
			inStr = false
			continue
		}
		if inStr {
			continue
		}
		if ch == '(' {
			if depth == 0 {
				start = i
			}
			depth++
		} else if ch == ')' {
			depth--
			if depth == 0 && start >= 0 {
				result = append(result, values[start:i+1])
				start = -1
			}
		}
	}
	return result
}

// extractUint64Col extracts the value at position colIdx from a tuple string
// "(v0,v1,...)" and parses it as uint64.
func extractUint64Col(tuple string, colIdx int) (uint64, error) {
	val, err := extractRawCol(tuple, colIdx)
	if err != nil {
		return 0, err
	}
	val = strings.Trim(val, "'` ")
	n, err := strconv.ParseUint(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("column %d value %q is not uint64: %w", colIdx, val, err)
	}
	return n, nil
}

// extractStringCol extracts the string value at colIdx, unquoted.
func extractStringCol(tuple string, colIdx int) (string, error) {
	val, err := extractRawCol(tuple, colIdx)
	if err != nil {
		return "", err
	}
	// Strip surrounding single quotes.
	if len(val) >= 2 && val[0] == '\'' && val[len(val)-1] == '\'' {
		val = val[1 : len(val)-1]
		// Unescape '' -> '
		val = strings.ReplaceAll(val, "''", "'")
		val = strings.ReplaceAll(val, "\\'", "'")
	}
	return val, nil
}

// extractRawCol returns the raw (unprocessed) token at position colIdx inside
// a tuple string "(v0, v1, v2, ...)".
func extractRawCol(tuple string, colIdx int) (string, error) {
	// Strip outer parentheses.
	if len(tuple) < 2 || tuple[0] != '(' || tuple[len(tuple)-1] != ')' {
		return "", fmt.Errorf("invalid tuple: %q", tuple)
	}
	inner := tuple[1 : len(tuple)-1]

	idx := 0
	inStr := false
	escape := false
	tokenStart := 0

	for i := 0; i < len(inner); i++ {
		ch := inner[i]
		if escape {
			escape = false
			continue
		}
		if ch == '\\' && inStr {
			escape = true
			continue
		}
		if ch == '\'' && !inStr {
			inStr = true
			continue
		}
		if ch == '\'' && inStr {
			if i+1 < len(inner) && inner[i+1] == '\'' {
				i++
				continue
			}
			inStr = false
			continue
		}
		if inStr {
			continue
		}
		if ch == ',' {
			if idx == colIdx {
				return strings.TrimSpace(inner[tokenStart:i]), nil
			}
			idx++
			tokenStart = i + 1
		}
	}
	// Last token.
	if idx == colIdx {
		return strings.TrimSpace(inner[tokenStart:]), nil
	}
	return "", fmt.Errorf("column index %d out of range", colIdx)
}

// rewriteCol returns a new tuple string with the value at colIdx replaced by newVal.
func rewriteCol(tuple string, colIdx int, newVal string) (string, error) {
	if len(tuple) < 2 || tuple[0] != '(' || tuple[len(tuple)-1] != ')' {
		return tuple, fmt.Errorf("invalid tuple: %q", tuple)
	}
	inner := tuple[1 : len(tuple)-1]

	idx := 0
	inStr := false
	escape := false
	tokenStart := 0
	var sb strings.Builder
	sb.WriteByte('(')

	for i := 0; i < len(inner); i++ {
		ch := inner[i]
		if escape {
			escape = false
			continue
		}
		if ch == '\\' && inStr {
			escape = true
			continue
		}
		if ch == '\'' && !inStr {
			inStr = true
			continue
		}
		if ch == '\'' && inStr {
			if i+1 < len(inner) && inner[i+1] == '\'' {
				i++
				continue
			}
			inStr = false
			continue
		}
		if inStr {
			continue
		}
		if ch == ',' {
			if idx == colIdx {
				sb.WriteString(newVal)
			} else {
				sb.WriteString(inner[tokenStart:i])
			}
			sb.WriteByte(',')
			idx++
			tokenStart = i + 1
		}
	}
	// Last token.
	if idx == colIdx {
		sb.WriteString(newVal)
	} else {
		sb.WriteString(inner[tokenStart:])
	}
	sb.WriteByte(')')
	return sb.String(), nil
}
