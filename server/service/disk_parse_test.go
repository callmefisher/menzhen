package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

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

func TestStatfsBytes(t *testing.T) {
	// /tmp always exists on Linux/Mac; just verify numbers are sane.
	total, used, free, err := statfsBytes("/tmp")
	assert.NoError(t, err)
	assert.Positive(t, total)
	assert.GreaterOrEqual(t, free, int64(0))
	assert.Equal(t, total, used+free+(total-used-free)) // used+free <= total (reserved blocks exist)
	assert.LessOrEqual(t, used+free, total)
}
