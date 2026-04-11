package models

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Category struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Color     string `json:"color"`
}

type Product struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Price       float64   `json:"price"`
	PriceUnit   string    `json:"price_unit"`
	CategoryID  *string   `json:"category_id"`
	ImagePath   string    `json:"image_url"`
	IsActive    bool      `json:"active"`
	SortOrder   int       `json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ListProducts returns all products, optionally filtered by category
func ListProducts(ctx context.Context, db *sql.DB, categoryFilter *string) ([]Product, error) {
	query := "SELECT id, name, description, price, price_unit, category_id, image_path, is_active, sort_order, created_at, updated_at FROM products WHERE is_active = 1"
	var args []interface{}

	if categoryFilter != nil && *categoryFilter != "" {
		query += " AND category_id = ?"
		args = append(args, *categoryFilter)
	}

	query += " ORDER BY sort_order ASC, name ASC"

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query products: %w", err)
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err := rows.Scan(
			&product.ID, &product.Name, &product.Description, &product.Price, &product.PriceUnit,
			&product.CategoryID, &product.ImagePath, &product.IsActive, &product.SortOrder,
			&product.CreatedAt, &product.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan product: %w", err)
		}
		products = append(products, product)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating products: %w", err)
	}

	return products, nil
}

// GetProduct retrieves a product by ID
func GetProduct(db *sql.DB, id string) (*Product, error) {
	product := &Product{}
	err := db.QueryRow(
		"SELECT id, name, description, price, price_unit, category_id, image_path, is_active, sort_order, created_at, updated_at FROM products WHERE id = ?",
		id,
	).Scan(
		&product.ID, &product.Name, &product.Description, &product.Price, &product.PriceUnit,
		&product.CategoryID, &product.ImagePath, &product.IsActive, &product.SortOrder,
		&product.CreatedAt, &product.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("product not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query product: %w", err)
	}

	return product, nil
}

// CreateProduct creates a new product
func CreateProduct(db *sql.DB, product *Product) (*Product, error) {
	product.ID = uuid.New().String()
	product.CreatedAt = time.Now()
	product.UpdatedAt = time.Now()

	err := db.QueryRow(
		"INSERT INTO products (id, name, description, price, price_unit, category_id, image_path, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
		product.ID, product.Name, product.Description, product.Price, product.PriceUnit,
		product.CategoryID, product.ImagePath, product.IsActive, product.SortOrder,
		product.CreatedAt, product.UpdatedAt,
	).Scan(&product.ID)

	if err != nil {
		return nil, fmt.Errorf("failed to create product: %w", err)
	}

	return product, nil
}

// UpdateProduct updates a product
func UpdateProduct(db *sql.DB, id string, product *Product) (*Product, error) {
	product.UpdatedAt = time.Now()

	_, err := db.Exec(
		"UPDATE products SET name = ?, description = ?, price = ?, price_unit = ?, category_id = ?, image_path = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE id = ?",
		product.Name, product.Description, product.Price, product.PriceUnit,
		product.CategoryID, product.ImagePath, product.IsActive, product.SortOrder,
		product.UpdatedAt, id,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to update product: %w", err)
	}

	return GetProduct(db, id)
}

// DeleteProduct soft-deletes a product (marks as inactive)
func DeleteProduct(db *sql.DB, id string) error {
	result, err := db.Exec(
		"UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?",
		id,
	)

	if err != nil {
		return fmt.Errorf("failed to delete product: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("product not found")
	}

	return nil
}

// ListCategories returns all categories
func ListCategories(db *sql.DB) ([]Category, error) {
	rows, err := db.Query(
		"SELECT id, name, sort_order, color FROM categories ORDER BY sort_order ASC, name ASC",
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query categories: %w", err)
	}
	defer rows.Close()

	var categories []Category
	for rows.Next() {
		var cat Category
		err := rows.Scan(&cat.ID, &cat.Name, &cat.SortOrder, &cat.Color)
		if err != nil {
			return nil, fmt.Errorf("failed to scan category: %w", err)
		}
		categories = append(categories, cat)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating categories: %w", err)
	}

	return categories, nil
}

// GetCategory retrieves a category by ID
func GetCategory(db *sql.DB, id string) (*Category, error) {
	cat := &Category{}
	err := db.QueryRow(
		"SELECT id, name, sort_order, color FROM categories WHERE id = ?",
		id,
	).Scan(&cat.ID, &cat.Name, &cat.SortOrder, &cat.Color)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("category not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query category: %w", err)
	}

	return cat, nil
}

// CreateCategory creates a new category
func CreateCategory(db *sql.DB, cat *Category) (*Category, error) {
	cat.ID = uuid.New().String()

	err := db.QueryRow(
		"INSERT INTO categories (id, name, sort_order, color) VALUES (?, ?, ?, ?) RETURNING id",
		cat.ID, cat.Name, cat.SortOrder, cat.Color,
	).Scan(&cat.ID)

	if err != nil {
		return nil, fmt.Errorf("failed to create category: %w", err)
	}

	return cat, nil
}

// UpdateCategory updates a category
func UpdateCategory(db *sql.DB, id string, cat *Category) (*Category, error) {
	_, err := db.Exec(
		"UPDATE categories SET name = ?, sort_order = ?, color = ? WHERE id = ?",
		cat.Name, cat.SortOrder, cat.Color, id,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to update category: %w", err)
	}

	return GetCategory(db, id)
}

// DeleteCategory deletes a category
func DeleteCategory(db *sql.DB, id string) error {
	result, err := db.Exec("DELETE FROM categories WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete category: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("category not found")
	}

	return nil
}
