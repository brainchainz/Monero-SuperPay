import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, Upload, AlertTriangle } from 'lucide-react'
import Card from '../components/Card'
import Modal from '../components/Modal'
import { products as productsApi, categories as categoriesApi, resolveImageUrl } from '../lib/api'

export default function Products() {
  const queryClient = useQueryClient()
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [newCategory, setNewCategory] = useState('')
  const [categoryColor, setCategoryColor] = useState('#FF6600')
  const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState<{
    name: string
    description: string
    price: number
    price_unit: 'each' | 'lb' | 'kg'
    category_id: string
    active: boolean
  }>({
    name: '',
    description: '',
    price: 0,
    price_unit: 'each',
    category_id: '',
    active: true,
  })

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  })

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const createProductMutation = useMutation({
    mutationFn: () => productsApi.create(formData as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      resetForm()
      setIsProductModalOpen(false)
    },
  })

  const updateProductMutation = useMutation({
    mutationFn: () => productsApi.update(editingProduct.id, {
      ...formData,
      // Preserve existing image when no new image is being uploaded
      image_url: editingProduct?.image_url || '',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      resetForm()
      setIsProductModalOpen(false)
    },
  })

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const createCategoryMutation = useMutation({
    mutationFn: () => categoriesApi.create({ name: newCategory, color: categoryColor }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNewCategory('')
      setCategoryColor('#FF6600')
      setIsCategoryModalOpen(false)
    },
  })

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => categoriesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: 0,
      price_unit: 'each' as const,
      category_id: '',
      active: true,
    })
    setEditingProduct(null)
    setImageFile(null)
    setImagePreview(null)
    setFormError(null)
  }

  const handleOpenModal = (product?: any) => {
    if (product) {
      setEditingProduct(product)
      setFormData({
        name: product.name,
        description: product.description,
        price: product.price,
        price_unit: product.price_unit,
        category_id: product.category_id,
        active: product.active,
      })
    } else {
      resetForm()
    }
    setIsProductModalOpen(true)
  }

  const handleSubmit = async () => {
    setFormError(null)
    if (!formData.name.trim()) {
      setFormError('Product name is required')
      return
    }
    if (formData.price < 0) {
      setFormError('Price must be non-negative')
      return
    }
    try {
      let product: any
      if (editingProduct) {
        product = await updateProductMutation.mutateAsync()
      } else {
        product = await createProductMutation.mutateAsync()
      }
      // Upload image if selected
      if (imageFile && product?.id) {
        await productsApi.uploadImage(product.id, imageFile)
        queryClient.invalidateQueries({ queryKey: ['products'] })
      }
    } catch (err: any) {
      console.error('Failed to save product:', err)
      setFormError(err?.message || 'Failed to save product. Please try again.')
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImageFile(file)
      setImagePreview(URL.createObjectURL(file))
    }
  }

  const getCategoryName = (id: string) => {
    return categories?.find((c) => c.id === id)?.name || 'Uncategorized'
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold mb-2">Products</h1>
          <p className="text-gray-400">Manage your product catalog</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition flex items-center gap-2"
          >
            <Plus size={18} />
            Category
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg transition flex items-center gap-2"
          >
            <Plus size={18} />
            Add Product
          </button>
        </div>
      </div>

      {/* Categories */}
      {categories && categories.length > 0 && (
        <Card>
          <h2 className="text-lg font-bold mb-4">Categories</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700/50 rounded-lg border border-gray-600"
              >
                {cat.color && (
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: cat.color }}
                  />
                )}
                <span className="text-sm font-medium">{cat.name}</span>
                <button
                  onClick={() => setDeleteCategoryConfirm(cat.id)}
                  className="ml-2 p-1 hover:bg-red-900/50 rounded transition text-gray-500 hover:text-red-300"
                  title="Delete category"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Category delete confirmation */}
          {deleteCategoryConfirm && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-700 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle size={16} className="text-yellow-400" />
                <span>Delete category "{categories.find(c => c.id === deleteCategoryConfirm)?.name}"? Products in this category will become uncategorized.</span>
              </div>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={() => {
                    deleteCategoryMutation.mutate(deleteCategoryConfirm)
                    setDeleteCategoryConfirm(null)
                  }}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm transition whitespace-nowrap"
                >
                  Delete
                </button>
                <button
                  onClick={() => setDeleteCategoryConfirm(null)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Products Grid */}
      <div>
        {productsLoading ? (
          <p className="text-gray-400">Loading products...</p>
        ) : products && products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <Card key={product.id}>
                <div className="space-y-4">
                  {product.image_url && (
                    <img
                      src={resolveImageUrl(product.image_url)}
                      alt={product.name}
                      className="w-full h-48 object-cover rounded-lg"
                    />
                  )}
                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-lg font-bold">{product.name}</h3>
                      {!product.active && (
                        <span className="text-xs bg-gray-700 px-2 py-1 rounded">Inactive</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400 mb-3">{product.description}</p>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xl font-bold text-monero-400">
                        ${product.price.toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400 bg-gray-700/50 px-2 py-1 rounded">
                        {getCategoryName(product.category_id)} • {product.price_unit}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-4 border-t border-gray-700">
                    <button
                      onClick={() => handleOpenModal(product)}
                      className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded transition flex items-center justify-center gap-2"
                    >
                      <Edit2 size={16} />
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProductMutation.mutate(product.id)}
                      className="flex-1 px-3 py-2 bg-red-900/30 hover:bg-red-900/50 rounded transition text-red-200 flex items-center justify-center gap-2"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-gray-400 text-center py-8">No products yet. Add your first product!</p>
          </Card>
        )}
      </div>

      {/* Product Modal */}
      <Modal
        isOpen={isProductModalOpen}
        onClose={() => {
          setIsProductModalOpen(false)
          resetForm()
        }}
        title={editingProduct ? 'Edit Product' : 'Add Product'}
        size="lg"
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
              {formError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-2">Product Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Organic Coffee"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Product description"
              className="resize-none"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Price</label>
              <input
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                required
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Unit</label>
              <select
                value={formData.price_unit}
                onChange={(e) => setFormData({ ...formData, price_unit: e.target.value as any })}
              >
                <option value="each">Each</option>
                <option value="lb">Pound (lb)</option>
                <option value="kg">Kilogram (kg)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Category</label>
            <select
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
            >
              <option value="">Select Category</option>
              {categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Product Image</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
            <div className="flex items-center gap-4">
              {(imagePreview || editingProduct?.image_url) && (
                <img
                  src={imagePreview || resolveImageUrl(editingProduct?.image_url)}
                  alt="Preview"
                  className="w-20 h-20 object-cover rounded-lg border border-gray-600"
                />
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition flex items-center gap-2 text-sm"
              >
                <Upload size={16} />
                {imagePreview || editingProduct?.image_url ? 'Change Image' : 'Upload Image'}
              </button>
              {imageFile && (
                <span className="text-xs text-gray-400">{imageFile.name}</span>
              )}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">Active</span>
            </label>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createProductMutation.isPending || updateProductMutation.isPending}
              className="flex-1 px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg transition font-medium disabled:opacity-50"
            >
              {(createProductMutation.isPending || updateProductMutation.isPending) ? 'Saving...' : editingProduct ? 'Update Product' : 'Create Product'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsProductModalOpen(false)
                resetForm()
              }}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Category Modal */}
      <Modal
        isOpen={isCategoryModalOpen}
        onClose={() => {
          setIsCategoryModalOpen(false)
          setNewCategory('')
          setCategoryColor('#FF6600')
        }}
        title="Add Category"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createCategoryMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium mb-2">Category Name</label>
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              required
              placeholder="e.g., Beverages"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Color</label>
            <input
              type="color"
              value={categoryColor}
              onChange={(e) => setCategoryColor(e.target.value)}
              className="w-full h-10 rounded cursor-pointer"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={createCategoryMutation.isPending}
              className="flex-1 px-4 py-2 bg-monero-600 hover:bg-monero-700 rounded-lg transition font-medium disabled:opacity-50"
            >
              Create Category
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCategoryModalOpen(false)
                setNewCategory('')
                setCategoryColor('#FF6600')
              }}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
