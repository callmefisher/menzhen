package service

import (
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ─── splitTuples ─────────────────────────────────────────────────────────────

func TestSplitTuples_Simple(t *testing.T) {
	tuples := splitTuples("(1,2,'hello'),(3,4,'world')")
	require.Len(t, tuples, 2)
	assert.Equal(t, "(1,2,'hello')", tuples[0])
	assert.Equal(t, "(3,4,'world')", tuples[1])
}

func TestSplitTuples_SingleRow(t *testing.T) {
	tuples := splitTuples("(1,2,3)")
	require.Len(t, tuples, 1)
	assert.Equal(t, "(1,2,3)", tuples[0])
}

func TestSplitTuples_EscapedQuoteInString(t *testing.T) {
	// Quoted string with escaped single quote inside
	tuples := splitTuples(`(1,'it''s fine',3),(4,'ok',5)`)
	require.Len(t, tuples, 2)
	assert.Equal(t, `(1,'it''s fine',3)`, tuples[0])
}

func TestSplitTuples_NullValue(t *testing.T) {
	tuples := splitTuples("(1,NULL,'test')")
	require.Len(t, tuples, 1)
	assert.Equal(t, "(1,NULL,'test')", tuples[0])
}

func TestSplitTuples_Empty(t *testing.T) {
	tuples := splitTuples("")
	assert.Len(t, tuples, 0)
}

// ─── extractRawCol ────────────────────────────────────────────────────────────

func TestExtractRawCol_Numeric(t *testing.T) {
	v, err := extractRawCol("(10,20,30)", 0)
	require.NoError(t, err)
	assert.Equal(t, "10", v)

	v, err = extractRawCol("(10,20,30)", 2)
	require.NoError(t, err)
	assert.Equal(t, "30", v)
}

func TestExtractRawCol_QuotedString(t *testing.T) {
	v, err := extractRawCol("(1,'hello world',3)", 1)
	require.NoError(t, err)
	assert.Equal(t, "'hello world'", v)
}

func TestExtractRawCol_NULL(t *testing.T) {
	v, err := extractRawCol("(1,NULL,3)", 1)
	require.NoError(t, err)
	assert.Equal(t, "NULL", v)
}

func TestExtractRawCol_OutOfRange(t *testing.T) {
	_, err := extractRawCol("(1,2,3)", 5)
	assert.Error(t, err)
}

func TestExtractRawCol_InvalidTuple(t *testing.T) {
	_, err := extractRawCol("not a tuple", 0)
	assert.Error(t, err)
}

// ─── extractUint64Col ─────────────────────────────────────────────────────────

func TestExtractUint64Col(t *testing.T) {
	v, err := extractUint64Col("(0,1,42,99)", 2)
	require.NoError(t, err)
	assert.Equal(t, uint64(42), v)
}

func TestExtractUint64Col_NonNumeric(t *testing.T) {
	_, err := extractUint64Col("(1,'text',3)", 1)
	assert.Error(t, err)
}

// ─── extractStringCol ─────────────────────────────────────────────────────────

func TestExtractStringCol(t *testing.T) {
	v, err := extractStringCol("(1,'hello',3)", 1)
	require.NoError(t, err)
	assert.Equal(t, "hello", v)
}

func TestExtractStringCol_EscapedQuote(t *testing.T) {
	v, err := extractStringCol(`(1,'it''s',3)`, 1)
	require.NoError(t, err)
	assert.Equal(t, "it's", v)
}

// ─── rewriteCol ──────────────────────────────────────────────────────────────

func TestRewriteCol_FirstCol(t *testing.T) {
	out, err := rewriteCol("(1,2,3)", 0, "99")
	require.NoError(t, err)
	assert.Equal(t, "(99,2,3)", out)
}

func TestRewriteCol_MiddleCol(t *testing.T) {
	out, err := rewriteCol("(1,2,3)", 1, "99")
	require.NoError(t, err)
	assert.Equal(t, "(1,99,3)", out)
}

func TestRewriteCol_LastCol(t *testing.T) {
	out, err := rewriteCol("(1,2,3)", 2, "99")
	require.NoError(t, err)
	assert.Equal(t, "(1,2,99)", out)
}

func TestRewriteCol_WithString(t *testing.T) {
	out, err := rewriteCol("(1,'hello',7)", 0, "5")
	require.NoError(t, err)
	assert.Equal(t, "(5,'hello',7)", out)
}

func TestRewriteCol_TenantIDPattern(t *testing.T) {
	// Simulates rewriting tenant_id from 3 to 9 in a typical row.
	// Row: (id, created_at, updated_at, deleted_at, tenant_id, ...)
	tuple := "(100,'2024-01-01 00:00:00','2024-01-01 00:00:00',NULL,3,'张三')"
	out, err := rewriteCol(tuple, 4, "9")
	require.NoError(t, err)
	// tenant_id at index 4 should now be 9
	v, err := extractUint64Col(out, 4)
	require.NoError(t, err)
	assert.Equal(t, uint64(9), v)
	// Other cols unchanged
	v0, _ := extractUint64Col(out, 0)
	assert.Equal(t, uint64(100), v0)
}

// ─── parseSQLFile ─────────────────────────────────────────────────────────────

// buildTestSQL generates a minimal mysqldump snippet for testing.
// Uses single-line INSERT format (legacy/compact mode).
func buildTestSQL() string {
	return `-- MySQL dump
SET NAMES utf8mb4;

CREATE TABLE ` + "`tenants`" + ` (
  ` + "`id`" + ` bigint unsigned NOT NULL AUTO_INCREMENT,
  ` + "`name`" + ` varchar(100) NOT NULL,
  ` + "`code`" + ` varchar(50) NOT NULL,
  ` + "`status`" + ` tinyint NOT NULL DEFAULT '1',
  ` + "`group_name`" + ` varchar(100) NOT NULL DEFAULT 'default',
  ` + "`created_at`" + ` datetime NOT NULL,
  PRIMARY KEY (` + "`id`" + `),
  UNIQUE KEY ` + "`idx_tenants_code`" + ` (` + "`code`" + `)
) ENGINE=InnoDB;

INSERT INTO ` + "`tenants`" + ` VALUES (1,'仁心诊所','clinic1',1,'default','2024-01-01 00:00:00'),(3,'康源医疗','clinic3',1,'default','2024-01-01 00:00:00');

CREATE TABLE ` + "`patients`" + ` (
  ` + "`id`" + ` bigint unsigned NOT NULL AUTO_INCREMENT,
  ` + "`created_at`" + ` datetime NOT NULL,
  ` + "`updated_at`" + ` datetime NOT NULL,
  ` + "`deleted_at`" + ` datetime DEFAULT NULL,
  ` + "`tenant_id`" + ` bigint unsigned NOT NULL,
  ` + "`name`" + ` varchar(50) NOT NULL,
  ` + "`gender`" + ` tinyint NOT NULL,
  ` + "`age`" + ` int DEFAULT NULL,
  ` + "`created_by`" + ` bigint unsigned NOT NULL,
  PRIMARY KEY (` + "`id`" + `)
) ENGINE=InnoDB;

INSERT INTO ` + "`patients`" + ` VALUES (1,'2024-01-01 00:00:00','2024-01-01 00:00:00',NULL,1,'张三',1,35,10),(2,'2024-01-01 00:00:00','2024-01-01 00:00:00',NULL,1,'李四',2,28,10),(3,'2024-01-01 00:00:00','2024-01-01 00:00:00',NULL,3,'王五',1,45,20);

CREATE TABLE ` + "`medical_records`" + ` (
  ` + "`id`" + ` bigint unsigned NOT NULL AUTO_INCREMENT,
  ` + "`created_at`" + ` datetime NOT NULL,
  ` + "`updated_at`" + ` datetime NOT NULL,
  ` + "`deleted_at`" + ` datetime DEFAULT NULL,
  ` + "`patient_id`" + ` bigint unsigned NOT NULL,
  ` + "`tenant_id`" + ` bigint unsigned NOT NULL,
  ` + "`diagnosis`" + ` text,
  ` + "`visit_date`" + ` date NOT NULL,
  ` + "`created_by`" + ` bigint unsigned NOT NULL,
  PRIMARY KEY (` + "`id`" + `)
) ENGINE=InnoDB;

INSERT INTO ` + "`medical_records`" + ` VALUES (1,'2024-01-01 00:00:00','2024-01-01 00:00:00',NULL,1,1,'感冒','2024-01-01',10),(2,'2024-01-01 00:00:00','2024-01-01 00:00:00',NULL,3,3,'头痛','2024-01-02',20);
`
}

// buildTestSQLMultiLine generates mysqldump output using the multi-line INSERT
// format (default for MySQL 8.0+): VALUES on its own line, each tuple on its own line.
func buildTestSQLMultiLine() string {
	return `-- MySQL dump 10.13  Distrib 8.0.36
SET NAMES utf8mb4;

CREATE TABLE ` + "`tenants`" + ` (
  ` + "`id`" + ` bigint unsigned NOT NULL AUTO_INCREMENT,
  ` + "`name`" + ` varchar(100) NOT NULL,
  ` + "`code`" + ` varchar(50) NOT NULL,
  ` + "`status`" + ` tinyint NOT NULL DEFAULT '1' COMMENT '1=enabled 0=disabled',
  ` + "`created_at`" + ` datetime(3) DEFAULT NULL,
  ` + "`queue_enabled`" + ` tinyint(1) DEFAULT '1',
  ` + "`group_name`" + ` varchar(100) NOT NULL DEFAULT 'default',
  PRIMARY KEY (` + "`id`" + `),
  UNIQUE KEY ` + "`idx_tenants_code`" + ` (` + "`code`" + `)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4;

LOCK TABLES ` + "`tenants`" + ` WRITE;
INSERT INTO ` + "`tenants`" + ` VALUES
(1,'仁心诊所','clinic1',1,'2026-01-01 00:00:00.000',1,'default'),
(3,'康源医疗','clinic3',1,'2026-01-02 00:00:00.000',1,'default');
UNLOCK TABLES;

CREATE TABLE ` + "`patients`" + ` (
  ` + "`id`" + ` bigint unsigned NOT NULL AUTO_INCREMENT,
  ` + "`created_at`" + ` datetime(3) DEFAULT NULL,
  ` + "`updated_at`" + ` datetime(3) DEFAULT NULL,
  ` + "`deleted_at`" + ` datetime(3) DEFAULT NULL,
  ` + "`tenant_id`" + ` bigint unsigned NOT NULL,
  ` + "`name`" + ` varchar(50) NOT NULL,
  ` + "`gender`" + ` tinyint NOT NULL,
  ` + "`age`" + ` int DEFAULT NULL,
  ` + "`created_by`" + ` bigint unsigned NOT NULL,
  PRIMARY KEY (` + "`id`" + `),
  KEY ` + "`idx_tenant_name`" + ` (` + "`tenant_id`" + `,` + "`name`" + `)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4;

LOCK TABLES ` + "`patients`" + ` WRITE;
INSERT INTO ` + "`patients`" + ` VALUES
(1,'2024-01-01 00:00:00.000','2024-01-01 00:00:00.000',NULL,1,'张三',1,35,10),
(2,'2024-01-01 00:00:00.000','2024-01-01 00:00:00.000',NULL,1,'李四',2,28,10),
(3,'2024-01-01 00:00:00.000','2024-01-01 00:00:00.000',NULL,3,'王五',1,45,20);
UNLOCK TABLES;
`
}

func TestParseSQLFile_Plain(t *testing.T) {
	dir := t.TempDir()
	sqlPath := filepath.Join(dir, "test.sql")
	require.NoError(t, os.WriteFile(sqlPath, []byte(buildTestSQL()), 0644))

	svc := &TenantMigrateService{tasks: make(map[string]*MigrateTask)}
	taskID := svc.CreateTask(sqlPath, "test.sql")
	result, err := svc.parseSQLFile(taskID, sqlPath)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.Tenants, 2, "should find 2 tenants")

	// Find tenant 1
	var t1, t3 *TenantTableCount
	for _, tc := range result.Tenants {
		switch tc.TenantID {
		case 1:
			t1 = tc
		case 3:
			t3 = tc
		}
	}

	require.NotNil(t, t1)
	assert.Equal(t, "仁心诊所", t1.TenantName)
	assert.Equal(t, 2, t1.Counts["patients"])
	assert.Equal(t, 1, t1.Counts["medical_records"])

	require.NotNil(t, t3)
	assert.Equal(t, "康源医疗", t3.TenantName)
	assert.Equal(t, 1, t3.Counts["patients"])
	assert.Equal(t, 1, t3.Counts["medical_records"])
}

func TestParseSQLFile_Gzip(t *testing.T) {
	dir := t.TempDir()
	gzPath := filepath.Join(dir, "test.sql.gz")

	f, err := os.Create(gzPath)
	require.NoError(t, err)
	gz := gzip.NewWriter(f)
	_, err = gz.Write([]byte(buildTestSQL()))
	require.NoError(t, err)
	require.NoError(t, gz.Close())
	require.NoError(t, f.Close())

	svc := &TenantMigrateService{tasks: make(map[string]*MigrateTask)}
	taskID := svc.CreateTask(gzPath, "test.sql.gz")
	result, err := svc.parseSQLFile(taskID, gzPath)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Len(t, result.Tenants, 2)
}

func TestParseSQLFile_Empty(t *testing.T) {
	dir := t.TempDir()
	sqlPath := filepath.Join(dir, "empty.sql")
	require.NoError(t, os.WriteFile(sqlPath, []byte(""), 0644))

	svc := &TenantMigrateService{tasks: make(map[string]*MigrateTask)}
	taskID := svc.CreateTask(sqlPath, "empty.sql")
	result, err := svc.parseSQLFile(taskID, sqlPath)

	require.NoError(t, err)
	assert.Len(t, result.Tenants, 0)
}

func TestParseSQLFile_NoTenantTables(t *testing.T) {
	sql := `-- MySQL dump
INSERT INTO ` + "`herbs`" + ` VALUES (1,'甘草','Glycyrrhiza'),(2,'黄芪','Astragalus');
`
	dir := t.TempDir()
	sqlPath := filepath.Join(dir, "herbs.sql")
	require.NoError(t, os.WriteFile(sqlPath, []byte(sql), 0644))

	svc := &TenantMigrateService{tasks: make(map[string]*MigrateTask)}
	taskID := svc.CreateTask(sqlPath, "herbs.sql")
	result, err := svc.parseSQLFile(taskID, sqlPath)

	require.NoError(t, err)
	assert.Len(t, result.Tenants, 0, "global tables should not generate tenant entries")
}

func TestParseSQLFile_FileNotFound(t *testing.T) {
	svc := &TenantMigrateService{tasks: make(map[string]*MigrateTask)}
	taskID := svc.CreateTask("/nonexistent/path.sql", "missing.sql")
	_, err := svc.parseSQLFile(taskID, "/nonexistent/path.sql")
	assert.Error(t, err)
}

func TestParseSQLFile_MultiLine(t *testing.T) {
	dir := t.TempDir()
	sqlPath := filepath.Join(dir, "multiline.sql")
	require.NoError(t, os.WriteFile(sqlPath, []byte(buildTestSQLMultiLine()), 0644))

	svc := &TenantMigrateService{tasks: make(map[string]*MigrateTask)}
	taskID := svc.CreateTask(sqlPath, "multiline.sql")
	result, err := svc.parseSQLFile(taskID, sqlPath)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.Len(t, result.Tenants, 2, "should find 2 tenants in multi-line format")

	var t1, t3 *TenantTableCount
	for _, tc := range result.Tenants {
		switch tc.TenantID {
		case 1:
			t1 = tc
		case 3:
			t3 = tc
		}
	}

	require.NotNil(t, t1)
	assert.Equal(t, "仁心诊所", t1.TenantName)
	assert.Equal(t, 2, t1.Counts["patients"])

	require.NotNil(t, t3)
	assert.Equal(t, "康源医疗", t3.TenantName)
	assert.Equal(t, 1, t3.Counts["patients"])
}
