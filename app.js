
let ITEMS = [];
let map, clusterer, userPos = null;
let favoritesFilterActive = false; // Track favorites filter state
const THEME_KEY = 'theme';
const REBEL_KEY = 'rebel_mode';

// Debounce helper to avoid excessive re-renders on rapid inputs
const debounce = (fn, wait = 150) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
};

// Render/animation control
let firstRender = true;

// Distance caching to avoid recomputing Haversine repeatedly
const distanceCache = new Map();
function computeDistance(item) {
  if (!userPos || !item.coords) return 1e9;
  let cached = distanceCache.get(item.id);
  if (cached == null) {
    cached = getDistanceKm(userPos, item.coords);
    distanceCache.set(item.id, cached);
  }
  return cached;
}

// Throttled pins refresh to reduce map churn
let pinsUpdateTimer = null;
function schedulePinsUpdate(filters, items) {
  clearTimeout(pinsUpdateTimer);
  pinsUpdateTimer = setTimeout(() => refreshPins(filters, items), 120);
}

function applyTheme(theme) {
  const safeTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', safeTheme);
  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.checked = safeTheme === 'light';
}

function initTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    const theme = saved || 'dark';
    applyTheme(theme);
  } catch (_) {
    applyTheme('dark');
  }
  const themeToggleEl = document.getElementById('themeToggle');
  if (themeToggleEl) {
    themeToggleEl.addEventListener('change', (e) => {
      const theme = e.target.checked ? 'light' : 'dark';
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    });
  }
}

async function loadItems() {
  const res = await fetch('data/items.json');
  const data = await res.json();
  // ensure only 13+
  ITEMS = data.filter(it => it.age && it.age.min <= 13);
  render();
  
  // Initialize map after Yandex API loads (guard if API failed to load)
  if (window.ymaps && typeof ymaps.ready === 'function') {
    ymaps.ready(setupMap);
  } else {
    initMapWhenReady();
  }
}

function setupMap() {
  if (map) return;
  // Инициализируем Яндекс.Карту
  map = new ymaps.Map('map', {
    center: [41.715, 44.79], // Тбилиси [lat, lng]
    zoom: 12,
    controls: ['zoomControl', 'typeSelector', 'fullscreenControl']
  });
  
  // Создаем кластеризатор для маркеров
  clusterer = new ymaps.Clusterer({
    preset: 'islands#invertedVioletClusterIcons',
    groupByCoordinates: false,
    clusterDisableClickZoom: false,
    clusterHideIconOnBalloonOpen: false,
    geoObjectHideIconOnBalloonOpen: false
  });
  
  map.geoObjects.add(clusterer);
  
  refreshPins(getFilters());
}

function getDistanceKm(a, b){
  if(!a || !b) return null;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI/180;
  const dLon = (b.lng - a.lng) * Math.PI/180;
  const s1 = Math.sin(dLat/2), s2 = Math.sin(dLon/2);
  const aa = s1*s1 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*s2*s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
  return R * c;
}

function render(){
  showLoadingAnimation();
  const list = document.getElementById('list');
  const filters = getFilters();
  const onlineLabelEl = document.querySelector('.switch-label');
  if (onlineLabelEl) onlineLabelEl.classList.toggle('on', filters.onlineOnly);
  const items = applyFilters(filters);
  list.innerHTML = `<div class="list-meta" id="listMeta"></div>`;
  const frag = document.createDocumentFragment();
  const metaEl = document.getElementById('listMeta');
  if (metaEl) metaEl.textContent = `Показано ${items.length} из ${ITEMS.length}`;
  console.log(`Rendered ${items.length} of ${ITEMS.length}`);
  
  // Add animation delay for cards
  let animationDelay = 0;
  items.forEach((it, index) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.animationDelay = `${animationDelay}ms`;
    animationDelay += 50;
    const dist = userPos && it.coords ? computeDistance(it) : null;
    const km = dist!=null ? ` • ${dist.toFixed(1)} км` : '';
    const isLiked = isItemLiked(it.id);
    div.innerHTML = `
      <div class="card-header">
        <strong>${it.title}</strong>
        ${index < 3 ? '<span class="hot-badge">🔥 HOT</span>' : ''}
      </div>
      <div class="card-description">${it.blurb}</div>
      <div class="badges">
        <span class="badge ${it.type==='online'?'badge-online':'badge-offline'}">
          ${it.type==='online'?'🌐 Онлайн':'📍 Оффлайн'}
        </span>
        <span class="badge badge-age">🎂 ${it.age.min}–${it.age.max} лет</span>
        ${renderLanguages(it.languages)}
        ${(it.categories||[]).map(c=>`<span class="badge">#${c}</span>`).join('')}
      </div>
      <div class="card-location">${it.address || 'Онлайн-формат'} ${km}</div>
      <div class="actions">
        ${renderLinks(it.links)}
        <button class="like ${isLiked ? 'liked' : ''}" data-id="${it.id}">
          ${isLiked ? '♥' : '♡'}
        </button>
      </div>
    `;
    div.querySelector('.like').onclick = (e) => {
      e.stopPropagation();
      toggleLike(it.id);
      e.target.classList.toggle('liked');
      e.target.textContent = e.target.classList.contains('liked') ? '♥' : '♡';
    };
    
    // Add click handler to show location on map
    div.onclick = () => {
      if (it.coords) {
        showItemOnMap(it);
      }
    };
    
    frag.appendChild(div);
  });
  list.appendChild(frag);
  schedulePinsUpdate(filters, items);
  // Обновляем счётчик с учётом возможного скрытия карточек поиском
  updateListMetaVisible();
  // Disable costly enter animations after initial render
  list.classList.toggle('no-anim', !firstRender);
  firstRender = false;
  hideLoadingAnimation();
}

function renderLinks(links){
  if(!links) return '';
  const entries = Object.entries(links);
  return entries.map(([k,v])=>iconButtonHtml(k, v)).join('');
}

function renderLanguages(languages) {
  if (!languages || !languages.length) return '';
  const langEmojis = { 'ru': '🇷🇺', 'en': '🇺🇸', 'ge': '🇬🇪' };
  const langNames = { 'ru': 'Русский', 'en': 'English', 'ge': 'ქართული' };
  return languages.map(lang => `<span class="language-badge">${langEmojis[lang] || ''} ${langNames[lang] || lang}</span>`).join('');
}
function labelFor(k){
  const map = {
    site:'Открыть сайт',
    about:'Подробнее',
    map:'Открыть карту',
    discord:'Discord',
    facebook:'Facebook',
    instagram:'Instagram',
    telegram:'Telegram',
    youtube:'YouTube',
    tiktok:'TikTok',
    whatsapp:'WhatsApp',
    list:'Список',
    meetup:'Meetup'
  };
  return map[k] || 'Открыть';
}

function iconFor(k){
  const map = {
    site:'fa-solid fa-globe',
    about:'fa-solid fa-circle-info',
    map:'fa-solid fa-map-location-dot',
    discord:'fa-brands fa-discord',
    facebook:'fa-brands fa-facebook',
    instagram:'fa-brands fa-instagram',
    telegram:'fa-brands fa-telegram',
    youtube:'fa-brands fa-youtube',
    tiktok:'fa-brands fa-tiktok',
    whatsapp:'fa-brands fa-whatsapp',
    list:'fa-solid fa-list',
    meetup:'fa-brands fa-meetup'
  };
  return map[k] || 'fa-solid fa-up-right-from-square';
}

function iconButtonHtml(key, url){
  const title = labelFor(key);
  const icon = iconFor(key);
  const typeClass = `icon-${key}`;
  return `<a class="btn btn-icon ${typeClass}" href="${url}" target="_blank" rel="noopener" title="${title}"><i class="${icon}"></i></a>`;
}

function getFilters(){
  const onlineOnly = document.getElementById('onlineToggle').checked;
  const favoritesOnly = favoritesFilterActive; // Use variable instead of CSS class
  const dist = Number(document.getElementById('distance').value);
  const chips = [...document.querySelectorAll('.chip.active[data-tag]')].map(x=>x.dataset.tag);
  const languages = [...document.querySelectorAll('.chip.active[data-language]')].map(x=>x.dataset.language);
  
  
  return { onlineOnly, favoritesOnly, dist, chips, languages };
}

function applyFilters({onlineOnly, favoritesOnly, dist, chips, languages}){
  let res = ITEMS.slice();
  
  if(onlineOnly){
    res = res.filter(it => it.type === 'online');
  }
  if(favoritesOnly){
    const likedIds = getLikedIds();
    res = res.filter(it => likedIds.has(it.id));
  }
  if(chips.length){
    res = res.filter(it => chips.some(tag => (it.categories||[]).some(c=>c.includes(tag))));
  }
  if(languages.length){
    res = res.filter(it => languages.some(lang => (it.languages||[]).includes(lang)));
  }
  if(userPos && dist>0){
    res = res.filter(it => it.coords && computeDistance(it) <= dist);
  }
  // sort by distance if available
  res.sort((a,b)=> computeDistance(a) - computeDistance(b));
  return res;
}

function refreshPins(filters, items = null) {
  if (!map || !clusterer) return;
  
  clusterer.removeAll();
  const list = items || applyFilters(filters);
  
  const placemarks = [];
  
  list.forEach(it => {
    if (!it.coords) return;
    
    const iconColor = it.type === 'online' ? '#3b82f6' : '#ff6e6c';
    const iconPreset = it.type === 'online' ? 'islands#blueCircleIcon' : 'islands#redCircleIcon';
    
    const placemark = new ymaps.Placemark(
      [it.coords.lat, it.coords.lng],
      {
        balloonContentHeader: `<strong>${it.title}</strong>`,
        balloonContentBody: `
          <p>${it.blurb}</p>
          <div style="margin: 8px 0;">
            ${renderLanguages(it.languages)}
            <span class="badge ${it.type === 'online' ? 'badge-online' : 'badge-offline'}">
              ${it.type === 'online' ? '🌐 Онлайн' : '📍 Оффлайн'}
            </span>
          </div>
          <div style="margin: 4px 0; color: #666;">
            ${it.address || 'Онлайн-формат'}
          </div>
          <div style="margin: 8px 0;">
            ${renderLinks(it.links)}
          </div>
          <div style="font-size: 12px; color: #888;">
            ${(it.categories || []).map(c => `#${c}`).join(' ')}
          </div>
        `,
        item: it
      },
      {
        preset: iconPreset,
        iconColor: iconColor
      }
    );
    
    placemarks.push(placemark);
  });
  
  clusterer.add(placemarks);
}

function getLikedIds() {
  const key = 'liked_ids';
  return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
}

function isItemLiked(id) {
  return getLikedIds().has(id);
}

function toggleLike(id) {
  const key = 'liked_ids';
  const liked = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  if(liked.has(id)) {
    liked.delete(id);
    showNotification('− Удалено из избранного');
  } else {
    liked.add(id);
    showNotification('✓ Добавлено в избранное!');
  }
  localStorage.setItem(key, JSON.stringify([...liked]));
  
  // Update only the counter, not the entire button
  const counter = document.getElementById('favoritesCount');
  if (counter) {
    counter.textContent = `(${liked.size})`;
  }
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 2000);
}

function showLoadingAnimation() {
  const list = document.getElementById('list');
  if (list.children.length === 0) {
    for (let i = 0; i < 3; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'card loading';
      skeleton.innerHTML = '<div style="height: 200px"></div>';
      list.appendChild(skeleton);
    }
  }
}

function hideLoadingAnimation() {
  const skeletons = document.querySelectorAll('.card.loading');
  skeletons.forEach(skeleton => skeleton.remove());
}

document.getElementById('onlineToggle').addEventListener('change', render);

function initializeFavoritesButton() {
  const favoritesBtn = document.getElementById('favoritesChip');
  if (favoritesBtn) {
    favoritesBtn.addEventListener('click', function() {
      // Toggle the filter state
      favoritesFilterActive = !favoritesFilterActive;
      
      const heartIcon = favoritesFilterActive ? '♥' : '♡';
      const count = getLikedIds().size;
      
      // Update visual appearance
      this.classList.toggle('active', favoritesFilterActive);
      this.innerHTML = `${heartIcon} Избранное <span id="favoritesCount">(${count})</span>`;
      this.style.background = favoritesFilterActive ? 'var(--accent)' : 'rgba(255, 110, 108, 0.15)';
      this.style.color = favoritesFilterActive ? 'var(--bg)' : 'var(--accent)';
      
      // Render immediately
      render();
    });
  }
}

function updateFavoritesCounter() {
  const count = getLikedIds().size;
  const counter = document.getElementById('favoritesCount');
  
  // Just update the counter text, don't touch anything else
  if (counter) {
    counter.textContent = `(${count})`;
  }
  
}
document.getElementById('distance').addEventListener('input', debounce((e)=>{
  const v = Number(e.target.value);
  document.getElementById('distLabel').textContent = v ? `${v} км от меня` : 'весь город';
  render();
}, 150));

async function tryYandexGeolocation() {
  if (!window.ymaps || !ymaps.geolocation) return null;
  try {
    const result = await ymaps.geolocation.get({ provider: 'auto', timeout: 8000 });
    const first = result && result.geoObjects && result.geoObjects.get(0);
    if (!first) return null;
    const coords = first.geometry && first.geometry.getCoordinates && first.geometry.getCoordinates();
    if (!coords || coords.length < 2) return null;
    return { lat: coords[0], lng: coords[1] };
  } catch (_) {
    return null;
  }
}

async function tryIpGeolocation() {
  try {
    const resp = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    const lat = (data && (data.latitude ?? (data.loc ? Number(String(data.loc).split(',')[0]) : null)));
    const lng = (data && (data.longitude ?? (data.loc ? Number(String(data.loc).split(',')[1]) : null)));
    if (typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { lat, lng };
    }
    return null;
  } catch (_) {
    return null;
  }
}
document.getElementById('geoBtn').addEventListener('click', async (e)=>{
  const btn = e.currentTarget;
  btn.classList.add('loading');
  btn.disabled = true;
  const isLocalhost = ['localhost','127.0.0.1','::1'].includes(location.hostname);
  if (!('geolocation' in navigator)) {
    // Try fallbacks immediately if Geolocation API is not present
    const yx = await tryYandexGeolocation();
    if (yx) {
      userPos = yx;
      distanceCache.clear();
      btn.classList.remove('loading');
      btn.disabled = false;
      btn.innerHTML = '<span>✓ Локация (прибл.)</span>';
      showNotification('📍 Приблизительная локация определена по сети');
      render();
      if (map) { map.setCenter([userPos.lat, userPos.lng], 13); }
      return;
    }
    const ip = await tryIpGeolocation();
    if (ip) {
      userPos = ip;
      distanceCache.clear();
      btn.classList.remove('loading');
      btn.disabled = false;
      btn.innerHTML = '<span>✓ Локация (IP)</span>';
      showNotification('📍 Приблизительная локация определена по IP');
      render();
      if (map) { map.setCenter([userPos.lat, userPos.lng], 12); }
      return;
    }
    btn.classList.remove('loading');
    btn.disabled = false;
    alert('Геолокация недоступна в этом браузере');
    return;
  }
  if (!window.isSecureContext && !isLocalhost) {
    btn.classList.remove('loading');
    btn.disabled = false;
    alert('Для определения местоположения открой сайт по HTTPS или запусти локально (localhost).');
    return;
  }
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 300000
      })
    );
    userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    distanceCache.clear();
    btn.classList.remove('loading');
    btn.disabled = false;
    btn.innerHTML = '<span>✓ Локация найдена</span>';
    showNotification('📍 Локация определена!');
    render();
    if (map) {
      map.setCenter([userPos.lat, userPos.lng], 14);
    }
  } catch (err) {
    const yx = await tryYandexGeolocation();
    if (yx) {
      userPos = yx;
      distanceCache.clear();
      btn.classList.remove('loading');
      btn.disabled = false;
      btn.innerHTML = '<span>✓ Локация (прибл.)</span>';
      showNotification('📍 Приблизительная локация определена по сети');
      render();
      if (map) { map.setCenter([userPos.lat, userPos.lng], 13); }
      return;
    }
    const ip = await tryIpGeolocation();
    if (ip) {
      userPos = ip;
      distanceCache.clear();
      btn.classList.remove('loading');
      btn.disabled = false;
      btn.innerHTML = '<span>✓ Локация (IP)</span>';
      showNotification('📍 Приблизительная локация определена по IP');
      render();
      if (map) { map.setCenter([userPos.lat, userPos.lng], 12); }
      return;
    }
    btn.classList.remove('loading');
    btn.disabled = false;
    let msg = 'Не получилось определить местоположение.';
    if (err && typeof err.code === 'number') {
      if (err.code === err.PERMISSION_DENIED) msg = 'Доступ к геолокации запрещён. Разреши доступ в настройках сайта/браузера.';
      else if (err.code === err.POSITION_UNAVAILABLE) msg = 'Не удалось определить позицию. На десктопах помогает включить Wi‑Fi (даже при Ethernet) и отключить VPN.';
      else if (err.code === err.TIMEOUT) msg = 'Геолокация не успела определить позицию. Попробуй ещё раз.';
    }
    alert(msg);
  }
});
document.querySelectorAll('.chip').forEach(btn=>{
  btn.addEventListener('click', ()=>{ 
    btn.classList.toggle('active'); 
    render(); 
  });
});

// Add search functionality
function addSearchBar() {
  const filters = document.getElementById('filters');
  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';
  searchContainer.innerHTML = `
    <input type="text" class="search-input" placeholder="🔍 Поиск по названию или категории..." id="searchInput">
  `;
  filters.insertBefore(searchContainer, filters.firstChild);
  
  document.getElementById('searchInput').addEventListener('input', debounce((e) => {
    const searchTerm = e.target.value.toLowerCase();
    filterBySearch(searchTerm);
  }, 120));
}

function filterBySearch(searchTerm) {
  const cards = document.querySelectorAll('.card');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    if (text.includes(searchTerm)) {
      card.style.display = 'grid';
    } else {
      card.style.display = 'none';
    }
  });
  updateListMetaVisible();
}

// Robust Yandex Maps loader with retry and polling
function initMapWhenReady() {
  if (window.__ymLoaderInit) return; // idempotent
  window.__ymLoaderInit = true;

  const tryInit = () => {
    if (window.ymaps && typeof ymaps.ready === 'function') {
      ymaps.ready(setupMap);
      return true;
    }
    return false;
  };

  if (tryInit()) return;

  const ymScript = document.querySelector('script[src*="api-maps.yandex.ru"]');
  let fallbackTimer = null;

  if (ymScript) {
    const onLoad = () => {
      clearTimeout(fallbackTimer);
      tryInit();
    };
    const onError = () => {
      clearTimeout(fallbackTimer);
      console.warn('Yandex Maps API failed to load; retrying shortly...');
      setTimeout(() => {
        if (!document.querySelector('script[src*="api-maps.yandex.ru"][data-retry="1"]')) {
          const s = document.createElement('script');
          s.src = ymScript.src;
          s.defer = true;
          s.setAttribute('data-retry', '1');
          s.onload = tryInit;
          s.onerror = () => console.warn('Yandex Maps API second attempt failed.');
          document.head.appendChild(s);
        }
      }, 2000);
    };

    ymScript.addEventListener('load', onLoad, { once: true });
    ymScript.addEventListener('error', onError, { once: true });

    // Fallback: if neither load nor error fired, try a single duplicate after delay
    fallbackTimer = setTimeout(() => {
      if (!window.ymaps && !document.querySelector('script[src*="api-maps.yandex.ru"][data-retry="1"]')) {
        const s = document.createElement('script');
        s.src = ymScript.src;
        s.defer = true;
        s.setAttribute('data-retry', '1');
        s.onload = tryInit;
        document.head.appendChild(s);
      }
    }, 2500);
  }

  // Safety polling to catch when ymaps becomes available
  let checks = 0;
  const id = setInterval(() => {
    if (tryInit() || ++checks > 50) clearInterval(id);
  }, 200);
}

// Initialize
loadItems();
initMapWhenReady();
setTimeout(addSearchBar, 100);
setTimeout(() => {
  updateFavoritesCounter();
  initializeFavoritesButton();
}, 200);

// Initialize theme as soon as possible
document.addEventListener('DOMContentLoaded', initTheme);
document.addEventListener('DOMContentLoaded', initRebelMode);


function showItemOnMap(item) {
  if (!item.coords || !map) return;
  
  // Центрируем карту на точке с анимацией
  map.setCenter([item.coords.lat, item.coords.lng], 16, {
    duration: 800
  });
  
  // Находим соответствующий маркер и открываем его балун
  setTimeout(() => {
    clusterer.each((placemark) => {
      if (placemark.properties.get('item') && placemark.properties.get('item').id === item.id) {
        placemark.balloon.open();
        return false; // прерываем цикл
      }
    });
  }, 400);
}

function updateListMetaVisible() {
  const metaEl = document.getElementById('listMeta');
  if (!metaEl) return;
  const all = ITEMS.length;
  const visible = [...document.querySelectorAll('#list .card')].filter(el => el.style.display !== 'none').length;
  metaEl.textContent = `Показано ${visible} из ${all}`;
}

function applyRebelMode(isOn) {
  const root = document.documentElement;
  if (isOn) {
    root.classList.add('rebel');
  } else {
    root.classList.remove('rebel');
  }
  const btn = document.getElementById('rebelToggle');
  if (btn) btn.setAttribute('aria-pressed', String(!!isOn));
}

function initRebelMode() {
  try {
    const saved = localStorage.getItem(REBEL_KEY);
    const isOn = saved ? saved === '1' : true;
    applyRebelMode(isOn);
  } catch (_) {
    applyRebelMode(true);
  }
  const toggleEl = document.getElementById('rebelToggle');
  if (toggleEl) {
    toggleEl.addEventListener('click', () => {
      const nowOn = !(document.documentElement.classList.contains('rebel'));
      applyRebelMode(nowOn);
      try { localStorage.setItem(REBEL_KEY, nowOn ? '1' : '0'); } catch (_) {}
      updateMicrocopyForRebel(nowOn);
    });
  }
  // Initial microcopy state
  updateMicrocopyForRebel(document.documentElement.classList.contains('rebel'));
}

function updateMicrocopyForRebel(isOn) {
  const titleEl = document.querySelector('header h1');
  const pEl = document.querySelector('header p');
  if (!titleEl || !pEl) return;
  if (isOn) {
    titleEl.textContent = 'Найди свою тусовку. Или создай свою.';
    pEl.textContent = 'Нормально — скучно. Лови места, комьюнити и движ, где можно быть собой, громко и без извинений.';
  } else {
    titleEl.textContent = 'Найди свою тусовку в Тбилиси';
    pEl.textContent = 'Крутые секции, кружки и онлайн-сообщества для подростков 13-18 лет. Выбирай что нравится и сохраняй в избранное!';
  }
}
