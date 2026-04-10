import { useQuery } from '@tanstack/react-query'
import { Activity, DollarSign, ShoppingCart, Download } from 'lucide-react'
import {
    PieChart,
    Pie,
    Cell,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts'
import Card from '../components/Card'
import { orders } from '../lib/api'

// HSL Tailored Monero Palette for vibrant pie charts
const COLORS = [
    '#f26822', // Monero Orange
    '#fb923c', // Lighter Orange
    '#f97316', // Core Orange
    '#ea580c', // Dark Orange
    '#c2410c', // Darker Orange
    '#9a3412', // Deepest Orange
    '#7c2d12', // Rust Option
]

export default function Analytics() {
    const { data: statsData, isLoading } = useQuery({
        queryKey: ['order-stats'],
        queryFn: () => orders.getStats(),
        refetchInterval: 30000, // Refetch every 30 seconds
    })

    const statCards = [
        {
            label: "Today's Orders",
            value: statsData?.todays_count || 0,
            icon: ShoppingCart,
            color: 'text-monero-400',
        },
        {
            label: "Today's Revenue",
            value: `$${(statsData?.todays_total || 0).toFixed(2)}`,
            icon: DollarSign,
            color: 'text-green-400',
        },
        {
            label: "7-Day Revenue",
            value: `$${(statsData?.week_total || 0).toFixed(2)}`,
            icon: Activity,
            color: 'text-blue-400',
        },
        {
            label: "30-Day Revenue",
            value: `$${(statsData?.month_total || 0).toFixed(2)}`,
            icon: DollarSign,
            color: 'text-indigo-400',
        },
    ]

    const handleExportCSV = () => {
        // Navigate standard browser download rather than XHR/Fetch so the browser handles saving the file blob native gracefully
        window.location.href = orders.exportCSV()
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold mb-2">Analytics</h1>
                    <p className="text-gray-400">Sales metrics and performance reports</p>
                </div>
                <button
                    onClick={handleExportCSV}
                    className="flex flex-row items-center gap-2 justify-center py-2 px-4 rounded-lg font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-white"
                >
                    <Download size={18} />
                    Export Orders (CSV)
                </button>
            </div>

            {isLoading ? (
                <p className="text-gray-400 animate-pulse">Loading analytics...</p>
            ) : (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {statCards.map((stat) => {
                            const Icon = stat.icon
                            return (
                                <Card key={stat.label}>
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="text-gray-400 text-sm mb-2">{stat.label}</p>
                                            <p className="text-2xl font-bold">{stat.value}</p>
                                        </div>
                                        <Icon className={`${stat.color}`} size={24} />
                                    </div>
                                </Card>
                            )
                        })}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
                        {/* Items Sold Pie Chart */}
                        <Card>
                            <h2 className="text-lg font-bold mb-6">Items Sold (All Time)</h2>
                            {!statsData?.sales_by_product || statsData.sales_by_product.length === 0 ? (
                                <p className="text-gray-400 text-center py-12">No product data available yet</p>
                            ) : (
                                <div className="h-[300px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={statsData.sales_by_product}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={100}
                                                paddingAngle={5}
                                                dataKey="quantity"
                                                nameKey="product_name"
                                            >
                                                {statsData.sales_by_product.map((_, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={COLORS[index % COLORS.length]}
                                                        className="stroke-gray-800 stroke-2"
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#1f2937',
                                                    border: 'none',
                                                    borderRadius: '0.5rem',
                                                    color: '#f3f4f6',
                                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                                                }}
                                                itemStyle={{ color: '#f3f4f6' }}
                                            />
                                            <Legend
                                                verticalAlign="bottom"
                                                height={36}
                                                iconType="circle"
                                                wrapperStyle={{ paddingTop: '20px' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </Card>

                        {/* Sales by Device Pie Chart */}
                        <Card>
                            <h2 className="text-lg font-bold mb-6">Sales Output by Device</h2>
                            {!statsData?.sales_by_device || statsData.sales_by_device.length === 0 ? (
                                <p className="text-gray-400 text-center py-12">No device data available yet</p>
                            ) : (
                                <div className="h-[300px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={statsData.sales_by_device}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={60}
                                                outerRadius={100}
                                                paddingAngle={5}
                                                dataKey="total_fiat"
                                                nameKey="device_name"
                                            >
                                                {statsData.sales_by_device.map((_, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={COLORS[(index + 3) % COLORS.length]} // Offset colors slightly for visual separation
                                                        className="stroke-gray-800 stroke-2"
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Revenue']}
                                                contentStyle={{
                                                    backgroundColor: '#1f2937',
                                                    border: 'none',
                                                    borderRadius: '0.5rem',
                                                    color: '#f3f4f6',
                                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                                                }}
                                                itemStyle={{ color: '#f3f4f6' }}
                                            />
                                            <Legend
                                                verticalAlign="bottom"
                                                height={36}
                                                iconType="circle"
                                                wrapperStyle={{ paddingTop: '20px' }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </Card>
                    </div>
                </>
            )}
        </div>
    )
}
