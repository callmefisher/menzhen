package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/callmefisher/menzhen/server/config"
)

var (
	ErrDeepSeekDisabled = errors.New("DeepSeek API key not configured")
	ErrDeepSeekFailed   = errors.New("DeepSeek API request failed")
)

// DeepSeekService handles communication with the DeepSeek AI API.
type DeepSeekService struct {
	APIKey  string
	BaseURL string
	Model   string
	Client  *http.Client
}

// NewDeepSeekService creates a new DeepSeekService from config.
func NewDeepSeekService(cfg *config.Config) *DeepSeekService {
	return &DeepSeekService{
		APIKey:  cfg.DeepSeekAPIKey,
		BaseURL: cfg.DeepSeekBaseURL,
		Model:   cfg.DeepSeekModel,
		Client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// IsEnabled returns true if the DeepSeek API key is configured.
func (s *DeepSeekService) IsEnabled() bool {
	return s.APIKey != ""
}

// API request/response types (Anthropic Messages API format)

type aiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiRequest struct {
	Model     string      `json:"model"`
	System    string      `json:"system,omitempty"`
	Messages  []aiMessage `json:"messages"`
	MaxTokens int         `json:"max_tokens"`
}

type aiContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type aiResponse struct {
	Content []aiContentBlock `json:"content"`
}

// HerbAIResult is the parsed result from DeepSeek for herb queries.
type HerbAIResult struct {
	Name        string `json:"name"`
	Alias       string `json:"alias"`
	Category    string `json:"category"`
	Properties  string `json:"properties"`
	Effects     string `json:"effects"`
	Indications string `json:"indications"`
}

// FormulaCompositionAI represents a single herb in a formula composition from AI.
type FormulaCompositionAI struct {
	HerbName      string `json:"herb_name"`
	DefaultDosage string `json:"default_dosage"`
}

// FormulaAIResult is the parsed result from DeepSeek for formula queries.
type FormulaAIResult struct {
	Name        string                 `json:"name"`
	Effects     string                 `json:"effects"`
	Indications string                 `json:"indications"`
	Composition []FormulaCompositionAI `json:"composition"`
}

// QueryHerb queries DeepSeek for information about a specific herb.
func (s *DeepSeekService) QueryHerb(name string) (*HerbAIResult, error) {
	if !s.IsEnabled() {
		return nil, ErrDeepSeekDisabled
	}

	systemPrompt := `你是一个中医药数据库助手。用户会查询中药信息，请以严格的JSON格式返回。
不要返回任何其他文字，只返回JSON。
JSON格式如下:
{
  "name": "药物名称",
  "alias": "别名，多个用逗号分隔",
  "category": "归类，如理气、活血、补气等",
  "properties": "性味归经",
  "effects": "功效",
  "indications": "主治"
}
如果你不确定该药物信息，请返回你最了解的内容，不要编造。`

	userPrompt := fmt.Sprintf("请提供中药「%s」的详细信息。", name)

	content, err := s.chat(systemPrompt, userPrompt)
	if err != nil {
		return nil, err
	}

	var result HerbAIResult
	if err := parseJSONFromContent(content, &result); err != nil {
		log.Printf("DeepSeek: failed to parse herb response: %v, content: %s", err, content)
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	// Use the queried name if AI returned empty name
	if result.Name == "" {
		result.Name = name
	}

	return &result, nil
}

// QueryFormula queries DeepSeek for information about a specific formula.
func (s *DeepSeekService) QueryFormula(name string) (*FormulaAIResult, error) {
	if !s.IsEnabled() {
		return nil, ErrDeepSeekDisabled
	}

	systemPrompt := `你是一个中医药数据库助手。用户会查询方剂信息，请以严格的JSON格式返回。
不要返回任何其他文字，只返回JSON。
JSON格式如下:
{
  "name": "方剂名称",
  "effects": "功效",
  "indications": "主治",
  "composition": [
    {"herb_name": "药物名称", "default_dosage": "默认用量如9g"},
    ...
  ]
}
如果你不确定该方剂信息，请返回你最了解的内容，不要编造。`

	userPrompt := fmt.Sprintf("请提供方剂「%s」的详细信息，包括所有组成药物及其用量。", name)

	content, err := s.chat(systemPrompt, userPrompt)
	if err != nil {
		return nil, err
	}

	var result FormulaAIResult
	if err := parseJSONFromContent(content, &result); err != nil {
		log.Printf("DeepSeek: failed to parse formula response: %v, content: %s", err, content)
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	if result.Name == "" {
		result.Name = name
	}

	return &result, nil
}

// chat sends a request to the AI API (Anthropic Messages format) and returns the response text.
func (s *DeepSeekService) chat(systemPrompt, userPrompt string) (string, error) {
	reqBody := aiRequest{
		Model:  s.Model,
		System: systemPrompt,
		Messages: []aiMessage{
			{Role: "user", Content: userPrompt},
		},
		MaxTokens: 2000,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", s.BaseURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := s.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrDeepSeekFailed, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("DeepSeek API error: status=%d body=%s", resp.StatusCode, string(respBody))
		return "", fmt.Errorf("%w: status %d", ErrDeepSeekFailed, resp.StatusCode)
	}

	var aiResp aiResponse
	if err := json.Unmarshal(respBody, &aiResp); err != nil {
		return "", fmt.Errorf("failed to parse API response: %w", err)
	}

	if len(aiResp.Content) == 0 {
		return "", fmt.Errorf("%w: no content returned", ErrDeepSeekFailed)
	}

	// Concatenate all text blocks
	var textParts []string
	for _, block := range aiResp.Content {
		if block.Type == "text" {
			textParts = append(textParts, block.Text)
		}
	}
	if len(textParts) == 0 {
		return "", fmt.Errorf("%w: no text content returned", ErrDeepSeekFailed)
	}

	return strings.Join(textParts, ""), nil
}

// AnalyzeDiagnosis calls DeepSeek to perform TCM+modern medicine analysis on the given diagnosis text.
// Returns the raw AI response text (not JSON).
func (s *DeepSeekService) AnalyzeDiagnosis(diagnosis string) (string, error) {
	if !s.IsEnabled() {
		return "", ErrDeepSeekDisabled
	}

	systemPrompt := `你是一名执业临床5000年的中医药专家，也是一名现代医学专家，熟读皇帝内经，伤寒论，金匮要略，温病条辨，神农本草经，针灸甲乙经以及历代各个著名中医大家(例如古代张仲景，孙思邈，金元四大家，叶天士，王孟英，当代和近代其他医学大家)的著作和医案。也非常熟悉中国的传统哲学经典例如道德经，论语，诗经，易经，中庸等各个时期的经典著作，深刻了解中药的性味归经和针对生理的独有特性，也熟悉现代医学的解剖学，生理学，药物学，内科学，外科学，骨科，生殖系统，妇科，男科，儿科，神经系统，血液科，皮肤科，消化科，脑科学，心脏科，呼吸科，肾脏科，肝脏科等各个科室的专家。

请从哲学、中医学、西医学、现代医学等各个角度进行辩证论治，提供多种临床思路和药物思路。请以 Markdown 格式输出分析结果，使用标题、列表、加粗等格式，确保层次分明、可读性强。`

	userPrompt := fmt.Sprintf("请针对以下诊断信息进行全面的辩证论治分析：\n\n%s", diagnosis)

	return s.chatLong(systemPrompt, userPrompt)
}

// chatLong sends a request to the AI API with a longer timeout and higher token limit for analysis tasks.
func (s *DeepSeekService) chatLong(systemPrompt, userPrompt string) (string, error) {
	reqBody := aiRequest{
		Model:  s.Model,
		System: systemPrompt,
		Messages: []aiMessage{
			{Role: "user", Content: userPrompt},
		},
		MaxTokens: 4096,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", s.BaseURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	// Use a longer timeout for analysis
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrDeepSeekFailed, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("DeepSeek API error: status=%d body=%s", resp.StatusCode, string(respBody))
		return "", fmt.Errorf("%w: status %d", ErrDeepSeekFailed, resp.StatusCode)
	}

	var aiResp aiResponse
	if err := json.Unmarshal(respBody, &aiResp); err != nil {
		return "", fmt.Errorf("failed to parse API response: %w", err)
	}

	if len(aiResp.Content) == 0 {
		return "", fmt.Errorf("%w: no content returned", ErrDeepSeekFailed)
	}

	var textParts []string
	for _, block := range aiResp.Content {
		if block.Type == "text" {
			textParts = append(textParts, block.Text)
		}
	}
	if len(textParts) == 0 {
		return "", fmt.Errorf("%w: no text content returned", ErrDeepSeekFailed)
	}

	return strings.Join(textParts, ""), nil
}

// parseJSONFromContent extracts and parses JSON from AI response content.
// The content may contain markdown code blocks around the JSON.
func parseJSONFromContent(content string, v interface{}) error {
	// Try to extract JSON from markdown code block
	cleaned := content
	if idx := strings.Index(content, "```json"); idx != -1 {
		cleaned = content[idx+7:]
		if endIdx := strings.Index(cleaned, "```"); endIdx != -1 {
			cleaned = cleaned[:endIdx]
		}
	} else if idx := strings.Index(content, "```"); idx != -1 {
		cleaned = content[idx+3:]
		if endIdx := strings.Index(cleaned, "```"); endIdx != -1 {
			cleaned = cleaned[:endIdx]
		}
	}

	cleaned = strings.TrimSpace(cleaned)

	return json.Unmarshal([]byte(cleaned), v)
}
