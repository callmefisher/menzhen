package storage

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/url"
	"time"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// DeleteFile deletes a single object from MinIO.
func DeleteFile(client *minio.Client, bucket, objectName string) error {
	ctx := context.Background()
	if err := client.RemoveObject(ctx, bucket, objectName, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("failed to delete object %s: %w", objectName, err)
	}
	return nil
}

// DeleteFiles deletes multiple objects from MinIO using batch removal.
// It returns the list of object names that failed to delete.
func DeleteFiles(client *minio.Client, bucket string, objectNames []string) []string {
	if len(objectNames) == 0 {
		return nil
	}
	ctx := context.Background()
	objectsCh := make(chan minio.ObjectInfo, len(objectNames))
	go func() {
		defer close(objectsCh)
		for _, name := range objectNames {
			objectsCh <- minio.ObjectInfo{Key: name}
		}
	}()

	var failed []string
	for err := range client.RemoveObjects(ctx, bucket, objectsCh, minio.RemoveObjectsOptions{}) {
		log.Printf("failed to delete object %s: %v", err.ObjectName, err.Err)
		failed = append(failed, err.ObjectName)
	}
	return failed
}

// ListAllObjects lists all object keys in a bucket with the given prefix.
func ListAllObjects(client *minio.Client, bucket, prefix string) ([]string, error) {
	ctx := context.Background()
	var keys []string
	for obj := range client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if obj.Err != nil {
			return nil, fmt.Errorf("failed to list objects: %w", obj.Err)
		}
		keys = append(keys, obj.Key)
	}
	return keys, nil
}

// InitMinIO creates a MinIO client and ensures the configured bucket exists.
// It uses SSL = false since the MinIO server runs on the internal network.
func InitMinIO(cfg *config.Config) *minio.Client {
	client, err := minio.New(cfg.MinIOEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinIOAccessKey, cfg.MinIOSecretKey, ""),
		Secure: false,
	})
	if err != nil {
		log.Fatalf("failed to create minio client: %v (endpoint=%s accessKey=%s secretKey=%s)",
			err, cfg.MinIOEndpoint, cfg.MinIOAccessKey, cfg.MinIOSecretKey)
	}

	// Auto-create bucket if it does not exist.
	ctx := context.Background()
	exists, err := client.BucketExists(ctx, cfg.MinIOBucket)
	if err != nil {
		log.Fatalf("failed to check bucket existence: %v (endpoint=%s accessKey=%s secretKey=%s)",
			err, cfg.MinIOEndpoint, cfg.MinIOAccessKey, cfg.MinIOSecretKey)
	}
	if !exists {
		if err := client.MakeBucket(ctx, cfg.MinIOBucket, minio.MakeBucketOptions{}); err != nil {
			log.Fatalf("failed to create bucket %s: %v", cfg.MinIOBucket, err)
		}
		log.Printf("created minio bucket: %s", cfg.MinIOBucket)
	}

	log.Printf("minio client initialized, endpoint=%s bucket=%s", cfg.MinIOEndpoint, cfg.MinIOBucket)
	return client
}

// UploadFile uploads data from reader to the specified bucket and object key.
func UploadFile(client *minio.Client, bucket, objectName string, reader io.Reader, size int64, contentType string) error {
	ctx := context.Background()
	_, err := client.PutObject(ctx, bucket, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("failed to upload object %s: %w", objectName, err)
	}
	return nil
}

// GetPresignedURL generates a presigned GET URL valid for 1 hour.
func GetPresignedURL(client *minio.Client, bucket, objectName string) (string, error) {
	ctx := context.Background()
	reqParams := make(url.Values)
	presignedURL, err := client.PresignedGetObject(ctx, bucket, objectName, time.Hour, reqParams)
	if err != nil {
		return "", fmt.Errorf("failed to generate presigned url for %s: %w", objectName, err)
	}
	return presignedURL.String(), nil
}

// GetObject retrieves an object from MinIO and returns its reader and object info.
func GetObject(client *minio.Client, bucket, objectName string) (*minio.Object, error) {
	ctx := context.Background()
	obj, err := client.GetObject(ctx, bucket, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get object %s: %w", objectName, err)
	}
	return obj, nil
}
