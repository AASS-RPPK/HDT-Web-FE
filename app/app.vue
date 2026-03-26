<script setup>
const { isAuthenticated, logout } = useAuth()
const router = useRouter()

async function handleLogout() {
  logout()
  await router.push('/login')
}

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'HDT Annotation Dashboards'
const description = 'Manage AI-assisted histopathology annotation workflows and monitor expert interaction quality.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary'
})
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink to="/">
          <AppLogo class="w-auto h-6 shrink-0" />
        </NuxtLink>

        <TemplateMenu />
      </template>

      <template #right>
        <UColorModeButton />
        <UButton
          v-if="isAuthenticated"
          size="xs"
          variant="ghost"
          leading-icon="i-lucide-log-out"
          @click="handleLogout"
        >
          Sign out
        </UButton>
        <UButton
          v-else
          size="xs"
          variant="ghost"
          leading-icon="i-lucide-log-in"
          to="/login"
        >
          Sign in
        </UButton>
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>

    <USeparator icon="i-lucide-heart-pulse" />

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          HDT Annotation Dashboards • © {{ new Date().getFullYear() }}
        </p>
      </template>
    </UFooter>
  </UApp>
</template>
