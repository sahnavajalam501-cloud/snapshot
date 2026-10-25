(() => {
  const marker = '__wingoSnapshotMonitor';
  window.addEventListener('message', event => {
    if (event.source !== window || !event.data || event.data[marker] !== true || event.data.type !== 'API_RESPONSE') return;
    const payload = event.data.payload;
    if (!payload || !payload.url || !payload.body) return;
    chrome.runtime.sendMessage({ type: 'WINGO_CAPTURE', payload }).catch(() => {});
  });
})();
