# Monero SuperPay - Dashboard Frontend

A complete React + Vite + Tailwind CSS frontend for the Monero SuperPay cryptocurrency point-of-sale system.

## Features

- **Dashboard**: Real-time stats, recent orders, and device monitoring
- **Orders Management**: Filter, search, and track all orders with expandable details
- **Products**: Manage product catalog with categories, pricing, and images
- **Devices**: Pair new devices with QR codes and monitor device status
- **Point of Sale**: Touch-optimized checkout with multiple modes:
  - Keypad: Manual amount entry
  - Products: Quick product selection
  - Cart: Full shopping cart with customer info
- **Settings**: Business configuration and system status monitoring
- **Real-time Updates**: WebSocket support for live order status and device connectivity

## Tech Stack

- **React 18** - UI library
- **React Router v6** - Client-side routing
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling with dark theme
- **TanStack React Query** - Data fetching and caching
- **Lucide React** - Icon library
- **QRCode React** - QR code generation
- **TypeScript** - Type safety

## Project Structure

```
frontend/
├── src/
│   ├── pages/           # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Orders.tsx
│   │   ├── Products.tsx
│   │   ├── Devices.tsx
│   │   ├── PointOfSale.tsx
│   │   └── Settings.tsx
│   ├── components/      # Reusable components
│   │   ├── Sidebar.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   └── StatusBadge.tsx
│   ├── lib/            # Utilities and API
│   │   ├── api.ts      # API client
│   │   ├── websocket.ts # WebSocket client
│   │   └── types.ts    # TypeScript interfaces
│   ├── App.tsx         # Main app layout
│   ├── main.tsx        # Entry point
│   └── index.css       # Global styles
├── vite.config.ts      # Vite configuration
├── tailwind.config.js  # Tailwind configuration
├── tsconfig.json       # TypeScript configuration
├── index.html          # HTML entry point
└── package.json        # Dependencies
```

## Getting Started

### Prerequisites

- Node.js 16+ and npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173` by default.

The dev server is configured to proxy `/api` requests to `http://localhost:3033` for backend API access.

### Build

```bash
npm run build
```

Production-optimized files will be generated in the `dist/` directory.

### Type Checking

```bash
npm run lint
```

## Configuration

### Vite

Dev server proxy is configured in `vite.config.ts`:

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3033',
      changeOrigin: true,
    },
  },
}
```

Update the target URL to match your backend server.

### Tailwind

Custom colors configured in `tailwind.config.js`:

- Primary color: Monero orange (#FF6600)
- Dark theme by default (bg-gray-900, text-white)

### TypeScript

- `tsconfig.json` - Main configuration
- `tsconfig.node.json` - Node/Vite configuration

## API Client

The `src/lib/api.ts` module provides a type-safe API client:

```typescript
// Examples
const devices = await devices.list()
const order = await orders.get(orderId)
await products.create({ name: 'Product', price: 10, ... })
```

All API calls return JSON and throw `APIError` on failure.

## WebSocket

Real-time updates via WebSocket at `/api/ws`:

```typescript
import { useWebSocket } from './lib/websocket'

// Listen for events
useWebSocket('order_paid', (data) => {
  console.log('Order paid:', data)
})
```

Supported events:
- `order_created` - New order created
- `order_paid` - Order payment confirmed
- `order_expired` - Order payment expired
- `device_online` - Device connected
- `device_offline` - Device disconnected

## Design System

### Colors

- **Background**: `bg-gray-900` (dark)
- **Surface**: `bg-gray-800` (cards, modals)
- **Primary**: `text-monero-600` / `bg-monero-600` (orange #FF6600)
- **Success**: `text-green-*`
- **Warning**: `text-yellow-*`
- **Error**: `text-red-*`

### Components

All components use Tailwind CSS utilities with no external CSS frameworks.

**Sidebar**: Responsive navigation with mobile hamburger menu

**Card**: Reusable container with border and shadow

**Modal**: Centered dialog with overlay and close button

**StatusBadge**: Colored status indicators (pending, paid, expired, etc.)

## Pages

### Dashboard

- Key metrics (orders, revenue, devices)
- Connected devices status with online/offline indicator
- Real-time recent orders table
- Auto-updates via WebSocket

### Orders

- Searchable, filterable order table
- Status, device, and date filtering
- Expandable rows with full order details
- Pagination support

### Products

- Product grid with images and pricing
- Category management with color coding
- Add/edit/delete products
- Category CRUD operations

### Devices

- List of paired devices with status
- Device pairing via QR code
- QR code contains device configuration JSON
- Device removal with confirmation

### Point of Sale (POS)

Three operation modes:

1. **Keypad**: Large touchable number pad for manual amount entry
2. **Products**: Grid of products for quick selection
3. **Cart**: Full shopping cart with category tabs and customer info

Features:
- Real-time XMR conversion
- QR code display after order creation
- Payment confirmation polling
- Countdown timer for order expiration
- Green checkmark on payment confirmation

### Settings

- Business name, currency, tax rate configuration
- Confirmation threshold (0, 1, or 10 blocks)
- Monero node sync status
- API endpoint information
- System status dashboard

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Mobile Optimization

- Responsive design optimized for desktop/tablet
- Touch-friendly buttons and inputs for POS
- Sidebar collapses on mobile with hamburger menu
- Large fonts and spacing for readability on small screens

## Known Limitations

- Keypad mode order creation not fully integrated (requires backend support)
- Product image upload uses fallback (depends on backend API)
- WebSocket events are demo data (depends on backend implementation)

## Environment Variables

None required. Configuration is done via Settings page at runtime.

## Troubleshooting

### API Connection Issues

- Ensure backend server is running on `http://localhost:3033`
- Check browser console for CORS errors
- Verify proxy configuration in `vite.config.ts`

### WebSocket Connection Issues

- Backend must support WebSocket at `/api/ws`
- Check network tab for connection failures
- Verify same-origin or CORS headers

### Build Issues

- Delete `node_modules` and `dist` directories
- Run `npm install` again
- Clear npm cache: `npm cache clean --force`

## Contributing

- Follow existing code style and patterns
- Use TypeScript for all new code
- Keep components small and focused
- Use Tailwind utilities instead of custom CSS

## License

Monero SuperPay © 2024
