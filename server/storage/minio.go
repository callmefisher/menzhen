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

// InitMinIO creates a MinIO client and ensures the configured bucket exists.
// It uses SSL = false since the MinIO server runs on the internal network.
func InitMinIO(cfg *config.Config) *minio.Client {
	client, err := minio.New(cfg.MinIOEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinIOAccessKey, cfg.MinIOSecretKey, ""),
		Secure: false,
	})
	if err != nil {
		log.Fatalf("failed to create minio client: %v", err)
	}

	// Auto-create bucket if it does not exist.
	ctx := context.Background()
	exists, err := client.BucketExists(ctx, cfg.MinIOBucket)
	if err != nil {
		log.Fatalf("failed to check bucket existence: %v", err)
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
