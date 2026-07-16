<script lang="ts">
  /**
   * +page.svelte — top-level SPA shell for Prompt Compose.
   *
   * There is exactly one view: the Prompt Library (PromptsView). The shell owns
   * only the app chrome — title, theme toggle, footer — and the compose surface
   * lives entirely inside PromptsView, whose store keeps a draft alive for the
   * app's lifetime.
   */
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { getTheme, toggleTheme } from '$lib/theme';
  import { isTauri } from '$lib/api';
  import PromptsView from '$lib/components/PromptsView.svelte';

  let theme = $state(getTheme());

  // App version for the footer — only available in the packaged desktop app.
  let appVersion = $state('');

  // The header height feeds the --header-h CSS var that app.css uses to size the
  // scroll region, so we measure it live rather than hardcode it.
  let headerEl: HTMLElement | undefined = $state(undefined);

  onMount(async () => {
    if (isTauri()) {
      try {
        appVersion = await getVersion();
      } catch (e) {
        console.error('[app] getVersion failed', e);
      }
    }
  });

  onMount(() => {
    if (!headerEl) return;
    const setVar = () =>
      document.documentElement.style.setProperty('--header-h', `${headerEl!.offsetHeight}px`);
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(headerEl);
    return () => ro.disconnect();
  });

  function handleToggleTheme(): void {
    theme = toggleTheme();
  }
</script>

<header class="app-header" bind:this={headerEl}>
  <div>
    <h1>Prompt Compose</h1>
  </div>
  <div class="app-header__actions">
    <button class="btn btn--ghost btn--sm" onclick={handleToggleTheme} type="button">
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  </div>
</header>

<main class="container-main">
  <PromptsView />
</main>

<footer class="app-footer">
  <a href="https://github.com/zhangxingeng/prompt-compose" target="_blank" rel="noopener noreferrer">
    Prompt Compose{appVersion ? ` v${appVersion}` : ''} — offline Markdown prompt snippets, organized by folder
  </a>
</footer>
