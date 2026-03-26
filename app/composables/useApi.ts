/**
 * Thin wrapper around $fetch that:
 *  1. Adds the Authorization header automatically.
 *  2. On 401, tries to refresh the token once and retries the request.
 *  3. If refresh fails, clears auth and navigates to /login.
 */
export const useApi = () => {
  const { accessToken, authHeaders, tryRefresh, logout } = useAuth()
  const router = useRouter()

  async function apiFetch<T = unknown>(
    url: string,
    options?: Parameters<typeof $fetch>[1]
  ): Promise<T> {
    const mergedHeaders = {
      ...authHeaders.value,
      ...((options as Record<string, unknown>)?.headers ?? {})
    }

    try {
      return await $fetch<T>(url, { ...options, headers: mergedHeaders })
    } catch (err: unknown) {
      const status = (err as { status?: number; statusCode?: number })?.status
        ?? (err as { status?: number; statusCode?: number })?.statusCode

      if (status === 401) {
        const refreshed = await tryRefresh()
        if (refreshed) {
          // Retry once with fresh token
          return await $fetch<T>(url, {
            ...options,
            headers: {
              Authorization: `Bearer ${accessToken.value}`,
              ...((options as Record<string, unknown>)?.headers ?? {})
            }
          })
        }
        logout()
        await router.push('/login')
      }
      throw err
    }
  }

  return { apiFetch }
}
