import { request } from './client'

// One function per endpoint in API-CONTRACT.md v1.1. Each returns the response body as the contract
// describes it; errors throw ApiError (see client.js).

// ---- auth
export const login = (email) => request('/auth/login', { method: 'POST', body: { email } })
export const logout = () => request('/auth/logout', { method: 'POST' })
export const getMe = () => request('/auth/me')

// ---- categories
export const getCategories = () => request('/categories')

// ---- uploads and transactions
export function createUpload(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/uploads', { method: 'POST', body: form })
}
export const listUploads = () => request('/uploads')
export const getUploadTransactions = (uploadId, { page, page_size } = {}) =>
  request(`/uploads/${encodeURIComponent(uploadId)}/transactions`, { query: { page, page_size } })
export const listTransactions = ({ from, to, category, direction, page, page_size } = {}) =>
  request('/transactions', { query: { from, to, category, direction, page, page_size } })

// ---- conversations
export const createConversation = () => request('/conversations', { method: 'POST', body: {} })
export const listConversations = () => request('/conversations')
export const getMessages = (conversationId) =>
  request(`/conversations/${encodeURIComponent(conversationId)}/messages`)
export const sendMessage = (conversationId, text) =>
  request(`/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: { text } })
