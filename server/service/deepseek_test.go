package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/callmefisher/menzhen/server/config"
)

func TestDeepSeekService_IsEnabled(t *testing.T) {
	// Without API key
	cfg := &config.Config{}
	svc := NewDeepSeekService(cfg)
	if svc.IsEnabled() {
		t.Error("expected IsEnabled to be false without API key")
	}

	// With API key
	cfg.DeepSeekAPIKey = "test-key"
	svc = NewDeepSeekService(cfg)
	if !svc.IsEnabled() {
		t.Error("expected IsEnabled to be true with API key")
	}
}

func TestDeepSeekService_QueryHerb(t *testing.T) {
	herbResponse := HerbAIResult{
		Name:        "黄芪",
		Alias:       "绵芪、绵黄芪",
		Category:    "补气",
		Properties:  "甘，微温。归肺、脾经。",
		Effects:     "补气升阳、固表止汗、利水消肿、生津养血",
		Indications: "气虚乏力、食少便溏",
	}

	responseJSON, _ := json.Marshal(herbResponse)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("expected Bearer test-key, got %s", r.Header.Get("Authorization"))
		}

		resp := deepSeekResponse{
			Choices: []deepSeekChoice{
				{Message: deepSeekMessage{Role: "assistant", Content: string(responseJSON)}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}

	result, err := svc.QueryHerb("黄芪")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Name != "黄芪" {
		t.Errorf("expected name 黄芪, got %s", result.Name)
	}
	if result.Category != "补气" {
		t.Errorf("expected category 补气, got %s", result.Category)
	}
}

func TestDeepSeekService_QueryHerbWithCodeBlock(t *testing.T) {
	// Test that JSON wrapped in markdown code block is parsed correctly
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		content := "```json\n{\"name\":\"当归\",\"alias\":\"干归\",\"category\":\"补血\",\"properties\":\"甘辛温\",\"effects\":\"补血活血\",\"indications\":\"血虚\"}\n```"
		resp := deepSeekResponse{
			Choices: []deepSeekChoice{
				{Message: deepSeekMessage{Role: "assistant", Content: content}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}

	result, err := svc.QueryHerb("当归")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Name != "当归" {
		t.Errorf("expected name 当归, got %s", result.Name)
	}
}

func TestDeepSeekService_QueryFormula(t *testing.T) {
	formulaResponse := FormulaAIResult{
		Name:        "小青龙汤",
		Effects:     "解表散寒、温肺化饮",
		Indications: "外寒里饮证",
		Composition: []FormulaCompositionAI{
			{HerbName: "麻黄", DefaultDosage: "9g"},
			{HerbName: "桂枝", DefaultDosage: "9g"},
		},
	}

	responseJSON, _ := json.Marshal(formulaResponse)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := deepSeekResponse{
			Choices: []deepSeekChoice{
				{Message: deepSeekMessage{Role: "assistant", Content: string(responseJSON)}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}

	result, err := svc.QueryFormula("小青龙汤")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Name != "小青龙汤" {
		t.Errorf("expected name 小青龙汤, got %s", result.Name)
	}
	if len(result.Composition) != 2 {
		t.Errorf("expected 2 composition items, got %d", len(result.Composition))
	}
}

func TestDeepSeekService_QueryHerb_Disabled(t *testing.T) {
	svc := &DeepSeekService{
		APIKey: "",
	}

	_, err := svc.QueryHerb("黄芪")
	if err != ErrDeepSeekDisabled {
		t.Errorf("expected ErrDeepSeekDisabled, got %v", err)
	}
}

func TestDeepSeekService_QueryHerb_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
		Client:  server.Client(),
	}

	_, err := svc.QueryHerb("黄芪")
	if err == nil {
		t.Error("expected error for 500 response")
	}
}

func TestParseJSONFromContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			name:    "plain JSON",
			content: `{"name":"test"}`,
			want:    "test",
		},
		{
			name:    "markdown code block",
			content: "```json\n{\"name\":\"test\"}\n```",
			want:    "test",
		},
		{
			name:    "generic code block",
			content: "```\n{\"name\":\"test\"}\n```",
			want:    "test",
		},
		{
			name:    "JSON with surrounding whitespace",
			content: "  \n{\"name\":\"test\"}\n  ",
			want:    "test",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var result struct{ Name string `json:"name"` }
			err := parseJSONFromContent(tt.content, &result)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Name != tt.want {
				t.Errorf("expected %s, got %s", tt.want, result.Name)
			}
		})
	}
}
