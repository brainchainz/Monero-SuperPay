import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import * as api from '../lib/api'

type Step = 1 | 2 | 3
type NodeConnectionMethod = 'public' | 'own' | 'umbrel'

interface BusinessInfoData {
  business_name: string
  fiat_currency: string
  tax_rate: number
}

interface NodeConnectionData {
  method: NodeConnectionMethod
  public_node?: string
  own_node_ip?: string
  own_node_port?: string
  own_node_username?: string
  own_node_password?: string
  umbrel_ip?: string
  umbrel_port?: string
  umbrel_username?: string
  umbrel_password?: string
}

interface WalletSetupData {
  primary_address: string
  secret_view_key: string
  restore_height: number
  wallet_name: string
}

const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'CNY']

const publicNodePresets = [
  'node.moneroworld.com:18089',
  'node.sethforprivacy.com:18089',
  'xmr-node.cakewallet.com:18081',
]

export default function SetupWizard() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState<Step>(1)
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set())
  const [error, setError] = useState('')

  // Step 1: Business Info
  const [businessInfo, setBusinessInfo] = useState<BusinessInfoData>({
    business_name: '',
    fiat_currency: 'USD',
    tax_rate: 0,
  })

  // Step 2: Node Connection
  const [nodeConnection, setNodeConnection] = useState<NodeConnectionData>({
    method: 'public',
    public_node: publicNodePresets[0],
    own_node_ip: '',
    own_node_port: '18089',
    own_node_username: '',
    own_node_password: '',
    umbrel_ip: '',
    umbrel_port: '18089',
    umbrel_username: '',
    umbrel_password: '',
  })

  // Step 3: Wallet Setup
  const [walletSetup, setWalletSetup] = useState<WalletSetupData>({
    primary_address: '',
    secret_view_key: '',
    restore_height: 0,
    wallet_name: 'merchant_wallet',
  })

  // Mutations
  const businessInfoMutation = useMutation({
    mutationFn: (data: BusinessInfoData) =>
      api.put('/settings', {
        settings: {
          business_name: data.business_name,
          fiat_currency: data.fiat_currency,
          tax_rate: data.tax_rate.toString(),
        },
      }),
    onSuccess: () => {
      setCompletedSteps((prev) => new Set([...prev, 1]))
      setCurrentStep(2)
      setError('')
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to save business information')
    },
  })

  const nodeConnectionMutation = useMutation({
    mutationFn: (data: NodeConnectionData) => {
      let monero_node_url = ''
      if (data.method === 'public') {
        monero_node_url = data.public_node || ''
      } else if (data.method === 'own') {
        monero_node_url = `${data.own_node_ip}:${data.own_node_port}`
      } else if (data.method === 'umbrel') {
        monero_node_url = `${data.umbrel_ip}:${data.umbrel_port}`
      }

      const settingsData: Record<string, string> = {
        monero_node_url,
      }

      // Add credentials if provided
      if (data.method === 'own' && (data.own_node_username || data.own_node_password)) {
        settingsData.monero_node_username = data.own_node_username || ''
        settingsData.monero_node_password = data.own_node_password || ''
      } else if (data.method === 'umbrel' && (data.umbrel_username || data.umbrel_password)) {
        settingsData.monero_node_username = data.umbrel_username || ''
        settingsData.monero_node_password = data.umbrel_password || ''
      }

      return api.put('/settings', { settings: settingsData })
    },
    onSuccess: () => {
      setCompletedSteps((prev) => new Set([...prev, 2]))
      setCurrentStep(3)
      setError('')
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to save node connection settings')
    },
  })

  const walletSetupMutation = useMutation({
    mutationFn: (data: WalletSetupData) =>
      api.post('/wallet/setup', {
        primary_address: data.primary_address,
        secret_view_key: data.secret_view_key,
        restore_height: data.restore_height || 0,
        wallet_name: data.wallet_name,
      }),
    onSuccess: () => {
      setCompletedSteps((prev) => new Set([...prev, 3]))
      // Redirect to dashboard after successful setup
      navigate('/')
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to setup wallet')
    },
  })

  const handleNextStep1 = () => {
    if (!businessInfo.business_name.trim()) {
      setError('Business name is required')
      return
    }
    businessInfoMutation.mutate(businessInfo)
  }

  const handleNextStep2 = () => {
    if (nodeConnection.method === 'own') {
      if (!nodeConnection.own_node_ip || !nodeConnection.own_node_port) {
        setError('IP and port are required for custom node')
        return
      }
    } else if (nodeConnection.method === 'umbrel') {
      if (!nodeConnection.umbrel_ip || !nodeConnection.umbrel_port) {
        setError('IP and port are required for Umbrel node')
        return
      }
    }
    nodeConnectionMutation.mutate(nodeConnection)
  }

  const handleCompleteSetup = () => {
    if (!walletSetup.primary_address.trim()) {
      setError('Primary address is required')
      return
    }
    if (!walletSetup.secret_view_key.trim()) {
      setError('Secret view key is required')
      return
    }
    if (walletSetup.primary_address.length !== 95) {
      setError('Primary address must be 95 characters')
      return
    }
    if (walletSetup.secret_view_key.length !== 64) {
      setError('Secret view key must be 64 hex characters')
      return
    }
    walletSetupMutation.mutate(walletSetup)
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step)
      setError('')
    }
  }

  const isLoading =
    businessInfoMutation.isPending ||
    nodeConnectionMutation.isPending ||
    walletSetupMutation.isPending

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-8 py-6">
        <h1 className="text-3xl font-bold text-white">Monero SuperPay Setup</h1>
        <p className="text-gray-400 mt-1">Complete these steps to get started</p>
      </div>

      {/* Step Indicator */}
      <div className="bg-gray-800 px-8 py-8">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center flex-1">
              {/* Step Circle */}
              <div
                className={`flex items-center justify-center w-12 h-12 rounded-full font-bold text-lg transition-colors ${
                  completedSteps.has(step as Step)
                    ? 'bg-green-600 text-white'
                    : currentStep === step
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-700 text-gray-400'
                }`}
              >
                {completedSteps.has(step as Step) ? (
                  <Check className="w-6 h-6" />
                ) : (
                  step
                )}
              </div>

              {/* Connector Line */}
              {step < 3 && (
                <div
                  className={`h-1 flex-1 mx-3 transition-colors ${
                    completedSteps.has(step as Step)
                      ? 'bg-green-600'
                      : 'bg-gray-700'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Labels */}
        <div className="max-w-4xl mx-auto flex justify-between mt-4 text-sm">
          <span className="text-gray-400">Business Info</span>
          <span className="text-gray-400">Node Connection</span>
          <span className="text-gray-400">Wallet Setup</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-8 py-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          {error && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg">
              <p className="text-red-300">{error}</p>
            </div>
          )}

          {/* Step 1: Business Info */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Business Information</h2>
                <p className="text-gray-400">Tell us about your business</p>
              </div>

              <div className="space-y-4">
                {/* Business Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Business Name
                  </label>
                  <input
                    type="text"
                    placeholder="Enter your business name"
                    value={businessInfo.business_name}
                    onChange={(e) =>
                      setBusinessInfo({ ...businessInfo, business_name: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                </div>

                {/* Fiat Currency */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Fiat Currency
                  </label>
                  <select
                    value={businessInfo.fiat_currency}
                    onChange={(e) =>
                      setBusinessInfo({ ...businessInfo, fiat_currency: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-orange-500"
                  >
                    {currencies.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tax Rate */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Tax Rate (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="0"
                    value={businessInfo.tax_rate}
                    onChange={(e) =>
                      setBusinessInfo({
                        ...businessInfo,
                        tax_rate: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Monero Node Connection */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Monero Node Connection</h2>
                <p className="text-gray-400">Choose how to connect to a Monero node</p>
              </div>

              <div className="space-y-4">
                {/* Public Node Option */}
                <div
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    nodeConnection.method === 'public'
                      ? 'bg-gray-800 border-orange-500'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}
                  onClick={() => setNodeConnection({ ...nodeConnection, method: 'public' })}
                >
                  <div className="flex items-center mb-3">
                    <input
                      type="radio"
                      checked={nodeConnection.method === 'public'}
                      onChange={() => setNodeConnection({ ...nodeConnection, method: 'public' })}
                      className="w-4 h-4"
                    />
                    <span className="ml-3 font-medium text-white">Use a public node (easiest)</span>
                  </div>

                  {nodeConnection.method === 'public' && (
                    <select
                      value={nodeConnection.public_node}
                      onChange={(e) =>
                        setNodeConnection({ ...nodeConnection, public_node: e.target.value })
                      }
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-orange-500"
                    >
                      {publicNodePresets.map((node) => (
                        <option key={node} value={node}>
                          {node}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Own Node Option */}
                <div
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    nodeConnection.method === 'own'
                      ? 'bg-gray-800 border-orange-500'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}
                  onClick={() => setNodeConnection({ ...nodeConnection, method: 'own' })}
                >
                  <div className="flex items-center mb-3">
                    <input
                      type="radio"
                      checked={nodeConnection.method === 'own'}
                      onChange={() => setNodeConnection({ ...nodeConnection, method: 'own' })}
                      className="w-4 h-4"
                    />
                    <span className="ml-3 font-medium text-white">Connect to my own node</span>
                  </div>

                  {nodeConnection.method === 'own' && (
                    <div className="space-y-3 mt-3">
                      <input
                        type="text"
                        placeholder="IP or hostname (e.g., 192.168.1.100)"
                        value={nodeConnection.own_node_ip}
                        onChange={(e) =>
                          setNodeConnection({ ...nodeConnection, own_node_ip: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                      <input
                        type="text"
                        placeholder="Port (e.g., 18089)"
                        value={nodeConnection.own_node_port}
                        onChange={(e) =>
                          setNodeConnection({ ...nodeConnection, own_node_port: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                      <input
                        type="text"
                        placeholder="Username (optional)"
                        value={nodeConnection.own_node_username}
                        onChange={(e) =>
                          setNodeConnection({
                            ...nodeConnection,
                            own_node_username: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                      <input
                        type="password"
                        placeholder="Password (optional)"
                        value={nodeConnection.own_node_password}
                        onChange={(e) =>
                          setNodeConnection({
                            ...nodeConnection,
                            own_node_password: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  )}
                </div>

                {/* Umbrel Node Option */}
                <div
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    nodeConnection.method === 'umbrel'
                      ? 'bg-gray-800 border-orange-500'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}
                  onClick={() => setNodeConnection({ ...nodeConnection, method: 'umbrel' })}
                >
                  <div className="flex items-center mb-3">
                    <input
                      type="radio"
                      checked={nodeConnection.method === 'umbrel'}
                      onChange={() => setNodeConnection({ ...nodeConnection, method: 'umbrel' })}
                      className="w-4 h-4"
                    />
                    <span className="ml-3 font-medium text-white">Connect to Umbrel node</span>
                  </div>

                  {nodeConnection.method === 'umbrel' && (
                    <div className="space-y-3 mt-3">
                      <div className="text-sm text-gray-400 mb-2">
                        Enter your Umbrel's IP, e.g. 192.168.1.x
                      </div>
                      <input
                        type="text"
                        placeholder="Umbrel IP (e.g., 192.168.1.100)"
                        value={nodeConnection.umbrel_ip}
                        onChange={(e) =>
                          setNodeConnection({ ...nodeConnection, umbrel_ip: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                      <input
                        type="text"
                        placeholder="Port (e.g., 18089)"
                        value={nodeConnection.umbrel_port}
                        onChange={(e) =>
                          setNodeConnection({ ...nodeConnection, umbrel_port: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                      <input
                        type="text"
                        placeholder="Username"
                        value={nodeConnection.umbrel_username}
                        onChange={(e) =>
                          setNodeConnection({
                            ...nodeConnection,
                            umbrel_username: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                      <input
                        type="password"
                        placeholder="Password"
                        value={nodeConnection.umbrel_password}
                        onChange={(e) =>
                          setNodeConnection({
                            ...nodeConnection,
                            umbrel_password: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Wallet Setup */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Wallet Setup</h2>
                <p className="text-gray-400">Configure your Monero wallet</p>
              </div>

              <div className="space-y-4">
                {/* Primary Address */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Primary Address
                  </label>
                  <textarea
                    placeholder="Enter your Monero mainnet address (95 characters)"
                    value={walletSetup.primary_address}
                    onChange={(e) =>
                      setWalletSetup({ ...walletSetup, primary_address: e.target.value })
                    }
                    rows={3}
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 font-mono text-xs"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    Length: {walletSetup.primary_address.length}/95
                  </div>
                </div>

                {/* Secret View Key */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Secret View Key
                  </label>
                  <input
                    type="password"
                    placeholder="Enter your 64-character hex secret view key"
                    value={walletSetup.secret_view_key}
                    onChange={(e) =>
                      setWalletSetup({ ...walletSetup, secret_view_key: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 font-mono text-xs"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    Length: {walletSetup.secret_view_key.length}/64
                  </div>
                </div>

                {/* Restore Height */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Restore Height (optional)
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={walletSetup.restore_height}
                    onChange={(e) =>
                      setWalletSetup({
                        ...walletSetup,
                        restore_height: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Set to a recent block height to skip scanning old blocks
                  </p>
                </div>

                {/* Wallet Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Wallet Name
                  </label>
                  <input
                    type="text"
                    placeholder="merchant_wallet"
                    value={walletSetup.wallet_name}
                    onChange={(e) =>
                      setWalletSetup({ ...walletSetup, wallet_name: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="bg-gray-800 border-t border-gray-700 px-8 py-6">
        <div className="max-w-2xl mx-auto flex justify-between items-center">
          <button
            onClick={handleBack}
            disabled={currentStep === 1 || isLoading}
            className="flex items-center gap-2 px-6 py-2 text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </button>

          {currentStep < 3 ? (
            <button
              onClick={currentStep === 1 ? handleNextStep1 : handleNextStep2}
              disabled={isLoading}
              className="flex items-center gap-2 px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={handleCompleteSetup}
              disabled={isLoading}
              className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {isLoading ? 'Completing Setup...' : 'Complete Setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
