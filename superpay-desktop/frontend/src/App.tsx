import { Outlet } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import { LockProvider } from './context/LockContext'

export default function App() {
  return (
    <LockProvider>
      <div className="min-h-screen bg-gray-900">
        <Sidebar />
        <main className="md:ml-64">
          {/* Top drag bar for window movement */}
          <div className="h-8 w-full" style={{ '--wails-draggable': 'drag' } as React.CSSProperties} />
          <div className="p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </LockProvider>
  )
}
