import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '@/api/endpoints'
import { setUnauthenticatedHandler } from '@/api/client'

const AuthContext = createContext(null)

// status: 'loading' (asking /me) | 'in' | 'out'
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, error: null })

  useEffect(() => {
    let alive = true
    api
      .getMe()
      .then(({ user }) => alive && setState({ status: 'in', user, error: null }))
      .catch((e) => {
        if (!alive) return
        // 401 is the normal "not logged in". Anything else (server down) also means login screen,
        // but we keep the error so the screen can say why.
        setState({ status: 'out', user: null, error: e.code === 'UNAUTHENTICATED' ? null : e })
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setUnauthenticatedHandler(() => setState({ status: 'out', user: null, error: null }))
    return () => setUnauthenticatedHandler(null)
  }, [])

  const login = useCallback(async (email) => {
    const { user } = await api.login(email)
    setState({ status: 'in', user, error: null })
    return user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setState({ status: 'out', user: null, error: null })
    }
  }, [])

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
