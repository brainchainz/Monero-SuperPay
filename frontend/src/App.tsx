import { Outlet } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import { LockProvider } from './context/LockContext'

export default function App() {
  return (
    <LockProvider>
      <div className="min-h-screen bg-gray-900">
        {/* Themed ambient backdrop — colorful blob mesh for the glass theme */}
        <div id="sp-ambient" aria-hidden="true">
          <div className="sp-blob sp-blob-1" />
          <div className="sp-blob sp-blob-2" />
          <div className="sp-blob sp-blob-3" />
          <div className="sp-grain" />
        </div>
        <Sidebar />
        <main className="md:ml-64 relative z-10">
          <div className="p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </LockProvider>
  )
}
