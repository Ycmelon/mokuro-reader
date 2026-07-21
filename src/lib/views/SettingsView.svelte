<script lang="ts">
  import { navigateBack } from '$lib/util/hash-router';
  import SettingsContent from '$lib/components/Settings/SettingsContent.svelte';
</script>

<svelte:head>
  <title>Settings</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
  <h1 class="text-2xl font-semibold">Settings</h1>
  <SettingsContent close={navigateBack} showCloseButton={false} />
</div>
