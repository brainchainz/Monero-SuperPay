package handlers

import (
	"encoding/json"
	"net/http"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

type SuccessResponse struct {
	Data interface{} `json:"data"`
}

func respondJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, statusCode int, message string) {
	respondJSON(w, statusCode, ErrorResponse{Error: message})
}

func respondSuccess(w http.ResponseWriter, statusCode int, data interface{}) {
	if data == nil {
		data = map[string]interface{}{}
	}
	respondJSON(w, statusCode, SuccessResponse{Data: data})
}

func decodeJSON(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}
