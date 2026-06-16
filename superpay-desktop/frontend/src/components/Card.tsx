import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
}

export default function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`sp-card bg-gray-800 rounded-lg p-6 shadow-lg border border-gray-700 ${className}`}>
      {children}
    </div>
  )
}
