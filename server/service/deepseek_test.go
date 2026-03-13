package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/callmefisher/menzhen/server/config"
)

// mockAIResponse creates an Anthropic Messages API format response.
func mockAIResponse(text string) aiResponse {
	return aiResponse{
		Content: []aiContentBlock{
			{Type: "text", Text: text},
		},
	}
}

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
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("expected Bearer test-key, got %s", r.Header.Get("Authorization"))
		}
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("expected anthropic-version header, got %s", r.Header.Get("anthropic-version"))
		}

		resp := mockAIResponse(string(responseJSON))
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		content := "```json\n{\"name\":\"当归\",\"alias\":\"干归\",\"category\":\"补血\",\"properties\":\"甘辛温\",\"effects\":\"补血活血\",\"indications\":\"血虚\"}\n```"
		resp := mockAIResponse(content)
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
		resp := mockAIResponse(string(responseJSON))
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

// --- QueryPulse tests ---

func TestDeepSeekService_QueryPulse(t *testing.T) {
	pulseResponse := PulseAIResult{
		Name:             "浮脉",
		Category:         "浮脉类",
		Description:      "轻取即得，重按稍减而不空",
		ClinicalMeaning:  "主表证，亦主虚证",
		CommonConditions: "外感风寒、外感风热",
	}

	responseJSON, _ := json.Marshal(pulseResponse)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
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

	result, err := svc.QueryPulse("浮脉")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Name != "浮脉" {
		t.Errorf("expected name 浮脉, got %s", result.Name)
	}
	if result.Category != "浮脉类" {
		t.Errorf("expected category 浮脉类, got %s", result.Category)
	}
	if result.ClinicalMeaning != "主表证，亦主虚证" {
		t.Errorf("expected clinical_meaning 主表证，亦主虚证, got %s", result.ClinicalMeaning)
	}
}

func TestDeepSeekService_QueryPulse_Disabled(t *testing.T) {
	svc := &DeepSeekService{APIKey: ""}

	_, err := svc.QueryPulse("浮脉")
	if err != ErrDeepSeekDisabled {
		t.Errorf("expected ErrDeepSeekDisabled, got %v", err)
	}
}

func TestDeepSeekService_QueryPulse_ServerError(t *testing.T) {
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

	_, err := svc.QueryPulse("浮脉")
	if err == nil {
		t.Error("expected error for 500 response")
	}
}

func TestDeepSeekService_QueryPulse_EmptyName(t *testing.T) {
	// AI returns empty name — should fall back to queried name
	pulseResponse := PulseAIResult{
		Name:            "",
		Category:        "沉脉类",
		Description:     "重按始得",
		ClinicalMeaning: "主里证",
	}

	responseJSON, _ := json.Marshal(pulseResponse)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(string(responseJSON))
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

	result, err := svc.QueryPulse("沉脉")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Name != "沉脉" {
		t.Errorf("expected fallback name 沉脉, got %s", result.Name)
	}
}

// --- AnalyzeTongue tests (chatLong path) ---

func TestDeepSeekService_AnalyzeTongue(t *testing.T) {
	expectedText := "## 舌象分析\n\n舌质红，苔薄黄，提示**热证**。"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(expectedText)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	result, err := svc.AnalyzeTongue("舌质红，苔薄黄")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != expectedText {
		t.Errorf("expected %q, got %q", expectedText, result)
	}
}

func TestDeepSeekService_AnalyzeTongue_Disabled(t *testing.T) {
	svc := &DeepSeekService{APIKey: ""}

	_, err := svc.AnalyzeTongue("舌质红")
	if err != ErrDeepSeekDisabled {
		t.Errorf("expected ErrDeepSeekDisabled, got %v", err)
	}
}

func TestDeepSeekService_AnalyzeTongue_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(`{"error":"bad gateway"}`))
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	_, err := svc.AnalyzeTongue("舌质红")
	if err == nil {
		t.Error("expected error for 502 response")
	}
	if !errors.Is(err, ErrDeepSeekFailed) {
		t.Errorf("expected ErrDeepSeekFailed, got %v", err)
	}
}

// --- AnalyzeDiagnosis tests (chatLong path) ---

func TestDeepSeekService_AnalyzeDiagnosis(t *testing.T) {
	expectedText := "## 辩证论治\n\n患者面色萎黄，属**脾虚证**。"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(expectedText)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	result, err := svc.AnalyzeDiagnosis("面色萎黄，神疲乏力，食少便溏")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != expectedText {
		t.Errorf("expected %q, got %q", expectedText, result)
	}
}

func TestDeepSeekService_AnalyzeDiagnosis_Disabled(t *testing.T) {
	svc := &DeepSeekService{APIKey: ""}

	_, err := svc.AnalyzeDiagnosis("面色萎黄")
	if err != ErrDeepSeekDisabled {
		t.Errorf("expected ErrDeepSeekDisabled, got %v", err)
	}
}

// --- QueryWuyunLiuqi tests (chatLong path) ---

func TestDeepSeekService_QueryWuyunLiuqi(t *testing.T) {
	expectedText := "## 2024年五运六气\n\n甲辰年，土运太过。"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := mockAIResponse(expectedText)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	result, err := svc.QueryWuyunLiuqi(2024)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != expectedText {
		t.Errorf("expected %q, got %q", expectedText, result)
	}
}

func TestDeepSeekService_QueryWuyunLiuqi_Disabled(t *testing.T) {
	svc := &DeepSeekService{APIKey: ""}

	_, err := svc.QueryWuyunLiuqi(2024)
	if err != ErrDeepSeekDisabled {
		t.Errorf("expected ErrDeepSeekDisabled, got %v", err)
	}
}

// --- SSE streaming helper ---

func newSSEServer(events []string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		for _, e := range events {
			fmt.Fprintln(w, e)
			flusher.Flush()
		}
	}))
}

// --- AnalyzeDiagnosisStream tests (chatStream path) ---

func TestDeepSeekService_AnalyzeDiagnosisStream(t *testing.T) {
	events := []string{
		`data: {"type":"content_block_start","index":0}`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello "}}`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}`,
		`data: {"type":"content_block_stop","index":0}`,
		`data: [DONE]`,
	}

	server := newSSEServer(events)
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	var chunks []string
	result, err := svc.AnalyzeDiagnosisStream("面色萎黄", func(chunk string) error {
		chunks = append(chunks, chunk)
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != "hello world" {
		t.Errorf("expected full text 'hello world', got %q", result)
	}

	if len(chunks) != 2 {
		t.Errorf("expected 2 chunks, got %d", len(chunks))
	}
	if len(chunks) >= 2 {
		if chunks[0] != "hello " {
			t.Errorf("expected first chunk 'hello ', got %q", chunks[0])
		}
		if chunks[1] != "world" {
			t.Errorf("expected second chunk 'world', got %q", chunks[1])
		}
	}
}

func TestDeepSeekService_AnalyzeDiagnosisStream_Disabled(t *testing.T) {
	svc := &DeepSeekService{APIKey: ""}

	_, err := svc.AnalyzeDiagnosisStream("面色萎黄", func(chunk string) error {
		return nil
	})
	if err != ErrDeepSeekDisabled {
		t.Errorf("expected ErrDeepSeekDisabled, got %v", err)
	}
}

func TestDeepSeekService_AnalyzeDiagnosisStream_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal"}`))
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	_, err := svc.AnalyzeDiagnosisStream("面色萎黄", func(chunk string) error {
		return nil
	})
	if err == nil {
		t.Error("expected error for 500 response")
	}
	if !errors.Is(err, ErrDeepSeekFailed) {
		t.Errorf("expected ErrDeepSeekFailed, got %v", err)
	}
}

func TestDeepSeekService_AnalyzeDiagnosisStream_ChunkCallbackError(t *testing.T) {
	events := []string{
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"first"}}`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"second"}}`,
		`data: [DONE]`,
	}

	server := newSSEServer(events)
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	result, err := svc.AnalyzeDiagnosisStream("面色萎黄", func(chunk string) error {
		return errors.New("client disconnected")
	})
	// Implementation continues accumulating after client disconnect, returns full text with nil error
	if err != nil {
		t.Errorf("expected nil error (impl continues after client disconnect), got %v", err)
	}
	if !strings.Contains(result, "first") {
		t.Errorf("expected result to contain 'first', got %q", result)
	}
}

func TestDeepSeekService_AnalyzeDiagnosisStream_NilCallback(t *testing.T) {
	events := []string{
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}`,
		`data: [DONE]`,
	}

	server := newSSEServer(events)
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	result, err := svc.AnalyzeDiagnosisStream("面色萎黄", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "hello" {
		t.Errorf("expected 'hello', got %q", result)
	}
}

func TestDeepSeekService_AnalyzeDiagnosisStream_EmptyStream(t *testing.T) {
	// Stream with no content_block_delta events
	events := []string{
		`data: {"type":"content_block_start","index":0}`,
		`data: {"type":"content_block_stop","index":0}`,
		`data: [DONE]`,
	}

	server := newSSEServer(events)
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	_, err := svc.AnalyzeDiagnosisStream("面色萎黄", nil)
	if err == nil {
		t.Error("expected error for empty stream content")
	}
	if !errors.Is(err, ErrDeepSeekFailed) {
		t.Errorf("expected ErrDeepSeekFailed, got %v", err)
	}
}

// --- QueryWuyunLiuqiStream tests (chatStream path) ---

func TestDeepSeekService_QueryWuyunLiuqiStream(t *testing.T) {
	events := []string{
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"甲辰年"}}`,
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"土运太过"}}`,
		`data: [DONE]`,
	}

	server := newSSEServer(events)
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	var chunks []string
	result, err := svc.QueryWuyunLiuqiStream(2024, func(chunk string) error {
		chunks = append(chunks, chunk)
		return nil
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != "甲辰年土运太过" {
		t.Errorf("expected '甲辰年土运太过', got %q", result)
	}
	if len(chunks) != 2 {
		t.Errorf("expected 2 chunks, got %d", len(chunks))
	}
}

func TestDeepSeekService_QueryWuyunLiuqiStream_Disabled(t *testing.T) {
	svc := &DeepSeekService{APIKey: ""}

	_, err := svc.QueryWuyunLiuqiStream(2024, func(chunk string) error {
		return nil
	})
	if err != ErrDeepSeekDisabled {
		t.Errorf("expected ErrDeepSeekDisabled, got %v", err)
	}
}

func TestDeepSeekService_QueryWuyunLiuqiStream_VerifiesStreamFlag(t *testing.T) {
	// Verify that the request body includes stream:true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody aiRequest
		json.NewDecoder(r.Body).Decode(&reqBody)

		if !reqBody.Stream {
			t.Error("expected stream:true in request body")
		}

		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		fmt.Fprintln(w, `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}`)
		flusher.Flush()
		fmt.Fprintln(w, `data: [DONE]`)
		flusher.Flush()
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	_, err := svc.QueryWuyunLiuqiStream(2024, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// --- chatLong verifies request format ---

func TestDeepSeekService_AnalyzeDiagnosis_VerifiesHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("expected Bearer test-key, got %s", r.Header.Get("Authorization"))
		}
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("expected anthropic-version header, got %s", r.Header.Get("anthropic-version"))
		}

		// Verify request body has max_tokens 4096 (chatLong)
		var reqBody aiRequest
		json.NewDecoder(r.Body).Decode(&reqBody)
		if reqBody.MaxTokens != 4096 {
			t.Errorf("expected max_tokens 4096, got %d", reqBody.MaxTokens)
		}

		resp := mockAIResponse("analysis result")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	result, err := svc.AnalyzeDiagnosis("面色萎黄")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "analysis result" {
		t.Errorf("expected 'analysis result', got %q", result)
	}
}

// --- chatLong no content ---

func TestDeepSeekService_AnalyzeTongue_NoContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return response with empty content array
		resp := aiResponse{Content: []aiContentBlock{}}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	svc := &DeepSeekService{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "test-model",
	}

	_, err := svc.AnalyzeTongue("舌质红")
	if err == nil {
		t.Error("expected error for empty content response")
	}
	if !strings.Contains(err.Error(), "no content returned") {
		t.Errorf("expected 'no content returned' in error, got %v", err)
	}
}
