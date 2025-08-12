
let ITEMS = [];
let map, clusterer, userPos = null;
let favoritesFilterActive = false; // Track favorites filter state

async function loadItems() {
  const res = await fetch('data/items.json');
  const data = await res.json();
  // ensure only 13+
  ITEMS = data.filter(it => it.age && it.age.min <= 13);
  render();
  
  // Initialize map after Yandex API loads
  ymaps.ready(setupMap);
}

function setupMap() {
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
  list.innerHTML = '';
  
  // Add animation delay for cards
  let animationDelay = 0;
  items.forEach((it, index) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.animationDelay = `${animationDelay}ms`;
    animationDelay += 50;
    const dist = userPos && it.coords ? getDistanceKm(userPos, it.coords) : null;
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
    
    list.appendChild(div);
  });
  refreshPins(filters, items);
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
    res = res.filter(it => {
      if(!it.coords) return false;
      const d = getDistanceKm(userPos, it.coords);
      return d!=null && d <= dist;
    });
  }
  // sort by distance if available
  res.sort((a,b)=>{
    const da = userPos && a.coords ? getDistanceKm(userPos, a.coords) : 1e9;
    const db = userPos && b.coords ? getDistanceKm(userPos, b.coords) : 1e9;
    return da - db;
  });
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
document.getElementById('distance').addEventListener('input', (e)=>{
  const v = Number(e.target.value);
  document.getElementById('distLabel').textContent = v ? `${v} км от меня` : 'весь город';
  render();
});
document.getElementById('geoBtn').addEventListener('click', (e)=>{
  const btn = e.currentTarget;
  btn.classList.add('loading');
  btn.disabled = true;
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('geolocation' in navigator)) { alert('Геолокация недоступна в этом браузере'); return; }
  if (!window.isSecureContext && !isLocalhost) {
    alert('Для определения местоположения открой сайт по HTTPS или запусти локально (localhost).');
    return;
  }
  navigator.geolocation.getCurrentPosition(pos=>{
    userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    btn.classList.remove('loading');
    btn.disabled = false;
    btn.innerHTML = '<span>✓ Локация найдена</span>';
    showNotification('📍 Локация определена!');
    render();
    if (map) {
      map.setCenter([userPos.lat, userPos.lng], 14);
    }
  }, err=>{
    btn.classList.remove('loading');
    btn.disabled = false;
    let msg = 'Не получилось определить местоположение.';
    if (err && typeof err.code === 'number') {
      if (err.code === err.PERMISSION_DENIED) msg = 'Доступ к геолокации запрещён. Разреши доступ в настройках сайта/браузера.';
      else if (err.code === err.POSITION_UNAVAILABLE) msg = 'Источник геолокации недоступен. Попробуй включить GPS/интернет.';
      else if (err.code === err.TIMEOUT) msg = 'Геолокация не успела определить позицию. Попробуй ещё раз.';
    }
    alert(msg);
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
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
  
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    filterBySearch(searchTerm);
  });
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
}

// Initialize
loadItems();
setTimeout(addSearchBar, 100);
setTimeout(() => {
  updateFavoritesCounter();
  initializeFavoritesButton();
}, 200);


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
