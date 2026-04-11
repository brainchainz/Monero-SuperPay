import React from 'react'

interface StatusBadgeProps {
  status: string
  children?: React.ReactNode
}

const statusColors = {
  pending: 'bg-yellow-900/30 text-yellow-200 border-yellow-700',
  paid: 'bg-green-900/30 text-green-200 border-green-700',
  expired: 'bg-red-900/30 text-red-200 border-red-700',
  refunded: 'bg-purple-900/30 text-purple-200 border-purple-700',
  cancelled: 'bg-gray-700/50 text-gray-300 border-gray-600',
  online: 'bg-green-900/30 text-green-200 border-green-700',
  offline: 'bg-gray-700/50 text-gray-300 border-gray-600',
}

const statusLabels = {
  pending: 'Pending',
  paid: 'Paid',
  expired: 'Expired',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  online: 'Online',
  offline: 'Offline',
}

export default function StatusBadge({ status, children }: StatusBadgeProps) {
  const colorKey = status as keyof typeof statusColors
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium border ${statusColors[colorKey] || 'bg-gray-700/50 text-gray-300 border-gray-600'}`}>
      {children || statusLabels[colorKey] || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
