const MCP_URL = 'https://mcp.tutu.ru/mcp';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://nykval.github.io',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
];
const GEOGRAPHY_TYPES = ['населенный пункт', 'без географии', 'страна', 'регион', 'местность'];
const THEME_TYPES = [
  'сценарий', 'состав', 'занятия', 'впечатления', 'удобства',
  'расположение', 'характер', 'уровень', 'повод', 'без темы',
];
const BENEFIT_TYPES = ['action', 'promocode'];
const COUNTRYSIDE_THEME_ID = 8;
const COUNTRYSIDE_SEARCH_GEOGRAPHIES = Object.freeze({
  'москва': 'Московская область',
  'санкт-петербург': 'Ленинградская область',
  'казань': 'Республика Татарстан',
  'калининград': 'Калининградская область',
  'нижний новгород': 'Нижегородская область',
  'петрозаводск': 'Республика Карелия',
  'владивосток': 'Приморский край',
  'екатеринбург': 'Свердловская область',
  'краснодар': 'Краснодарский край',
  'ростов-на-дону': 'Ростовская область',
  'новосибирск': 'Новосибирская область',
  'самара': 'Самарская область',
  'ярославль': 'Ярославская область',
  'великий новгород': 'Новгородская область',
  'владимир': 'Владимирская область',
  'тула': 'Тульская область',
  'мурманск': 'Мурманская область',
  'иркутск': 'Иркутская область',
  'уфа': 'Республика Башкортостан',
  'красноярск': 'Красноярский край',
  'тюмень': 'Тюменская область',
  'псков': 'Псковская область',
  'тверь': 'Тверская область',
  'вологда': 'Вологодская область',
  'кострома': 'Костромская область',
  'рязань': 'Рязанская область',
  'пермь': 'Пермский край',
  'волгоград': 'Волгоградская область',
  'воронеж': 'Воронежская область',
  'саратов': 'Саратовская область',
  'астрахань': 'Астраханская область',
  'владикавказ': 'Республика Северная Осетия — Алания',
});
const MAX_HOTEL_CANDIDATES = 120;
const HOTEL_RATING_PRIOR = 8;
const HOTEL_RATING_CONFIDENCE = 60;
const THEME_HOTEL_AMENITIES = {
  9: 'spa',
  15: 'kid_friendly',
  16: 'kid_friendly',
  17: 'kid_friendly',
  19: 'pet_friendly',
  20: 'kid_friendly',
  21: 'beach',
  48: 'pool',
  49: 'pool',
  50: 'pool',
  51: 'pool',
  52: 'kids_pool',
  53: 'spa',
  54: 'sauna',
  55: 'sauna',
  56: 'spa',
  57: 'jacuzzi',
  61: 'parking',
  63: 'kid_friendly',
  64: 'fitness',
  67: 'beach',
  68: 'beach',
};
const THEME_ROOM_AMENITIES = {
  5: 'workspace',
  36: 'sea_view',
  37: 'mountain_view',
  38: 'view',
  60: 'room_kitchen',
  65: 'workspace',
};
const THEME_STARS = {90: 3, 91: 4, 92: 5, 93: 5};

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}

function assertAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins(env).has(origin)) {
    throw new ApiError('Этот сайт не может обращаться к серверу.', 403);
  }
}

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError('Ожидается JSON-запрос.', 415);
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError('Некорректный JSON.');
  }
}

function positiveInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ApiError(label + ': укажите целое число от ' + minimum + ' до ' + maximum + '.');
  }
  return number;
}

function normalizeConfig(payload) {
  const geographyId = positiveInteger(payload.geographyId, 1, 10000000, 'География');
  const themeIds = Array.isArray(payload.themeIds)
    ? payload.themeIds.map(value => positiveInteger(value, 1, 10000000, 'Тема')).sort((a, b) => a - b)
    : [];
  if (themeIds.length < 1 || themeIds.length > 3) {
    throw new ApiError('Выберите от одной до трёх тем.');
  }
  if (new Set(themeIds).size !== themeIds.length || (themeIds.includes(1) && themeIds.length > 1)) {
    throw new ApiError('Темы не должны повторяться; «Без темы» выбирается отдельно.');
  }
  const hotelCount = positiveInteger(payload.hotelCount, 1, 100, 'Количество отелей');
  const discountPercent = payload.discountPercent == null
    ? null
    : positiveInteger(payload.discountPercent, 1, 90, 'Выгода');
  const benefitType = discountPercent == null ? null : (payload.benefitType || 'action');
  if (benefitType != null && !BENEFIT_TYPES.includes(benefitType)) {
    throw new ApiError('Выберите тип выгоды.');
  }
  return {
    key: JSON.stringify([geographyId, themeIds, hotelCount, benefitType, discountPercent]),
    geographyId,
    themeIds,
    hotelCount,
    benefitType,
    discountPercent,
  };
}

function normalizeLinks(links, expectedCount) {
  if (!Array.isArray(links) || links.length !== expectedCount) {
    throw new ApiError('Нужно добавить ровно ' + expectedCount + ' ссылок на отели.');
  }
  const cleaned = [];
  const seen = new Set();
  for (const raw of links) {
    const link = String(raw).trim();
    let parsed;
    try {
      parsed = new URL(link);
    } catch {
      throw new ApiError('Некорректная ссылка: ' + link.slice(0, 90));
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new ApiError('Некорректная ссылка: ' + link.slice(0, 90));
    }
    const key = link.replace(/\/$/, '');
    if (seen.has(key)) throw new ApiError('Одна ссылка добавлена несколько раз.');
    seen.add(key);
    cleaned.push(link);
  }
  return cleaned;
}

function rawCollection(row, links = []) {
  return {
    id: Number(row.id),
    geographyId: Number(row.geography_id),
    themeIds: JSON.parse(row.theme_ids),
    hotelCount: Number(row.hotel_count),
    benefitType: row.benefit_type,
    discountPercent: row.discount_percent == null ? null : Number(row.discount_percent),
    links,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function allCollections(env) {
  const collectionResult = await env.DB.prepare(
    'SELECT * FROM collections ORDER BY updated_at DESC, id DESC'
  ).all();
  const linkResult = await env.DB.prepare(
    'SELECT collection_id, position, url FROM hotel_links ORDER BY collection_id, position'
  ).all();
  const linksById = new Map();
  for (const row of linkResult.results || []) {
    const id = Number(row.collection_id);
    if (!linksById.has(id)) linksById.set(id, []);
    linksById.get(id).push(row.url);
  }
  return (collectionResult.results || []).map(row => rawCollection(row, linksById.get(Number(row.id)) || []));
}

async function catalogRows(env, catalog) {
  const result = await env.DB.prepare(
    'SELECT id, name, type FROM catalog_items WHERE catalog = ? ORDER BY name_key, id'
  ).bind(catalog).all();
  return result.results || [];
}

async function bootstrap(env) {
  const [geographies, themes, collections] = await Promise.all([
    catalogRows(env, 'geographies'),
    catalogRows(env, 'themes'),
    allCollections(env),
  ]);
  return {rawCollections: true, geographies, themes, collections};
}

function catalogSettings(catalog) {
  if (catalog === 'geographies') return {types: GEOGRAPHY_TYPES, firstId: 1000000};
  if (catalog === 'themes') return {types: THEME_TYPES, firstId: 2000000};
  throw new ApiError('Справочник не найден.', 404);
}

function normalizeCatalogItem(catalog, payload) {
  const settings = catalogSettings(catalog);
  const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
  const type = String(payload.type || '');
  if (name.length < 2 || name.length > 120) {
    throw new ApiError('Название должно содержать от 2 до 120 символов.');
  }
  if (!settings.types.includes(type)) throw new ApiError('Выберите тип из справочника.');
  return {name, nameKey: name.toLocaleLowerCase('ru'), type, firstId: settings.firstId};
}

async function createCatalogItem(env, catalog, payload) {
  const item = normalizeCatalogItem(catalog, payload);
  const next = await env.DB.prepare(
    'SELECT MAX(id) AS max_id FROM catalog_items WHERE catalog = ? AND id >= ?'
  ).bind(catalog, item.firstId).first();
  const id = Math.max(item.firstId, Number(next?.max_id || 0) + 1);
  try {
    await env.DB.prepare(
      'INSERT INTO catalog_items (id, catalog, name, name_key, type) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, catalog, item.name, item.nameKey, item.type).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new ApiError('Такая запись уже существует.', 409);
    throw error;
  }
  return {id, name: item.name, type: item.type};
}

async function updateCatalogItem(env, catalog, id, payload) {
  const item = normalizeCatalogItem(catalog, payload);
  try {
    await env.DB.prepare(
      'INSERT INTO catalog_items (id, catalog, name, name_key, type) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, type = excluded.type, catalog = excluded.catalog'
    ).bind(id, catalog, item.name, item.nameKey, item.type).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new ApiError('Такая запись уже существует.', 409);
    throw error;
  }
  return {id, name: item.name, type: item.type};
}

function similarCollections(collections, config, excludeId = null) {
  return collections.map(item => {
    if (item.id === excludeId) return null;
    const sharedThemes = item.themeIds.filter(id => id !== 1 && config.themeIds.includes(id));
    const reasons = [];
    let score = 0;
    if (item.geographyId === config.geographyId && config.geographyId !== 1) {
      reasons.push('та же география');
      score += 5;
    }
    if (sharedThemes.length) {
      reasons.push('общих тем: ' + sharedThemes.length);
      score += sharedThemes.length * 3;
    }
    if (item.hotelCount === config.hotelCount) {
      reasons.push('то же количество отелей');
      score += 1;
    }
    if (
      config.discountPercent != null &&
      item.discountPercent === config.discountPercent &&
      item.benefitType === config.benefitType
    ) {
      reasons.push('та же выгода');
      score += 1;
    }
    if (!reasons.length) return null;
    return {score, item: {...item, similarity: reasons}};
  })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
    .slice(0, 6)
    .map(entry => entry.item);
}

async function lookupCollection(env, payload) {
  const config = normalizeConfig(payload);
  const collections = await allCollections(env);
  const exact = collections.find(item => (
    JSON.stringify([
      item.geographyId,
      [...item.themeIds].sort((a, b) => a - b),
      item.hotelCount,
      item.benefitType,
      item.discountPercent,
    ]) === config.key
  )) || null;
  return {
    rawCollections: true,
    exact,
    similar: similarCollections(collections, config, exact?.id ?? null),
  };
}

async function saveCollection(env, payload) {
  const config = normalizeConfig(payload);
  const links = normalizeLinks(payload.links, config.hotelCount);
  const existing = await env.DB.prepare('SELECT id FROM collections WHERE key = ?').bind(config.key).first();
  if (existing) throw new ApiError('Такая подборка уже существует.', 409);
  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    'INSERT INTO collections (key, geography_id, theme_ids, hotel_count, benefit_type, discount_percent, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    config.key,
    config.geographyId,
    JSON.stringify(config.themeIds),
    config.hotelCount,
    config.benefitType,
    config.discountPercent,
    now,
    now
  ).run();
  const id = Number(insert.meta.last_row_id);
  await env.DB.batch(links.map((url, index) => env.DB.prepare(
    'INSERT INTO hotel_links (collection_id, position, url) VALUES (?, ?, ?)'
  ).bind(id, index + 1, url)));
  return {rawCollections: true, id};
}

async function updateCollectionLinks(env, id, payload) {
  const row = await env.DB.prepare('SELECT hotel_count FROM collections WHERE id = ?').bind(id).first();
  if (!row) throw new ApiError('Подборка не найдена.', 404);
  const links = normalizeLinks(payload.links, Number(row.hotel_count));
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare('DELETE FROM hotel_links WHERE collection_id = ?').bind(id),
    ...links.map((url, index) => env.DB.prepare(
      'INSERT INTO hotel_links (collection_id, position, url) VALUES (?, ?, ?)'
    ).bind(id, index + 1, url)),
    env.DB.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').bind(now, id),
  ];
  await env.DB.batch(statements);
  return {rawCollections: true, id};
}

async function deleteCollection(env, id) {
  const row = await env.DB.prepare('SELECT id FROM collections WHERE id = ?').bind(id).first();
  if (!row) throw new ApiError('Подборка не найдена.', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hotel_links WHERE collection_id = ?').bind(id),
    env.DB.prepare('DELETE FROM collections WHERE id = ?').bind(id),
  ]);
  return {id, deleted: true};
}

function hotelSearchFilters(themeIds) {
  const ids = new Set(themeIds);
  const argumentsValue = {};
  const hotelAmenities = [...new Set(
    [...ids].filter(id => THEME_HOTEL_AMENITIES[id]).map(id => THEME_HOTEL_AMENITIES[id])
  )].sort();
  const roomAmenities = [...new Set(
    [...ids].filter(id => THEME_ROOM_AMENITIES[id]).map(id => THEME_ROOM_AMENITIES[id])
  )].sort();
  const stars = [...new Set(
    [...ids].filter(id => THEME_STARS[id]).map(id => THEME_STARS[id])
  )].sort();
  if (hotelAmenities.length) argumentsValue.hotel_amenities = hotelAmenities;
  if (roomAmenities.length) argumentsValue.room_amenities = roomAmenities;
  if (stars.length) argumentsValue.stars = stars;
  if (ids.has(58)) argumentsValue.breakfast_included = true;
  if (ids.has(59)) argumentsValue.meals = ['allinclusive'];
  if (ids.has(85)) argumentsValue.hotel_types = ['apartments'];
  else if (ids.has(COUNTRYSIDE_THEME_ID)) argumentsValue.hotel_types = ['hotel', 'guesthouse'];
  if (ids.has(94)) argumentsValue.min_rating = 8;
  return argumentsValue;
}

function geographyKey(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function hotelSearchGeography(geographyName, themeIds) {
  if (!themeIds.includes(COUNTRYSIDE_THEME_ID)) return geographyName;
  return COUNTRYSIDE_SEARCH_GEOGRAPHIES[geographyKey(geographyName)] || geographyName;
}

function countrysideHotelMatches(hotel, requestedGeographyName, themeIds) {
  if (!themeIds.includes(COUNTRYSIDE_THEME_ID)) return true;
  const name = geographyKey(hotel?.name);
  const address = geographyKey(hotel?.address);
  const combined = `${name} ${address}`;
  if (/(хостел|hostel|shelter|апарт[ -]?отел|апартамент|apart|капсул|общежит|вокзал)/i.test(combined)) {
    return false;
  }
  if (geographyKey(requestedGeographyName) === 'москва') {
    const isMoscowRegion = /(московск(?:ая|ой)\s+област|подмосков)/i.test(address);
    const isMoscowCity = /(^|[,\s])(?:г(?:ород)?\.?\s*)?москва(?:[,\s]|$)/i.test(address);
    if (isMoscowCity && !isMoscowRegion) return false;
  }
  const leisureProperty = /(парк[ -]?отел|загород|эко|eco|усадьб|база отдыха|дом отдыха|санатор|курорт|resort|глэмп|коттедж|спа|spa|дач|турбаз|ферм)/i.test(name);
  const ruralAddress = /(деревн|село|пос[её]лок|территор|урочище|лесн|берег|район|шоссе)/i.test(address);
  return leisureProperty || ruralAddress;
}

function numericHotelValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function hotelRating(hotel) {
  const summary = hotel?.review_summary;
  const values = [hotel?.rating, summary?.rating, summary?.score, summary?.value];
  for (const value of values) {
    const number = numericHotelValue(value);
    if (number != null && number >= 0 && number <= 10) return number;
  }
  return null;
}

function hotelReviewCount(hotel) {
  const summary = hotel?.review_summary;
  const values = [
    hotel?.reviewCount,
    summary?.count,
    summary?.review_count,
    summary?.reviews_count,
    summary?.total,
    hotel?.review_count,
    hotel?.reviews_count,
  ];
  for (const value of values) {
    const number = numericHotelValue(value);
    if (number != null && number >= 0) return Math.floor(number);
  }
  return 0;
}

function hotelQualityScore(hotel) {
  const rating = hotelRating(hotel);
  if (rating == null) return -1;
  const reviews = hotelReviewCount(hotel);
  return (
    rating * reviews + HOTEL_RATING_PRIOR * HOTEL_RATING_CONFIDENCE
  ) / (reviews + HOTEL_RATING_CONFIDENCE);
}

function compareHotelsByQuality(left, right) {
  return hotelQualityScore(right) - hotelQualityScore(left)
    || (hotelRating(right) ?? -1) - (hotelRating(left) ?? -1)
    || hotelReviewCount(right) - hotelReviewCount(left)
    || String(left?.name || '').localeCompare(String(right?.name || ''), 'ru');
}

function validateDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(label + ': используйте формат ГГГГ-ММ-ДД.');
  }
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) throw new ApiError(label + ': некорректная дата.');
  return date;
}

function mcpToolData(result) {
  const content = Array.isArray(result.content) ? result.content : [];
  const message = content
    .filter(item => item?.type === 'text' && item.text)
    .map(item => item.text)
    .join(' ');
  if (result.isError) throw new ApiError(message || 'Tutu MCP не смог выполнить поиск.', 502);
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  for (const item of content) {
    if (item?.type !== 'text') continue;
    try {
      const value = JSON.parse(item.text);
      if (value && typeof value === 'object') return value;
    } catch {}
  }
  throw new ApiError('Tutu MCP вернул ответ в неподдерживаемом формате.', 502);
}

async function callMcpTool(name, argumentsValue) {
  let response;
  try {
    response = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {name, arguments: argumentsValue},
      }),
    });
  } catch {
    throw new ApiError('Не удалось связаться с Tutu MCP. Попробуйте ещё раз.', 502);
  }
  if (!response.ok) throw new ApiError('Tutu MCP временно недоступен: HTTP ' + response.status + '.', 502);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('Tutu MCP вернул некорректный ответ.', 502);
  }
  if (payload.error) throw new ApiError(payload.error.message || 'Tutu MCP не смог выполнить поиск.', 502);
  if (!payload.result) throw new ApiError('Tutu MCP вернул пустой ответ.', 502);
  return mcpToolData(payload.result);
}

function appendMcpAttribution(url) {
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const fragment = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const parsed = new URL(base);
  const additions = [];
  if (!parsed.searchParams.has('utm_source')) additions.push('utm_source=tutu-collections');
  if (!parsed.searchParams.has('utm_medium')) additions.push('utm_medium=mcp');
  if (!additions.length) return url;
  return base + (base.includes('?') ? '&' : '?') + additions.join('&') + fragment;
}

async function searchHotels(payload) {
  const geographyName = String(payload.geographyName || '').trim();
  if (!geographyName || geographyName === 'Без географии') {
    throw new ApiError('Для автоматического поиска выберите конкретную географию.');
  }
  const checkIn = validateDate(payload.checkIn, 'Дата заезда');
  const checkOut = validateDate(payload.checkOut, 'Дата выезда');
  if (checkOut <= checkIn) throw new ApiError('Дата выезда должна быть позже даты заезда.');
  const adults = positiveInteger(payload.adults, 1, 6, 'Количество гостей');
  const requested = positiveInteger(payload.hotelCount, 1, 100, 'Количество отелей');
  const themeIds = Array.isArray(payload.themeIds)
    ? payload.themeIds.map(value => positiveInteger(value, 1, 10000000, 'Тема'))
    : [];
  const requestedGeographyName = String(payload.requestedGeographyName || geographyName).trim();
  const searchGeography = hotelSearchGeography(geographyName, themeIds);
  const baseArguments = {
    city_name: searchGeography,
    check_in: payload.checkIn,
    check_out: payload.checkOut,
    adults,
    view: 'compact',
    ...hotelSearchFilters(themeIds),
  };
  const candidates = [];
  const seen = new Set();
  let resolvedGeo = null;
  let page = 1;
  let hasMore = true;
  const candidateLimit = Math.min(MAX_HOTEL_CANDIDATES, Math.max(30, requested * 6));
  while (candidates.length < candidateLimit && page <= 10 && hasMore) {
    const data = await callMcpTool('search_hotels', {
      ...baseArguments,
      page,
      page_size: Math.min(30, candidateLimit - candidates.length),
    });
    const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
    resolvedGeo ||= meta.resolved_geo || null;
    const rows = Array.isArray(data.hotels) ? data.hotels : [];
    for (const hotel of rows) {
      if (!countrysideHotelMatches(hotel, requestedGeographyName, themeIds)) continue;
      const offer = hotel?.best_offer;
      const link = offer?.checkout_url;
      if (typeof link !== 'string' || !/^https?:\/\//.test(link)) continue;
      const attributed = appendMcpAttribution(link);
      const key = attributed.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        name: hotel.name || 'Отель',
        stars: hotel.stars ?? null,
        rating: hotelRating(hotel),
        reviewCount: hotelReviewCount(hotel),
        address: hotel.address ?? null,
        price: offer.price ?? null,
        url: attributed,
      });
      if (candidates.length >= candidateLimit) break;
    }
    hasMore = Boolean(meta.has_more) && rows.length > 0;
    page += 1;
  }
  if (!candidates.length) {
    const message = themeIds.includes(COUNTRYSIDE_THEME_ID)
      ? 'Не нашлось отелей, которые действительно подходят для загородного отдыха. Попробуйте другие даты или выберите регион.'
      : 'Tutu не нашёл подходящих отелей. Попробуйте изменить даты или темы.';
    throw new ApiError(message, 404);
  }
  const hotels = candidates.sort(compareHotelsByQuality).slice(0, requested);
  return {
    hotels,
    requested,
    found: hotels.length,
    resolvedGeo,
    searchGeography,
    ranking: 'rating_and_reviews',
  };
}

async function route(request, env) {
  if (!env.DB) throw new ApiError('Общая база данных ещё не подключена.', 503);
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/health') {
    return {status: 'ok'};
  }
  if (request.method === 'GET' && path === '/api/bootstrap') {
    return bootstrap(env);
  }
  const collectionMatch = path.match(/^\/api\/collections\/(-?\d+)$/);
  if (request.method === 'DELETE' && collectionMatch) {
    return deleteCollection(env, Number(collectionMatch[1]));
  }
  const payload = await readJson(request);
  if (request.method === 'POST' && path === '/api/lookup') {
    return lookupCollection(env, payload);
  }
  if (request.method === 'POST' && path === '/api/collections') {
    return saveCollection(env, payload);
  }
  if (request.method === 'POST' && path === '/api/hotel-search') {
    return searchHotels(payload);
  }
  const catalogMatch = path.match(/^\/api\/(geographies|themes)$/);
  if (request.method === 'POST' && catalogMatch) {
    return createCatalogItem(env, catalogMatch[1], payload);
  }
  const catalogItemMatch = path.match(/^\/api\/(geographies|themes)\/(\d+)$/);
  if (request.method === 'PATCH' && catalogItemMatch) {
    return updateCatalogItem(env, catalogItemMatch[1], Number(catalogItemMatch[2]), payload);
  }
  if (request.method === 'PUT' && collectionMatch) {
    return updateCollectionLinks(env, Number(collectionMatch[1]), payload);
  }
  throw new ApiError('Страница не найдена.', 404);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!origin || !allowedOrigins(env).has(origin)) {
        return jsonResponse(request, env, {error: 'Этот сайт не может обращаться к серверу.'}, 403);
      }
      return new Response(null, {status: 204, headers: corsHeaders(request, env)});
    }
    try {
      assertAllowedOrigin(request, env);
      const payload = await route(request, env);
      return jsonResponse(request, env, await payload);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonResponse(request, env, {error: error.message}, error.status);
      }
      return jsonResponse(request, env, {error: 'Внутренняя ошибка сервера.'}, 500);
    }
  },
};
