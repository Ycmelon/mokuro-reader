<script lang="ts">
  import { Drawer, Spinner } from 'flowbite-svelte';
  import { ChevronDown, SendHorizontal, X, Trash2 } from '@lucide/svelte';
  import { sineIn } from 'svelte/easing';
  import { onMount, tick } from 'svelte';
  import {
    chatOpen,
    chatMessages,
    chatPendingInput,
    chatLoading,
    chatError,
    closeChat,
    clearHistory,
    sendMessage
  } from '$lib/ai-chat/store';
  import { miscSettings } from '$lib/settings/misc';
  import { renderMarkdown } from '$lib/ai-chat/markdown';

  let textarea: HTMLTextAreaElement | undefined = $state();
  let messagesEl: HTMLDivElement | undefined = $state();
  let inputValue = $state('');

  // Tracks whether the message list is scrolled to (near) the bottom, so
  // streamed content only auto-follows the user's reading position instead
  // of yanking them back down while they're scrolled up reading history.
  let isNearBottom = $state(true);
  const BOTTOM_THRESHOLD_PX = 80;

  function handleMessagesScroll() {
    if (!messagesEl) return;
    const distanceFromBottom =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    isNearBottom = distanceFromBottom < BOTTOM_THRESHOLD_PX;
  }

  function scrollToBottom(behavior: ScrollBehavior = 'auto') {
    if (!messagesEl) return;
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
    isNearBottom = true;
  }

  // Same drawer primitive and motion as Settings.svelte, so the two panels
  // slide, size, and dim the page identically.
  let transitionParams = {
    x: 320,
    duration: 200,
    easing: sineIn
  };

  // Visual Viewport API fallback for browsers that don't yet support 100dvh
  // shrinking when the soft keyboard appears (older iOS, some Android WebViews).
  // We only listen to 'resize' (keyboard show/hide) — NOT 'scroll'.
  // The dialog is fixed relative to the visual viewport, so updating its
  // height from visualViewport.offsetTop on scroll events would make the
  // panel jump every time the user scrolls the messages list on iOS.
  // The <dialog> node is destroyed/recreated each time the drawer opens
  // (Dialog.svelte only renders it while open), so it's looked up fresh by
  // id on every resize rather than cached in a ref that could go stale.
  onMount(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function onKeyboardResize() {
      const dlg = document.getElementById('ai-chat-drawer');
      if (dlg) dlg.style.height = vv!.height + 'px';
    }

    vv.addEventListener('resize', onKeyboardResize);
    return () => vv!.removeEventListener('resize', onKeyboardResize);
  });

  // Pre-fill textarea when opened via Explain
  $effect(() => {
    if ($chatOpen && $chatPendingInput) {
      inputValue = $chatPendingInput;
      chatPendingInput.set('');
      tick().then(() => {
        autoResize();
        textarea?.focus();
      });
    }
  });

  // Jump to the latest message every time the drawer opens, regardless of
  // where the list was scrolled when it was last closed.
  $effect(() => {
    if ($chatOpen) {
      tick().then(() => scrollToBottom());
    }
  });

  // Follow streamed content only while the user is already at the bottom —
  // otherwise leave their scroll position alone and let the jump-to-bottom
  // button handle it. isNearBottom is deliberately read inside the .then()
  // (not at the top of the effect) so scrolling the list doesn't itself
  // retrigger this effect — only new messages/loading state should.
  $effect(() => {
    $chatMessages;
    $chatLoading;
    tick().then(() => {
      if (isNearBottom) scrollToBottom();
    });
  });

  function autoResize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  async function handleSend() {
    const content = inputValue.trim();
    if (!content || $chatLoading) return;
    inputValue = '';
    await tick();
    autoResize();
    await sendMessage(content);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Escape is handled by the reader's capture-phase coordinator
  // (Reader.svelte handleEscapeCapture), which closes this panel ahead of the
  // layout's global back-navigation.

  // Close on outside click, but only when the click *starts* on the backdrop —
  // mirrors Settings.svelte so a text selection dragged past the panel edge
  // doesn't dismiss the drawer on mouseup.
  function handleBackdropMousedown(ev: MouseEvent & { currentTarget: HTMLDialogElement }) {
    const dlg = ev.currentTarget;
    if (ev.target === dlg) {
      const rect = dlg.getBoundingClientRect();
      const clickedInContent =
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom;

      if (!clickedInContent) {
        chatOpen.set(false);
      }
    }
  }

  let apiKeyMissing = $derived(!$miscSettings.aiChatSettings.openrouterApiKey);
  let chatFontSize = $derived($miscSettings.aiChatSettings.chatFontSize);
</script>

<Drawer
  placement="right"
  class="w-full p-0 md:w-1/2 lg:w-1/4"
  {transitionParams}
  bind:open={$chatOpen}
  id="ai-chat-drawer"
  outsideclose={false}
  dismissable={false}
  onmousedown={handleBackdropMousedown}
>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="header">
      <h5 class="text-base font-semibold text-gray-900 dark:text-white">Chat</h5>
      <div class="header-actions">
        <button
          onclick={clearHistory}
          title="Clear history"
          aria-label="Clear history"
          class="m-0.5 rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <Trash2 class="h-5 w-5" />
        </button>
        <button
          onclick={closeChat}
          title="Close"
          aria-label="Close chat"
          class="m-0.5 rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <X class="h-5 w-5" />
        </button>
      </div>
    </div>

    <!-- API key warning -->
    {#if apiKeyMissing}
      <div class="warning">No API key set. Add your OpenRouter key in Settings → Chat.</div>
    {/if}

    <!-- Messages -->
    <div class="messages">
      <div
        bind:this={messagesEl}
        class="messages-scroll"
        style:font-size="{chatFontSize}px"
        onscroll={handleMessagesScroll}
      >
        {#if $chatMessages.length === 0}
          <p class="empty-hint">No messages yet</p>
        {/if}

        {#each $chatMessages as msg}
          {#if msg.role === 'user'}
            <div class="msg-row user">
              <div class="bubble user">{msg.content}</div>
            </div>
          {:else}
            <div class="assistant-markdown">
              {@html renderMarkdown(msg.content)}
            </div>
          {/if}
        {/each}

        {#if $chatLoading}
          <div class="assistant-text thinking">
            <Spinner size="4" />
            <span>Thinking…</span>
          </div>
        {/if}

        {#if $chatError}
          <div class="error-msg">{$chatError}</div>
        {/if}
      </div>

      {#if !isNearBottom}
        <button
          class="scroll-bottom-btn"
          onclick={() => scrollToBottom('smooth')}
          aria-label="Scroll to latest message"
          title="Scroll to latest message"
        >
          <ChevronDown class="h-4 w-4" />
        </button>
      {/if}
    </div>

    <!-- Input bar -->
    <div class="input-bar">
      <div class="input-row">
        <textarea
          bind:this={textarea}
          bind:value={inputValue}
          oninput={autoResize}
          onkeydown={handleKeydown}
          placeholder="Message…"
          rows="1"
          class="chat-input"
        ></textarea>
        <button
          onclick={handleSend}
          disabled={!inputValue.trim() || $chatLoading}
          aria-label="Send message"
          class="send-btn"
        >
          <SendHorizontal class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- One-handed close button — only shown at the width where the drawer is
         full-screen (mobile); at md+ the drawer is a side panel and the
         header close button is already within thumb reach. -->
    <div class="mobile-close-row md:hidden">
      <button
        onclick={closeChat}
        aria-label="Close chat"
        title="Close chat"
        class="mobile-close-btn"
      >
        <X class="h-5 w-5" />
      </button>
    </div>
  </div>
</Drawer>

<style>
  /* The dialog is promoted to the top layer (native showModal), so height:
     100% resolves against the layout viewport, not the visual one. The ID
     selector's specificity lets this plain property win over the Drawer's
     `h-full` utility class without !important. The visualViewport listener
     in the script overrides this for browsers without 100dvh support. */
  :global(#ai-chat-drawer) {
    height: 100dvh;
  }

  /* ── Header ── */

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e5e7eb;
    flex-shrink: 0;
  }

  :global(.dark) .header {
    border-bottom-color: var(--color-gray-700);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  /* ── API key warning ── */

  .warning {
    margin: 0.75rem 1rem 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    background: #fefce8;
    color: #854d0e;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  :global(.dark) .warning {
    background: rgba(202, 138, 4, 0.15);
    color: #fde047;
  }

  /* ── Messages ── */

  /* Non-scrolling positioned wrapper — .scroll-bottom-btn is absolutely
     positioned against *this* box, so it stays pinned to the visible
     viewport instead of the scrollable content box (which grows as
     messages arrive, dragging an absolutely-positioned child down with it
     if it lived inside the scrolling element itself). */
  .messages {
    position: relative;
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .messages-scroll {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    /* Prevent the iOS rubber-band scroll from propagating to the fixed panel
       when the user reaches the top or bottom of the message list. Without
       this, overscrolling visually moves the whole panel, revealing the manga
       panel behind it. */
    overscroll-behavior: contain;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    /* min-height: 0 is critical — without it, a flex child won't shrink below
       its content size, so the messages area won't compress when the keyboard
       appears, pushing the input bar out of view. */
    min-height: 0;
  }

  .empty-hint {
    font-size: 0.75rem;
    color: #9ca3af;
    text-align: center;
    margin-top: 1rem;
  }

  .msg-row {
    display: flex;
  }

  .msg-row.user {
    justify-content: flex-end;
  }

  .bubble {
    max-width: 85%;
    border-radius: 1rem;
    padding: 0.5rem 0.75rem;
    /* font-size inherited from .messages, driven by the chatFontSize setting */
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  .bubble.user {
    background: #2563eb;
    color: white;
    border-bottom-right-radius: 0.25rem;
  }

  .assistant-text {
    width: 100%;
    padding: 0.25rem 0;
    /* font-size inherited from .messages, driven by the chatFontSize setting */
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    color: #111827;
  }

  :global(.dark) .assistant-text {
    color: #f3f4f6;
  }

  /* Custom (not Tailwind Typography's `prose`) so block spacing stays close
     to the plain white-space:pre-wrap rhythm used elsewhere in the chat —
     `prose`'s default margins read as "article" spacing and look
     inconsistent with plaintext messages sitting right above/below. */
  .assistant-markdown {
    width: 100%;
    padding: 0.25rem 0;
    /* font-size inherited from .messages, driven by the chatFontSize setting */
    word-break: break-word;
    line-height: 1.5;
    color: #111827;
  }

  :global(.dark) .assistant-markdown {
    color: #f3f4f6;
  }

  .assistant-markdown :global(:first-child) {
    margin-top: 0;
  }

  .assistant-markdown :global(:last-child) {
    margin-bottom: 0;
  }

  .assistant-markdown :global(p) {
    margin: 0.5em 0;
  }

  .assistant-markdown :global(strong) {
    font-weight: 600;
  }

  .assistant-markdown :global(h1),
  .assistant-markdown :global(h2),
  .assistant-markdown :global(h3),
  .assistant-markdown :global(h4),
  .assistant-markdown :global(h5),
  .assistant-markdown :global(h6) {
    margin: 0.75em 0 0.35em;
    font-weight: 600;
    line-height: 1.3;
  }

  .assistant-markdown :global(h1) {
    font-size: 1.35em;
  }

  .assistant-markdown :global(h2) {
    font-size: 1.2em;
  }

  .assistant-markdown :global(h3) {
    font-size: 1.1em;
  }

  .assistant-markdown :global(h4),
  .assistant-markdown :global(h5),
  .assistant-markdown :global(h6) {
    font-size: 1em;
  }

  .assistant-markdown :global(ul),
  .assistant-markdown :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.4em;
    /* Tailwind's preflight resets list-style to none on all ul/ol, so
       markers need to be re-enabled explicitly here. */
    list-style-position: outside;
  }

  .assistant-markdown :global(ul) {
    list-style-type: disc;
  }

  .assistant-markdown :global(ol) {
    list-style-type: decimal;
  }

  .assistant-markdown :global(ul ul),
  .assistant-markdown :global(ol ul) {
    list-style-type: circle;
  }

  .assistant-markdown :global(li) {
    margin: 0.15em 0;
  }

  .assistant-markdown :global(li > p) {
    margin: 0;
  }

  .assistant-markdown :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: rgba(0, 0, 0, 0.06);
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
  }

  :global(.dark) .assistant-markdown :global(code) {
    background: rgba(255, 255, 255, 0.1);
  }

  .assistant-markdown :global(pre) {
    margin: 0.5em 0;
    padding: 0.6em 0.75em;
    border-radius: 0.5rem;
    background: rgba(0, 0, 0, 0.06);
    overflow-x: auto;
  }

  :global(.dark) .assistant-markdown :global(pre) {
    background: rgba(255, 255, 255, 0.08);
  }

  .assistant-markdown :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.8125em;
  }

  .assistant-markdown :global(blockquote) {
    margin: 0.5em 0;
    padding-left: 0.75em;
    border-left: 3px solid #d1d5db;
    color: #6b7280;
  }

  :global(.dark) .assistant-markdown :global(blockquote) {
    border-left-color: #4b5563;
    color: #9ca3af;
  }

  .assistant-markdown :global(hr) {
    margin: 0.75em 0;
    border: none;
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .assistant-markdown :global(hr) {
    border-top-color: var(--color-gray-700);
  }

  .assistant-markdown :global(a) {
    color: #2563eb;
    text-decoration: underline;
  }

  :global(.dark) .assistant-markdown :global(a) {
    color: #60a5fa;
  }

  .assistant-markdown :global(table) {
    width: 100%;
    margin: 0.5em 0;
    border-collapse: collapse;
    font-size: 0.9em;
  }

  .assistant-markdown :global(th),
  .assistant-markdown :global(td) {
    border: 1px solid #e5e7eb;
    padding: 0.35em 0.5em;
    text-align: left;
  }

  :global(.dark) .assistant-markdown :global(th),
  :global(.dark) .assistant-markdown :global(td) {
    border-color: var(--color-gray-700);
  }

  .assistant-markdown :global(th) {
    background: #f9fafb;
    font-weight: 600;
  }

  :global(.dark) .assistant-markdown :global(th) {
    background: var(--color-gray-800);
  }

  /* Pinned to the bottom of the scroll viewport (not the content) since it's
     an absolutely-positioned child of the position:relative .messages pane. */
  .scroll-bottom-btn {
    position: absolute;
    left: 50%;
    bottom: 0.75rem;
    transform: translateX(-50%);
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    border: 1px solid #e5e7eb;
    background: white;
    color: #374151;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    cursor: pointer;
  }

  .scroll-bottom-btn:hover {
    background: #f9fafb;
  }

  :global(.dark) .scroll-bottom-btn {
    background: var(--color-gray-700);
    border-color: var(--color-gray-600);
    color: #e5e7eb;
  }

  :global(.dark) .scroll-bottom-btn:hover {
    background: var(--color-gray-600);
  }

  .assistant-text.thinking {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #6b7280;
    font-size: 0.75rem;
  }

  :global(.dark) .assistant-text.thinking {
    color: #9ca3af;
  }

  .error-msg {
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: #fef2f2;
    color: #b91c1c;
    font-size: 0.75rem;
  }

  :global(.dark) .error-msg {
    background: rgba(185, 28, 28, 0.2);
    color: #fca5a5;
  }

  /* ── Mobile one-handed close button ── */

  .mobile-close-row {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    padding: 0 0 0.375rem;
    /* Trim the input bar's bottom padding so the gap above the close
       button matches the 0.5rem gap between the textarea and send button. */
    margin-top: -0.25rem;
  }

  .mobile-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 9999px;
    border: 1px solid #e5e7eb;
    background: white;
    color: #374151;
    cursor: pointer;
  }

  .mobile-close-btn:hover {
    background: #f9fafb;
  }

  :global(.dark) .mobile-close-btn {
    background: var(--color-gray-700);
    border-color: var(--color-gray-600);
    color: #e5e7eb;
  }

  :global(.dark) .mobile-close-btn:hover {
    background: var(--color-gray-600);
  }

  /* ── Input bar ── */

  .input-bar {
    flex-shrink: 0;
    padding: 0.75rem;
    /* Respect iPhone notch / home indicator */
    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid #e5e7eb;
  }

  :global(.dark) .input-bar {
    border-top-color: var(--color-gray-700);
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .chat-input {
    flex: 1;
    resize: none;
    border-radius: 1.25rem;
    border: 1px solid #d1d5db;
    background: white;
    padding: 0.5rem 0.875rem;
    font-size: 0.9375rem; /* 15px — matches system default, avoids iOS zoom on focus */
    color: #111827;
    line-height: 1.5;
    max-height: 120px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    outline: none;
    font-family: inherit;
  }

  .chat-input:focus {
    border-color: #2563eb;
  }

  .chat-input::placeholder {
    color: #9ca3af;
  }

  :global(.dark) .chat-input {
    background: var(--color-gray-700);
    border-color: var(--color-gray-600);
    color: #f3f4f6;
  }

  :global(.dark) .chat-input:focus {
    border-color: #3b82f6;
  }

  :global(.dark) .chat-input::placeholder {
    color: #6b7280;
  }

  .send-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    border: none;
    background: #2563eb;
    color: white;
    cursor: pointer;
    transition: background 150ms;
  }

  .send-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
