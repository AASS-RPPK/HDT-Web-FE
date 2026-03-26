export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const { isAuthenticated, tryRefresh } = useAuth()

  if (isAuthenticated.value) return

  // Access token missing — try a silent refresh before forcing login
  const refreshed = await tryRefresh()
  if (!refreshed) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
