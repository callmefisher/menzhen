package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// setupDeleteUploadRouter creates a minimal router with the DeleteUploadedFile handler.
// minioClient is nil so actual MinIO calls will fail, but we test validation logic.
func setupDeleteUploadRouter(tenantID uint64) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	h := &UploadHandler{
		minioClient: nil,
		bucket:      "test-bucket",
		db:          nil,
	}

	r.DELETE("/api/v1/upload", func(c *gin.Context) {
		// Inject tenantID into context the same way AuthMiddleware does.
		c.Set("tenant_id", tenantID)
	}, h.DeleteUploadedFile)

	return r
}

func doDeleteUpload(router *gin.Engine, body map[string]string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/upload", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestDeleteUploadedFile_MissingFilePath(t *testing.T) {
	router := setupDeleteUploadRouter(1)
	w := doDeleteUpload(router, map[string]string{})

	assert.Equal(t, http.StatusBadRequest, w.Code)
	result := parseJSON(w)
	assert.Equal(t, float64(400), result["code"])
}

func TestDeleteUploadedFile_PathTraversal(t *testing.T) {
	router := setupDeleteUploadRouter(7)

	tests := []struct {
		name     string
		filePath string
	}{
		{"double dot in path", "7/../../2/image/secret.jpg"},
		{"double dot only", "7/../other.txt"},
		{"encoded double dot", "7/..%2f..%2f2/image/x.jpg"}, // raw ".." still present
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := doDeleteUpload(router, map[string]string{"file_path": tt.filePath})
			assert.Equal(t, http.StatusBadRequest, w.Code)
			result := parseJSON(w)
			assert.Equal(t, float64(400), result["code"])
		})
	}
}

func TestDeleteUploadedFile_WrongTenant(t *testing.T) {
	router := setupDeleteUploadRouter(1)

	// Attempt to delete a file belonging to tenant 2.
	w := doDeleteUpload(router, map[string]string{"file_path": "2/image/some-uuid.jpg"})

	assert.Equal(t, http.StatusForbidden, w.Code)
	result := parseJSON(w)
	assert.Equal(t, float64(403), result["code"])
}

func TestDeleteUploadedFile_TenantZero(t *testing.T) {
	router := setupDeleteUploadRouter(0) // simulate missing tenant

	w := doDeleteUpload(router, map[string]string{"file_path": "0/image/some-uuid.jpg"})

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	result := parseJSON(w)
	assert.Equal(t, float64(401), result["code"])
}

func TestAllowedExtensions_IncludesDocuments(t *testing.T) {
	docExts := []string{".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".rtf"}
	for _, ext := range docExts {
		t.Run(ext, func(t *testing.T) {
			resourceType, ok := allowedExtensions[ext]
			assert.True(t, ok, "extension %s should be allowed", ext)
			assert.Equal(t, "document", resourceType)
		})
	}
}

func TestAllowedExtensions_IncludesArchives(t *testing.T) {
	archiveExts := []string{".zip", ".rar", ".7z", ".gz", ".tar"}
	for _, ext := range archiveExts {
		t.Run(ext, func(t *testing.T) {
			resourceType, ok := allowedExtensions[ext]
			assert.True(t, ok, "extension %s should be allowed", ext)
			assert.Equal(t, "archive", resourceType)
		})
	}
}

func TestExtContentType_DocumentMappings(t *testing.T) {
	expected := map[string]string{
		".pdf":  "application/pdf",
		".doc":  "application/msword",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".txt":  "text/plain",
		".csv":  "text/csv",
	}
	for ext, ct := range expected {
		t.Run(ext, func(t *testing.T) {
			assert.Equal(t, ct, extContentType[ext])
		})
	}
}
