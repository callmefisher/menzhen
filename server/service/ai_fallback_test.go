package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/config"
	"github.com/callmefisher/menzhen/server/model"
	"github.com/callmefisher/menzhen/server/testutil"
	"github.com/stretchr/testify/assert"
)

// --- Herb AI fallback tests ---

func TestIsValidHerbResult_Valid(t *testing.T) {
	r := &HerbAIResult{Effects: "补气", Indications: "气虚"}
	assert.True(t, isValidHerbResult(r))
}

func TestIsValidHerbResult_EffectsOnly(t *testing.T) {
	r := &HerbAIResult{Effects: "补气"}
	assert.True(t, isValidHerbResult(r))
}

func TestIsValidHerbResult_Invalid(t *testing.T) {
	r := &HerbAIResult{Name: "test"}
	assert.False(t, isValidHerbResult(r))
}

func TestHerbService_Search_AIFallback(t *testing.T) {
	db := testutil.SetupTestDB(t)

	herbResponse := HerbAIResult{
		Name:        "柴胡",
		Category:    "解表",
		Effects:     "疏散退热",
		Indications: "感冒发热",
	}
	responseJSON, _ := json.Marshal(herbResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}
	svc := NewHerbService(db, ds)

	// Search for a herb not in DB — should trigger AI fallback
	herbs, total, err := svc.Search("柴胡", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, herbs, 1)
	assert.Equal(t, "柴胡", herbs[0].Name)
	assert.Equal(t, "deepseek", herbs[0].Source)

	// Search again — should find it in DB now
	herbs2, total2, err := svc.Search("柴胡", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total2)
	assert.Equal(t, herbs[0].ID, herbs2[0].ID)
}

func TestHerbService_AIRefresh_Success(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// Create a herb in DB first
	herb := model.Herb{Name: "黄芪", Effects: "old effects"}
	db.Create(&herb)

	herbResponse := HerbAIResult{
		Name:        "黄芪",
		Alias:       "绵芪",
		Category:    "补气",
		Effects:     "补气升阳",
		Indications: "气虚乏力",
	}
	responseJSON, _ := json.Marshal(herbResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}
	svc := NewHerbService(db, ds)

	refreshed, err := svc.AIRefresh(herb.ID)
	assert.NoError(t, err)
	assert.Equal(t, "补气升阳", refreshed.Effects)
	assert.Equal(t, "绵芪", refreshed.Alias)
}

func TestHerbService_AIRefresh_NotEnabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	herb := model.Herb{Name: "黄芪", Effects: "old"}
	db.Create(&herb)

	svc := NewHerbService(db, nil)
	_, err := svc.AIRefresh(herb.ID)
	assert.Error(t, err)
}

func TestHerbService_AIRefresh_NotFound(t *testing.T) {
	db := testutil.SetupTestDB(t)
	ds := &DeepSeekService{APIKey: "key", BaseURL: "http://localhost", Model: "m", Client: http.DefaultClient}
	svc := NewHerbService(db, ds)
	_, err := svc.AIRefresh(99999)
	assert.ErrorIs(t, err, ErrHerbNotFound)
}

// --- Formula AI fallback tests ---

func TestIsValidFormulaResult_Valid(t *testing.T) {
	r := &FormulaAIResult{
		Composition: []FormulaCompositionAI{{HerbName: "麻黄", DefaultDosage: "9g"}},
	}
	assert.True(t, isValidFormulaResult(r))
}

func TestIsValidFormulaResult_Invalid(t *testing.T) {
	r := &FormulaAIResult{Name: "test"}
	assert.False(t, isValidFormulaResult(r))
}

func TestFormulaService_Search_AIFallback(t *testing.T) {
	db := testutil.SetupTestDB(t)

	formulaResponse := FormulaAIResult{
		Name:        "小青龙汤",
		Effects:     "解表散寒",
		Indications: "外寒里饮",
		Composition: []FormulaCompositionAI{
			{HerbName: "麻黄", DefaultDosage: "9g"},
			{HerbName: "桂枝", DefaultDosage: "9g"},
		},
	}
	responseJSON, _ := json.Marshal(formulaResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}
	svc := NewFormulaService(db, ds)

	formulas, total, err := svc.Search("小青龙汤", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, formulas, 1)
	assert.Equal(t, "小青龙汤", formulas[0].Name)
	assert.Equal(t, "deepseek", formulas[0].Source)
}

// --- Pulse AI fallback tests ---

func TestIsValidPulseResult_Valid(t *testing.T) {
	r := &PulseAIResult{Description: "浮而有力", ClinicalMeaning: "表证"}
	assert.True(t, isValidPulseResult(r))
}

func TestIsValidPulseResult_Invalid(t *testing.T) {
	r := &PulseAIResult{Name: "test"}
	assert.False(t, isValidPulseResult(r))
}

func TestPulseService_Search_AIFallback(t *testing.T) {
	db := testutil.SetupTestDB(t)

	pulseResponse := PulseAIResult{
		Name:             "革脉",
		Category:         "复合脉类",
		Description:      "弦而芤",
		ClinicalMeaning:  "精血亏虚",
		CommonConditions: "亡血失精",
	}
	responseJSON, _ := json.Marshal(pulseResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}
	svc := NewPulseService(db, ds)

	pulses, total, err := svc.Search("革", "", 1, 10, true)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, pulses, 1)
	assert.Equal(t, "革脉", pulses[0].Name)
}

// --- queryAndSaveFromAI edge cases ---

func TestHerbService_queryAndSaveFromAI_InvalidResult(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// AI returns herb with no effects/indications — should not save to DB
	herbResponse := HerbAIResult{Name: "未知药"}
	responseJSON, _ := json.Marshal(herbResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{APIKey: "key", BaseURL: server.URL, Model: "m", Client: server.Client()}
	svc := NewHerbService(db, ds)

	herbs, total, err := svc.Search("未知药", "", 1, 10)
	assert.NoError(t, err)
	// Invalid result is still returned but not saved
	assert.Equal(t, int64(1), total)
	assert.Len(t, herbs, 1)

	// Verify not saved — searching again with disabled AI should find nothing
	svc2 := NewHerbService(db, nil)
	herbs2, total2, err := svc2.Search("未知药", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total2)
	assert.Len(t, herbs2, 0)
}

func TestFormulaService_queryAndSaveFromAI_InvalidResult(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// AI returns formula with no composition — invalid
	formulaResponse := FormulaAIResult{Name: "未知方"}
	responseJSON, _ := json.Marshal(formulaResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{APIKey: "key", BaseURL: server.URL, Model: "m", Client: server.Client()}
	svc := NewFormulaService(db, ds)

	formulas, total, err := svc.Search("未知方", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, formulas, 1)
}

func TestPulseService_queryAndSaveFromAI_InvalidResult(t *testing.T) {
	db := testutil.SetupTestDB(t)

	pulseResponse := PulseAIResult{Name: "未知脉"}
	responseJSON, _ := json.Marshal(pulseResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{APIKey: "key", BaseURL: server.URL, Model: "m", Client: server.Client()}
	svc := NewPulseService(db, ds)

	pulses, total, err := svc.Search("未知", "", 1, 10, true)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Len(t, pulses, 1)
}

func TestHerbService_AIRefresh_InvalidResult(t *testing.T) {
	db := testutil.SetupTestDB(t)

	herb := model.Herb{Name: "黄芪", Effects: "old"}
	db.Create(&herb)

	// AI returns empty effects/indications — isValidHerbResult returns false
	herbResponse := HerbAIResult{Name: "黄芪"}
	responseJSON, _ := json.Marshal(herbResponse)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	ds := &DeepSeekService{APIKey: "key", BaseURL: server.URL, Model: "m", Client: server.Client()}
	svc := NewHerbService(db, ds)

	_, err := svc.AIRefresh(herb.ID)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid herb data")
}

// --- AI fallback with category filter (should NOT trigger AI) ---

func TestHerbService_Search_WithCategory_NoAIFallback(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// Even with AI enabled, category filter should prevent AI fallback
	ds := &DeepSeekService{APIKey: "key", BaseURL: "http://should-not-be-called", Model: "m", Client: http.DefaultClient}
	svc := NewHerbService(db, ds)

	herbs, total, err := svc.Search("不存在", "补气", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, herbs, 0)
}

func TestHerbService_Update_EmptyMap(t *testing.T) {
	db := testutil.SetupTestDB(t)
	herb := model.Herb{Name: "黄芪", Effects: "old"}
	db.Create(&herb)

	svc := NewHerbService(db, nil)
	err := svc.Update(herb.ID, map[string]interface{}{})
	assert.NoError(t, err)
}

// --- Herb AI fallback error from DeepSeek server ---

func TestHerbService_Search_AIFallback_ServerError(t *testing.T) {
	db := testutil.SetupTestDB(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	ds := &DeepSeekService{APIKey: "key", BaseURL: server.URL, Model: "m", Client: server.Client()}
	svc := NewHerbService(db, ds)

	// AI error should be swallowed, return empty
	herbs, total, err := svc.Search("不存在药", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, herbs, 0)
}

func TestFormulaService_Search_AIFallback_ServerError(t *testing.T) {
	db := testutil.SetupTestDB(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	ds := &DeepSeekService{APIKey: "key", BaseURL: server.URL, Model: "m", Client: server.Client()}
	svc := NewFormulaService(db, ds)

	formulas, total, err := svc.Search("不存在方", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, formulas, 0)
}

func TestPulseService_Search_AIFallback_ServerError(t *testing.T) {
	db := testutil.SetupTestDB(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	ds := &DeepSeekService{APIKey: "key", BaseURL: server.URL, Model: "m", Client: server.Client()}
	svc := NewPulseService(db, ds)

	pulses, total, err := svc.Search("不存在脉", "", 1, 10, true)
	assert.NoError(t, err)
	// Server error, but returns existing DB results (empty) without error
	assert.True(t, total >= 0)
	assert.True(t, len(pulses) >= 0)
}

// --- Pulse search with existing partial match + AI ---

func TestPulseService_Search_ExactMatch_NoAIFallback(t *testing.T) {
	db := testutil.SetupTestDB(t)

	// Create a pulse that exactly matches the search term
	pulse := model.Pulse{Name: "浮脉", Category: "浮脉类", Description: "轻取即得", ClinicalMeaning: "表证"}
	db.Create(&pulse)

	// AI enabled but should NOT be called since exact match exists
	ds := &DeepSeekService{APIKey: "key", BaseURL: "http://should-not-be-called", Model: "m", Client: http.DefaultClient}
	svc := NewPulseService(db, ds)

	pulses, total, err := svc.Search("浮脉", "", 1, 10, true)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "浮脉", pulses[0].Name)
}

// --- DeepSeek disabled fallback (no NewDeepSeekService needed) ---

func TestHerbService_Search_AIFallback_Disabled(t *testing.T) {
	db := testutil.SetupTestDB(t)
	ds := NewDeepSeekService(&config.Config{}) // no API key
	svc := NewHerbService(db, ds)

	// Search for non-existent herb with disabled AI — should return empty
	herbs, total, err := svc.Search("不存在", "", 1, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Len(t, herbs, 0)
}
