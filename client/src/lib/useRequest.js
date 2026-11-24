import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Runs `fn()` on mount and whenever `deps` change. Ignores responses that arrive after a newer
 * request started, so fast filter changes can't show stale data.
 * Returns { status: 'loading' | 'ready' | 'error', data, error, reload, setData }.
 */
export function useRequest(fn, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const seq = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(() => {
    const mine = ++seq.current
    setState((s) => ({ ...s, status: 'loading', error: null }))
    return fnRef.current().then(
      (data) => {
        if (mine === seq.current) setState({ status: 'ready', data, error: null })
        return data
      },
      (error) => {
        if (mine === seq.current) setState((s) => ({ status: 'error', data: s.data, error }))
        return null
      },
    )
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    run()
    return () => {
      seq.current++
    }
  }, deps)

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: updater(s.data) })), [])
  return { ...state, reload: run, setData }
}
