(() => {
  'use strict';
  const STORAGE_KEY = 'hk-coffee-map-v1';
  const STATUS_KEY = 'hk-coffee-status-v1';
  const DEFAULT_CENTER = [114.1588, 22.2857];
  const REGION_BY_DISTRICT = {
    '铜锣湾':'港岛','大坑':'港岛','中环':'港岛','石塘咀':'港岛','跑马地':'港岛','坚尼地城':'港岛','北角':'港岛','西营盘':'港岛','上环':'港岛','湾仔':'港岛',
    '黄埔':'九龙','旺角':'九龙','太子':'九龙','深水埗':'九龙','大角咀':'九龙','土瓜湾':'九龙','尖沙咀':'九龙','大澳':'离岛'
  };
  let customShops = loadJson(STORAGE_KEY, []);
  let statusMap = loadJson(STATUS_KEY, {});
  let shops = hydrateShops();
  let filtered = [...shops];
  let activeRegion = '全部';
  let activeDistrict = '全部';
  let activeView = 'map';
  let selectedId = null;
  let markers = new Map();
  let toastTimer;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const els = {
    search: $('#searchInput'), clearSearch: $('#clearSearch'), resultCount: $('#resultCount'), allCount: $('#allCount'),
    list: $('#shopList'), detailSheet: $('#detailSheet'), districtSheet: $('#districtSheet'), districtList: $('#districtList'),
    menuSheet: $('#menuSheet'), addDialog: $('#addDialog'), addForm: $('#addForm'), toast: $('#toast')
  };

  let map = null;
  if (!window.maplibregl) {
    document.getElementById('map').innerHTML = '<div class="map-error"><strong>地图组件未能载入</strong><span>请检查网络连接后刷新；你仍可切换到列表并使用搜索、筛选和数据管理。</span></div>';
  } else {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: DEFAULT_CENTER,
      zoom: 11.25,
      minZoom: 9,
      maxZoom: 19,
      attributionControl: true
    });
    map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
    map.on('error', (event) => {
      if (event?.error?.message) console.warn('Map error:', event.error.message);
    });
    map.on('load', () => {
      renderMarkers();
      fitTo(filtered, false);
    });
  }

  function hydrateShops(){
    return [...window.COFFEE_SHOPS, ...customShops].map(s => ({...s, status: statusMap[s.id] || s.status || '想去'}));
  }
  function loadJson(key, fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(customShops)); localStorage.setItem(STATUS_KEY, JSON.stringify(statusMap)); }
  function normalize(v){ return String(v || '').trim().toLowerCase(); }
  function deriveRegion(district){ return REGION_BY_DISTRICT[district] || '其他'; }

  function renderMarkers(){
    if (!map) return;
    markers.forEach(marker => marker.remove()); markers.clear();
    filtered.forEach(shop => {
      const node = document.createElement('button');
      node.type = 'button'; node.className = 'marker-hit';
      node.title = shop.name; node.setAttribute('aria-label', shop.name);
      node.innerHTML = `<span class="coffee-marker${shop.isCustom ? ' custom' : ''}${selectedId === shop.id ? ' selected' : ''}"></span>`;
      node.addEventListener('click', (e) => { e.stopPropagation(); selectShop(shop.id, true); });
      const marker = new maplibregl.Marker({element: node, anchor:'bottom'}).setLngLat([shop.lng, shop.lat]).addTo(map);
      markers.set(shop.id, marker);
    });
  }

  function renderList(){
    els.resultCount.textContent = filtered.length;
    els.allCount.textContent = shops.length;
    if (!filtered.length){ els.list.innerHTML = '<div class="empty-state">没有符合当前条件的咖啡店</div>'; return; }
    els.list.innerHTML = filtered.map(s => `
      <button class="shop-card" data-shop-id="${escapeHtml(s.id)}">
        <h3>${escapeHtml(s.name)}</h3>
        <p><span class="area">${escapeHtml(s.district)}</span>${escapeHtml(s.address)}</p>
      </button>`).join('');
    els.list.querySelectorAll('[data-shop-id]').forEach(el => el.addEventListener('click', () => selectShop(el.dataset.shopId, true)));
  }

  function applyFilters({fit=false}={}){
    const q = normalize(els.search.value);
    filtered = shops.filter(s => {
      const regionOK = activeRegion === '全部' || s.region === activeRegion;
      const districtOK = activeDistrict === '全部' || s.district === activeDistrict;
      const searchOK = !q || [s.name,s.address,s.district,s.region,s.notes,s.status].some(v => normalize(v).includes(q));
      const savedOK = activeView !== 'saved' || s.status === '优先去';
      return regionOK && districtOK && searchOK && savedOK;
    });
    renderList(); if (map?.loaded()) renderMarkers(); if (fit) fitTo(filtered, true);
  }

  function fitTo(items, animate=true){
    if (!map || !items.length) return;
    if (items.length === 1){ map.flyTo({center:[items[0].lng,items[0].lat],zoom:15.5,essential:true}); return; }
    const bounds = new maplibregl.LngLatBounds(); items.forEach(s => bounds.extend([s.lng,s.lat]));
    map.fitBounds(bounds,{padding:{top:190,bottom:130,left:35,right:35},maxZoom:14,duration:animate?700:0});
  }

  function selectShop(id, moveMap){
    const shop = shops.find(s => s.id === id); if (!shop) return;
    selectedId = id;
    if (moveMap && map) map.flyTo({center:[shop.lng,shop.lat],zoom:15.6,offset:[0,-90],essential:true});
    markers.forEach((m,key) => m.getElement().querySelector('.coffee-marker')?.classList.toggle('selected', key === id));
    $('#detailRegion').textContent = shop.region; $('#detailDistrict').textContent = shop.district;
    $('#detailName').textContent = shop.name; $('#detailAddress').textContent = shop.address;
    const notes = $('#detailNotes'); notes.textContent = shop.notes || ''; notes.classList.toggle('visible', !!shop.notes);
    $('#googleMapsButton').href = shop.googleMaps || googleSearchUrl(shop);
    $('#appleMapsButton').href = shop.appleMaps || `https://maps.apple.com/?q=${encodeURIComponent(shop.name)}&ll=${shop.lat},${shop.lng}`;
    $$('.status-button').forEach(b => b.classList.toggle('active', b.dataset.status === shop.status));
    openSheet(els.detailSheet);
  }

  function openSheet(el){ el.classList.add('open'); el.setAttribute('aria-hidden','false'); }
  function closeSheet(el){ el.classList.remove('open'); el.setAttribute('aria-hidden','true'); }
  function googleSearchUrl(s){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.name} ${s.address}`)}`; }
  function escapeHtml(v){ return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function showToast(text){ clearTimeout(toastTimer); els.toast.textContent=text; els.toast.classList.add('show'); toastTimer=setTimeout(()=>els.toast.classList.remove('show'),2200); }

  function renderDistricts(){
    const counts = shops.reduce((acc,s)=>(acc[s.district]=(acc[s.district]||0)+1,acc),{});
    const districts = Object.keys(counts).sort((a,b)=>a.localeCompare(b,'zh-Hans'));
    els.districtList.innerHTML = `<button class="district-option ${activeDistrict==='全部'?'active':''}" data-district="全部">全部地区</button>` + districts.map(d => `<button class="district-option ${activeDistrict===d?'active':''}" data-district="${escapeHtml(d)}">${escapeHtml(d)} · ${counts[d]}</button>`).join('');
    els.districtList.querySelectorAll('[data-district]').forEach(b => b.addEventListener('click',()=>{
      activeDistrict=b.dataset.district; $('#districtButton').classList.toggle('active',activeDistrict!=='全部'); $('#districtButton').firstChild.textContent=activeDistrict==='全部'?'具体地区 ':activeDistrict+' ';
      closeSheet(els.districtSheet); applyFilters({fit:true}); renderDistricts();
    }));
  }

  $('#regionFilters').addEventListener('click', e => {
    const b=e.target.closest('[data-region]'); if(!b)return;
    activeRegion=b.dataset.region; $$('#regionFilters [data-region]').forEach(x=>x.classList.toggle('active',x===b));
    applyFilters({fit:true});
  });
  $('#districtButton').addEventListener('click',()=>{renderDistricts();openSheet(els.districtSheet)});
  els.search.addEventListener('input',()=>{els.clearSearch.classList.toggle('visible',!!els.search.value);applyFilters()});
  els.clearSearch.addEventListener('click',()=>{els.search.value='';els.clearSearch.classList.remove('visible');applyFilters({fit:true});els.search.focus()});
  $('#fitButton').addEventListener('click',()=>fitTo(filtered,true));

  $$('.nav-item').forEach(b=>b.addEventListener('click',()=>{
    activeView=b.dataset.view; $$('.nav-item').forEach(x=>x.classList.toggle('active',x===b));
    document.body.classList.toggle('list-view',activeView==='list'); document.body.classList.toggle('saved-view',activeView==='saved');
    applyFilters(); if (map) setTimeout(()=>map.resize(),60);
  }));

  $('#locateButton').addEventListener('click',()=>{
    if(!map){showToast('地图尚未载入');return}
    if(!navigator.geolocation){showToast('当前浏览器不支持定位');return}
    navigator.geolocation.getCurrentPosition(p=>map.flyTo({center:[p.coords.longitude,p.coords.latitude],zoom:14.5,essential:true}),()=>showToast('无法取得当前位置'),{enableHighAccuracy:true,timeout:8000});
  });
  $('#addButton').addEventListener('click',()=>els.addDialog.showModal());
  $('#closeAddDialog').addEventListener('click',()=>els.addDialog.close());
  $('#useMapCenter').addEventListener('click',()=>{if(!map){showToast('地图尚未载入');return}const c=map.getCenter();els.addForm.elements.lat.value=c.lat.toFixed(7);els.addForm.elements.lng.value=c.lng.toFixed(7);showToast('已填入地图中心坐标')});

  els.addForm.addEventListener('submit',e=>{
    e.preventDefault(); const fd=new FormData(els.addForm); const name=String(fd.get('name')).trim(); const district=String(fd.get('district')).trim();
    const lat=Number(fd.get('lat')),lng=Number(fd.get('lng')); if(!name||!district||!Number.isFinite(lat)||!Number.isFinite(lng)){showToast('请填写完整信息');return}
    const shop={id:`custom-${Date.now()}`,name,district,region:deriveRegion(district),address:String(fd.get('address')).trim(),lat,lng,googleMaps:String(fd.get('googleMaps')).trim(),appleMaps:'',status:'想去',source:'手动添加',notes:String(fd.get('notes')).trim(),isCustom:true};
    if(!shop.googleMaps) shop.googleMaps=googleSearchUrl(shop);
    customShops.push(shop); persist(); shops=hydrateShops(); els.addForm.reset(); els.addDialog.close(); renderDistricts(); applyFilters(); selectShop(shop.id,true); showToast('已添加到收藏地图');
  });

  $$('.status-button').forEach(b=>b.addEventListener('click',()=>{
    if(!selectedId)return; statusMap[selectedId]=b.dataset.status; persist(); shops=hydrateShops(); applyFilters(); selectShop(selectedId,false); showToast(`已标记为“${b.dataset.status}”`);
  }));

  $('#menuButton').addEventListener('click',()=>openSheet(els.menuSheet));
  $$('[data-close-sheet]').forEach(x=>x.addEventListener('click',()=>closeSheet(els.detailSheet)));
  $$('[data-close-district]').forEach(x=>x.addEventListener('click',()=>closeSheet(els.districtSheet)));
  $$('[data-close-menu]').forEach(x=>x.addEventListener('click',()=>closeSheet(els.menuSheet)));

  $('#exportJsonButton').addEventListener('click',()=>download('香港咖啡地图-备份.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),customShops,statusMap},null,2),'application/json'));
  $('#exportCsvButton').addEventListener('click',()=>{
    const headers=['Name','District','Region','Address','Latitude','Longitude','Status','Google Maps','Apple Maps','Notes'];
    const lines=[headers,...shops.map(s=>[s.name,s.district,s.region,s.address,s.lat,s.lng,s.status,s.googleMaps,s.appleMaps,s.notes])].map(row=>row.map(csvCell).join(','));
    download('香港咖啡地图.csv','\ufeff'+lines.join('\n'),'text/csv;charset=utf-8');
  });
  function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
  function download(name,content,type){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);showToast('文件已导出')}

  $('#importInput').addEventListener('change',async e=>{
    const f=e.target.files[0]; if(!f)return;
    try{const data=JSON.parse(await f.text()); if(!Array.isArray(data.customShops)||typeof data.statusMap!=='object')throw new Error(); customShops=data.customShops;statusMap=data.statusMap;persist();shops=hydrateShops();renderDistricts();applyFilters({fit:true});closeSheet(els.menuSheet);showToast('备份已导入')}catch{showToast('无法识别此备份文件')} e.target.value='';
  });
  $('#resetButton').addEventListener('click',()=>{
    if(!confirm('确定清除本机新增的咖啡店和所有状态吗？初始 36 家仍会保留。'))return;
    customShops=[];statusMap={};persist();shops=hydrateShops();activeDistrict='全部';renderDistricts();applyFilters({fit:true});closeSheet(els.menuSheet);showToast('本机新增数据已清除');
  });

  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  renderDistricts(); renderList();
})();
