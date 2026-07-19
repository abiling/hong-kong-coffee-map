(() => {
  'use strict';

  const CITY_KEY = 'coffee-map-active-city-v1';
  const API_MARKER = 'script.google.com/macros/s/AKfycby0EnuIMDygemCzD522FkMgdYylRcr-UZef_KZUuiboBa5kT73PpDXrdHK8nqoAlsgxVg/exec';
  const CITIES = {
    'Hong Kong': {
      country: 'Hong Kong',
      label: 'Hong Kong',
      center: [114.1588, 22.2857],
      regions: ['港岛', '九龙', '新界', '离岛']
    },
    Tokyo: {
      country: 'Japan',
      label: 'Tokyo',
      center: [139.6917, 35.6895],
      regions: ['千代田区','中央区','港区','新宿区','文京区','台东区','墨田区','江东区','品川区','目黑区','大田区','世田谷区','涩谷区','中野区','杉并区','丰岛区','北区','荒川区','板桥区','练马区','足立区','葛饰区','江户川区']
    }
  };

  const activeCity = CITIES[localStorage.getItem(CITY_KEY)] ? localStorage.getItem(CITY_KEY) : 'Hong Kong';
  const nativeFetch = window.fetch.bind(window);

  function inferCity(place = {}) {
    if (CITIES[place.city]) return place.city;
    const lat = Number(place.latitude);
    const lng = Number(place.longitude);
    const address = String(place.address || '');
    if ((lat >= 35.45 && lat <= 35.95 && lng >= 139.35 && lng <= 140.10) || /Tokyo|東京都|东京/i.test(address)) return 'Tokyo';
    return 'Hong Kong';
  }

  function inferTokyoRegion(address = '') {
    const text = String(address);
    const aliases = {
      '千代田区':['千代田区','Chiyoda'], '中央区':['中央区','Chuo'], '港区':['港区','Minato'], '新宿区':['新宿区','Shinjuku'],
      '文京区':['文京区','Bunkyo'], '台东区':['台東区','台东区','Taito'], '墨田区':['墨田区','Sumida'], '江东区':['江東区','江东区','Koto'],
      '品川区':['品川区','Shinagawa'], '目黑区':['目黒区','目黑区','Meguro'], '大田区':['大田区','Ota'], '世田谷区':['世田谷区','Setagaya'],
      '涩谷区':['渋谷区','涩谷区','Shibuya'], '中野区':['中野区','Nakano'], '杉并区':['杉並区','杉并区','Suginami'], '丰岛区':['豊島区','丰岛区','Toshima'],
      '北区':['北区','Kita'], '荒川区':['荒川区','Arakawa'], '板桥区':['板橋区','板桥区','Itabashi'], '练马区':['練馬区','练马区','Nerima'],
      '足立区':['足立区','Adachi'], '葛饰区':['葛飾区','葛饰区','Katsushika'], '江户川区':['江戸川区','江户川区','Edogawa']
    };
    return Object.keys(aliases).find(region => aliases[region].some(alias => text.toLowerCase().includes(alias.toLowerCase()))) || '待确认';
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const requestUrl = String(args[0]?.url || args[0] || '');
    if (!requestUrl.includes(API_MARKER)) return response;
    try {
      const clone = response.clone();
      const payload = await clone.json();
      if (Array.isArray(payload.shops)) {
        payload.shops = payload.shops.map(shop => {
          const city = inferCity(shop);
          return { ...shop, city, country: shop.country || CITIES[city].country };
        }).filter(shop => shop.city === activeCity);
        payload.count = payload.shops.length;
      }
      if (payload.place) {
        const city = inferCity(payload.place);
        payload.place.city = city;
        payload.place.country = CITIES[city].country;
        if (city === 'Tokyo') payload.place.region = inferTokyoRegion(payload.place.address);
      }
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (_) {
      return response;
    }
  };

  function renderRegionRail() {
    const rail = document.querySelector('#regionFilters');
    if (!rail) return;
    const regions = CITIES[activeCity].regions;
    rail.innerHTML = `<button class="chip active" data-region="全部">全部 <span id="allCount">—</span></button>` +
      regions.map(region => `<button class="chip" data-region="${region}">${region}</button>`).join('') +
      '<button class="chip district-chip" id="districtButton">具体地区 <span>⌄</span></button>';
  }

  function fillRegionSelect(select, city, selected = '') {
    if (!select) return;
    const options = CITIES[city]?.regions || [];
    select.innerHTML = '<option value="">请选择</option>' + options.map(region => `<option value="${region}">${region}</option>`).join('');
    if (selected && !options.includes(selected)) select.insertAdjacentHTML('beforeend', `<option value="${selected}">${selected}</option>`);
    select.value = selected || '';
  }

  function setupAddForm() {
    const form = document.querySelector('#addForm');
    if (!form) return;
    const citySelect = form.elements.city;
    const countryInput = form.elements.country;
    const regionSelect = form.elements.region;
    if (citySelect) citySelect.value = activeCity;
    if (countryInput) countryInput.value = CITIES[activeCity].country;
    fillRegionSelect(regionSelect, activeCity, regionSelect?.value || '');
    citySelect?.addEventListener('change', () => {
      const city = citySelect.value;
      if (countryInput) countryInput.value = CITIES[city].country;
      fillRegionSelect(regionSelect, city);
    });
    const parseState = document.querySelector('#parseState');
    if (parseState) new MutationObserver(() => {
      if (!parseState.classList.contains('success')) return;
      const city = inferCity({
        latitude: form.elements.latitude?.value,
        longitude: form.elements.longitude?.value,
        address: form.elements.address?.value
      });
      if (citySelect) citySelect.value = city;
      if (countryInput) countryInput.value = CITIES[city].country;
      const inferredRegion = city === 'Tokyo' ? inferTokyoRegion(form.elements.address?.value) : form.elements.region?.value;
      fillRegionSelect(regionSelect, city, inferredRegion);
    }).observe(parseState, { childList: true, attributes: true, subtree: true });
  }

  function setupCitySheet() {
    const button = document.querySelector('#cityButton');
    const sheet = document.querySelector('#citySheet');
    const list = document.querySelector('#cityList');
    if (!button || !sheet || !list) return;
    button.querySelector('[data-city-label]').textContent = CITIES[activeCity].label;
    list.innerHTML = Object.keys(CITIES).map(city => `<button class="city-option${city === activeCity ? ' active' : ''}" data-city="${city}"><span>${CITIES[city].label}</span><b>${city === activeCity ? '✓' : ''}</b></button>`).join('');
    button.addEventListener('click', () => {
      sheet.classList.add('open');
      sheet.setAttribute('aria-hidden', 'false');
    });
    sheet.querySelectorAll('[data-close-city]').forEach(node => node.addEventListener('click', () => {
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden', 'true');
    }));
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-city]');
      if (!option) return;
      localStorage.setItem(CITY_KEY, option.dataset.city);
      location.reload();
    });
  }

  renderRegionRail();
  document.documentElement.dataset.city = activeCity === 'Tokyo' ? 'tokyo' : 'hong-kong';
  document.title = `${CITIES[activeCity].label} · Coffee Shops`;
  document.addEventListener('DOMContentLoaded', () => {
    setupCitySheet();
    setupAddForm();
  });
})();