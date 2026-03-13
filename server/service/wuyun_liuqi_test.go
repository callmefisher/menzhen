package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupWuyunLiuqiService(t *testing.T) *service.WuyunLiuqiService {
	db := testutil.SetupTestDB(t)
	return service.NewWuyunLiuqiService(db, nil)
}

func TestWuyunLiuqiService_SaveFromAI_Create(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	record, err := svc.SaveFromAI(2026, "丙午年五运六气分析内容", 1)
	assert.NoError(t, err)
	assert.NotNil(t, record)
	assert.NotZero(t, record.ID)
	assert.Equal(t, 2026, record.Year)
	assert.Equal(t, "丙午年五运六气分析内容", record.Content)
	assert.Equal(t, "ai", record.Source)
	assert.Equal(t, uint64(1), record.UpdatedBy)
}

func TestWuyunLiuqiService_SaveFromAI_UpdateExisting(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	// Create first
	record1, err := svc.SaveFromAI(2026, "初始内容", 1)
	assert.NoError(t, err)

	// Update same year
	record2, err := svc.SaveFromAI(2026, "更新后的内容", 2)
	assert.NoError(t, err)
	assert.Equal(t, record1.ID, record2.ID) // Same row
	assert.Equal(t, "更新后的内容", record2.Content)
	assert.Equal(t, "ai", record2.Source)
}

func TestWuyunLiuqiService_GetByYear_Found(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	_, err := svc.SaveFromAI(2025, "乙巳年分析", 1)
	assert.NoError(t, err)

	record, err := svc.GetByYear(2025)
	assert.NoError(t, err)
	assert.NotNil(t, record)
	assert.Equal(t, 2025, record.Year)
	assert.Equal(t, "乙巳年分析", record.Content)
}

func TestWuyunLiuqiService_GetByYear_NotFound(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	record, err := svc.GetByYear(1900)
	assert.NoError(t, err)
	assert.Nil(t, record)
}

func TestWuyunLiuqiService_GetByID_Success(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	created, err := svc.SaveFromAI(2026, "测试内容", 1)
	assert.NoError(t, err)

	record, err := svc.GetByID(created.ID)
	assert.NoError(t, err)
	assert.NotNil(t, record)
	assert.Equal(t, 2026, record.Year)
}

func TestWuyunLiuqiService_GetByID_NotFound(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	record, err := svc.GetByID(99999)
	assert.ErrorIs(t, err, service.ErrWuyunLiuqiNotFound)
	assert.Nil(t, record)
}

func TestWuyunLiuqiService_Update_Success(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	created, err := svc.SaveFromAI(2026, "AI生成内容", 1)
	assert.NoError(t, err)
	assert.Equal(t, "ai", created.Source)

	err = svc.Update(created.ID, "手动修改后的内容", 2)
	assert.NoError(t, err)

	record, err := svc.GetByID(created.ID)
	assert.NoError(t, err)
	assert.Equal(t, "手动修改后的内容", record.Content)
	assert.Equal(t, "manual", record.Source)
	assert.Equal(t, uint64(2), record.UpdatedBy)
}

func TestWuyunLiuqiService_Update_NotFound(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	err := svc.Update(99999, "content", 1)
	assert.ErrorIs(t, err, service.ErrWuyunLiuqiNotFound)
}

func TestWuyunLiuqiService_Delete_Success(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	created, err := svc.SaveFromAI(2026, "待删除", 1)
	assert.NoError(t, err)

	err = svc.Delete(created.ID)
	assert.NoError(t, err)

	// Verify deleted
	record, err := svc.GetByYear(2026)
	assert.NoError(t, err)
	assert.Nil(t, record)
}

func TestWuyunLiuqiService_Delete_NotFound(t *testing.T) {
	svc := setupWuyunLiuqiService(t)

	err := svc.Delete(99999)
	assert.ErrorIs(t, err, service.ErrWuyunLiuqiNotFound)
}
