package service_test

import (
	"testing"

	"github.com/callmefisher/menzhen/server/database"
	"github.com/callmefisher/menzhen/server/service"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

func setupSolarTermTest(t *testing.T) *service.SolarTermService {
	t.Helper()
	db := testutil.SetupTestDB(t)
	database.Seed(db)
	return service.NewSolarTermService(db)
}

// ---------- List ----------

func TestSolarTerm_List_Returns24Items(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, err := svc.List()

	assert.NoError(t, err)
	assert.Len(t, terms, 24)
}

func TestSolarTerm_List_CorrectOrder(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, err := svc.List()

	assert.NoError(t, err)
	assert.Equal(t, "立春", terms[0].Name)
	assert.Equal(t, 1, terms[0].OrderIndex)
	assert.Equal(t, "大寒", terms[23].Name)
	assert.Equal(t, 24, terms[23].OrderIndex)

	// Verify all order indexes are sequential.
	for i, term := range terms {
		assert.Equal(t, i+1, term.OrderIndex)
	}
}

// ---------- GetByID ----------

func TestSolarTerm_GetByID_Success(t *testing.T) {
	svc := setupSolarTermTest(t)

	// Get the first term to know its ID.
	terms, err := svc.List()
	assert.NoError(t, err)
	assert.True(t, len(terms) > 0)

	term, err := svc.GetByID(terms[0].ID)

	assert.NoError(t, err)
	assert.Equal(t, "立春", term.Name)
	assert.Equal(t, "春", term.Season)
	assert.Equal(t, 1, term.OrderIndex)
}

func TestSolarTerm_GetByID_NotFound(t *testing.T) {
	svc := setupSolarTermTest(t)

	_, err := svc.GetByID(99999)

	assert.ErrorIs(t, err, service.ErrSolarTermNotFound)
}

// ---------- UpdateContent ----------

func TestSolarTerm_UpdateContent_Success(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, err := svc.List()
	assert.NoError(t, err)
	id := terms[0].ID

	updated, err := svc.UpdateContent(id, "立春养生内容")

	assert.NoError(t, err)
	assert.Equal(t, "立春养生内容", updated.Content)
}

func TestSolarTerm_UpdateContent_Persistence(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, err := svc.List()
	assert.NoError(t, err)
	id := terms[0].ID

	_, err = svc.UpdateContent(id, "持久化测试内容")
	assert.NoError(t, err)

	// Re-fetch to verify persistence.
	term, err := svc.GetByID(id)
	assert.NoError(t, err)
	assert.Equal(t, "持久化测试内容", term.Content)
}

func TestSolarTerm_UpdateContent_NotFound(t *testing.T) {
	svc := setupSolarTermTest(t)

	_, err := svc.UpdateContent(99999, "内容")

	assert.ErrorIs(t, err, service.ErrSolarTermNotFound)
}

// ---------- DeleteContent ----------

func TestSolarTerm_DeleteContent_Success(t *testing.T) {
	svc := setupSolarTermTest(t)

	terms, err := svc.List()
	assert.NoError(t, err)
	id := terms[0].ID

	// First set content, then delete it.
	_, err = svc.UpdateContent(id, "要被删除的内容")
	assert.NoError(t, err)

	err = svc.DeleteContent(id)
	assert.NoError(t, err)

	// Verify content is cleared.
	term, err := svc.GetByID(id)
	assert.NoError(t, err)
	assert.Equal(t, "", term.Content)
}

func TestSolarTerm_DeleteContent_NotFound(t *testing.T) {
	svc := setupSolarTermTest(t)

	err := svc.DeleteContent(99999)

	assert.ErrorIs(t, err, service.ErrSolarTermNotFound)
}
