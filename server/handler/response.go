package handler

import "github.com/gin-gonic/gin"

// Success responds with HTTP 200 and a standard success envelope.
func Success(c *gin.Context, data interface{}) {
	c.JSON(200, gin.H{"code": 0, "message": "success", "data": data})
}

// SuccessWithPagination responds with HTTP 200, data, and pagination metadata.
func SuccessWithPagination(c *gin.Context, data interface{}, page, size int, total int64) {
	c.JSON(200, gin.H{
		"code": 0, "message": "success",
		"data": data,
		"pagination": gin.H{"page": page, "size": size, "total": total},
	})
}

// Created responds with HTTP 201 and a standard success envelope.
func Created(c *gin.Context, data interface{}) {
	c.JSON(201, gin.H{"code": 0, "message": "success", "data": data})
}

// Error responds with the given HTTP status code and error message.
func Error(c *gin.Context, httpCode int, message string) {
	c.JSON(httpCode, gin.H{"code": httpCode, "message": message})
}
