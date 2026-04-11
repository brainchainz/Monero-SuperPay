package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/monero-superpay/monero-superpay/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type CreateProductRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	PriceUnit   string  `json:"price_unit"`
	CategoryID  *string `json:"category_id"`
	ImagePath   string  `json:"image_url"` // frontend sends "image_url"
	IsActive    bool    `json:"is_active"`
	Active      bool    `json:"active"` // frontend sends "active"
	SortOrder   int     `json:"sort_order"`
}

type UpdateProductRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	PriceUnit   string  `json:"price_unit"`
	CategoryID  *string `json:"category_id"`
	ImagePath   string  `json:"image_url"` // frontend sends "image_url"
	IsActive    bool    `json:"is_active"`
	Active      bool    `json:"active"` // frontend sends "active"
	SortOrder   int     `json:"sort_order"`
}

type CreateCategoryRequest struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Color     string `json:"color"`
}

type UpdateCategoryRequest struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Color     string `json:"color"`
}

// ListProducts returns all active products
func ListProducts(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		categoryFilter := r.URL.Query().Get("category")
		var categoryFilterPtr *string
		if categoryFilter != "" {
			categoryFilterPtr = &categoryFilter
		}

		products, err := models.ListProducts(r.Context(), deps.DB, categoryFilterPtr)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to list products")
			return
		}

		if products == nil {
			products = []models.Product{}
		}

		respondSuccess(w, http.StatusOK, products)
	}
}

// GetProduct returns a specific product
func GetProduct(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		productID := chi.URLParam(r, "id")

		product, err := models.GetProduct(deps.DB, productID)
		if err != nil {
			respondError(w, http.StatusNotFound, "product not found")
			return
		}

		respondSuccess(w, http.StatusOK, product)
	}
}

// CreateProduct creates a new product
func CreateProduct(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req CreateProductRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}

		if len(req.Name) > 255 {
			respondError(w, http.StatusBadRequest, "name must not exceed 255 characters")
			return
		}

		if len(req.Description) > 5000 {
			respondError(w, http.StatusBadRequest, "description must not exceed 5000 characters")
			return
		}

		if req.Price < 0 {
			respondError(w, http.StatusBadRequest, "price must be non-negative")
			return
		}

		// Accept both "active" (frontend) and "is_active" field names
		isActive := req.IsActive || req.Active

		product := &models.Product{
			Name:        req.Name,
			Description: req.Description,
			Price:       req.Price,
			PriceUnit:   req.PriceUnit,
			CategoryID:  req.CategoryID,
			ImagePath:   req.ImagePath,
			IsActive:    isActive,
			SortOrder:   req.SortOrder,
		}

		createdProduct, err := models.CreateProduct(deps.DB, product)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to create product")
			return
		}

		respondSuccess(w, http.StatusCreated, createdProduct)
	}
}

// UpdateProduct updates a product
func UpdateProduct(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		productID := chi.URLParam(r, "id")

		var req UpdateProductRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}

		if len(req.Name) > 255 {
			respondError(w, http.StatusBadRequest, "name must not exceed 255 characters")
			return
		}

		if len(req.Description) > 5000 {
			respondError(w, http.StatusBadRequest, "description must not exceed 5000 characters")
			return
		}

		if req.Price < 0 {
			respondError(w, http.StatusBadRequest, "price must be non-negative")
			return
		}

		isActive := req.IsActive || req.Active

		product := &models.Product{
			Name:        req.Name,
			Description: req.Description,
			Price:       req.Price,
			PriceUnit:   req.PriceUnit,
			CategoryID:  req.CategoryID,
			ImagePath:   req.ImagePath,
			IsActive:    isActive,
			SortOrder:   req.SortOrder,
		}

		updatedProduct, err := models.UpdateProduct(deps.DB, productID, product)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to update product")
			return
		}

		respondSuccess(w, http.StatusOK, updatedProduct)
	}
}

// DeleteProduct deletes a product
func DeleteProduct(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		productID := chi.URLParam(r, "id")

		if err := models.DeleteProduct(deps.DB, productID); err != nil {
			respondError(w, http.StatusNotFound, "product not found")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// ListCategories returns all categories
func ListCategories(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		categories, err := models.ListCategories(deps.DB)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to list categories")
			return
		}

		if categories == nil {
			categories = []models.Category{}
		}

		respondSuccess(w, http.StatusOK, categories)
	}
}

// CreateCategory creates a new category
func CreateCategory(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req CreateCategoryRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}

		if len(req.Name) > 255 {
			respondError(w, http.StatusBadRequest, "name must not exceed 255 characters")
			return
		}

		category := &models.Category{
			Name:      req.Name,
			SortOrder: req.SortOrder,
			Color:     req.Color,
		}

		createdCategory, err := models.CreateCategory(deps.DB, category)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to create category")
			return
		}

		respondSuccess(w, http.StatusCreated, createdCategory)
	}
}

// UpdateCategory updates a category
func UpdateCategory(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		categoryID := chi.URLParam(r, "id")

		var req UpdateCategoryRequest
		if err := decodeJSON(r, &req); err != nil {
			respondError(w, http.StatusBadRequest, "invalid request")
			return
		}

		if req.Name == "" {
			respondError(w, http.StatusBadRequest, "name is required")
			return
		}

		if len(req.Name) > 255 {
			respondError(w, http.StatusBadRequest, "name must not exceed 255 characters")
			return
		}

		category := &models.Category{
			Name:      req.Name,
			SortOrder: req.SortOrder,
			Color:     req.Color,
		}

		updatedCategory, err := models.UpdateCategory(deps.DB, categoryID, category)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to update category")
			return
		}

		respondSuccess(w, http.StatusOK, updatedCategory)
	}
}

// DeleteCategory deletes a category
func DeleteCategory(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		categoryID := chi.URLParam(r, "id")

		if err := models.DeleteCategory(deps.DB, categoryID); err != nil {
			respondError(w, http.StatusNotFound, "category not found")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// UploadProductImageRequest represents an image upload request
type UploadProductImageRequest struct {
	ImagePath string `json:"image_path"`
}

// UploadProductImageResponse represents the response from image upload
type UploadProductImageResponse struct {
	ImagePath string `json:"image_path"`
	URL       string `json:"url"`
}

// UploadProductImage handles product image uploads
func UploadProductImage(deps *Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		productID := chi.URLParam(r, "id")

		// Parse multipart form with max 10MB file size
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			respondError(w, http.StatusBadRequest, "failed to parse form")
			return
		}

		file, handler, err := r.FormFile("image")
		if err != nil {
			respondError(w, http.StatusBadRequest, "image file is required")
			return
		}
		defer file.Close()

		// Read first 512 bytes for content type detection
		buffer := make([]byte, 512)
		n, err := file.Read(buffer)
		if err != nil && err != io.EOF {
			respondError(w, http.StatusBadRequest, "failed to read file")
			return
		}

		// Detect content type from file contents
		detectedType := http.DetectContentType(buffer[:n])

		// Whitelist allowed image MIME types
		allowedTypes := map[string]bool{
			"image/jpeg": true,
			"image/png":  true,
			"image/webp": true,
			"image/gif":  true,
		}

		if !allowedTypes[detectedType] {
			respondError(w, http.StatusBadRequest, "invalid image format - only JPEG, PNG, WebP, and GIF are allowed")
			return
		}

		// Seek back to start for copying
		if _, err := file.Seek(0, 0); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to seek in file")
			return
		}

		// Create uploads directory if it doesn't exist
		uploadDir := deps.Cfg.UploadDir
		if uploadDir == "" {
			uploadDir = "./uploads"
		}

		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to create upload directory")
			return
		}

		// Generate unique filename using only the extension
		ext := filepath.Ext(handler.Filename)
		filename := fmt.Sprintf("%s%s", uuid.New().String(), ext)
		filepath := filepath.Join(uploadDir, filename)

		// Create destination file
		dst, err := os.Create(filepath)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to create file")
			return
		}
		defer dst.Close()

		// Copy file content
		if _, err := io.Copy(dst, file); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to save file")
			return
		}

		// Get existing product
		product, err := models.GetProduct(deps.DB, productID)
		if err != nil {
			respondError(w, http.StatusNotFound, "product not found")
			return
		}

		// Update product with new image path
		imagePath := "/uploads/" + filename
		product.ImagePath = imagePath
		_, err = models.UpdateProduct(deps.DB, productID, product)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to update product")
			return
		}

		respondSuccess(w, http.StatusOK, UploadProductImageResponse{
			ImagePath: imagePath,
			URL:       imagePath,
		})
	}
}
