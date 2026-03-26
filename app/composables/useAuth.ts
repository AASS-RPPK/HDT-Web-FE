const LS_ACCESS = 'hdt_access_token'
const LS_REFRESH = 'hdt_refresh_token'

export const useAuth = () => {
  const runtimeConfig = useRuntimeConfig()

  // Global state — shared across all composable calls in the same Nuxt app instance
  const accessToken = useState<string>('auth_access_token', () => '')
  const refreshToken = useState<string>('auth_refresh_token', () => '')

  const isAuthenticated = computed(() => !!accessToken.value)

  function getApiBase(): string {
    const fromStorage = typeof window !== 'undefined'
      ? (window.localStorage.getItem('hdt_apiBase') ?? '')
      : ''
    return fromStorage || (runtimeConfig.public.apiBase as string) || ''
  }

  /** Called once by the client plugin to hydrate state from localStorage. */
  function init() {
    if (typeof window === 'undefined') return
    accessToken.value = localStorage.getItem(LS_ACCESS) ?? ''
    refreshToken.value = localStorage.getItem(LS_REFRESH) ?? ''
  }

  function persist(access: string, refresh: string) {
    accessToken.value = access
    refreshToken.value = refresh
    if (typeof window === 'undefined') return
    localStorage.setItem(LS_ACCESS, access)
    localStorage.setItem(LS_REFRESH, refresh)
  }

  function logout() {
    persist('', '')
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LS_ACCESS)
      localStorage.removeItem(LS_REFRESH)
    }
    accessToken.value = ''
    refreshToken.value = ''
  }

  async function login(username: string, password: string) {
    const base = getApiBase()
    const res = await $fetch<{ access_token: string; refresh_token: string }>(
      `${base}/auth/login`,
      { method: 'POST', body: { username, password } }
    )
    persist(res.access_token, res.refresh_token)
  }

  async function register(email: string, username: string, password: string) {
    const base = getApiBase()
    await $fetch(`${base}/auth/register`, {
      method: 'POST',
      body: { email, username, password }
    })
  }

  /** Returns true if a new access token was obtained, false if login is required. */
  async function tryRefresh(): Promise<boolean> {
    const rt = refreshToken.value || (typeof window !== 'undefined' ? localStorage.getItem(LS_REFRESH) : null)
    if (!rt) return false
    const base = getApiBase()
    try {
      const res = await $fetch<{ access_token: string; refresh_token: string }>(
        `${base}/auth/refresh`,
        { method: 'POST', body: { refresh_token: rt } }
      )
      persist(res.access_token, res.refresh_token)
      return true
    } catch {
      logout()
      return false
    }
  }

  const authHeaders = computed<Record<string, string>>(() =>
    accessToken.value
      ? { Authorization: `Bearer ${accessToken.value}` }
      : {}
  )

  return {
    accessToken,
    refreshToken,
    isAuthenticated,
    authHeaders,
    init,
    login,
    register,
    logout,
    tryRefresh
  }
}
