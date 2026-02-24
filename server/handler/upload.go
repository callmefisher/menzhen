package handler

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/callmefisher/menzhen/server/middleware"
	"github.com/callmefisher/menzhen/server/storage"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
)

// Allowed file extensions grouped by resource type.
var allowedExtensions = map[string]string{
	".jpg":  "image",
	".jpeg": "image",
	".png":  "image",
	".gif":  "image",
	".bmp":  "image",
	".mp3":  "audio",
	".wav":  "audio",
	".ogg":  "audio",
	".m4a":  "audio",
	".mp4":  "video",
	".avi":  "video",
	".mov":  "video",
	".mkv":  "video",
}

// Content-Type mapping for common extensions used when proxying files.
var extContentType = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".gif":  "image/gif",
	".bmp":  "image/bmp",
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".ogg":  "audio/ogg",
	".m4a":  "audio/mp4",
	".mp4":  "video/mp4",
	".avi":  "video/x-msvideo",
	".mov":  "video/quicktime",
	".mkv":  "video/x-matroska",
}

// UploadHandler handles file upload and download endpoints.
type UploadHandler struct {
	minioClient *minio.Client
	bucket      string
}

// NewUploadHandler creates a new UploadHandler.
func NewUploadHandler(minioClient *minio.Client, bucket string) *UploadHandler {
	return &UploadHandler{
		minioClient: minioClient,
		bucket:      bucket,
	}
}

// Upload handles POST /api/v1/upload.
// It accepts a multipart form file with key "file", validates the file type,
// uploads it to MinIO, and returns file metadata.
func (h *UploadHandler) Upload(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "missing or invalid file in form field 'file'",
		})
		return
	}

	// Validate file extension.
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	resourceType, ok := allowedExtensions[ext]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": fmt.Sprintf("unsupported file type: %s. Allowed: images(.jpg,.jpeg,.png,.gif,.bmp), audio(.mp3,.wav,.ogg,.m4a), video(.mp4,.avi,.mov,.mkv)", ext),
		})
		return
	}

	// Open the uploaded file.
	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to open uploaded file",
		})
		return
	}
	defer file.Close()

	// Build unique object key: {tenant_id}/{resource_type}/{uuid}{ext}
	tenantID := middleware.GetTenantID(c)
	objectKey := fmt.Sprintf("%d/%s/%s%s", tenantID, resourceType, uuid.New().String(), ext)

	// Determine content type.
	contentType := extContentType[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Upload to MinIO.
	if err := storage.UploadFile(h.minioClient, h.bucket, objectKey, file, fileHeader.Size, contentType); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to upload file to storage",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"file_path": objectKey,
			"file_name": fileHeader.Filename,
			"file_size": fileHeader.Size,
			"file_type": resourceType,
		},
	})
}

// GetFile handles GET /api/v1/files/*key.
// It proxies the file from MinIO to the client with the correct Content-Type,
// so that MinIO URLs are never exposed.
func (h *UploadHandler) GetFile(c *gin.Context) {
	// The *key param captures everything after /api/v1/files/
	// Gin provides it with a leading slash, so we trim it.
	key := c.Param("key")
	key = strings.TrimPrefix(key, "/")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    400,
			"message": "missing file key",
		})
		return
	}

	// Get object from MinIO.
	obj, err := storage.GetObject(h.minioClient, h.bucket, key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to retrieve file",
		})
		return
	}
	defer obj.Close()

	// Stat the object to get content type and size.
	info, err := obj.Stat()
	if err != nil {
		errResp := minio.ToErrorResponse(err)
		if errResp.Code == "NoSuchKey" {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    404,
				"message": "file not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    500,
			"message": "failed to stat file",
		})
		return
	}

	// Determine content type from the stored object or fall back to extension.
	contentType := info.ContentType
	if contentType == "" || contentType == "application/octet-stream" {
		ext := strings.ToLower(filepath.Ext(key))
		if ct, ok := extContentType[ext]; ok {
			contentType = ct
		}
	}

	// Stream the object to the response.
	c.Header("Content-Type", contentType)
	c.Header("Content-Length", fmt.Sprintf("%d", info.Size))
	c.Status(http.StatusOK)

	if _, err := io.Copy(c.Writer, obj); err != nil {
		// At this point headers are already sent, so we cannot return a JSON error.
		// Just log the error silently.
		_ = err
	}
}
