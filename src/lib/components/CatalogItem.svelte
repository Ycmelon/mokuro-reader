<script lang="ts">
  import type { VolumeMetadata } from '$lib/types';
  import { progress } from '$lib/settings';
  import { volumes as catalogVolumes } from '$lib/catalog';
  import { downloadQueue } from '$lib/util/download-queue';
  import { nav } from '$lib/util/hash-router';
  import { Spinner } from 'flowbite-svelte';
  import { Download } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import {
    fetchCloudThumbnail,
    getCachedCloudThumbnail,
    type CloudThumbnailResult
  } from '$lib/catalog/cloud-thumbnails';

  const CATALOG_SCROLL_Y_KEY = 'mokuro:catalog:scroll-y';

  interface Props {
    volumes: VolumeMetadata[]; // Pre-computed by parent - avoids O(N) re-filtering
    providerName?: string; // Shared across all items - avoids repeated lookups
  }

  let { volumes, providerName = 'Cloud' }: Props = $props();

  // Volumes are pre-sorted by catalog store (natural sort)
  let seriesVolumes = $derived(volumes);

  // Split into local vs cloud placeholders
  let localVolumes = $derived(seriesVolumes.filter((v) => !v.isPlaceholder));
  let hasLocalVolumes = $derived(localVolumes.length > 0);

  // Unread volumes drive the completion tint
  let unreadVolumes = $derived(
    localVolumes.filter((v) => ($progress?.[v.volume_uuid] || 1) < v.page_count - 1)
  );

  let isComplete = $derived(unreadVolumes.length === 0 && hasLocalVolumes);
  let isPlaceholderOnly = $derived(!hasLocalVolumes);

  // Cover comes from the first volume in the series.
  let coverVolume = $derived(seriesVolumes[0]);
  // Any volume works for the series identity / navigation.
  let volume = $derived(seriesVolumes[0]);

  // Live metadata so a freshly generated local thumbnail shows up without a reload.
  let liveCover = $derived(
    coverVolume ? ($catalogVolumes?.[coverVolume.volume_uuid] ?? coverVolume) : undefined
  );

  // Check if this series is downloading or queued
  let isDownloading = $derived.by(() => {
    if (!isPlaceholderOnly || !volume) return false;
    const status = downloadQueue.getSeriesQueueStatus(volume.series_title);
    return status.hasQueued || status.hasDownloading;
  });

  // ---- Thumbnail resolution (local File or fetched cloud thumbnail) ----
  let cloudThumbnail = $state<CloudThumbnailResult | undefined>(undefined);

  // Fetch the cloud thumbnail for placeholder-only series (first volume only).
  $effect(() => {
    if (!isPlaceholderOnly || !coverVolume?.cloudThumbnailFileId) {
      cloudThumbnail = undefined;
      return;
    }

    const cached = getCachedCloudThumbnail(coverVolume.volume_uuid);
    if (cached) {
      cloudThumbnail = cached;
      return;
    }

    let cancelled = false;
    fetchCloudThumbnail(coverVolume).then((result) => {
      if (cancelled || !result) return;
      cloudThumbnail = result;
    });

    return () => {
      cancelled = true;
    };
  });

  // The File backing the cover (local thumbnail or fetched cloud thumbnail).
  let thumbnailFile = $derived(liveCover?.thumbnail ?? cloudThumbnail?.file);

  let thumbnailUrl = $state<string | undefined>(undefined);
  let thumbnailKey = $state<string | undefined>(undefined);

  function getThumbnailKey(file?: File): string | undefined {
    if (!file) return undefined;
    return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
  }

  $effect(() => {
    const nextKey = getThumbnailKey(thumbnailFile);
    if (nextKey === thumbnailKey) return;

    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
      thumbnailUrl = undefined;
    }

    thumbnailKey = nextKey;
    if (thumbnailFile) {
      thumbnailUrl = URL.createObjectURL(thumbnailFile);
    }
  });

  onDestroy(() => {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  });

  // Use series title for navigation so grouping and routing align with user-visible identity.
  let navId = $derived(volume?.series_title || '');

  function persistCatalogScrollPosition() {
    const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    sessionStorage.setItem(CATALOG_SCROLL_Y_KEY, String(y));
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    persistCatalogScrollPosition();
    nav.toSeries(navId);
  }
</script>

{#if volume}
  <a
    href="#/series/{encodeURIComponent(navId)}"
    onclick={handleClick}
    class="group flex flex-col gap-1.5"
    class:opacity-70={isPlaceholderOnly}
  >
    <!-- Fixed-aspect cover box -->
    <div
      class="relative aspect-[250/360] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 shadow-sm transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
    >
      {#if thumbnailUrl}
        <img
          src={thumbnailUrl}
          alt={volume.series_title}
          loading="lazy"
          class="h-full w-full object-cover"
        />
      {:else}
        <div
          class="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-400 dark:text-gray-500"
        >
          {#if isPlaceholderOnly}
            <Download class="h-8 w-8 text-blue-400" />
          {:else}
            <span class="line-clamp-3">{volume.series_title}</span>
          {/if}
        </div>
      {/if}

      {#if isPlaceholderOnly}
        <!-- Cloud download overlay -->
        <div class="absolute right-1.5 bottom-1.5 rounded-full bg-black/60 p-1.5">
          {#if isDownloading}
            <Spinner size="4" color="blue" />
          {:else}
            <Download class="h-4 w-4 text-blue-400" />
          {/if}
        </div>
      {/if}
    </div>

    <!-- Title -->
    <p
      class="line-clamp-2 text-center text-sm leading-tight font-semibold"
      class:text-green-500={isComplete}
    >
      {volume.series_title}
    </p>
    {#if isPlaceholderOnly}
      <p class="text-center text-xs text-blue-400">
        {seriesVolumes.length} vol{seriesVolumes.length !== 1 ? 's' : ''} in {providerName}
      </p>
    {/if}
  </a>
{/if}
