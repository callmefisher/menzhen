package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupMeridianResourceService(t *testing.T) *service.MeridianResourceService {
	db := testutil.SetupTestDB(t)
	return service.NewMeridianResourceService(db)
}

func TestMeridianResourceService_Upsert_Create(t *testing.T) {
	svc := setupMeridianResourceService(t)

	res, err := svc.Upsert("LU", "https://example.com/lu.mp4", "手太阴肺经原文", 1)
	assert.NoError(t, err)
	assert.NotNil(t, res)
	assert.NotZero(t, res.ID)
	assert.Equal(t, "LU", res.MeridianID)
	assert.Equal(t, "https://example.com/lu.mp4", res.VideoURL)
	assert.Equal(t, "手太阴肺经原文", res.SourceText)
	assert.Equal(t, uint64(1), res.UpdatedBy)
}

func TestMeridianResourceService_Upsert_Update(t *testing.T) {
	svc := setupMeridianResourceService(t)

	// Create first
	res1, err := svc.Upsert("LU", "https://example.com/lu-v1.mp4", "原文v1", 1)
	assert.NoError(t, err)

	// Update
	res2, err := svc.Upsert("LU", "https://example.com/lu-v2.mp4", "原文v2", 2)
	assert.NoError(t, err)
	assert.Equal(t, res1.ID, res2.ID) // Same row
	assert.Equal(t, "https://example.com/lu-v2.mp4", res2.VideoURL)
	assert.Equal(t, "原文v2", res2.SourceText)
	assert.Equal(t, uint64(2), res2.UpdatedBy)
}

func TestMeridianResourceService_GetByMeridianID_Found(t *testing.T) {
	svc := setupMeridianResourceService(t)

	_, err := svc.Upsert("ST", "https://example.com/st.mp4", "足阳明胃经", 1)
	assert.NoError(t, err)

	res, err := svc.GetByMeridianID("ST")
	assert.NoError(t, err)
	assert.NotNil(t, res)
	assert.Equal(t, "ST", res.MeridianID)
	assert.Equal(t, "https://example.com/st.mp4", res.VideoURL)
}

func TestMeridianResourceService_GetByMeridianID_NotFound(t *testing.T) {
	svc := setupMeridianResourceService(t)

	res, err := svc.GetByMeridianID("NONEXIST")
	assert.NoError(t, err)
	assert.Nil(t, res)
}
