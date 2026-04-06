package model

import "time"

// DiskStatus 磁盘状态采集结果
type DiskStatus struct {
	Total       int64     `json:"total"`        // 字节
	Used        int64     `json:"used"`
	Free        int64     `json:"free"`
	UsedPct     float64   `json:"used_pct"`
	MySQLUsed   int64     `json:"mysql_used"`
	MinIOUsed   int64     `json:"minio_used"`
	BackupUsed  int64     `json:"backup_used"`
	CollectedAt time.Time `json:"collected_at"`
	Interval    int       `json:"interval"` // 秒
}

// DirEntry 目录浏览条目
type DirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"` // 宿主机绝对路径
}

// MigrateRequest MySQL 或 MinIO 迁移请求
type MigrateRequest struct {
	Target  string `json:"target" binding:"required,oneof=mysql minio"` // "mysql" or "minio"
	NewPath string `json:"new_path" binding:"required"`
}

// BackupDirRequest 备份目录更换请求
type BackupDirRequest struct {
	NewPath string `json:"new_path" binding:"required"`
}

// DiskTask 磁盘操作任务状态
type DiskTask struct {
	TaskID  string `json:"task_id"`
	Type    string `json:"type"`     // migrate_mysql, migrate_minio, backup_dir
	Status  string `json:"status"`   // running, success, failed, aborted
	Step    int    `json:"step"`     // 当前步骤（1-based）
	Total   int    `json:"total"`    // 总步骤数
	Output  string `json:"output"`
	StartAt string `json:"start_at"`
}
