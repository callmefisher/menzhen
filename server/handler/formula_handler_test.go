package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/callmefisher/menzhen/server/model"
	"github.com/stretchr/testify/assert"
)

func TestFormulaHandler_List_Success(t *testing.T) {
	env := setupTestEnv(t)

	formulas := []model.Formula{
		{Name: "小青龙汤", Effects: "解表散寒"},
		{Name: "麻黄汤", Effects: "发汗解表"},
		{Name: "桂枝汤", Effects: "解肌发表"},
	}
	for i := range formulas {
		assert.NoError(t, env.DB.Create(&formulas[i]).Error)
	}

	w := env.doRequest("GET", "/api/v1/formulas?page=1&size=10", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	body := parseJSON(w)
	assert.Equal(t, float64(0), body["code"])

	data := body["data"].(map[string]interface{})
	assert.Equal(t, float64(3), data["total"])

	list := data["list"].([]interface{})
	assert.Len(t, list, 3)
}

func TestFormulaHandler_Detail_Success(t *testing.T) {
	env := setupTestEnv(t)

	formula := model.Formula{Name: "小青龙汤", Effects: "解表散寒"}
	assert.NoError(t, env.DB.Create(&formula).Error)

	w := env.doRequest("GET", fmt.Sprintf("/api/v1/formulas/%d", formula.ID), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	data := getData(w)
	assert.NotNil(t, data)
	assert.Equal(t, "小青龙汤", data["name"])
}

func TestFormulaHandler_Detail_NotFound(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequest("GET", "/api/v1/formulas/99999", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestFormulaHandler_NoToken(t *testing.T) {
	env := setupTestEnv(t)

	w := env.doRequestNoAuth("GET", "/api/v1/formulas", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
