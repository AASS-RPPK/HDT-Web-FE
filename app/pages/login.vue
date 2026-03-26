<script setup lang="ts">
definePageMeta({
  ssr: false,
  title: 'Sign in'
})

const { login, register, isAuthenticated } = useAuth()
const route = useRoute()
const router = useRouter()

// If already authenticated, redirect away
if (isAuthenticated.value) {
  await router.replace((route.query.redirect as string) || '/')
}

const tab = ref<'login' | 'register'>('login')

const loginForm = reactive({ username: '', password: '' })
const registerForm = reactive({ email: '', username: '', password: '', password2: '' })

const loading = ref(false)
const error = ref('')
const info = ref('')

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    await login(loginForm.username.trim(), loginForm.password)
    await router.replace((route.query.redirect as string) || '/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed.'
  } finally {
    loading.value = false
  }
}

async function handleRegister() {
  error.value = ''
  if (registerForm.password !== registerForm.password2) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    await register(registerForm.email.trim(), registerForm.username.trim(), registerForm.password)
    info.value = 'Account created. You can now sign in.'
    tab.value = 'login'
    loginForm.username = registerForm.username.trim()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Registration failed.'
  } finally {
    loading.value = false
  }
}

function switchTab(t: 'login' | 'register') {
  tab.value = t
  error.value = ''
  info.value = ''
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4 hero-gradient">
    <div class="glass-card w-full max-w-sm p-8">
      <div class="mb-6 text-center">
        <h1 class="text-2xl font-bold tracking-tight">
          HDT Platform
        </h1>
        <p class="mt-1 text-sm text-ui-muted">
          Sign in to access the dashboards
        </p>
      </div>

      <!-- Tab switcher -->
      <div class="mb-5 flex gap-1 rounded-lg bg-ui-bg/60 p-1">
        <button
          class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors"
          :class="tab === 'login' ? 'bg-ui-primary text-white shadow-sm' : 'text-ui-muted hover:text-ui-fg'"
          @click="switchTab('login')"
        >
          Sign in
        </button>
        <button
          class="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors"
          :class="tab === 'register' ? 'bg-ui-primary text-white shadow-sm' : 'text-ui-muted hover:text-ui-fg'"
          @click="switchTab('register')"
        >
          Register
        </button>
      </div>

      <!-- Login form -->
      <div
        v-if="tab === 'login'"
        class="grid gap-3"
      >
        <label class="block text-xs">
          <span class="text-ui-muted">Username</span>
          <input
            v-model="loginForm.username"
            class="input-modern mt-1"
            placeholder="your-username"
            autofocus
            @keydown.enter="handleLogin"
          >
        </label>
        <label class="block text-xs">
          <span class="text-ui-muted">Password</span>
          <input
            v-model="loginForm.password"
            type="password"
            class="input-modern mt-1"
            placeholder="••••••••"
            @keydown.enter="handleLogin"
          >
        </label>

        <p
          v-if="info"
          class="text-xs text-blue-500"
        >
          {{ info }}
        </p>
        <p
          v-if="error"
          class="text-xs text-red-500"
        >
          {{ error }}
        </p>

        <UButton
          :disabled="loading || !loginForm.username.trim() || !loginForm.password"
          color="primary"
          variant="solid"
          block
          class="mt-1"
          @click="handleLogin"
        >
          <span
            v-if="loading"
            class="inline-flex items-center gap-2"
          >
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Signing in…
          </span>
          <span v-else>Sign in</span>
        </UButton>
      </div>

      <!-- Register form -->
      <div
        v-if="tab === 'register'"
        class="grid gap-3"
      >
        <label class="block text-xs">
          <span class="text-ui-muted">Email</span>
          <input
            v-model="registerForm.email"
            type="email"
            class="input-modern mt-1"
            placeholder="user@example.com"
            @keydown.enter="handleRegister"
          >
        </label>
        <label class="block text-xs">
          <span class="text-ui-muted">Username</span>
          <input
            v-model="registerForm.username"
            class="input-modern mt-1"
            placeholder="your-username"
            @keydown.enter="handleRegister"
          >
        </label>
        <label class="block text-xs">
          <span class="text-ui-muted">Password</span>
          <input
            v-model="registerForm.password"
            type="password"
            class="input-modern mt-1"
            placeholder="••••••••"
            @keydown.enter="handleRegister"
          >
        </label>
        <label class="block text-xs">
          <span class="text-ui-muted">Confirm password</span>
          <input
            v-model="registerForm.password2"
            type="password"
            class="input-modern mt-1"
            placeholder="••••••••"
            @keydown.enter="handleRegister"
          >
        </label>

        <p
          v-if="error"
          class="text-xs text-red-500"
        >
          {{ error }}
        </p>

        <UButton
          :disabled="loading || !registerForm.email.trim() || !registerForm.username.trim() || !registerForm.password"
          color="primary"
          variant="solid"
          block
          class="mt-1"
          @click="handleRegister"
        >
          <span
            v-if="loading"
            class="inline-flex items-center gap-2"
          >
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Creating account…
          </span>
          <span v-else>Create account</span>
        </UButton>
      </div>
    </div>
  </div>
</template>
