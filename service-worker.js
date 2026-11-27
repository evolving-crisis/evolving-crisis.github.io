---
---

const CACHE_PREFIX = 'evolving-crisis-site-';
const CACHE_NAME = `${CACHE_PREFIX}{{ site.time | date: "%s" }}`;
const RADIO_URL = {{ "/modules/radio-chaito/" | relative_url | jsonify }};
const RADIO_PATH = new URL(RADIO_URL, self.location.origin).pathname;
const IMAGE_EXTENSIONS = "avif,bmp,gif,ico,jpeg,jpg,png,svg,tif,tiff,webp".split(",");
const PRECACHE_URLS = [
  {{ "/" | relative_url | jsonify }},
  {% for page in site.pages %}
    {% unless page.url == "/service-worker.js" %}
      {{ page.url | relative_url | jsonify }},
    {% endunless %}
  {% endfor %}
  {% assign image_extensions = "avif,bmp,gif,ico,jpeg,jpg,png,svg,tif,tiff,webp" | split: "," %}
  {% for file in site.static_files %}
    {% assign file_extension = file.name | split: "." | last | downcase %}
    {% unless image_extensions contains file_extension %}
      {{ file.path | relative_url | jsonify }},
      {% if file.name == "index.html" %}
        {% assign directory_url = file.path | remove: "index.html" %}
        {{ directory_url | relative_url | jsonify }},
      {% endif %}
    {% endunless %}
  {% endfor %}
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(PRECACHE_URLS.map(async url => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok && response.type === 'basic') {
          await cache.put(url, response);
        }
      } catch (error) {
        console.warn('Offline precache failed for', url, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (request.destination === 'image' || IMAGE_EXTENSIONS.includes(url.pathname.split('.').pop().toLowerCase())) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  if (url.origin !== self.location.origin || request.headers.has('range')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request) ||
      (url.pathname === RADIO_PATH ? await cache.match(RADIO_URL) : undefined);
    const forceFresh = request.cache === 'no-store' || request.cache === 'reload';
    const networkRequest = fetch(request).then(async response => {
      if (response.ok && response.type === 'basic' && response.status === 200) {
        try {
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn('Offline cache update failed for', request.url, error);
        }
      }
      return response;
    });

    if (cachedResponse && !forceFresh) {
      event.waitUntil(networkRequest.catch(() => undefined));
      return cachedResponse;
    }

    try {
      return await networkRequest;
    } catch (error) {
      if (cachedResponse) return cachedResponse;
      if (request.mode === 'navigate') {
        const homePage = await cache.match({{ "/" | relative_url | jsonify }});
        if (homePage) return homePage;
      }
      throw error;
    }
  })());
});
