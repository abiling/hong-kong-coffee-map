(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const hiddenInput = $('#searchInput');
  const nav = $('.bottom-nav');
  if (!hiddenInput || !nav) return;

  let renderToken = 0;

  const searchButton = document.createElement('button');
  searchButton.type = 'button';
  searchButton.className = 'compact-search-button';
  searchButton.setAttribute('aria-label', '搜索咖啡店');
  searchButton.innerHTML = `
    <svg class="material-symbol" viewBox="0 0 960 960" aria-hidden="true"><use href="#ms-search"/></svg>
    <span class="compact-search-count" aria-hidden="true">0</span>`;
  nav.insertAdjacentElement('afterend', searchButton);

  const overlay = document.createElement('section');
  overlay.className = 'search-mode';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="search-mode-backdrop"></div>
    <div class="search-mode-content">
      <div class="search-mode-bar">
        <label class="search-mode-field">
          <svg class="material-symbol" viewBox="0 0 960 960" aria-hidden="true"><use href="#ms-search"/></svg>
          <input class="search-mode-input" type="search" inputmode="search" autocomplete="off" placeholder="搜索店名、地址或地区" aria-label="搜索店名、地址或地区" />
          <button class="search-mode-clear" type="button" aria-label="清除搜索"><svg class="material-symbol" viewBox="0 0 960 960" aria-hidden="true"><use href="#ms-close"/></svg></button>
        </label>
        <button class="search-mode-cancel" type="button">取消</button>
      </div>
      <div class="search-mode-summary"><span class="search-mode-status">输入关键词开始搜索</span><span class="search-mode-scope">店名 · 地区 · 地址</span></div>
      <div class="search-mode-results" role="listbox"><div class="search-mode-empty">输入店名、地区或地址后，这里会直接显示匹配的咖啡店。</div></div>
    </div>`;
  document.body.appendChild(overlay);

  const overlayInput = overlay.querySelector('.search-mode-input');
  const clearButton = overlay.querySelector('.search-mode-clear');
  const cancelButton = overlay.querySelector('.search-mode-cancel');
  const results = overlay.querySelector('.search-mode-results');
  const status = overlay.querySelector('.search-mode-status');

  bindEvents();
  updateBadge();

  function bindEvents() {
    window.addEventListener('coffee-map:results-updated', () => {
      if (overlay.classList.contains('open')) renderResults();
      updateBadge();
    });
    searchButton.addEventListener('click', openSearch);
    cancelButton.addEventListener('click', closeSearch);
    overlay.querySelector('.search-mode-backdrop').addEventListener('click', closeSearch);
    clearButton.addEventListener('click', () => {
      overlayInput.value = '';
      syncCoreSearch('');
      overlayInput.focus();
    });
    overlayInput.addEventListener('input', () => {
      syncCoreSearch(overlayInput.value);
    });
    overlayInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSearch();
      if (event.key === 'Enter') {
        const first = results.querySelector('[data-search-shop-id]');
        if (first) {
          event.preventDefault();
          chooseShop(first.dataset.searchShopId);
        }
      }
    });
    hiddenInput.addEventListener('input', () => {
      if (!overlay.classList.contains('open')) overlayInput.value = hiddenInput.value;
      updateBadge();
    });
  }

  function openSearch() {
    overlayInput.value = hiddenInput.value;
    overlayInput.placeholder = hiddenInput.placeholder;
    overlayInput.setAttribute('aria-label', hiddenInput.placeholder);
    overlay.querySelector('.search-mode-scope').textContent = document.body.classList.contains('saved-view')
      ? '全部收藏' : '店名 · 地区 · 地址';
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('search-mode-open');
    renderResults();
    requestAnimationFrame(() => {
      overlayInput.focus({ preventScroll: true });
      overlayInput.setSelectionRange(overlayInput.value.length, overlayInput.value.length);
    });
  }

  function closeSearch() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('search-mode-open');
    overlayInput.blur();
    updateBadge();
  }

  function syncCoreSearch(value) {
    hiddenInput.value = value;
    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderResults() {
    const token = ++renderToken;
    const query = overlayInput.value.trim();
    clearButton.style.visibility = query ? 'visible' : 'hidden';

    if (!query) {
      status.textContent = '输入关键词开始搜索';
      results.innerHTML = '<div class="search-mode-empty">输入店名、地区或地址后，这里会直接显示匹配的咖啡店。</div>';
      return;
    }

    requestAnimationFrame(() => {
      if (token !== renderToken) return;
      const matched = window.CoffeeMapData.getResults();
      const global = document.body.classList.contains('saved-view');
      status.textContent = matched.length ? `${matched.length} 个匹配结果` : '没有匹配结果';

      if (!matched.length) {
        results.innerHTML = '<div class="search-mode-empty"><strong>没有找到相关咖啡店</strong><br>尝试缩短关键词，或改用地区、街道名称搜索。</div>';
        updateBadge(0);
        return;
      }

      results.innerHTML = matched.map(shop => `
        <button class="search-result" type="button" role="option" data-search-shop-id="${escapeHtml(shop.id)}">
          <span class="search-result-name">${highlight(shop.name, query)}</span>
          <span class="search-result-meta"><span class="search-result-district">${highlight(global ? `${shop.country} · ${shop.city}` : shop.district || shop.region, query)}</span>${highlight(shop.address, query)}</span>
        </button>`).join('');
      results.querySelectorAll('[data-search-shop-id]').forEach(button => {
        button.addEventListener('click', () => chooseShop(button.dataset.searchShopId));
      });
      updateBadge(matched.length);
    });
  }

  function chooseShop(id) {
    closeSearch();
    if (!document.body.classList.contains('saved-view') && !document.body.classList.contains('map-unavailable')) {
      document.querySelector('.nav-item[data-view="map"]:not(.active)')?.click();
    }
    window.CoffeeMapData.selectShop(id);
  }

  function updateBadge(explicitCount) {
    const query = hiddenInput.value.trim();
    const badge = searchButton.querySelector('.compact-search-count');
    searchButton.classList.toggle('has-query', Boolean(query));
    const count = query ? explicitCount ?? window.CoffeeMapData.getResults().length : 0;
    badge.textContent = count > 99 ? '99+' : String(count);
  }

  function highlight(text, query) {
    const value = String(text || '');
    const words = query.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!words.length) return escapeHtml(value);
    const pattern = words.map(escapeRegExp).join('|');
    return value.split(new RegExp(`(${pattern})`, 'ig')).map((part, index) => (
      index % 2 ? `<mark class="search-highlight">${escapeHtml(part)}</mark>` : escapeHtml(part)
    )).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

})();
