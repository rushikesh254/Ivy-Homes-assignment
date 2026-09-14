import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authApi, stash, bootSession } from '../api/client'

const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  const [account, setAccount] = useState(null)
  const [restoring, setRestoring] = useState(true)

  // Restore a stored session on first load and arm the refresh timer.
  useEffect(() => {
    const account = stash.account()
    if (account) {
      setAccount(account)
      bootSession()
    }
    setRestoring(false)
  }, [])

  const signIn = useCallback(async (email, password) => {
    const payload = await authApi.login(email, password)
    authApi.apply(payload)
    setAccount(payload.user)
    return payload
  }, [])

  const signOut = useCallback(async () => {
    await authApi.logout()
    setAccount(null)
  }, [])

  return (
    <SessionContext.Provider value={{ account, restoring, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}