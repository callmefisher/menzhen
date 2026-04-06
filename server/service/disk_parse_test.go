package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseRootDf(t *testing.T) {
	t.Run("normal output — root filesystem", func(t *testing.T) {
		// Real-world output from `df -B1 /` inside the backup container on Docker Desktop Mac
		output := `Filesystem           1-blocks       Used Available Use% Mounted on
overlay              485473984512 21217587200 439520440320   5% /`
		total, used, free, err := parseRootDf(output)
		require.NoError(t, err)
		assert.Equal(t, int64(485473984512), total)
		assert.Equal(t, int64(21217587200), used)
		assert.Equal(t, int64(439520440320), free)
	})

	t.Run("hostfs output — Mac host disk via /:/hostfs:ro mount", func(t *testing.T) {
		// Real-world output from `df -B1 /hostfs` on Docker Desktop Mac (138.76 GB free)
		output := `Filesystem         1-blocks       Used  Available Use% Mounted on
/dev/disk3s5s1   494384795648 355988963328 138395832320  72% /hostfs`
		total, used, free, err := parseRootDf(output)
		require.NoError(t, err)
		assert.Equal(t, int64(494384795648), total)
		assert.Equal(t, int64(355988963328), used)
		assert.Equal(t, int64(138395832320), free)
	})

	t.Run("header only — no data row", func(t *testing.T) {
		output := `Filesystem 1-blocks Used Available Use% Mounted on`
		_, _, _, err := parseRootDf(output)
		assert.Error(t, err)
	})

	t.Run("empty output", func(t *testing.T) {
		_, _, _, err := parseRootDf("")
		assert.Error(t, err)
	})

	t.Run("too few fields", func(t *testing.T) {
		output := "Filesystem 1-blocks\noverlay 485473984512"
		_, _, _, err := parseRootDf(output)
		assert.Error(t, err)
	})
}

func TestParseDuOutput(t *testing.T) {
	t.Run("all three paths present", func(t *testing.T) {
		// du -sb output: size TAB path
		output := `1024297093	/var/lib/mysql
321817	/data
2379192	/backups`
		mysqlUsed, minioUsed, backupUsed := parseDuOutput(output)
		assert.Equal(t, int64(1024297093), mysqlUsed)
		assert.Equal(t, int64(321817), minioUsed)
		assert.Equal(t, int64(2379192), backupUsed)
	})

	t.Run("missing path returns zero", func(t *testing.T) {
		output := `321817	/data`
		mysqlUsed, minioUsed, backupUsed := parseDuOutput(output)
		assert.Equal(t, int64(0), mysqlUsed)
		assert.Equal(t, int64(321817), minioUsed)
		assert.Equal(t, int64(0), backupUsed)
	})

	t.Run("empty output returns all zeros", func(t *testing.T) {
		mysqlUsed, minioUsed, backupUsed := parseDuOutput("")
		assert.Equal(t, int64(0), mysqlUsed)
		assert.Equal(t, int64(0), minioUsed)
		assert.Equal(t, int64(0), backupUsed)
	})

	t.Run("non-numeric size is skipped", func(t *testing.T) {
		output := `bad_size	/var/lib/mysql
500	/data`
		mysqlUsed, minioUsed, _ := parseDuOutput(output)
		assert.Equal(t, int64(0), mysqlUsed)
		assert.Equal(t, int64(500), minioUsed)
	})
}
