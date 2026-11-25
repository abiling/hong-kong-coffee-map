(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const hiddenInput = $('#searchInput');
  const nav = $('.bottom-nav');
  if (!hiddenInput || !nav) return;

  let currentCity = false;

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
      <div class="search-mode-summary">
        <span class="search-mode-status" role="status">输入关键词开始搜索</span>
        <div class="search-mode-scopes" role="group" aria-label="搜索范围">
          <button type="button" data-search-scope="all" aria-pressed="true">全部地点</button>
          <button type="button" data-search-scope="city" aria-pressed="false">当前城市</button>
        </div>
      </div>
      <div class="search-mode-results"></div>
    </div>`;
  document.body.appendChild(overlay);

  const overlayInput = overlay.querySelector('.search-mode-input');
  const clearButton = overlay.querySelector('.search-mode-clear');
  const cancelButton = overlay.querySelector('.search-mode-cancel');
  const results = overlay.querySelector('.search-mode-results');
  const status = overlay.querySelector('.search-mode-status');
  const scopes = overlay.querySelector('.search-mode-scopes');
  const isOpen = () => overlay.classList.contains('open');

  bindEvents();
  updateSearch();

  function bindEvents() {
    window.addEventListener('coffee-map:results-updated', updateSearch);
    window.addEventListener('coffee-map:data-updated', updateSearch);
    hiddenInput.addEventListener('input', updateSearch);
    hiddenInput.addEventListener('focus', openSearch);
    searchButton.addEventListener('click', openSearch);
    cancelButton.addEventListener('click', closeSearch);
    overlay.querySelector('.search-mode-backdrop').addEventListener('click', closeSearch);
    clearButton.addEventListener('click', () => {
      syncCoreSearch('');
      overlayInput.focus();
    });
    overlayInput.addEventListener('input', () => syncCoreSearch(overlayInput.value));
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) closeSearch();
    });
    overlayInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) {
        const first = results.querySelector('[data-search-shop-id]');
        if (first) {
          event.preventDefault();
          chooseShop(first.dataset.searchShopId);
        }
      }
    });
    scopes.addEventListener('click', event => {
      const button = event.target.closest('[data-search-scope]');
      if (!button) return;
      currentCity = button.dataset.searchScope === 'city';
      scopes.querySelectorAll('button').forEach(option => {
        option.setAttribute('aria-pressed', String(option === button));
      });
      updateSearch();
    });
    results.addEventListener('click', event => {
      const button = event.target.closest('[data-search-shop-id]');
      if (button) chooseShop(button.dataset.searchShopId);
    });
  }

  function openSearch() {
    if (isOpen()) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('search-mode-open');
    updateSearch();
    requestAnimationFrame(() => {
      if (!isOpen()) return;
      overlayInput.focus({ preventScroll: true });
      overlayInput.setSelectionRange(overlayInput.value.length, overlayInput.value.length);
    });
  }

  function closeSearch() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('search-mode-open');
    overlayInput.blur();
  }

  function syncCoreSearch(value) {
    hiddenInput.value = value;
    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function updateSearch() {
    const query = hiddenInput.value.trim();
    const matched = window.CoffeeMapData.searchShops(query, { currentCity });
    searchButton.classList.toggle('has-query', Boolean(query));
    searchButton.querySelector('.compact-search-count').textContent = String(matched.length);
    if (!isOpen()) return;

    if (overlayInput.value !== hiddenInput.value) overlayInput.value = hiddenInput.value;
    overlayInput.placeholder = hiddenInput.placeholder;
    overlayInput.setAttribute('aria-label', hiddenInput.placeholder);
    scopes.hidden = document.body.classList.contains('saved-view');
    clearButton.style.visibility = query ? 'visible' : 'hidden';
    if (!query) {
      status.textContent = '输入关键词开始搜索';
      results.innerHTML = '<div class="search-mode-empty">输入店名、地区或地址后，这里会直接显示匹配的咖啡店。</div>';
      return;
    }

    status.textContent = matched.length ? `${matched.length} 个匹配结果` : '没有匹配结果';
    results.innerHTML = matched.length ? matched.map(shop => `
      <button class="search-result" type="button" data-search-shop-id="${escapeHtml(shop.id)}">
        <span class="search-result-name">${highlight(shop.name, query)}</span>
        <span class="search-result-meta"><span class="search-result-district">${highlight(`${shop.country} · ${shop.city}`, query)}</span>${highlight(shop.address, query)}</span>
      </button>`).join('')
      : '<div class="search-mode-empty"><strong>没有找到相关咖啡店</strong><br>尝试缩短关键词，或改用地区、街道名称搜索。</div>';
  }

  function chooseShop(id) {
    closeSearch();
    window.CoffeeMapData.selectSearchShop(id);
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
