/**
 * Client-only plugin: restores auth tokens from localStorage before any
 * route middleware runs, so the middleware can see the correct auth state.
 */
export default defineNuxtPlugin(() => {
  const { init } = useAuth()
  init()
})
