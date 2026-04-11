# Monero SuperPay Backend

A complete Go backend for the Monero SuperPay Umbrel app using chi router, SQLite, and WebSocket support.

## Project Structure

```
backend/
├── cmd/server/
│   └── main.go                 # Application entry point
├── internal/
│   ├── config/
│   │   └── config.go          # Configuration management
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 001_init.sql   # Database schema
│   │   └── sqlite.go          # Database initialization
│   ├── handlers/
│   │   ├── deps.go            # Dependency injection
│   │   ├── device.go          # Device API handlers
│   │   ├── middleware.go      # Authentication middleware
│   │   ├── order.go           # Order API handlers
│   │   ├── product.go         # Product/Category handlers
│   │   ├── settings.go        # Settings handlers
│   │   ├── utils.go           # Response helpers
│   │   └── websocket.go       # WebSocket handler
│   └── models/
│       ├── device.go          # Device model and CRUD
│       ├── order.go           # Order model and CRUD
│       └── product.go         # Product/Category models
├── web/                        # Static frontend files (served by server)
├── go.mod                     # Go module definition
└── README.md                  # This file
```

## Features

- **Device Pairing**: Create pairing tokens and pair devices securely
- **Product Management**: CRUD operations for products and categories
- **Order Management**: Create orders with line items and track status
- **WebSocket Support**: Real-time updates for connected clients
- **API Key Authentication**: Secure API key validation for device communication
- **SQLite Database**: Persistent storage with WAL mode
- **Chi Router**: Fast, modular HTTP routing
- **CORS Support**: Cross-origin resource sharing configured
- **Graceful Shutdown**: Clean server shutdown with signal handling

## API Endpoints

### Device Management

```
POST   /api/devices/pairing-token     # Create pairing token
POST   /api/devices/pair              # Pair device with token
GET    /api/devices                   # List all devices
GET    /api/devices/{id}              # Get device details
PUT    /api/devices/{id}              # Update device
DELETE /api/devices/{id}              # Delete device
POST   /api/devices/{id}/heartbeat    # Update device heartbeat
```

### Product Management

```
GET    /api/products                  # List products (with category filter)
GET    /api/products/{id}             # Get product details
POST   /api/products                  # Create product
PUT    /api/products/{id}             # Update product
DELETE /api/products/{id}             # Delete product (soft delete)
```

### Category Management

```
GET    /api/categories                # List categories
POST   /api/categories                # Create category
PUT    /api/categories/{id}           # Update category
DELETE /api/categories/{id}           # Delete category
```

### Order Management

```
GET    /api/orders                    # List orders (with filters)
GET    /api/orders/{id}               # Get order details with items
POST   /api/orders                    # Create order
PUT    /api/orders/{id}/status        # Update order status
GET    /api/orders/stats/today        # Get order statistics
```

### Settings

```
GET    /api/settings                  # Get all settings
PUT    /api/settings                  # Update settings
```

### WebSocket

```
GET    /api/ws                        # WebSocket connection (requires API key)
```

### Health Check

```
GET    /health                        # Health check (no auth required)
```

## Environment Variables

```bash
PORT=3033                              # Server port (default: 3033)
DATABASE_PATH=./data/merchant.db       # SQLite database path
APP_SECRET=<generated>                 # JWT signing secret (auto-generated if not set)
UPLOAD_DIR=./data/uploads              # Upload directory for images
FIAT_CURRENCY=USD                      # Default fiat currency
CONFIRMATIONS=0                        # Required XMR confirmations
BUSINESS_NAME=Monero SuperPay          # Business name
TAX_RATE=0.0                           # Tax rate as decimal (e.g., 0.1 for 10%)
```

## Getting Started

### Prerequisites

- Go 1.22 or higher
- SQLite3 (included via modernc.org/sqlite)

### Installation

1. Clone the repository and navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
go mod download
```

3. Create data directory:
```bash
mkdir -p data/uploads
```

4. Run the server:
```bash
go run cmd/server/main.go
```

The server will start on `http://localhost:3033` by default.

### Database

The SQLite database is automatically initialized on first run with:
- Device management tables
- Product and category tables
- Order and order item tables
- Settings table
- Automatic indexes for performance

The database uses WAL (Write-Ahead Logging) mode for better concurrency.

## Authentication

All protected endpoints require API key authentication via one of:

1. `Authorization: Bearer <api-key>` header
2. `X-API-Key: <api-key>` header

API keys are generated during device pairing and are SHA256 hashed in the database.

## Device Pairing Flow

1. **Create Pairing Token**
   ```bash
   POST /api/devices/pairing-token
   {"device_name": "POS Terminal 1"}
   ```
   Response: `{"token": "..."}`

2. **Pair Device**
   ```bash
   POST /api/devices/pair
   {"token": "..."}
   ```
   Response: `{"device": {...}, "api_key": "..."}`

3. **Use API Key**
   - Store the returned `api_key` securely
   - Use in all subsequent requests via `Authorization: Bearer` header

## Pairing Token Validity

- Tokens expire in 15 minutes
- Tokens are single-use only
- Invalid/expired tokens return 400 Bad Request

## Order Creation Example

```bash
POST /api/orders
{
  "device_id": "device-uuid",
  "customer_name": "John Doe",
  "subtotal_fiat": 100.00,
  "tax_fiat": 10.00,
  "total_fiat": 110.00,
  "fiat_currency": "USD",
  "total_xmr": "0.5",
  "xmr_rate": 220.00,
  "payment_id": "pay-123",
  "payment_address": "xmr-address",
  "status": "pending",
  "items": [
    {
      "product_name": "Item 1",
      "quantity": 2,
      "unit_price": 50.00,
      "line_total": 100.00
    }
  ]
}
```

## Order Status Flow

- `pending` - Order created, awaiting payment
- `paid` - Payment received
- `confirmed` - Payment confirmed with required confirmations
- `cancelled` - Order cancelled

## WebSocket Usage

Connect to `/api/ws` with valid API key authentication.

Message format:
```json
{
  "type": "ping",
  "payload": null
}
```

Response:
```json
{
  "type": "pong",
  "data": null,
  "timestamp": 1234567890
}
```

## Development

### Project Layout Philosophy

- **cmd/** - Application entry points
- **internal/config/** - Configuration loading
- **internal/db/** - Database initialization and migrations
- **internal/handlers/** - HTTP request handlers and middleware
- **internal/models/** - Data models and business logic

### Key Dependencies

- **github.com/go-chi/chi/v5** - HTTP router
- **github.com/go-chi/cors** - CORS middleware
- **modernc.org/sqlite** - SQLite driver
- **github.com/google/uuid** - UUID generation
- **github.com/gorilla/websocket** - WebSocket support
- **github.com/golang-jwt/jwt/v5** - JWT support (for future use)

### Error Handling

All handlers return consistent JSON error responses:
```json
{
  "error": "error message"
}
```

### JSON Tags

All model fields use snake_case JSON tags for REST API consistency.

## Security Considerations

1. **API Keys**: Always transmitted via headers, never in URLs
2. **Database**: Uses parameterized queries to prevent SQL injection
3. **CORS**: Configured for development (update for production)
4. **Passwords**: API keys are SHA256 hashed before storage
5. **Foreign Keys**: Enabled for referential integrity

## Performance

- **WAL Mode**: Enables concurrent reads while writing
- **Indexes**: Automatic indexes on frequently queried columns
- **Connection Pooling**: Chi handles HTTP connection management
- **WebSocket Buffer**: 256-message buffer per client

## Deployment

For production deployment:

1. Update CORS origins in `cmd/server/main.go`
2. Set `APP_SECRET` environment variable
3. Use environment-specific configuration
4. Enable HTTPS/TLS
5. Set up proper logging
6. Configure database backups
7. Use production-grade reverse proxy (nginx, etc.)

## Troubleshooting

### Database Locked Error
- Ensure only one process is accessing the database
- Check for zombie processes holding database locks

### WebSocket Connection Fails
- Verify API key is valid
- Check CORS configuration
- Ensure WebSocket upgrade is allowed

### Migration Fails
- Delete database file to reset schema
- Check file permissions in data directory
- Verify SQL syntax in migrations

## License

TBD
