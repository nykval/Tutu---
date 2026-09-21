const $ = (selector, root = document) => root.querySelector(selector);
const state = {
  geographies: [], themes: [], collections: [],
  view: 'builder', catalog: 'geographies', editId: null,
  geographyId: null, themeIds: [null], hotelCount: 10, benefitType: null, discountPercent: null,
  themeDraft: [], lookup: null, config: null, editingLinks: false, viewedCollection: null,
};
const geographyTypes = ['населенный пункт', 'страна', 'регион', 'местность'];
const themeTypes = ['сценарий', 'состав', 'занятия', 'впечатления', 'удобства', 'расположение', 'характер', 'уровень', 'повод'];
const benefitLabels = {action: 'Акция', promocode: 'Промокод'};
const standaloneMode = location.protocol === 'file:' || location.hostname.endsWith('.github.io');
const storageKey = 'tutu-hotel-collections-v1';
let localMemory = null;

function plural(value, one, few, many) {
  const number = Math.abs(Number(value));
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function countText(value, forms) {
  return `${value} ${plural(value, ...forms)}`;
}

function hotelCountText(value) {
  return countText(value, ['отель', 'отеля', 'отелей']);
}

function linkCountText(value) {
  return countText(value, ['ссылка', 'ссылки', 'ссылок']);
}

function collectionCountText(value) {
  return countText(value, ['подборка', 'подборки', 'подборок']);
}

function fieldCountText(value) {
  return countText(value, ['поле', 'поля', 'полей']);
}

function localSeed() {
  const catalog = window.COLLECTION_CATALOG || {geographies: [], themes: [], collections: []};
  return {
    geographies: catalog.geographies.map(([id, name, type]) => ({id, name, type})),
    themes: catalog.themes.map(([id, name, type]) => ({id, name, type})),
    collections: (catalog.collections || []).map(item => ({
      ...item,
      themeIds: [...item.themeIds],
      links: [...item.links],
    })),
  };
}

function mergeSeededData(saved) {
  const seeded = localSeed();
  const mergeCatalog = (current, defaults) => {
    const currentIds = new Set(current.map(item => item.id));
    return [...current, ...defaults.filter(item => !currentIds.has(item.id))];
  };
  const collectionIds = new Set(saved.collections.map(item => item.id));
  const collectionKeys = new Set(saved.collections.map(localConfigKey));
  const missingCollections = seeded.collections.filter(item => (
    !collectionIds.has(item.id) && !collectionKeys.has(localConfigKey(item))
  ));
  return {
    geographies: mergeCatalog(saved.geographies, seeded.geographies),
    themes: mergeCatalog(saved.themes, seeded.themes),
    collections: [...saved.collections, ...missingCollections],
  };
}

function localRead() {
  if (localMemory) return localMemory;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.geographies) && Array.isArray(parsed.themes) && Array.isArray(parsed.collections)) {
        localMemory = mergeSeededData(parsed);
        localWrite(localMemory);
        return localMemory;
      }
    }
  } catch (_) {
    // Some browsers restrict file storage; the app still works for the current session.
  }
  localMemory = localSeed();
  return localMemory;
}

function localWrite(data) {
  localMemory = data;
  try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (_) {}
}

function localConfig(data, payload) {
  const geographyId = Number(payload.geographyId);
  const themeIds = Array.isArray(payload.themeIds) ? payload.themeIds.map(Number).sort((a, b) => a - b) : [];
  const hotelCount = Number(payload.hotelCount);
  const discountPercent = payload.discountPercent == null ? null : Number(payload.discountPercent);
  const benefitType = discountPercent === null ? null : (payload.benefitType || 'action');
  if (!data.geographies.some(item => item.id === geographyId)) throw new Error('География не найдена.');
  if (themeIds.length < 1 || themeIds.length > 3 || themeIds.some(id => !data.themes.some(item => item.id === id))) throw new Error('Выберите от одной до трёх тем.');
  if (new Set(themeIds).size !== themeIds.length || (themeIds.includes(1) && themeIds.length > 1)) throw new Error('Темы не должны повторяться; «Без темы» выбирается отдельно.');
  if (!Number.isInteger(hotelCount) || hotelCount < 1 || hotelCount > 100) throw new Error('Количество отелей: укажите целое число от 1 до 100.');
  if (discountPercent !== null && (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 90)) throw new Error('Выгода: укажите целое число от 1 до 90.');
  if (benefitType !== null && !benefitLabels[benefitType]) throw new Error('Выберите тип выгоды.');
  return {geographyId, themeIds, hotelCount, benefitType, discountPercent};
}

function localConfigKey(config) {
  return JSON.stringify([config.geographyId, [...config.themeIds].sort((a, b) => a - b), config.hotelCount, benefitTypeFor(config), config.discountPercent ?? null]);
}

function benefitTypeFor(config) {
  return config.discountPercent == null ? null : (config.benefitType || 'action');
}

function benefitText(config) {
  const percent = config.discountPercent;
  if (percent == null) return 'Без выгоды';
  return `${benefitLabels[benefitTypeFor(config)] || 'Акция'} ${percent}%`;
}

function localLinks(links, expectedCount) {
  if (!Array.isArray(links) || links.length !== expectedCount) throw new Error(`Нужно добавить ровно ${linkCountText(expectedCount)} на отели.`);
  const cleaned = [];
  const seen = new Set();
  for (const raw of links) {
    const link = String(raw).trim();
    let parsed;
    try { parsed = new URL(link); } catch (_) { throw new Error(`Некорректная ссылка: ${link.slice(0, 90)}`); }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error(`Некорректная ссылка: ${link.slice(0, 90)}`);
    const key = link.replace(/\/$/, '');
    if (seen.has(key)) throw new Error('Одна ссылка добавлена несколько раз.');
    seen.add(key);
    cleaned.push(link);
  }
  return cleaned;
}

function localHydrate(data, item) {
  return {
    id: item.id,
    geography: data.geographies.find(entry => entry.id === item.geographyId),
    themes: item.themeIds.map(id => data.themes.find(entry => entry.id === id)).filter(Boolean),
    hotelCount: item.hotelCount,
    benefitType: benefitTypeFor(item),
    discountPercent: item.discountPercent,
    links: [...item.links],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function localSimilar(data, config, excludeId = null) {
  return data.collections.map(item => {
    if (item.id === excludeId) return null;
    const sharedThemes = item.themeIds.filter(id => id !== 1 && config.themeIds.includes(id));
    const reasons = [];
    let score = 0;
    if (item.geographyId === config.geographyId && config.geographyId !== 1) { reasons.push('та же география'); score += 5; }
    if (sharedThemes.length) { reasons.push(`общих тем: ${sharedThemes.length}`); score += sharedThemes.length * 3; }
    if (item.hotelCount === config.hotelCount) { reasons.push('то же количество отелей'); score += 1; }
    if (config.discountPercent !== null && item.discountPercent === config.discountPercent && benefitTypeFor(item) === benefitTypeFor(config)) { reasons.push('та же выгода'); score += 1; }
    if (!reasons.length) return null;
    return {score, updatedAt: item.updatedAt, value: {...localHydrate(data, item), similarity: reasons}};
  }).filter(Boolean).sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(item => item.value);
}

function localCatalogItem(data, table, payload, id = null) {
  const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
  const type = payload.type;
  const allowed = table === 'geographies' ? geographyTypes : themeTypes;
  if (name.length < 2 || name.length > 120) throw new Error('Название должно содержать от 2 до 120 символов.');
  if (!allowed.includes(type)) throw new Error('Выберите тип из справочника.');
  if (data[table].some(item => item.id !== id && item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru') && item.type === type)) throw new Error('Такое название с этим типом уже есть.');
  if (id === 1) throw new Error('Служебное значение нельзя изменить.');
  if (id !== null) {
    const item = data[table].find(entry => entry.id === id);
    if (!item) throw new Error('Элемент справочника не найден.');
    Object.assign(item, {name, type});
    return {...item};
  }
  const item = {id: Math.max(0, ...data[table].map(entry => entry.id)) + 1, name, type};
  data[table].push(item);
  return {...item};
}

async function localRequest(path, method, body) {
  const data = localRead();
  if (path === '/api/bootstrap' && method === 'GET') {
    return {geographies: data.geographies.map(item => ({...item})), themes: data.themes.map(item => ({...item})), collections: data.collections.map(item => localHydrate(data, item)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))};
  }
  const catalogMatch = path.match(/^\/api\/(geographies|themes)(?:\/(\d+))?$/);
  if (catalogMatch && ['POST', 'PATCH'].includes(method)) {
    const result = localCatalogItem(data, catalogMatch[1], body, catalogMatch[2] ? Number(catalogMatch[2]) : null);
    localWrite(data);
    return result;
  }
  if (path === '/api/lookup' && method === 'POST') {
    const config = localConfig(data, body);
    const exactRaw = data.collections.find(item => localConfigKey(item) === localConfigKey(config));
    return {exact: exactRaw ? localHydrate(data, exactRaw) : null, similar: localSimilar(data, config, exactRaw?.id)};
  }
  if (path === '/api/collections' && method === 'POST') {
    const config = localConfig(data, body);
    if (data.collections.some(item => localConfigKey(item) === localConfigKey(config))) throw new Error('Такая подборка уже существует.');
    const now = new Date().toISOString();
    const item = {...config, id: Math.max(0, ...data.collections.map(entry => entry.id)) + 1, links: localLinks(body.links, config.hotelCount), createdAt: now, updatedAt: now};
    data.collections.push(item);
    localWrite(data);
    return localHydrate(data, item);
  }
  const collectionMatch = path.match(/^\/api\/collections\/(\d+)$/);
  if (collectionMatch && method === 'PUT') {
    const item = data.collections.find(entry => entry.id === Number(collectionMatch[1]));
    if (!item) throw new Error('Подборка не найдена.');
    item.links = localLinks(body.links, item.hotelCount);
    item.updatedAt = new Date().toISOString();
    localWrite(data);
    return localHydrate(data, item);
  }
  throw new Error('Действие не найдено.');
}

function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'})) svg.setAttribute(key, value);
  for (const [tag, attrs] of window.APP_ICONS[name] || []) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

function appendText(parent, tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  parent.append(node);
  return node;
}

function makeButton(label, className, click, iconName) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  if (iconName) button.append(icon(iconName));
  if (label) button.append(document.createTextNode(label));
  button.addEventListener('click', click);
  return button;
}

function closeImage() {
  const image = document.createElement('img');
  image.src = './close.svg';
  image.alt = '';
  image.className = 'close-glyph';
  return image;
}

function chip(parent, label, className = 'type-chip') {
  return appendText(parent, 'span', className, label);
}

function selectionChip(parent, item, removeLabel, onRemove) {
  const selected = appendText(parent, 'div', 'selection-chip', '');
  appendText(selected, 'span', 'selection-chip-name', item.name);
  const remove = makeButton('', 'selection-chip-remove', onRemove);
  remove.append(closeImage());
  remove.title = removeLabel;
  remove.setAttribute('aria-label', removeLabel);
  selected.append(remove);
}

async function request(path, method = 'GET', body) {
  if (standaloneMode) return localRequest(path, method, body);
  const response = await fetch(path, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие.');
  return data;
}

async function refreshData() {
  const data = await request('/api/bootstrap');
  state.geographies = data.geographies;
  state.themes = data.themes;
  state.collections = data.collections;
  $('#catalog-caption').textContent = `${data.geographies.length} географий · ${data.themes.length} тем`;
  $('#nav-collection-count').textContent = data.collections.length;
  $('#library-count').textContent = collectionCountText(data.collections.length);
  $('#geo-count').textContent = data.geographies.length;
  $('#theme-count').textContent = data.themes.length;
  renderGeographies();
  renderThemes();
  renderLibrary();
  renderAdminList();
}

function setView(view) {
  state.view = view;
  for (const node of document.querySelectorAll('.view')) node.hidden = node.id !== `${view}-view`;
  for (const node of document.querySelectorAll('[data-view]')) node.classList.toggle('active', node.dataset.view === view);
  window.scrollTo({top: 0, behavior: 'instant'});
}

function fillSelect(select, items, selectedId, placeholder, filter = '') {
  const query = filter.trim().toLocaleLowerCase('ru');
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = placeholder;
  select.append(empty);
  for (const item of items) {
    if (query && item.id !== selectedId && !item.name.toLocaleLowerCase('ru').includes(query)) continue;
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  }
  select.value = selectedId == null ? '' : String(selectedId);
}

function renderGeographies() {
  const selected = state.geographies.find(item => item.id === state.geographyId);
  $('#geography-picker-label').textContent = 'Выберите географию';
  $('#geography-picker').classList.remove('has-value');
  const root = $('#geography-selection');
  root.replaceChildren();
  if (selected) selectionChip(root, selected, `Убрать географию «${selected.name}»`, () => {
    state.geographyId = null;
    invalidateResult();
    renderGeographies();
  });
}

const geographyTypeLabels = {
  'без географии': 'Без географии',
  'населенный пункт': 'Населённые пункты',
  'местность': 'Местности',
  'регион': 'Регионы',
  'страна': 'Страны',
};

function renderGeographyGroups() {
  const root = $('#geography-groups');
  const query = $('#geography-modal-search').value.trim().toLocaleLowerCase('ru');
  $('#geography-search-clear').hidden = !query;
  const order = ['без географии', 'населенный пункт', 'местность', 'регион', 'страна'];
  let found = 0;
  root.replaceChildren();
  for (const type of order) {
    const items = state.geographies.filter(item => item.type === type && (!query || item.name.toLocaleLowerCase('ru').includes(query)));
    if (!items.length) continue;
    found += items.length;
    const group = appendText(root, 'section', 'geography-group', '');
    const head = appendText(group, 'div', 'geography-group-head', '');
    appendText(head, 'h3', '', geographyTypeLabels[type] || type);
    appendText(head, 'span', '', String(items.length));
    const grid = appendText(group, 'div', 'geography-grid', '');
    for (const item of items) {
      const option = makeButton('', `geography-option${item.id === state.geographyId ? ' selected' : ''}`, () => {
        state.geographyId = item.id;
        invalidateResult();
        renderGeographies();
        closeGeographyModal();
      });
      const marker = appendText(option, 'span', 'option-icon', '');
      marker.append(icon(type === 'страна' ? 'MapPin' : 'MapPin', 17));
      appendText(option, 'span', 'geography-option-name', item.name);
      if (item.id === state.geographyId) option.append(icon('Check', 17));
      grid.append(option);
    }
  }
  $('#geography-found').textContent = found ? `Найдено: ${found}` : 'Ничего не найдено';
  if (!found) {
    const empty = appendText(root, 'div', 'picker-empty', '');
    appendText(empty, 'strong', '', 'Совпадений нет');
    appendText(empty, 'span', '', 'Попробуйте изменить запрос или добавьте географию в справочнике.');
  }
}

function openGeographyModal() {
  const modal = $('#geography-modal');
  modal.hidden = false;
  document.body.classList.add('modal-open');
  $('#geography-modal-search').value = '';
  renderGeographyGroups();
  requestAnimationFrame(() => $('#geography-modal-search').focus());
}

function closeGeographyModal() {
  $('#geography-modal').hidden = true;
  document.body.classList.remove('modal-open');
  $('#geography-picker').focus();
}

const themeTypeLabels = {
  'без темы': 'Без темы',
  'сценарий': 'Сценарии',
  'состав': 'Состав',
  'занятия': 'Занятия',
  'впечатления': 'Впечатления',
  'удобства': 'Удобства',
  'расположение': 'Расположение',
  'характер': 'Характер',
  'уровень': 'Уровень',
  'повод': 'Поводы',
};

function renderThemes() {
  const root = $('#theme-fields');
  root.replaceChildren();
  const selected = state.themeIds.map(id => state.themes.find(item => item.id === id)).filter(Boolean);
  const picker = makeButton('', 'picker-trigger theme-modal-trigger', openThemeModal);
  picker.id = 'theme-picker';
  picker.setAttribute('aria-haspopup', 'dialog');
  picker.setAttribute('aria-controls', 'theme-modal');
  picker.setAttribute('aria-label', 'Выбрать темы');
  appendText(picker, 'span', 'picker-label', 'Выберите тему');
  const chevron = appendText(picker, 'span', 'picker-chevron', '');
  chevron.append(icon('ChevronDown'));
  root.append(picker);

  if (!selected.length) return;
  const list = appendText(root, 'div', 'selection-chip-list', '');
  for (const theme of selected) {
    selectionChip(list, theme, `Убрать тему «${theme.name}»`, () => {
      state.themeIds = state.themeIds.filter(id => id !== theme.id);
      if (!state.themeIds.length) state.themeIds = [null];
      invalidateResult();
      renderThemes();
    });
  }
}

function renderThemeGroups() {
  const root = $('#theme-groups');
  const previousScrollTop = root.scrollTop;
  const query = $('#theme-modal-search').value.trim().toLocaleLowerCase('ru');
  const order = ['без темы', 'сценарий', 'состав', 'занятия', 'впечатления', 'удобства', 'расположение', 'характер', 'уровень', 'повод'];
  const noThemeId = state.themes.find(item => item.type === 'без темы')?.id;
  let found = 0;
  root.replaceChildren();
  $('#theme-search-clear').hidden = !query;
  for (const type of order) {
    const items = state.themes.filter(item => item.type === type && (!query || item.name.toLocaleLowerCase('ru').includes(query)));
    if (!items.length) continue;
    found += items.length;
    const group = appendText(root, 'section', 'geography-group', '');
    const head = appendText(group, 'div', 'geography-group-head', '');
    appendText(head, 'h3', '', themeTypeLabels[type] || type);
    appendText(head, 'span', '', String(items.length));
    const grid = appendText(group, 'div', 'geography-grid', '');
    for (const item of items) {
      const isSelected = state.themeDraft.includes(item.id);
      const limitReached = state.themeDraft.length >= 3 && !isSelected && item.id !== noThemeId;
      const option = makeButton('', `geography-option theme-option${isSelected ? ' selected' : ''}`, () => {
        if (isSelected) state.themeDraft = state.themeDraft.filter(id => id !== item.id);
        else if (item.id === noThemeId) state.themeDraft = [item.id];
        else if (state.themeDraft.length < 3) state.themeDraft = [...state.themeDraft.filter(id => id !== noThemeId), item.id];
        renderThemeGroups();
      });
      option.disabled = limitReached;
      option.setAttribute('aria-pressed', String(isSelected));
      const marker = appendText(option, 'span', 'option-icon', '');
      marker.append(icon('Tags', 16));
      appendText(option, 'span', 'geography-option-name', item.name);
      if (isSelected) option.append(icon('Check', 17));
      grid.append(option);
    }
  }
  $('#theme-found').textContent = found ? `Найдено: ${found}` : 'Ничего не найдено';
  $('#theme-selection-count').textContent = `Выбрано: ${state.themeDraft.length} из 3`;
  $('#theme-apply').disabled = state.themeDraft.length === 0;
  if (!found) {
    const empty = appendText(root, 'div', 'picker-empty', '');
    appendText(empty, 'strong', '', 'Совпадений нет');
    appendText(empty, 'span', '', 'Попробуйте изменить запрос или добавьте тему в справочнике.');
  }
  requestAnimationFrame(() => { root.scrollTop = previousScrollTop; });
}

function openThemeModal() {
  state.themeDraft = state.themeIds.filter(Boolean);
  $('#theme-modal-search').value = '';
  $('#theme-modal').hidden = false;
  document.body.classList.add('modal-open');
  renderThemeGroups();
  requestAnimationFrame(() => $('#theme-modal-search').focus());
}

function closeThemeModal(apply = false) {
  if (apply && state.themeDraft.length) {
    state.themeIds = [...state.themeDraft];
    invalidateResult();
    renderThemes();
  }
  $('#theme-modal').hidden = true;
  document.body.classList.remove('modal-open');
  $('#theme-picker')?.focus();
}

function invalidateResult() {
  if (!state.lookup) return;
  state.lookup = null;
  state.config = null;
  state.editingLinks = false;
  $('#output-status').textContent = '';
  const root = $('#result-content');
  root.replaceChildren();
  const empty = appendText(root, 'div', 'empty-state', '');
  appendText(empty, 'span', 'empty-accent', '');
  appendText(empty, 'h3', '', 'Параметры изменены');
  appendText(empty, 'p', '', 'Нажмите «Придумать подборку», чтобы проверить новое сочетание.');
}

function getConfig() {
  const geographyId = Number(state.geographyId);
  const themeIds = state.themeIds.map(Number);
  const hotelCount = Number($('#hotel-count').value);
  const discountPercent = $('#discount-toggle').checked ? Number($('#discount-percent').value) : null;
  const benefitType = discountPercent === null ? null : $('#benefit-type').value;
  if (!geographyId) throw new Error('Выберите географию.');
  if (themeIds.some(id => !id)) throw new Error('Выберите тему в каждом поле.');
  if (!Number.isInteger(hotelCount) || hotelCount < 1 || hotelCount > 100) throw new Error('Укажите от 1 до 100 отелей.');
  if (discountPercent !== null && (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 90)) throw new Error('Укажите размер выгоды от 1 до 90%.');
  if (benefitType !== null && !benefitLabels[benefitType]) throw new Error('Выберите тип выгоды.');
  return {geographyId, themeIds, hotelCount, benefitType, discountPercent};
}

function titleFor(config, source) {
  const geography = source?.geography || state.geographies.find(item => item.id === config.geographyId);
  const themes = source?.themes || config.themeIds.map(id => state.themes.find(item => item.id === id)).filter(Boolean);
  const subject = themes.filter(item => item.id !== 1).map(item => item.name.toLocaleLowerCase('ru')).join(' · ');
  return geography.id === 1 ? (subject ? `Отели: ${subject}` : 'Подборка отелей') : (subject ? `${geography.name}: ${subject}` : `Отели: ${geography.name}`);
}

function summaryFor(config, source) {
  const geography = source?.geography || state.geographies.find(item => item.id === config.geographyId);
  const themes = source?.themes || config.themeIds.map(id => state.themes.find(item => item.id === id)).filter(Boolean);
  const summary = [geography?.name || 'Без географии', ...themes.map(item => item.name), hotelCountText(config.hotelCount)];
  if (config.discountPercent) summary.push(benefitText(config));
  return summary;
}

function showResultHeader(root, config, source) {
  appendText(root, 'h2', 'result-title', titleFor(config, source));
  const summary = appendText(root, 'div', 'result-summary', '');
  for (const item of summaryFor(config, source)) chip(summary, item, 'small-chip');
  const geography = source?.geography || state.geographies.find(item => item.id === config.geographyId);
  const themes = source?.themes || config.themeIds.map(id => state.themes.find(item => item.id === id)).filter(Boolean);
  const facts = appendText(root, 'dl', 'result-facts', '');
  for (const [label, value] of [
    ['География', `${geography.name} · ${geography.type}`],
    ['Темы', themes.map(item => `${item.name} · ${item.type}`).join('; ')],
    ['Отели', String(config.hotelCount)],
    ['Выгода', benefitText(config)],
  ]) {
    const row = appendText(facts, 'div', 'fact-row', '');
    appendText(row, 'dt', '', label);
    appendText(row, 'dd', '', value);
  }
}

function renderSimilar(root, similar) {
  if (!similar.length) return;
  const section = appendText(root, 'section', 'similar-carousel-section', '');
  const head = appendText(section, 'div', 'result-section-head similar-carousel-head', '');
  appendText(head, 'h3', '', 'Похожие подборки');
  const controls = appendText(head, 'div', 'carousel-controls', '');
  const prev = makeButton('', 'carousel-button carousel-button-prev', () => {}, 'ChevronRight');
  const next = makeButton('', 'carousel-button', () => {}, 'ChevronRight');
  prev.setAttribute('aria-label', 'Показать предыдущие похожие подборки');
  next.setAttribute('aria-label', 'Показать следующие похожие подборки');
  controls.append(prev, next);
  const list = appendText(section, 'div', 'similar-list similar-carousel', '');
  prev.addEventListener('click', () => list.scrollBy({left: -320, behavior: 'smooth'}));
  next.addEventListener('click', () => list.scrollBy({left: 320, behavior: 'smooth'}));
  for (const collection of similar) {
    const row = makeButton('', 'similar-row similar-card', () => openCollection(collection), null);
    const main = appendText(row, 'span', 'row-main', '');
    appendText(main, 'span', 'row-title', titleFor(collection, collection));
    appendText(main, 'span', 'row-subtitle', collection.similarity.join(' · '));
    const end = appendText(row, 'span', 'row-end', '');
    appendText(end, 'span', '', linkCountText(collection.links.length));
    end.append(icon('ChevronRight'));
    list.append(row);
  }
}

function splitLinks(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function getInputLinks(section) {
  return [...section.querySelectorAll('.hotel-link-input')].map(input => input.value.trim()).filter(Boolean);
}

function renderLinkEditor(root, config, existing) {
  const section = appendText(root, 'section', 'url-editor', '');
  const head = appendText(section, 'div', 'result-section-head', '');
  appendText(head, 'h3', '', existing ? 'Ссылки на отели' : 'Добавить отели');
  const fields = appendText(section, 'div', 'hotel-link-fields', '');
  const inputs = [];
  for (let index = 0; index < config.hotelCount; index += 1) {
    const row = appendText(fields, 'label', 'hotel-link-field', '');
    appendText(row, 'span', 'hotel-link-index', String(index + 1).padStart(2, '0'));
    const input = document.createElement('input');
    input.className = 'input-control hotel-link-input';
    input.type = 'url';
    input.inputMode = 'url';
    input.autocomplete = 'off';
    input.placeholder = `Ссылка на отель ${index + 1}`;
    input.value = existing?.links[index] || '';
    input.setAttribute('aria-label', `Ссылка на отель ${index + 1}`);
    row.append(input);
    inputs.push(input);
  }
  const note = appendText(section, 'div', 'editor-note', '');
  const count = appendText(note, 'span', '', '');
  appendText(note, 'span', '', 'Каждое поле — отдельный отель');
  const updateCount = () => { count.textContent = `${getInputLinks(section).length} из ${linkCountText(config.hotelCount)}`; };
  for (const [index, input] of inputs.entries()) {
    input.addEventListener('input', updateCount);
    input.addEventListener('paste', event => {
      const links = splitLinks(event.clipboardData?.getData('text') || '');
      if (links.length <= 1) return;
      event.preventDefault();
      links.slice(0, inputs.length - index).forEach((link, offset) => {
        inputs[index + offset].value = link;
      });
      updateCount();
      inputs[Math.min(index + links.length, inputs.length - 1)].focus();
    });
  }
  updateCount();
  const actions = appendText(section, 'div', 'editor-actions', '');
  const error = appendText(section, 'p', 'form-error', '');
  const save = makeButton(existing ? 'Сохранить ссылки' : 'Добавить подборку', 'primary-button', async () => {
    error.textContent = '';
    const links = getInputLinks(section);
    if (links.length !== config.hotelCount) {
      error.textContent = `Нужно заполнить все ${fieldCountText(config.hotelCount)}.`;
      inputs.find(input => !input.value.trim())?.focus();
      return;
    }
    save.disabled = true;
    try {
      if (existing) await request(`/api/collections/${existing.id}`, 'PUT', {links});
      else await request('/api/collections', 'POST', {...config, links});
      await refreshData();
      await lookup(config);
    } catch (problem) { error.textContent = problem.message; }
    finally { save.disabled = false; }
  }, 'Check');
  actions.append(save);
  if (existing) actions.append(makeButton('Отмена', 'secondary-button', () => { state.editingLinks = false; renderResult(); }));
}

function renderResult() {
  const root = $('#result-content');
  root.replaceChildren();
  if (!state.lookup || !state.config) return;
  const {exact, similar} = state.lookup;
  showResultHeader(root, state.config, exact);
  if (exact) {
    $('#output-status').textContent = 'Подборка найдена';
    appendText(root, 'p', 'result-description', 'Такое сочетание уже сохранено. Ниже ссылки на отели в подборке.');
    if (state.editingLinks) renderLinkEditor(root, state.config, exact);
    else {
      const head = appendText(root, 'div', 'result-section-head', '');
      appendText(head, 'h3', '', `Отели · ${hotelCountText(exact.links.length)}`);
      head.append(makeButton('Изменить ссылки', 'text-button', () => {state.editingLinks = true; renderResult();}, 'Pencil'));
      const list = appendText(root, 'ol', 'hotel-links', '');
      for (const [index, url] of exact.links.entries()) {
        const row = document.createElement('li');
        appendText(row, 'span', 'hotel-number', String(index + 1).padStart(2, '0'));
        const link = appendText(row, 'a', '', url);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        row.append(icon('ArrowUpRight'));
        list.append(row);
      }
    }
  } else {
    $('#output-status').textContent = 'Новая подборка';
    appendText(root, 'p', 'result-description', 'Такой подборки пока нет. Добавьте ссылки на отели, чтобы сохранить её для команды.');
    if (state.config.discountPercent) appendText(root, 'p', 'callout', 'Указанную выгоду нужно проверить для каждого отеля перед публикацией.');
    renderLinkEditor(root, state.config, null);
  }
  renderSimilar(root, similar);
}

async function lookup(config) {
  const result = await request('/api/lookup', 'POST', config);
  state.config = config;
  state.lookup = result;
  state.editingLinks = false;
  renderResult();
}

function setHotelCount(value) {
  const select = $('#hotel-count');
  const stringValue = String(value);
  if (![...select.options].some(option => option.value === stringValue)) {
    const option = document.createElement('option');
    option.value = stringValue;
    option.textContent = stringValue;
    select.append(option);
  }
  select.value = stringValue;
}

async function openCollection(collection) {
  state.geographyId = collection.geography.id;
  state.themeIds = collection.themes.map(item => item.id);
  state.hotelCount = collection.hotelCount;
  state.benefitType = benefitTypeFor(collection);
  state.discountPercent = collection.discountPercent;
  setHotelCount(collection.hotelCount);
  $('#discount-toggle').checked = collection.discountPercent !== null;
  $('#benefit-type').disabled = collection.discountPercent === null;
  $('#benefit-type').value = benefitTypeFor(collection) || 'action';
  $('#discount-percent').disabled = collection.discountPercent === null;
  $('#discount-percent').value = collection.discountPercent || 10;
  $('#discount-details').hidden = collection.discountPercent === null;
  renderGeographies();
  renderThemes();
  setView('builder');
  $('#builder-error').textContent = '';
  try { await lookup(getConfig()); }
  catch (problem) { $('#builder-error').textContent = problem.message; }
}

function renderLibrary() {
  const root = $('#library-list');
  root.replaceChildren();
  const query = $('#library-search').value.trim().toLocaleLowerCase('ru');
  const items = state.collections.filter(item => !query || `${item.geography.name} ${item.themes.map(theme => theme.name).join(' ')}`.toLocaleLowerCase('ru').includes(query));
  if (!items.length) { appendText(root, 'div', 'list-empty', state.collections.length ? 'По этому запросу подборок нет.' : 'Пока нет сохранённых подборок. Соберите первую в конструкторе.'); return; }
  for (const collection of items) {
    const row = makeButton('', 'library-row', () => openCollectionModal(collection));
    const main = appendText(row, 'span', 'row-main', '');
    appendText(main, 'span', 'row-title', titleFor(collection, collection));
    appendText(main, 'span', 'row-subtitle', summaryFor(collection, collection).join(' · '));
    const end = appendText(row, 'span', 'row-end', '');
    appendText(end, 'span', '', linkCountText(collection.links.length));
    end.append(icon('ChevronRight'));
    root.append(row);
  }
}

function closeCollectionModal() {
  $('#collection-modal').hidden = true;
  document.body.classList.remove('modal-open');
  state.viewedCollection = null;
}

function renderCollectionModal(collection) {
  const root = $('#collection-modal-body');
  root.replaceChildren();
  appendText(root, 'h3', 'collection-modal-title', titleFor(collection, collection));
  const summary = appendText(root, 'div', 'result-summary collection-summary', '');
  for (const item of summaryFor(collection, collection)) chip(summary, item, 'small-chip');

  const facts = appendText(root, 'dl', 'result-facts collection-facts', '');
  for (const [label, value] of [
    ['География', `${collection.geography.name} · ${collection.geography.type}`],
    ['Темы', collection.themes.map(item => `${item.name} · ${item.type}`).join('; ')],
    ['Отели', String(collection.hotelCount)],
    ['Выгода', benefitText(collection)],
  ]) {
    const row = appendText(facts, 'div', 'fact-row', '');
    appendText(row, 'dt', '', label);
    appendText(row, 'dd', '', value);
  }

  const head = appendText(root, 'div', 'result-section-head collection-links-head', '');
  appendText(head, 'h3', '', `Ссылки на отели · ${linkCountText(collection.links.length)}`);
  const list = appendText(root, 'ol', 'hotel-links collection-modal-links', '');
  for (const [index, url] of collection.links.entries()) {
    const row = document.createElement('li');
    appendText(row, 'span', 'hotel-number', String(index + 1).padStart(2, '0'));
    const link = appendText(row, 'a', '', url);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.append(icon('ArrowUpRight'));
    list.append(row);
  }
  $('#collection-modal-count').textContent = linkCountText(collection.links.length);
}

function openCollectionModal(collection) {
  state.viewedCollection = collection;
  renderCollectionModal(collection);
  $('#collection-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#collection-close').focus();
}

function resetAdminForm() {
  state.editId = null;
  $('#admin-form').reset();
  $('#editor-title').textContent = state.catalog === 'geographies' ? 'Новая география' : 'Новая тема';
  $('#admin-save').textContent = 'Добавить';
  $('#admin-cancel').hidden = true;
  $('#admin-message').textContent = '';
  $('#admin-message').className = 'form-message';
}

function renderAdminTypes() {
  const select = $('#admin-type');
  select.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Выберите тип';
  select.append(empty);
  for (const kind of state.catalog === 'geographies' ? geographyTypes : themeTypes) {
    const option = document.createElement('option');
    option.value = kind;
    option.textContent = kind;
    select.append(option);
  }
}

function setCatalog(catalog) {
  state.catalog = catalog;
  for (const tab of document.querySelectorAll('.admin-tab')) {
    const active = tab.dataset.catalog === catalog;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  $('#admin-list-title').textContent = catalog === 'geographies' ? 'Все географии' : 'Все темы';
  $('#admin-name').placeholder = catalog === 'geographies' ? 'Например, Казань' : 'Например, Отели со спа';
  $('#admin-search').value = '';
  renderAdminTypes();
  resetAdminForm();
  renderAdminList();
}

function editCatalogItem(item) {
  state.editId = item.id;
  $('#editor-title').textContent = state.catalog === 'geographies' ? 'Изменить географию' : 'Изменить тему';
  $('#admin-name').value = item.name;
  $('#admin-type').value = item.type;
  $('#admin-save').textContent = 'Сохранить';
  $('#admin-cancel').hidden = false;
  $('#admin-message').textContent = '';
  $('#admin-name').focus();
}

function renderAdminList() {
  const root = $('#admin-list');
  root.replaceChildren();
  const source = state.catalog === 'geographies' ? state.geographies : state.themes;
  const query = $('#admin-search').value.trim().toLocaleLowerCase('ru');
  const items = source.filter(item => !query || `${item.name} ${item.type}`.toLocaleLowerCase('ru').includes(query));
  if (!items.length) { appendText(root, 'div', 'list-empty', 'Ничего не найдено.'); return; }
  for (const item of items) {
    const row = appendText(root, 'div', 'admin-row', '');
    appendText(row, 'span', 'admin-row-name', item.name);
    chip(row, item.type);
    if (item.id !== 1) {
      const edit = makeButton('', 'icon-button', () => editCatalogItem(item), 'Pencil');
      edit.title = 'Изменить';
      edit.setAttribute('aria-label', `Изменить ${item.name}`);
      row.append(edit);
    }
  }
}

async function init() {
  for (const node of document.querySelectorAll('[data-icon]')) node.replaceChildren(icon(node.dataset.icon));
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));
  for (const tab of document.querySelectorAll('[data-catalog]')) tab.addEventListener('click', () => setCatalog(tab.dataset.catalog));
  $('#geography-picker').addEventListener('click', () => openGeographyModal());
  $('#geography-close').addEventListener('click', closeGeographyModal);
  $('#geography-modal-search').addEventListener('input', renderGeographyGroups);
  $('#geography-search-clear').addEventListener('click', () => {
    $('#geography-modal-search').value = '';
    renderGeographyGroups();
    $('#geography-modal-search').focus();
  });
  $('#geography-modal').addEventListener('click', event => { if (event.target === $('#geography-modal')) closeGeographyModal(); });
  $('#theme-close').addEventListener('click', () => closeThemeModal(false));
  $('#theme-modal-search').addEventListener('input', () => {
    $('#theme-groups').scrollTop = 0;
    renderThemeGroups();
  });
  $('#theme-search-clear').addEventListener('click', () => {
    $('#theme-modal-search').value = '';
    renderThemeGroups();
    $('#theme-modal-search').focus();
  });
  $('#theme-apply').addEventListener('click', () => closeThemeModal(true));
  $('#theme-modal').addEventListener('click', event => { if (event.target === $('#theme-modal')) closeThemeModal(false); });
  $('#collection-close').addEventListener('click', closeCollectionModal);
  $('#collection-modal').addEventListener('click', event => { if (event.target === $('#collection-modal')) closeCollectionModal(); });
  $('#collection-edit').addEventListener('click', () => {
    const collection = state.viewedCollection;
    closeCollectionModal();
    if (collection) openCollection(collection);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!$('#geography-modal').hidden) closeGeographyModal();
      else if (!$('#theme-modal').hidden) closeThemeModal(false);
      else if (!$('#collection-modal').hidden) closeCollectionModal();
    }
  });
  $('#hotel-count').addEventListener('change', invalidateResult);
  $('#discount-toggle').addEventListener('change', event => {
    $('#discount-details').hidden = !event.target.checked;
    $('#benefit-type').disabled = !event.target.checked;
    $('#discount-percent').disabled = !event.target.checked;
    invalidateResult();
  });
  $('#benefit-type').addEventListener('change', invalidateResult);
  $('#discount-percent').addEventListener('input', invalidateResult);
  $('#builder-form').addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('#builder-error');
    error.textContent = '';
    const button = $('#lookup-button');
    try {
      const config = getConfig();
      button.disabled = true;
      await lookup(config);
    } catch (problem) { error.textContent = problem.message; }
    finally { button.disabled = false; }
  });
  $('#library-search').addEventListener('input', renderLibrary);
  $('#admin-search').addEventListener('input', renderAdminList);
  $('#admin-cancel').addEventListener('click', resetAdminForm);
  $('#admin-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = $('#admin-message');
    message.textContent = '';
    message.className = 'form-message';
    const name = $('#admin-name').value.trim();
    const type = $('#admin-type').value;
    if (!name || !type) {message.textContent = 'Укажите название и тип.'; return;}
    const editId = state.editId;
    const button = $('#admin-save');
    button.disabled = true;
    try {
      await request(`/api/${state.catalog}${editId ? `/${editId}` : ''}`, editId ? 'PATCH' : 'POST', {name, type});
      await refreshData();
      resetAdminForm();
      message.className = 'form-message success';
      message.textContent = editId ? 'Изменения сохранены.' : 'Добавлено в справочник.';
    } catch (problem) { message.textContent = problem.message; }
    finally { button.disabled = false; }
  });
  renderAdminTypes();
  try { await refreshData(); }
  catch (problem) {
    $('#builder-error').textContent = `Не удалось загрузить данные: ${problem.message}`;
    $('#admin-message').textContent = `Не удалось загрузить данные: ${problem.message}`;
  }
}

init();
