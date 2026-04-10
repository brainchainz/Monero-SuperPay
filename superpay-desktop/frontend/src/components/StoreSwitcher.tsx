import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Loader2 } from 'lucide-react'
import { stores as storesApi } from '../lib/api'

interface StoreSwitcherProps {
  onStoreSwitch?: () => void
}

export default function StoreSwitcher({ onStoreSwitch }: StoreSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreDescription, setNewStoreDescription] = useState('')
  const [createError, setCreateError] = useState('')
  const queryClient = useQueryClient()

  const { data: storeData, isLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const storeList = storeData?.stores || []
  const activeStoreId = storeData?.active_store_id || ''

  const switchMutation = useMutation({
    mutationFn: (id: string) => storesApi.switch(id),
    onSuccess: () => {
      setIsOpen(false)
      // Invalidate all queries to refresh data from the new store's DB
      queryClient.invalidateQueries()
      setTimeout(() => queryClient.refetchQueries(), 300)
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => storesApi.create(data),
    onSuccess: () => {
      setNewStoreName('')
      setNewStoreDescription('')
      setCreateError('')
      setShowCreateModal(false)
      queryClient.invalidateQueries({ queryKey: ['stores'] })
      onStoreSwitch?.()
    },
    onError: (error: any) => {
      setCreateError(error?.message || 'Failed to create store')
    },
  })

  const handleCreateStore = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStoreName.trim()) {
      setCreateError('Store name is required')
      return
    }
    createMutation.mutate({
      name: newStoreName.trim(),
      description: newStoreDescription.trim() || undefined,
    })
  }

  const activeStore = storeList.find((s) => s.id === activeStoreId) || storeList[0]

  return (
    <>
      {/* Store Switcher Dropdown */}
      <div className="p-4 border-b border-gray-700">
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-750 hover:bg-gray-700 border border-gray-700 rounded-lg transition"
          >
            <div className="flex items-center gap-2 text-left min-w-0">
              <div className="w-2 h-2 bg-monero-600 rounded-full flex-shrink-0" />
              <span className="text-sm font-medium text-gray-200 truncate">
                {activeStore?.name || 'Loading...'}
              </span>
            </div>
            <ChevronDown
              size={16}
              className={`text-gray-400 flex-shrink-0 transition ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Dropdown Menu */}
          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50">
              <div className="max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="p-3 flex items-center justify-center gap-2 text-gray-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : storeList.length > 0 ? (
                  storeList.map((store) => (
                    <button
                      key={store.id}
                      onClick={() => {
                        if (store.id !== activeStore?.id) {
                          switchMutation.mutate(store.id)
                        } else {
                          setIsOpen(false)
                        }
                      }}
                      disabled={switchMutation.isPending}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition ${
                        store.id === activeStore?.id
                          ? 'bg-monero-600/20 text-monero-400 border-l-2 border-monero-600'
                          : 'text-gray-300 hover:bg-gray-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span className="truncate">{store.name}</span>
                      {store.id === activeStore?.id && (
                        <span className="text-xs font-bold uppercase text-monero-400 flex-shrink-0">
                          Active
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-xs text-gray-500 text-center">No stores</div>
                )}
              </div>

              {/* Create Store Button */}
              <div className="p-2 border-t border-gray-700">
                <button
                  onClick={() => {
                    setShowCreateModal(true)
                    setIsOpen(false)
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-monero-600 hover:bg-monero-700 rounded text-sm font-medium text-white transition"
                >
                  <Plus size={14} />
                  New Store
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Store Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-md space-y-4 p-6">
            <h2 className="text-xl font-bold text-white">Create New Store</h2>

            <form onSubmit={handleCreateStore} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">Store Name</label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => {
                    setNewStoreName(e.target.value)
                    if (createError) setCreateError('')
                  }}
                  placeholder="e.g., Downtown Store"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:border-monero-600 transition"
                  disabled={createMutation.isPending}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">
                  Description <span className="text-gray-500">(optional)</span>
                </label>
                <textarea
                  value={newStoreDescription}
                  onChange={(e) => setNewStoreDescription(e.target.value)}
                  placeholder="e.g., Main location on 5th Ave"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder:text-gray-500 focus:outline-none focus:border-monero-600 transition resize-none"
                  rows={2}
                  disabled={createMutation.isPending}
                />
              </div>

              {createError && (
                <div className="p-3 bg-red-900/20 border border-red-700 rounded text-red-300 text-sm">
                  {createError}
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setNewStoreName('')
                    setNewStoreDescription('')
                    setCreateError('')
                  }}
                  disabled={createMutation.isPending}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !newStoreName.trim()}
                  className="flex-1 px-4 py-2 bg-monero-600 hover:bg-monero-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium transition flex items-center justify-center gap-2"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
