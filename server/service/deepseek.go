package service

import (
	"bufio"
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
	Stream    bool        `json:"stream,omitempty"`
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
	Origin      string `json:"origin"`
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

// PulseAIResult is the parsed result from DeepSeek for pulse queries.
type PulseAIResult struct {
	Name             string `json:"name"`
	Category         string `json:"category"`
	Description      string `json:"description"`
	ClinicalMeaning  string `json:"clinical_meaning"`
	CommonConditions string `json:"common_conditions"`
}

// QueryHerb queries DeepSeek for information about a specific herb.
func (s *DeepSeekService) QueryHerb(name string) (*HerbAIResult, error) {
	if !s.IsEnabled() {
		return nil, ErrDeepSeekDisabled
	}

	systemPrompt := `你是一个中医药数据库助手。也是一个中医药和临床专家,精通传统古中医各个时代药学经典,精通神农本草经,本草纲目,新修本草,现代的中药学,用户会查询中药信息,请以严格的JSON格式返回。
不要返回任何其他文字,只返回JSON。
JSON格式如下:
{
  "name": "药物名称",
  "alias": "别名，多个用逗号分隔",
  "category": "归类，如理气、活血、补气等",
  "properties": "性味归经",
  "effects": "功效",
  "indications": "主治",
  "origin": "道地产区"
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

	systemPrompt := `你是一个中医药数据库助手。也是一个中医药和临床专家,精通各个时代经典的方剂经典,例如伤寒杂病论,千金要方,千金翼方,金元四大家的著作和叶天士,王孟英,张锡纯,傅青主的著作,也精通医宗金鉴和现代的方剂学,用户会查询方剂信息,请以严格的JSON格式返回。
不要返回任何其他文字,只返回JSON。
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

// QueryPulse queries DeepSeek for information about a specific pulse type.
func (s *DeepSeekService) QueryPulse(name string) (*PulseAIResult, error) {
	if !s.IsEnabled() {
		return nil, ErrDeepSeekDisabled
	}

	systemPrompt := `你是一个中医脉学数据库助手,也是一个中医脉学和临床专家，精通难经，脉经，黄帝内经，濒湖脉学,伤寒杂病论,注重脉象与临床结合。用户会查询脉象信息,请以严格的JSON格式返回。
不要返回任何其他文字,只返回JSON。
JSON格式如下:
{
  "name": "脉象名称",
  "category": "分类，如浮脉类、沉脉类、迟脉类、数脉类等",
  "description": "脉象特征描述",
  "clinical_meaning": "临床意义",
  "common_conditions": "常见病症"
}
如果你不确定该脉象信息，请返回你最了解的内容，不要编造。`

	userPrompt := fmt.Sprintf("请提供脉象「%s」的详细信息。", name)

	content, err := s.chat(systemPrompt, userPrompt)
	if err != nil {
		return nil, err
	}

	var result PulseAIResult
	if err := parseJSONFromContent(content, &result); err != nil {
		log.Printf("DeepSeek: failed to parse pulse response: %v, content: %s", err, content)
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	if result.Name == "" {
		result.Name = name
	}

	return &result, nil
}

// AnalyzeTongue calls DeepSeek to analyze tongue diagnosis description.
func (s *DeepSeekService) AnalyzeTongue(description string) (string, error) {
	if !s.IsEnabled() {
		return "", ErrDeepSeekDisabled
	}

	systemPrompt := `你是一名中医舌诊专家，精通《舌鉴辨正》《察舌辨症新法》等舌诊经典著作,对舌质、舌苔、舌形、舌态的辨证分析有深入研究。

请根据用户描述的舌象，从以下角度进行辨证分析：
1. 舌象解读：对描述的舌质、舌苔等特征逐一分析
2. 脏腑辨证：舌象反映的脏腑状态
3. 病机分析：可能的病因病机
4. 证型判断：最可能的证型

注意：只输出中医辨证分析内容，不要包含饮食、生活调养、养生保健等建议。
请以 Markdown 格式输出，使用标题、列表、加粗等格式，确保层次分明。`

	userPrompt := fmt.Sprintf("请分析以下舌象描述：\n\n%s", description)

	return s.chatLong(systemPrompt, userPrompt)
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

	systemPrompt := `你是一名执业临床5000年的中医药专家,也是一名现代医学专家,精通黄帝内经,伤寒论,金匮要略,温病条辨,神农本草经,诸病源候论,针灸甲乙经,五运六气学说以及历代中医大家(例如张仲景，孙思邈，金元四大家,叶天士,王孟英,傅青主,近现代的施今墨,赵绍琴,胡希恕,邓铁涛,李可,倪海厦,李阳波,针灸专家贺普仁,石学敏,吕景山,董氏奇穴董景昌的著作和医案。也非常熟悉中国的传统哲学经典例如道德经,论语,诗经,易经等各个时期的经典著作，深刻了解中药的性味归经和特性，也熟悉现代医学的解剖学，生理病理学等。

请从哲学、中医学等各个角度，引用上述经典著作作为理论依据，进行深刻的辩证论治，提供临床和理法方药参考。请以 Markdown 格式输出分析结果，使用标题、列表、加粗等格式，确保层次分明、可读性强。`

	userPrompt := fmt.Sprintf("请针对以下诊断信息进行全面的辩证论治分析：\n\n%s", diagnosis)

	return s.chatLong(systemPrompt, userPrompt)
}

// AnalyzeDiagnosisStream calls DeepSeek to perform TCM+modern medicine analysis with streaming.
// Returns the full concatenated text when done.
func (s *DeepSeekService) AnalyzeDiagnosisStream(diagnosis string, onChunk func(string) error) (string, error) {
	if !s.IsEnabled() {
		return "", ErrDeepSeekDisabled
	}

	systemPrompt := `你是一名执业临床5000年的中医药专家,也是一名现代医学专家,精通黄帝内经,伤寒论,金匮要略,温病条辨,神农本草经,诸病源候论,针灸甲乙经,五运六气学说以及历代中医大家(例如张仲景，孙思邈，金元四大家,叶天士,王孟英,傅青主,近现代的施今墨,赵绍琴,胡希恕,邓铁涛,李可,倪海厦,李阳波,针灸专家贺普仁,石学敏,吕景山,董氏奇穴董景昌的著作和医案。也非常熟悉中国的传统哲学经典例如道德经,论语,诗经,易经等各个时期的经典著作，深刻了解中药的性味归经和特性，也熟悉现代医学的解剖学，生理病理学等。

请从哲学、中医学等各个角度，引用上述经典著作作为理论依据，进行深刻的辩证论治，提供临床和理法方药参考。请以 Markdown 格式输出分析结果，使用标题、列表、加粗等格式，确保层次分明、可读性强。`

	userPrompt := fmt.Sprintf("请针对以下诊断信息进行全面的辩证论治分析：\n\n%s", diagnosis)

	return s.chatStream(systemPrompt, userPrompt, onChunk)
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

// streamEvent represents one SSE event from the Anthropic streaming API.
type streamEvent struct {
	Type  string `json:"type"`
	Delta *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"delta,omitempty"`
}

// chatStream sends a streaming request to the AI API and calls onChunk for each text delta.
// It returns the full concatenated text when done.
func (s *DeepSeekService) chatStream(systemPrompt, userPrompt string, onChunk func(string) error) (string, error) {
	reqBody := aiRequest{
		Model:  s.Model,
		System: systemPrompt,
		Messages: []aiMessage{
			{Role: "user", Content: userPrompt},
		},
		MaxTokens: 4096,
		Stream:    true,
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

	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrDeepSeekFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("DeepSeek API error: status=%d body=%s", resp.StatusCode, string(respBody))
		return "", fmt.Errorf("%w: status %d", ErrDeepSeekFailed, resp.StatusCode)
	}

	var fullText strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	// Increase buffer size for potentially large SSE lines.
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var evt streamEvent
		if err := json.Unmarshal([]byte(data), &evt); err != nil {
			continue
		}

		if evt.Type == "content_block_delta" && evt.Delta != nil && evt.Delta.Type == "text_delta" {
			fullText.WriteString(evt.Delta.Text)
			if onChunk != nil {
				if err := onChunk(evt.Delta.Text); err != nil {
					return fullText.String(), err
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return fullText.String(), fmt.Errorf("stream read error: %w", err)
	}

	result := fullText.String()
	if result == "" {
		return "", fmt.Errorf("%w: no text content returned from stream", ErrDeepSeekFailed)
	}

	return result, nil
}

// QueryWuyunLiuqiStream queries DeepSeek for Five Phases and Six Qi analysis with streaming.
func (s *DeepSeekService) QueryWuyunLiuqiStream(year int, onChunk func(string) error) (string, error) {
	if !s.IsEnabled() {
		return "", ErrDeepSeekDisabled
	}

	systemPrompt := `你是1个贯古通今的五运六气研究学者,精通黄帝内经、素问、运气七篇、易经等经典著作。
请根据用户提供的年份，以 Markdown 格式返回以下内容，确保层次分明、可读性强：

1. **天干地支**：该年份的干支纪年
2. **五运分析**：大运、主运、客运的详细分析
3. **六气分析**：主气、客气的逐步推演，司天、在泉、各气的升降变化
4. **气候与疾病预测**：基于运气推演，该年可能出现的气候特点和多发疾病
5. **养生建议**：针对该年运气特点的饮食、起居、情志调养建议
6. **重要补充知识**：你认为对了解该年五运六气很重要的其他知识

请引用经典原文作为理论依据，使用标题、列表、加粗等 Markdown 格式。`

	userPrompt := fmt.Sprintf("请分析 %d 年的五运六气。", year)

	return s.chatStream(systemPrompt, userPrompt, onChunk)
}

// QueryWuyunLiuqi queries DeepSeek for Five Phases and Six Qi analysis (non-streaming).
func (s *DeepSeekService) QueryWuyunLiuqi(year int) (string, error) {
	if !s.IsEnabled() {
		return "", ErrDeepSeekDisabled
	}

	systemPrompt := `你是1个贯古通今的五运六气研究学者,精通黄帝内经、素问、运气七篇、易经等经典著作。
请根据用户提供的年份，以 Markdown 格式返回以下内容，确保层次分明、可读性强：

1. **天干地支**：该年份的干支纪年
2. **五运分析**：大运、主运、客运的详细分析
3. **六气分析**：主气、客气的逐步推演，司天、在泉、各气的升降变化
4. **气候与疾病预测**：基于运气推演，该年可能出现的气候特点和多发疾病
5. **养生建议**：针对该年运气特点的饮食、起居、情志调养建议
6. **重要补充知识**：你认为对了解该年五运六气很重要的其他知识

请引用经典原文作为理论依据，使用标题、列表、加粗等 Markdown 格式。`

	userPrompt := fmt.Sprintf("请分析 %d 年的五运六气。", year)

	return s.chatLong(systemPrompt, userPrompt)
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
