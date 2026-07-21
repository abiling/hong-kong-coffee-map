(() => {
  'use strict';

  const API_URL = 'https://script.google.com/macros/s/AKfycby0EnuIMDygemCzD522FkMgdYylRcr-UZef_KZUuiboBa5kT73PpDXrdHK8nqoAlsgxVg/exec';
  const KEY_STORAGE = 'hk-coffee-admin-key-v2';
  const ACTION_WIDTH = 144;
  let shopIndex = new Map();
  let openRow = null;
  let suppressClickUntil = 0;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const hasKey = () => Boolean(localStorage.getItem(KEY_STORAGE));

  init();

  async function init() {
    installDetailAdminActions();
    installEditDialog();
    bindSettingsEvents();
    observeList();
    await refreshShopIndex();
    enhanceRows();
  }

  async function refreshShopIndex({ force = false } = {}) {
    try {
      let payload;
      if (window.CoffeeMapData?.load) {
        payload = await window.CoffeeMapData.load({ force });
      } else {
        const response = await fetch(`${API_URL}?action=list&_=${Date.now()}`, { cache: 'no-store' });
        payload = await response.json();
      }
      if (!payload.ok || !Array.isArray(payload.shops)) return;
      shopIndex = new Map(payload.shops.filter(shop => shop.active !== false).map(shop => [String(shop.id), shop]));
    } catch (error) {
      console.warn('Admin data refresh failed:', error);
    }
  }

  function observeList() {
    const list = $('#shopList');
    if (!list) return;
    new MutationObserver(() => requestAnimationFrame(enhanceRows)).observe(list, { childList: true });
  }

  function enhanceRows() {
    const list = $('#shopList');
    if (!list) return;
    const admin = hasKey();
    document.body.classList.toggle('admin-enabled', admin);

    list.querySelectorAll(':scope > .shop-card').forEach(card => {
      const id = card.dataset.shopId;
      if (!id) return;
      const row = document.createElement('div');
      row.className = 'swipe-row';
      row.dataset.shopRow = id;
      card.parentNode.insertBefore(row, card);
      row.appendChild(card);
    });

    list.querySelectorAll('.swipe-row').forEach(row => {
      const card = row.querySelector('.shop-card');
      if (!card) return;
      if (admin && !row.querySelector('.swipe-actions')) {
        const actions = document.createElement('div');
        actions.className = 'swipe-actions';
        actions.innerHTML = `<button class="swipe-action swipe-edit" type="button">编辑</button><button class="swipe-action swipe-delete" type="button">删除</button>`;
        row.insertBefore(actions, card);
        actions.querySelector('.swipe-edit').addEventListener('click', event => {
          event.stopPropagation();
          closeSwipeRows();
          openEditor(row.dataset.shopRow);
        });
        actions.querySelector('.swipe-delete').addEventListener('click', event => {
          event.stopPropagation();
          closeSwipeRows();
          archiveShop(row.dataset.shopRow);
        });
      }
      if (!admin) row.querySelector('.swipe-actions')?.remove();
      if (admin && !card.dataset.swipeBound) bindSwipe(card, row);
    });
  }

  function bindSwipe(card, row) {
    card.dataset.swipeBound = '1';
    let startX = 0;
    let startY = 0;
    let base = 0;
    let current = 0;
    let dragging = false;
    let horizontal = false;

    card.addEventListener('pointerdown', event => {
      if (!hasKey() || !document.body.matches('.list-view,.saved-view')) return;
      dragging = true;
      horizontal = false;
      startX = event.clientX;
      startY = event.clientY;
      base = row.classList.contains('swiped') ? -ACTION_WIDTH : 0;
      current = base;
      card.setPointerCapture?.(event.pointerId);
      row.classList.add('dragging');
    });

    card.addEventListener('pointermove', event => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!horizontal && Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      if (!horizontal && Math.abs(dy) > Math.abs(dx)) {
        dragging = false;
        row.classList.remove('dragging');
        return;
      }
      horizontal = true;
      event.preventDefault();
      current = Math.max(-ACTION_WIDTH, Math.min(0, base + dx));
      card.style.transform = `translateX(${current}px)`;
    }, { passive: false });

    const finish = event => {
      if (!dragging) return;
      dragging = false;
      row.classList.remove('dragging');
      card.releasePointerCapture?.(event.pointerId);
      if (!horizontal) return;
      suppressClickUntil = Date.now() + 350;
      const shouldOpen = current < -ACTION_WIDTH * 0.38;
      closeSwipeRows(row);
      row.classList.toggle('swiped', shouldOpen);
      card.style.transform = shouldOpen ? `translateX(-${ACTION_WIDTH}px)` : '';
      openRow = shouldOpen ? row : null;
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    card.addEventListener('click', event => {
      if (Date.now() < suppressClickUntil || row.classList.contains('swiped')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (row.classList.contains('swiped')) closeSwipeRows();
      }
    }, true);
  }

  function closeSwipeRows(except = null) {
    $$('.swipe-row.swiped').forEach(row => {
      if (row === except) return;
      row.classList.remove('swiped');
      const card = row.querySelector('.shop-card');
      if (card) card.style.transform = '';
    });
    if (openRow !== except) openRow = null;
  }

  function installDetailAdminActions() {
    const detailActions = $('.detail-actions');
    if (!detailActions || $('#detailAdminActions')) return;
    const actions = document.createElement('div');
    actions.id = 'detailAdminActions';
    actions.className = 'detail-admin-actions';
    actions.innerHTML = '<button id="editSelectedButton" class="admin-action edit-action" type="button">编辑地点</button><button id="deleteSelectedButton" class="admin-action delete-action" type="button">删除地点</button>';
    detailActions.insertAdjacentElement('afterend', actions);
    $('#editSelectedButton').addEventListener('click', () => {
      const shop = resolveDetailShop();
      if (shop) openEditor(shop.id);
    });
    $('#deleteSelectedButton').addEventListener('click', () => {
      const shop = resolveDetailShop();
      if (shop) archiveShop(shop.id);
    });
  }

  function resolveDetailShop() {
    const name = ($('#detailName')?.textContent || '').trim();
    const address = ($('#detailAddress')?.textContent || '').trim();
    const shop = [...shopIndex.values()].find(item => String(item.name).trim() === name && String(item.address).trim() === address)
      || [...shopIndex.values()].find(item => String(item.name).trim() === name);
    if (!shop) showToast('未能识别当前地点，请从列表左滑编辑');
    return shop;
  }

  function installEditDialog() {
    if ($('#editPlaceDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="editPlaceDialog" class="add-dialog edit-place-dialog">
        <form id="editPlaceForm" method="dialog">
          <div class="dialog-head"><div><p class="list-kicker">Edit Place</p><h2>编辑咖啡店</h2></div><button type="button" id="closeEditDialog" class="sheet-close" aria-label="关闭"><svg class="material-symbol" viewBox="0 0 960 960" aria-hidden="true"><use href="#ms-close"/></svg></button></div>
          <div class="form-grid">
            <label class="full primary-input map-provider-field" data-map-provider-field="google"><span>Google Maps 链接 *</span><input name="google_maps" type="url" required /></label>
            <label class="full primary-input map-provider-field" data-map-provider-field="apple" hidden><span>Apple Maps 链接 *</span><input name="apple_maps" type="url" disabled /></label>
            <label><span>店铺名称 *</span><input name="name" required /></label>
            <label><span>具体地区 *</span><input name="district" required /></label>
            <label><span>大区 *</span><input name="region" required /></label>
            <label class="full"><span>地址 *</span><input name="address" required /></label>
            <label><span>纬度 *</span><input name="latitude" type="number" step="any" required /></label>
            <label><span>经度 *</span><input name="longitude" type="number" step="any" required /></label>
            <label><span>类型</span><input name="category" /></label>
            <label><span>来源链接</span><input name="source" type="url" /></label>
            <label class="full"><span>备注</span><textarea name="notes" rows="3"></textarea></label>
          </div>
          <div class="dialog-actions single-action">
            <button type="submit" id="saveEditButton" class="primary-action dialog-submit">保存修改</button>
          </div>
        </form>
      </dialog>`);
    $('#closeEditDialog').addEventListener('click', () => $('#editPlaceDialog').close());
    $('#editPlaceForm').addEventListener('submit', saveEdit);
  }

  function openEditor(id) {
    if (!hasKey()) return showToast('请先设置管理员密钥');
    const shop = shopIndex.get(String(id));
    if (!shop) return showToast('找不到这个地点');
    const form = $('#editPlaceForm');
    form.dataset.shopId = shop.id;
    const fields = ['google_maps', 'apple_maps', 'name', 'address', 'region', 'district', 'latitude', 'longitude', 'category', 'source', 'notes', 'city', 'country'];
    fields.forEach(field => {
      if (form.elements[field]) form.elements[field].value = shop[field] ?? '';
    });
    $('#editPlaceDialog').showModal();
  }

  async function saveEdit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('#saveEditButton');
    const data = Object.fromEntries(new FormData(form).entries());
    data.id = form.dataset.shopId;
    data.latitude = Number(data.latitude);
    data.longitude = Number(data.longitude);
    data.active = true;
    data.status = shopIndex.get(String(data.id))?.status || '想去';
    const mapRule = window.CoffeeMapCities?.applyMapProviderRule(data, data.city) || { requiredField: 'google_maps' };
    if (!data[mapRule.requiredField] || mapRule.valid === false) return showToast('请填写当前城市指定的有效地图链接');
    button.disabled = true;
    button.textContent = '正在保存…';
    try {
      const payload = await post('update', data);
      shopIndex.set(String(payload.shop.id), payload.shop);
      window.CoffeeMapData?.upsert(payload.shop);
      $('#editPlaceDialog').close();
      showToast('地点资料已更新');
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = '保存修改';
    }
  }

  async function archiveShop(id) {
    const shop = shopIndex.get(String(id));
    if (!shop) return showToast('找不到这个地点');
    if (!confirm(`确定删除“${shop.name}”吗？\n\n该地点会从地图隐藏，但仍可在 Google Sheet 中将 active 改回 TRUE 恢复。`)) return;
    try {
      await post('archive', { id: String(id) });
      window.CoffeeMapData?.remove(String(id));
      showToast('地点已删除');
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function post(action, data) {
    const adminKey = localStorage.getItem(KEY_STORAGE) || '';
    if (!adminKey) throw new Error('请先设置管理员密钥');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, adminKey, data }),
      redirect: 'follow'
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || '云端操作失败');
    return payload;
  }

  function bindSettingsEvents() {
    $('#refreshButton')?.addEventListener('click', () => refreshShopIndex({ force: true }));
    $('#saveAdminKeyButton')?.addEventListener('click', () => setTimeout(() => {
      enhanceRows();
      refreshShopIndex();
    }, 50));
    $('#clearAdminKeyButton')?.addEventListener('click', () => setTimeout(enhanceRows, 50));
    $$('.nav-item').forEach(button => button.addEventListener('click', () => closeSwipeRows()));
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('.swipe-row')) closeSwipeRows();
    }, { passive: true });
  }

  function showToast(text) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
})();
