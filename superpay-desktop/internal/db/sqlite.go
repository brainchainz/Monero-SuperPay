package db

import (
	"database/sql"
	"embed"
	"fmt"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Init initializes the SQLite database with WAL mode and runs migrations
func Init(dbPath string) (*sql.DB, error) {
	// Ensure directory exists
	if err := ensureDir(dbPath); err != nil {
		return nil, fmt.Errorf("failed to ensure directory: %w", err)
	}

	// Open database with connection string
	dsn := fmt.Sprintf("file:%s?cache=shared&mode=rwc&_journal_mode=WAL&_timeout=5000", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Configure connection pooling for improved performance
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Enable foreign keys
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	// Run migrations
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return db, nil
}

func runMigrations(db *sql.DB) error {
	// Read all migration files
	files, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}

	// Execute migrations in order
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".sql") {
			continue
		}

		data, err := migrationsFS.ReadFile("migrations/" + file.Name())
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", file.Name(), err)
		}

		// Split by semicolons and execute each statement
		statements := strings.Split(string(data), ";")
		for _, stmt := range statements {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}

			if _, err := db.Exec(stmt); err != nil {
				// Tolerate "duplicate column" errors from ALTER TABLE ADD COLUMN
				// since migrations re-run on every startup
				if strings.Contains(err.Error(), "duplicate column") {
					continue
				}
				return fmt.Errorf("failed to execute migration from %s: %w", file.Name(), err)
			}
		}
	}

	return nil
}

func ensureDir(dbPath string) error {
	// Extract directory from path and create it if missing
	parts := strings.Split(dbPath, "/")
	if len(parts) > 1 {
		dirPath := strings.Join(parts[:len(parts)-1], "/")
		if err := os.MkdirAll(dirPath, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dirPath, err)
		}
	}
	return nil
}
