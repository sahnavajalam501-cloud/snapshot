(() => {
  if (window.__wingoSnapshotHookInstalled) return;
  window.__wingoSnapshotHookInstalled = true;
  const API_RE = /(?:api\.ar-lottery01\.com)?\/(?:api\/)?(?:Energy\/GetPanel|GetGameIssue|GetNoaverageEmerdList|GetEmerdList|GetWinTheLotteryResult|GetLastFiveIssueNumberResult|Lottery\/GetHistoryIssuePage|Lottery\/GetRecordPage)/i;
  const emit = (url, body, status, method) => {
    try {
      const u = String(url || '');
      if (!API_RE.test(u)) return;
      let parsed = body;
      if (typeof body === 'string') { try { parsed = JSON.parse(body); } catch { parsed = { _rawText: body.slice(0, 100000) }; } }
      if (!parsed || typeof parsed !== 'object') return;
      window.postMessage({ __wingoSnapshotMonitor: true, type: 'API_RESPONSE', payload: { url: u, method: method || 'GET', status: Number(status || 0), capturedAt: Date.now(), body: parsed } }, '*');
    } catch (_) {}
  };
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const req = args[0];
    const url = typeof req === 'string' ? req : (req && req.url) || '';
    return originalFetch.apply(this, args).then(response => {
      try { if (API_RE.test(String(url))) response.clone().text().then(text => emit(url, text, response.status, (args[1] && args[1].method) || (req && req.method) || 'GET')).catch(() => {}); } catch (_) {}
      return response;
    });
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__wingoMonUrl = String(url || ''); this.__wingoMonMethod = method || 'GET';
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (API_RE.test(this.__wingoMonUrl || '')) {
      this.addEventListener('load', () => { try { emit(this.responseURL || this.__wingoMonUrl, this.responseText, this.status, this.__wingoMonMethod); } catch (_) {} }, { once: true });
    }
    return origSend.apply(this, args);
  };
})();
