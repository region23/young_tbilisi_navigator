
let ITEMS = [];
let map, clusterer, userPos = null;
let favoritesFilterActive = false; // Track favorites filter state
const THEME_KEY = 'theme';
const REBEL_KEY = 'rebel_mode';

// Gamification system
let userStats = {
  placesViewed: 0,
  categoriesExplored: new Set(),
  achievementsUnlocked: new Set(),
  sessionStartTime: Date.now()
};

const ACHIEVEMENTS = {
  'explorer': { name: 'Исследователь', desc: 'Посмотрел 10+ мест', emoji: '🔍', threshold: 10 },
  'social': { name: 'Общительный', desc: 'Изучил места для знакомств', emoji: '🦋', categories: ['социум'] },
  'creative': { name: 'Креативный', desc: 'Нашел творческие активности', emoji: '🎨', categories: ['творчество'] },
  'gamer': { name: 'Геймер', desc: 'Обнаружил игровые тусовки', emoji: '🎮', categories: ['игры'] },
  'polyglot': { name: 'Полиглот', desc: 'Заинтересовался языками', emoji: '🗣️', categories: ['языки'] },
  'athlete': { name: 'Атлет', desc: 'Выбрал активный образ жизни', emoji: '💪', categories: ['спорт'] },
  'first_like': { name: 'Первый лайк', desc: 'Добавил место в избранное', emoji: '💖', threshold: 1 },
  'collector': { name: 'Коллекционер', desc: 'Собрал 5+ лайков', emoji: '⭐', threshold: 5 }
};

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
  // Teen-safe: include only activities overlapping with 13–18 or explicitly tagged as teen
  ITEMS = data.filter(it => {
    const age = it.age || {};
    const min = Number.isFinite(age.min) ? age.min : null;
    const max = Number.isFinite(age.max) ? age.max : null;
    const overlapsTeen = (min === null && max === null) ? false : ((min ?? -Infinity) <= 18 && (max ?? Infinity) >= 13);
    const teenTag = (it.categories || []).some(c => /подрост|teen|тин/i.test(String(c)));
    return overlapsTeen || teenTag;
  });
  console.log(`Loaded ${ITEMS.length} teen-friendly from ${data.length} total`);
  render();
  
  // Initialize map after Yandex API loads (guard if API failed to load)
  if (window.ymaps && typeof ymaps.ready === 'function') {
    ymaps.ready(setupMap);
  } else {
    initMapWhenReady();
  }

  // Dispatch custom event so dynamic chips can be built
  try {
    document.dispatchEvent(new Event('itemsLoaded'));
  } catch (_) {}
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
  const chipsContainer = document.getElementById('categoryChips');
  if (chipsContainer && !chipsContainer.children.length) {
    try { buildCategoryChips(); } catch (_) {}
  }
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
        ${index < 3 ? '<span class="hot-badge">🔥 Популярно</span>' : ''}
      </div>
      <div class="card-description">${it.blurb}</div>
      <div class="badges">
        <span class="badge ${it.type==='online'?'badge-online':'badge-offline'}">
          ${it.type==='online'?'🌐 Онлайн':'📍 Офлайн'}
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
      const wasLiked = e.target.classList.contains('liked');
      toggleLike(it.id);
      e.target.classList.toggle('liked');
      e.target.textContent = e.target.classList.contains('liked') ? '♥' : '♡';
      
      // Track gamification
      trackFavoriteToggle(!wasLiked);
    };
    
    // Add click handler to show location on map
    div.onclick = () => {
      // Track place view for gamification
      trackPlaceView(it);
      
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
  const vibes = [...document.querySelectorAll('.personality-chip.active[data-vibe]')].map(x=>x.dataset.vibe);
  
  return { onlineOnly, favoritesOnly, dist, chips, languages, vibes };
}

// Mapping of activity categories to personality vibes
const VIBE_MAPPING = {
  'introvert': ['программирование', 'it', 'искусство', 'студия', 'рисование', 'творчество', 'minecraft', 'roblox', 'чтение', 'музыка', 'шахматы', 'манга', 'аниме'],
  'extrovert': ['танцы', 'театр', 'хип-хоп', 'концерт', 'фестиваль', 'публичные', 'команда', 'групповые', 'вечеринка', 'социум', 'общение', 'косплей', 'alt'],
  'chill': ['йога', 'медитация', 'релакс', 'спа', 'массаж', 'природа', 'кафе', 'чай', 'прогулки', 'здоровье', 'лоуфай', 'lofi'],
  'active': ['спорт', 'фитнес', 'плавание', 'мма', 'бег', 'велосипед', 'активные', 'экстрим', 'туризм', 'games', 'игры']
};

// Zones: normalized groups for categories (Option B)
const ZONES = [
  { id: 'общение', label: 'Общение и друзья', emoji: '✨', synonyms: ['социум', 'общение', 'друзья', 'клуб', 'комьюнити', 'community'] },
  { id: 'спорт', label: 'Спорт и актив', emoji: '🔥', synonyms: ['спорт', 'фитнес', 'актив', 'тренировка', 'плавание', 'мма', 'бег', 'велосипед', 'туризм', 'поход'] },
  { id: 'игры', label: 'Гейминг', emoji: '🎮', synonyms: ['игры', 'game', 'games', 'гейминг', 'киберспорт', 'шахматы', 'minecraft', 'roblox'] },
  { id: 'творчество', label: 'Творчество', emoji: '🎨', synonyms: ['творчество', 'искусство', 'рисование', 'скетч', 'фото', 'видео', 'дизайн', 'керамика', 'театр', 'сцена', 'аниме', 'anime', 'косплей', 'cosplay', 'манга', 'manga'] },
  { id: 'языки', label: 'Языки', emoji: '🗣️', synonyms: ['языки', 'язык', 'английский', 'english', 'ქართული', 'georgian', 'грузинский', 'русский', 'speaking', 'разговорный'] },
  { id: 'it', label: 'IT и код', emoji: '👾', synonyms: ['программирование', 'it', 'код', 'coding', 'разработка', 'python', 'javascript', 'робототехника', 'робotics'] },
  { id: 'танцы', label: 'Танцы', emoji: '💃', synonyms: ['танцы', 'dance', 'хип-хоп', 'hip-hop', 'k-pop'] },
  { id: 'музыка', label: 'Музыка', emoji: '🎵', synonyms: ['музыка', 'вокал', 'гитара', 'фортепиано', 'dj', 'битмейкинг'] },
  { id: 'природа', label: 'Природа и прогулки', emoji: '🌿', synonyms: ['природа', 'прогулки', 'хайкинг', 'парк', 'поход', 'скалолазание'] },
];

const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));

function applyFilters({onlineOnly, favoritesOnly, dist, chips, languages, vibes}){
  let res = ITEMS.slice();
  
  if(onlineOnly){
    res = res.filter(it => it.type === 'online');
  }
  if(favoritesOnly){
    const likedIds = getLikedIds();
    res = res.filter(it => likedIds.has(it.id));
  }
  if(chips.length){
    res = res.filter(it => {
      const categories = (it.categories||[]).map(x => String(x).toLowerCase());
      return chips.some(zoneId => {
        const zone = ZONE_BY_ID[String(zoneId).toLowerCase()];
        if (!zone) return false;
        const synonyms = [zone.id, ...(zone.synonyms || [])].map(s => String(s).toLowerCase());
        return categories.some(c => synonyms.some(s => c.includes(s)));
      });
    });
  }
  if(languages.length){
    res = res.filter(it => languages.some(lang => (it.languages||[]).includes(lang)));
  }
  if(vibes.length){
    console.log('Filtering by vibes:', vibes);
    res = res.filter(it => {
      const itemCategories = (it.categories||[]).concat([it.title, it.blurb]).join(' ').toLowerCase();
      const matches = vibes.some(vibe => 
        VIBE_MAPPING[vibe].some(keyword => itemCategories.includes(keyword.toLowerCase()))
      );
      return matches;
    });
    console.log('Items after vibe filter:', res.length);
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
              ${it.type === 'online' ? '🌐 Онлайн' : '📍 Офлайн'}
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

async function getPositionRobust() {
  try {
    return await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 30000,
        maximumAge: 0
      })
    );
  } catch (e) {
    if (e && typeof e.code === 'number' && e.code === e.PERMISSION_DENIED) throw e;
  }
  try {
    return await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 0
      })
    );
  } catch (_) {}
  return await new Promise((resolve, reject) => {
    const id = navigator.geolocation.watchPosition(
      p => {
        navigator.geolocation.clearWatch(id);
        resolve(p);
      },
      err => {
        navigator.geolocation.clearWatch(id);
        reject(err);
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    setTimeout(() => {
      navigator.geolocation.clearWatch(id);
      reject(new Error('watch timeout'));
    }, 45000);
  });
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
    const pos = await getPositionRobust();
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
      else if (err.code === err.POSITION_UNAVAILABLE) msg = 'Система не смогла получить координаты (на iOS/macOS это часто kCLErrorLocationUnknown). Включи Wi‑Fi (даже при Ethernet), отключи VPN/Private Relay, включи точную геопозицию и подожди минуту.';
      else if (err.code === err.TIMEOUT) msg = 'Геолокация не успела определить позицию. Попробуй ещё раз.';
    }
    alert(msg);
  }
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

// Initialize map readiness polling
initMapWhenReady();

// Add all chip handlers and other interactive elements
function initChipHandlers() {
  document.addEventListener('click', (e) => {
    // Handle personality chips (vibe filters) - radio button behavior
    if (e.target.matches('.personality-chip')) {
      console.log('Personality chip clicked:', e.target.dataset.vibe);
      
      const wasActive = e.target.classList.contains('active');
      
      // If clicking an active button, deactivate it
      if (wasActive) {
        e.target.classList.remove('active');
      } else {
        // Deactivate all other personality chips first
        document.querySelectorAll('.personality-chip.active').forEach(chip => {
          chip.classList.remove('active');
        });
        // Activate the clicked one
        e.target.classList.add('active');
        
        // Show encouraging message
        const vibe = e.target.dataset.vibe;
        const messages = {
          'introvert': 'Подобрали спокойные варианты 🌙',
          'extrovert': 'Покажем активные варианты 🌟',
          'chill': 'Больше спокойных мест 🌊',
          'active': 'Больше движения ⚡'
        };
        
        if (messages[vibe]) {
          setTimeout(() => showMotivationalMessage(messages[vibe]), 300);
        }
      }
      
      // Re-render with new filters
      render();
    }
    
    // Handle category chips (data-tag)
    if (e.target.matches('.chip[data-tag]') && !e.target.matches('.personality-chip')) {
      e.target.classList.toggle('active');
      render();
      
      // Track gamification
      const category = e.target.dataset.tag;
      if (category) {
        userStats.categoriesExplored.add(category);
        checkAchievements();
      }
    }
    
    // Handle language chips (data-language)
    if (e.target.matches('.chip[data-language]')) {
      e.target.classList.toggle('active');
      render();
    }
  });
  
  // Add other control handlers
  const onlineToggle = document.getElementById('onlineToggle');
  if (onlineToggle) {
    onlineToggle.addEventListener('change', () => {
      render();
    });
  }
  
  const distanceSlider = document.getElementById('distance');
  if (distanceSlider) {
    distanceSlider.addEventListener('input', debounce(() => {
      const val = Number(distanceSlider.value);
      const label = document.getElementById('distLabel');
      if (label) {
        label.textContent = val === 0 ? 'везде' : `${val} км`;
      }
      render();
    }, 300));
  }
}

// Initialize theme as soon as possible
document.addEventListener('DOMContentLoaded', initTheme);
document.addEventListener('DOMContentLoaded', initRebelMode);
document.addEventListener('DOMContentLoaded', initChipHandlers);
document.addEventListener('DOMContentLoaded', () => {
  // Load items and initialize UI
  loadItems();
  setTimeout(addSearchBar, 100);
  setTimeout(() => {
    updateFavoritesCounter();
    initializeFavoritesButton();
  }, 200);
  // Build dynamic category chips after items load
  document.addEventListener('itemsLoaded', () => {
    buildCategoryChips();
  });
  
  // Show welcome message for first-time users
  setTimeout(() => {
    if (userStats.placesViewed === 0) {
      showMotivationalMessage('Привет! Посмотрим, что тебе понравится ✨');
    }
  }, 2000);
  
  // Update achievement display periodically
  setInterval(() => {
    updateAchievementDisplay();
  }, 5000);
});


function showItemOnMap(item) {
  if (!item.coords || !map) return;
  
  // Центрируем карту на точке с анимацией
  map.setCenter([item.coords.lat, item.coords.lng], 16, {
    duration: 800
  });
  
  // Auto-opening balloons disabled due to Yandex Maps API issues
  // Users can click on pins to see details
}

function updateListMetaVisible() {
  const metaEl = document.getElementById('listMeta');
  if (!metaEl) return;
  const all = ITEMS.length;
  const visible = [...document.querySelectorAll('#list .card')].filter(el => el.style.display !== 'none').length;
  metaEl.textContent = `Показано ${visible} из ${all}`;
}

function buildCategoryChips() {
  const container = document.getElementById('categoryChips');
  if (!container) return;
  container.innerHTML = '';
  // Build normalized zone chips
  const frag = document.createDocumentFragment();
  ZONES.forEach(z => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.setAttribute('data-tag', z.id);
    btn.textContent = `${z.emoji} ${z.label}`;
    frag.appendChild(btn);
  });
  container.appendChild(frag);
}

function applyRebelMode(isOn) {
  const root = document.documentElement;
  if (isOn) {
    root.classList.add('rebel');
  } else {
    root.classList.remove('rebel');
  }
  const btn = document.getElementById('rebelToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', String(!!isOn));
    const span = btn.querySelector('span');
    if (span) span.textContent = isOn ? 'ALT MODE' : 'ANIME';
  }
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
  titleEl.textContent = 'Найди друзей по интересам в Тбилиси ✨';
  if (isOn) {
    pEl.textContent = 'Альт‑режим включён. Выбирай, что нравится — сохраняй избранное и знакомься.';
  } else {
    pEl.textContent = 'Выбирай, что нравится. Сохраняй избранное и знакомься в безопасных местах.';
  }
}

// Gamification functions
function trackPlaceView(item) {
  userStats.placesViewed++;
  if (item.categories) {
    item.categories.forEach(cat => userStats.categoriesExplored.add(cat));
  }
  
  checkAchievements();
  updateStatsDisplay();
}

function trackFavoriteToggle(isAdding) {
  if (isAdding) {
    checkAchievements();
  }
}

function checkAchievements() {
  const newAchievements = [];
  
  // Explorer achievement
  if (userStats.placesViewed >= ACHIEVEMENTS.explorer.threshold && !userStats.achievementsUnlocked.has('explorer')) {
    newAchievements.push('explorer');
  }
  
  // Category-based achievements
  ['social', 'creative', 'gamer', 'polyglot', 'athlete'].forEach(achievementKey => {
    const achievement = ACHIEVEMENTS[achievementKey];
    if (achievement.categories && !userStats.achievementsUnlocked.has(achievementKey)) {
      const hasCategory = achievement.categories.some(cat => userStats.categoriesExplored.has(cat));
      if (hasCategory) {
        newAchievements.push(achievementKey);
      }
    }
  });
  
  // Favorites-based achievements
  const favCount = getFavoritesCount();
  if (favCount >= 1 && !userStats.achievementsUnlocked.has('first_like')) {
    newAchievements.push('first_like');
  }
  if (favCount >= 5 && !userStats.achievementsUnlocked.has('collector')) {
    newAchievements.push('collector');
  }
  
  newAchievements.forEach(key => {
    userStats.achievementsUnlocked.add(key);
    showAchievementPopup(ACHIEVEMENTS[key]);
  });
}

function showAchievementPopup(achievement) {
  const popup = document.createElement('div');
  popup.className = 'achievement-popup';
  popup.innerHTML = `${achievement.emoji} <strong>${achievement.name}</strong><br><small>${achievement.desc}</small>`;
  
  document.body.appendChild(popup);
  
  setTimeout(() => popup.classList.add('show'), 100);
  setTimeout(() => {
    popup.classList.remove('show');
    setTimeout(() => popup.remove(), 500);
  }, 3000);
}

function getFavoritesCount() {
  try {
    const arr = JSON.parse(localStorage.getItem('liked_ids') || '[]');
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function updateStatsDisplay() {
  // Show motivational messages
  const messages = [
    'Продолжай в том же духе! 🌟',
    'Ты на правильном пути! ✨',
    'Скоро найдешь что-то классное! 🔥',
    'Исследуй больше, найди свое! 💎',
    'Каждое место - новая возможность! 🚀'
  ];
  
  if (userStats.placesViewed > 0 && userStats.placesViewed % 5 === 0) {
    showMotivationalMessage(messages[Math.floor(Math.random() * messages.length)]);
  }
}

function showMotivationalMessage(message) {
  const existing = document.querySelector('.motivation-badge');
  if (existing) existing.remove();
  
  const badge = document.createElement('div');
  badge.className = 'motivation-badge';
  badge.textContent = message;
  
  document.body.appendChild(badge);
  
  setTimeout(() => badge.classList.add('show'), 100);
  setTimeout(() => {
    badge.classList.remove('show');
    setTimeout(() => badge.remove(), 500);
  }, 2500);
}

function updateAchievementDisplay() {
  const display = document.getElementById('achievementDisplay');
  if (!display) return;
  
  if (userStats.achievementsUnlocked.size === 0) {
    display.innerHTML = 'Исследуй сайт чтобы получить первые достижения! 🎯';
    return;
  }
  
  const achievementBadges = Array.from(userStats.achievementsUnlocked)
    .map(key => {
      const achievement = ACHIEVEMENTS[key];
      return `<span class="achievement-badge" title="${achievement.desc}">${achievement.emoji} ${achievement.name}</span>`;
    })
    .join('');
  
  display.innerHTML = `Твои достижения: ${achievementBadges}`;
}
