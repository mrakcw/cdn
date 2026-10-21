/*!
 * Browser Risk Assessment — browser-risk.js
 * Диагностика браузерного окружения: собирает доступные сайту сигналы, проверяет их согласованность
 * и объясняет каждый балл риска. Не маскирует автоматизацию и не обещает прохождение проверок.
 *
 * Подключение: <script src="browser-risk.js"></script> → window.BrowserRisk
 * Без зависимостей, без сборщика, без отправки данных третьим лицам.
 */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'browser-risk-report/1';

  // Заголовки, которые анализирует серверная часть. Остальные (Cookie, Authorization и т. п.) не собираются.
  const SERVER_HEADERS = [
    'user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile',
    'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'accept', 'accept-encoding',
  ];

  // Веса правил (баллы при срабатывании). Правила одного фактора не суммируются — берётся максимум.
  // Слабые признаки (weak) суммарно ограничены WEAK_CAP. Настраивается через options.weights.
  const DEFAULT_WEIGHTS = {
    // client-side
    'client.webdriver': 45,
    'client.headless-ua': 40,
    'client.ua-hints-version': 20,
    'client.ua-hints-headless': 40,
    'client.platform-mismatch': 20,
    'client.languages-empty': 15,
    'client.language-order': 5,
    'client.window-outer-zero': 20,
    'client.window-larger-than-screen': 10,
    'client.window-outer-smaller': 10,
    'client.screen-equals-viewport': 10,
    'client.dpr-fractional': 5,
    'client.software-gpu': 15,
    'client.webgl-unavailable': 5,
    'client.plugins-empty': 5,
    'client.chrome-object-missing': 10,
    'client.notification-permission': 10,
    'client.hardware-concurrency': 5,
    'client.webrtc-missing': 5,
    'client.timezone-language': 0,
    // server-side
    'server.headless-ua': 40,
    'server.ua-mismatch-client': 25,
    'server.ch-ua-version': 20,
    'server.ch-ua-missing': 10,
    'server.ch-platform-mismatch': 15,
    'server.accept-language-missing': 15,
    'server.accept-language-client': 10,
    'server.fetch-metadata-missing': 10,
    'server.accept-unusual': 10,
    'server.accept-encoding': 5,
  };

  const WEAK_CAP = 15;
  const LEVELS = [
    { max: 34, level: 'low' },
    { max: 69, level: 'medium' },
    { max: 100, level: 'high' },
  ];

  // ---------- Значения: отличаем «нет API», ошибку, false, 0 и пустой массив ----------

  function ok(value) {
    return { state: 'ok', value };
  }

  function unsupported(note) {
    return { state: 'unsupported', value: null, note: note || 'API не поддерживается в этом браузере' };
  }

  function failed(error) {
    return { state: 'error', value: null, note: String(error && error.message ? error.message : error) };
  }

  function read(fn) {
    try {
      const value = fn();
      return value === undefined ? unsupported() : ok(value);
    } catch (error) {
      return failed(error);
    }
  }

  function val(params, key) {
    const entry = params && params[key];
    return entry && entry.state === 'ok' ? entry.value : undefined;
  }

  function has(params, key) {
    return Boolean(params && params[key] && params[key].state === 'ok');
  }

  // ---------- Сбор client-side ----------

  async function collectClient(options) {
    const opts = options || {};
    const started = Date.now();
    const params = {};
    const errors = [];
    const stage = async (name, fn) => {
      try {
        await fn();
      } catch (error) {
        errors.push({ stage: name, message: String(error && error.message ? error.message : error) });
      }
    };
    const nav = root.navigator || {};

    await stage('identity', async () => {
      params['navigator.userAgent'] = read(() => nav.userAgent);
      params['navigator.platform'] = read(() => nav.platform);
      params['navigator.webdriver'] = read(() => nav.webdriver);
      params['navigator.vendor'] = read(() => nav.vendor);
      params['navigator.appVersion'] = read(() => nav.appVersion);
      params['window.chrome'] = read(() => (typeof root.chrome === 'undefined' ? undefined : typeof root.chrome));
      if (nav.userAgentData) {
        const data = nav.userAgentData;
        params['navigator.userAgentData.brands'] = read(() => (data.brands || []).map((b) => `${b.brand} ${b.version}`));
        params['navigator.userAgentData.mobile'] = read(() => data.mobile);
        params['navigator.userAgentData.platform'] = read(() => data.platform);
        if (typeof data.getHighEntropyValues === 'function') {
          try {
            const high = await data.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'fullVersionList', 'model']);
            params['navigator.userAgentData.platformVersion'] = ok(high.platformVersion);
            params['navigator.userAgentData.architecture'] = ok(high.architecture);
            params['navigator.userAgentData.bitness'] = ok(high.bitness);
            params['navigator.userAgentData.fullVersionList'] = ok((high.fullVersionList || []).map((b) => `${b.brand} ${b.version}`));
          } catch (error) {
            params['navigator.userAgentData.fullVersionList'] = failed(error);
          }
        }
      } else {
        params['navigator.userAgentData.brands'] = unsupported('userAgentData доступен только в Chromium и только в защищённом контексте (HTTPS или localhost)');
      }
    });

    await stage('language', async () => {
      params['navigator.language'] = read(() => nav.language);
      params['navigator.languages'] = read(() => (nav.languages ? Array.from(nav.languages) : undefined));
      const resolved = read(() => Intl.DateTimeFormat().resolvedOptions());
      params['Intl.timeZone'] = resolved.state === 'ok' ? ok(resolved.value.timeZone) : resolved;
      params['Intl.locale'] = resolved.state === 'ok' ? ok(resolved.value.locale) : resolved;
    });

    await stage('screen', async () => {
      const screen = root.screen || {};
      for (const key of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) {
        params[`screen.${key}`] = read(() => screen[key]);
      }
      for (const key of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio']) {
        params[`window.${key}`] = read(() => root[key]);
      }
    });

    await stage('hardware', async () => {
      params['navigator.hardwareConcurrency'] = read(() => nav.hardwareConcurrency);
      params['navigator.deviceMemory'] = read(() => nav.deviceMemory);
      params['navigator.maxTouchPoints'] = read(() => nav.maxTouchPoints);
      params['navigator.onLine'] = read(() => nav.onLine);
    });

    await stage('plugins', async () => {
      params['navigator.plugins.length'] = read(() => (nav.plugins ? nav.plugins.length : undefined));
      params['navigator.plugins.names'] = read(() => (nav.plugins ? Array.from(nav.plugins).map((p) => p.name) : undefined));
      params['navigator.mimeTypes.length'] = read(() => (nav.mimeTypes ? nav.mimeTypes.length : undefined));
    });

    await stage('webgl', async () => {
      if (!root.document || typeof root.document.createElement !== 'function') {
        params['webgl.available'] = unsupported('нет DOM');
        return;
      }
      const canvas = root.document.createElement('canvas');
      let gl = null;
      try {
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      } catch (error) {
        params['webgl.available'] = failed(error);
        return;
      }
      if (!gl) {
        params['webgl.available'] = ok(false);
        params['webgl.reason'] = ok('getContext("webgl") вернул null: WebGL отключён политикой, флагом запуска, драйвером или нет GPU');
        return;
      }
      params['webgl.available'] = ok(true);
      params['webgl.vendor'] = read(() => gl.getParameter(gl.VENDOR));
      params['webgl.renderer'] = read(() => gl.getParameter(gl.RENDERER));
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      if (debug) {
        params['webgl.unmaskedVendor'] = read(() => gl.getParameter(debug.UNMASKED_VENDOR_WEBGL));
        params['webgl.unmaskedRenderer'] = read(() => gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
      } else {
        params['webgl.unmaskedRenderer'] = unsupported('расширение WEBGL_debug_renderer_info недоступно');
      }
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    });

    await stage('apis', async () => {
      params['api.canvas2d'] = read(() => {
        if (!root.document) return undefined;
        const canvas = root.document.createElement('canvas');
        return Boolean(canvas.getContext && canvas.getContext('2d'));
      });
      params['api.webrtc'] = ok(typeof root.RTCPeerConnection === 'function');
      params['api.webassembly'] = ok(typeof root.WebAssembly === 'object' && typeof root.WebAssembly.validate === 'function');
      params['api.workers'] = ok(typeof root.Worker === 'function');
      params['api.intl'] = ok(typeof root.Intl === 'object');
      params['api.permissions'] = ok(Boolean(nav.permissions && typeof nav.permissions.query === 'function'));
      params['Notification.permission'] = read(() => (typeof root.Notification === 'function' ? root.Notification.permission : undefined));
      if (nav.permissions && typeof nav.permissions.query === 'function') {
        try {
          const status = await nav.permissions.query({ name: 'notifications' });
          params['permissions.notifications'] = ok(status.state);
        } catch (error) {
          params['permissions.notifications'] = failed(error);
        }
      }
    });

    return { params, errors, durationMs: Date.now() - started, collectedAt: new Date().toISOString(), context: opts.context || null };
  }

  // ---------- Разбор User-Agent и Client Hints ----------

  function parseUserAgent(ua) {
    const text = String(ua || '');
    const chrome = /(?:HeadlessChrome|Chrome|Chromium)\/(\d+)/.exec(text);
    let platform = null;
    if (/Windows NT/.test(text)) platform = 'Windows';
    else if (/Android/.test(text)) platform = 'Android';
    else if (/iPhone|iPad|iPod/.test(text)) platform = 'iOS';
    else if (/Mac OS X|Macintosh/.test(text)) platform = 'macOS';
    else if (/CrOS/.test(text)) platform = 'Chrome OS';
    else if (/Linux/.test(text)) platform = 'Linux';
    return {
      headless: /HeadlessChrome/.test(text),
      chromium: Boolean(chrome),
      major: chrome ? Number(chrome[1]) : null,
      platform,
      mobile: /Mobile|Android|iPhone/.test(text),
    };
  }

  // Sec-CH-UA: "Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"
  function parseClientHintBrands(value) {
    const brands = [];
    const re = /"([^"]+)"\s*;\s*v="([^"]*)"/g;
    let match;
    while ((match = re.exec(String(value || '')))) brands.push({ brand: match[1], version: match[2] });
    return brands;
  }

  function brandsFromClient(list) {
    return (list || []).map((entry) => {
      const index = String(entry).lastIndexOf(' ');
      return { brand: String(entry).slice(0, index), version: String(entry).slice(index + 1) };
    });
  }

  function chromiumMajorFromBrands(brands) {
    const main = brands.find((b) => /^(Google Chrome|Chromium|HeadlessChrome|Microsoft Edge)$/i.test(b.brand));
    return main ? Number(String(main.version).split('.')[0]) : null;
  }

  function unquote(value) {
    return String(value || '').replace(/^"|"$/g, '');
  }

  function platformFamily(value) {
    const text = String(value || '').toLowerCase();
    if (!text) return null;
    if (text.startsWith('win')) return 'Windows';
    if (text.includes('mac')) return 'macOS';
    if (text.includes('android')) return 'Android';
    if (text.includes('linux') || text.includes('x11')) return 'Linux';
    if (text.includes('iphone') || text.includes('ipad') || text.includes('ios')) return 'iOS';
    if (text.includes('cros') || text.includes('chrome os')) return 'Chrome OS';
    return value;
  }

  function primaryLanguage(value) {
    return String(value || '').split(',')[0].split(';')[0].trim().toLowerCase().split('-')[0] || null;
  }

  // ---------- Проверки ----------
  // Результат проверки: id, status, params, observed, explanation, severity, points, factor, weak.
  // status: ok — согласовано; mismatch — фактическое несоответствие; acceptable — допустимое отличие;
  // insufficient — недостаточно данных; info — справочно.

  function makeCheck(weights, def) {
    const weight = Object.prototype.hasOwnProperty.call(weights, def.id) ? weights[def.id] : 0;
    const fired = def.status === 'mismatch';
    return {
      id: def.id,
      status: def.status,
      params: def.params,
      observed: def.observed,
      explanation: def.explanation,
      severity: fired ? (weight >= 30 ? 'high' : weight >= 10 ? 'medium' : 'low') : 'none',
      points: fired ? weight : 0,
      factor: def.factor || def.id,
      weak: Boolean(def.weak),
    };
  }

  function analyzeClient(params, options) {
    const weights = Object.assign({}, DEFAULT_WEIGHTS, (options && options.weights) || {});
    const checks = [];
    const add = (def) => checks.push(makeCheck(weights, def));
    const ua = val(params, 'navigator.userAgent');
    const parsed = parseUserAgent(ua);

    // navigator.webdriver
    const webdriver = params['navigator.webdriver'];
    if (!webdriver || webdriver.state !== 'ok') {
      add({ id: 'client.webdriver', status: 'insufficient', params: ['navigator.webdriver'], observed: 'navigator.webdriver недоступен', explanation: 'Свойство отсутствует в некоторых браузерах; отсутствие не считается признаком автоматизации.' });
    } else {
      add({
        id: 'client.webdriver', factor: 'automation-flag',
        status: webdriver.value === true ? 'mismatch' : 'ok',
        params: ['navigator.webdriver'],
        observed: `navigator.webdriver = ${webdriver.value}`,
        explanation: webdriver.value === true
          ? 'Браузер сам сообщает, что управляется программой (WebDriver/CDP). Playwright и Selenium включают этот флаг по умолчанию; это стандартный открытый сигнал.'
          : 'Флаг автоматизации не выставлен.',
      });
    }

    // HeadlessChrome в User-Agent
    if (ua === undefined) {
      add({ id: 'client.headless-ua', status: 'insufficient', params: ['navigator.userAgent'], observed: 'User-Agent недоступен', explanation: 'Нечего проверять.' });
    } else {
      add({
        id: 'client.headless-ua', factor: 'headless',
        status: parsed.headless ? 'mismatch' : 'ok',
        params: ['navigator.userAgent'],
        observed: parsed.headless ? 'User-Agent содержит «HeadlessChrome»' : 'В User-Agent нет «HeadlessChrome»',
        explanation: parsed.headless ? 'Chromium без окна (headless) сообщает об этом прямо в User-Agent.' : 'Обычное обозначение браузера.',
      });
    }

    // User-Agent ↔ userAgentData
    const brandsEntry = params['navigator.userAgentData.brands'];
    if (!brandsEntry || brandsEntry.state !== 'ok' || !parsed.chromium) {
      add({
        id: 'client.ua-hints-version', status: 'insufficient', params: ['navigator.userAgent', 'navigator.userAgentData.brands'],
        observed: 'userAgentData недоступен или браузер не на Chromium',
        explanation: 'userAgentData есть только в Chromium и только в защищённом контексте; сравнение невозможно.',
      });
    } else {
      const brands = brandsFromClient(brandsEntry.value);
      const major = chromiumMajorFromBrands(brands);
      const headlessBrand = brands.some((b) => /Headless/i.test(b.brand));
      add({
        id: 'client.ua-hints-headless', factor: 'headless',
        status: headlessBrand ? 'mismatch' : 'ok',
        params: ['navigator.userAgentData.brands'],
        observed: `brands: ${brandsEntry.value.join(', ')}`,
        explanation: headlessBrand ? 'В списке брендов Client Hints есть HeadlessChrome.' : 'Бренды Client Hints обычные.',
      });
      if (major === null || parsed.major === null) {
        add({ id: 'client.ua-hints-version', status: 'insufficient', params: ['navigator.userAgent', 'navigator.userAgentData.brands'], observed: 'Не удалось определить основную версию', explanation: 'Нет бренда Chrome/Chromium в userAgentData.' });
      } else {
        add({
          id: 'client.ua-hints-version', factor: 'ua-consistency',
          status: major === parsed.major ? 'ok' : 'mismatch',
          params: ['navigator.userAgent', 'navigator.userAgentData.brands'],
          observed: `User-Agent: ${parsed.major}, userAgentData: ${major}`,
          explanation: major === parsed.major
            ? 'Версия в User-Agent совпадает с Client Hints.'
            : 'Версия в User-Agent не совпадает с Client Hints: User-Agent переопределён вручную или расширением, а Client Hints — нет.',
        });
      }
    }

    // Платформа: navigator.platform / userAgentData.platform / User-Agent
    const navPlatform = platformFamily(val(params, 'navigator.platform'));
    const hintPlatform = platformFamily(val(params, 'navigator.userAgentData.platform'));
    if (!parsed.platform || (!navPlatform && !hintPlatform)) {
      add({ id: 'client.platform-mismatch', status: 'insufficient', params: ['navigator.userAgent', 'navigator.platform'], observed: 'Платформа не определена', explanation: 'Недостаточно данных для сравнения платформ.' });
    } else {
      const mismatched = [navPlatform, hintPlatform].filter(Boolean).filter((p) => p !== parsed.platform
        && !(parsed.platform === 'Android' && p === 'Linux'));
      add({
        id: 'client.platform-mismatch', factor: 'platform',
        status: mismatched.length ? 'mismatch' : 'ok',
        params: ['navigator.userAgent', 'navigator.platform', 'navigator.userAgentData.platform'],
        observed: `User-Agent: ${parsed.platform}; navigator.platform: ${val(params, 'navigator.platform') ?? '—'}; userAgentData.platform: ${val(params, 'navigator.userAgentData.platform') ?? '—'}`,
        explanation: mismatched.length
          ? 'Платформа в User-Agent не совпадает с navigator.platform или Client Hints — обычно следствие подмены User-Agent.'
          : 'Платформа согласована.',
      });
    }

    // Языки
    const languages = params['navigator.languages'];
    if (!languages || languages.state !== 'ok') {
      add({ id: 'client.languages-empty', status: 'insufficient', params: ['navigator.languages'], observed: 'navigator.languages недоступен', explanation: 'Нечего проверять.' });
    } else {
      add({
        id: 'client.languages-empty', factor: 'languages',
        status: languages.value.length === 0 ? 'mismatch' : 'ok',
        params: ['navigator.languages'],
        observed: `navigator.languages = [${languages.value.join(', ')}]`,
        explanation: languages.value.length === 0
          ? 'Пустой список языков бывает у автоматизированных и headless-браузеров; у обычного Chrome он не пуст.'
          : 'Список языков не пуст.',
      });
      const first = languages.value[0];
      const language = val(params, 'navigator.language');
      if (first && language) {
        add({
          id: 'client.language-order', factor: 'languages', weak: true,
          status: first === language ? 'ok' : 'mismatch',
          params: ['navigator.language', 'navigator.languages'],
          observed: `language = ${language}, languages[0] = ${first}`,
          explanation: first === language ? 'Основной язык совпадает с первым в списке.' : 'navigator.language не совпадает с первым элементом languages.',
        });
      }
    }

    // Окно и экран
    const outerW = val(params, 'window.outerWidth');
    const outerH = val(params, 'window.outerHeight');
    const innerW = val(params, 'window.innerWidth');
    const innerH = val(params, 'window.innerHeight');
    const screenW = val(params, 'screen.width');
    const screenH = val(params, 'screen.height');
    if ([outerW, outerH, innerW, innerH].some((v) => v === undefined)) {
      add({ id: 'client.window-outer-zero', status: 'insufficient', params: ['window.outerWidth', 'window.outerHeight'], observed: 'Размеры окна недоступны', explanation: 'Нечего проверять.' });
    } else {
      add({
        id: 'client.window-outer-zero', factor: 'headless',
        status: outerW === 0 && outerH === 0 ? 'mismatch' : 'ok',
        params: ['window.outerWidth', 'window.outerHeight'],
        observed: `outer ${outerW}×${outerH}, inner ${innerW}×${innerH}`,
        explanation: outerW === 0 && outerH === 0 ? 'Нулевой внешний размер окна характерен для headless-режима.' : 'У окна есть внешний размер.',
      });
      const larger = screenW !== undefined && screenH !== undefined && (innerW > screenW || innerH > screenH);
      add({
        id: 'client.window-larger-than-screen', factor: 'window-geometry',
        status: larger ? 'mismatch' : 'ok',
        params: ['window.innerWidth', 'window.innerHeight', 'screen.width', 'screen.height'],
        observed: `inner ${innerW}×${innerH}, screen ${screenW ?? '—'}×${screenH ?? '—'}`,
        explanation: larger
          ? 'Видимая область больше экрана: размер окна или экрана задан программно (например, viewport в Playwright) или страница масштабирована.'
          : 'Видимая область помещается в экран.',
      });
      // У настольного браузера часть экрана занимают панели и вкладки; экран, точно равный видимой области,
      // обычно означает эмулированный экран (viewport в Playwright/DevTools) или полноэкранный режим.
      if (screenW !== undefined && screenH !== undefined && !parsed.mobile) {
        const equal = screenW === innerW && screenH === innerH;
        add({
          id: 'client.screen-equals-viewport', factor: 'window-geometry',
          status: equal ? 'mismatch' : 'ok',
          params: ['screen.width', 'screen.height', 'window.innerWidth', 'window.innerHeight'],
          observed: `screen ${screenW}×${screenH}, inner ${innerW}×${innerH}`,
          explanation: equal
            ? 'Размер экрана в точности равен видимой области: экран эмулирован под заданный viewport (Playwright, DevTools) или браузер в полноэкранном режиме (F11).'
            : 'Экран больше видимой области, как у обычного окна браузера.',
        });
      }
      const outerSmaller = outerW > 0 && (outerW < innerW || outerH < innerH);
      add({
        id: 'client.window-outer-smaller', factor: 'window-geometry',
        status: outerSmaller ? 'mismatch' : 'ok',
        params: ['window.outerWidth', 'window.innerWidth'],
        observed: `outer ${outerW}×${outerH}, inner ${innerW}×${innerH}`,
        explanation: outerSmaller
          ? 'Внешний размер окна меньше видимой области — так бывает при программно заданном viewport. Масштаб страницы (Ctrl+колесо) тоже может давать такое отличие.'
          : 'Внешний размер окна не меньше видимой области.',
      });
    }

    // devicePixelRatio: реальные значения — 1, 1.25, 1.5, 2… Хвост вроде 1.0000000298 — артефакт эмуляции масштаба.
    const dpr = val(params, 'window.devicePixelRatio');
    if (typeof dpr === 'number') {
      const fractional = Math.abs(dpr * 100 - Math.round(dpr * 100)) > 1e-6;
      add({
        id: 'client.dpr-fractional', factor: 'window-geometry', weak: true,
        status: fractional ? 'mismatch' : 'ok',
        params: ['window.devicePixelRatio'],
        observed: `devicePixelRatio = ${dpr}`,
        explanation: fractional
          ? 'Масштаб с «хвостом» после запятой получается при программной эмуляции deviceScaleFactor; бывает и при нестандартном масштабе Windows — слабый сигнал.'
          : 'Обычное значение масштаба.',
      });
    }

    // Графика
    const webglAvailable = val(params, 'webgl.available');
    if (webglAvailable === undefined) {
      add({ id: 'client.webgl-unavailable', status: 'insufficient', params: ['webgl.available'], observed: 'WebGL не проверен', explanation: 'Нечего проверять.' });
    } else {
      add({
        id: 'client.webgl-unavailable', factor: 'gpu', weak: true,
        status: webglAvailable ? 'ok' : 'mismatch',
        params: ['webgl.available'],
        observed: `WebGL: ${webglAvailable ? 'доступен' : 'недоступен'}`,
        explanation: webglAvailable ? 'WebGL работает.' : 'WebGL недоступен: может быть отключён политикой, драйвером, виртуализацией или флагом запуска — слабый сигнал.',
      });
      const renderer = String(val(params, 'webgl.unmaskedRenderer') || val(params, 'webgl.renderer') || '');
      if (webglAvailable && renderer) {
        const software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(renderer);
        add({
          id: 'client.software-gpu', factor: 'gpu',
          status: software ? 'mismatch' : 'ok',
          params: ['webgl.unmaskedRenderer', 'webgl.renderer'],
          observed: `renderer: ${renderer}`,
          explanation: software
            ? 'Программный рендеринг (SwiftShader/llvmpipe) типичен для headless-режима, контейнеров и виртуальных машин без GPU.'
            : 'Используется аппаратный GPU.',
        });
      }
    }

    // Плагины
    const pluginCount = val(params, 'navigator.plugins.length');
    if (pluginCount === undefined || !parsed.chromium || parsed.mobile) {
      add({ id: 'client.plugins-empty', status: 'insufficient', params: ['navigator.plugins.length'], observed: 'Не применимо', explanation: 'Проверка имеет смысл только для настольного Chromium.' });
    } else {
      add({
        id: 'client.plugins-empty', factor: 'plugins', weak: true,
        status: pluginCount === 0 ? 'mismatch' : 'ok',
        params: ['navigator.plugins.length'],
        observed: `navigator.plugins.length = ${pluginCount}`,
        explanation: pluginCount === 0
          ? 'У настольного Chrome обычно 5 встроенных PDF-плагинов; пустой список бывает в headless-режиме и при отключённом PDF-просмотрщике — слабый сигнал.'
          : 'Плагины перечислены.',
      });
    }

    // window.chrome
    if (parsed.chromium && !parsed.mobile) {
      const chromeObject = params['window.chrome'];
      add({
        id: 'client.chrome-object-missing', factor: 'headless',
        status: chromeObject && chromeObject.state === 'ok' ? 'ok' : 'mismatch',
        params: ['window.chrome', 'navigator.userAgent'],
        observed: chromeObject && chromeObject.state === 'ok' ? 'window.chrome есть' : 'window.chrome отсутствует',
        explanation: chromeObject && chromeObject.state === 'ok'
          ? 'Объект window.chrome на месте, как в обычном Chrome.'
          : 'User-Agent заявляет Chrome, но объекта window.chrome нет — так бывает в headless-режиме и в нестандартных сборках.',
      });
    }

    // Уведомления: противоречие Notification.permission и permissions.query
    const notification = val(params, 'Notification.permission');
    const query = val(params, 'permissions.notifications');
    if (notification === undefined || query === undefined) {
      add({ id: 'client.notification-permission', status: 'insufficient', params: ['Notification.permission', 'permissions.notifications'], observed: 'Данных нет', explanation: 'Notifications или Permissions API недоступны.' });
    } else {
      const contradictory = notification === 'denied' && query === 'prompt';
      add({
        id: 'client.notification-permission', factor: 'headless',
        status: contradictory ? 'mismatch' : 'ok',
        params: ['Notification.permission', 'permissions.notifications'],
        observed: `Notification.permission = ${notification}, permissions.query = ${query}`,
        explanation: contradictory
          ? 'Два API дают противоречивое состояние разрешения на уведомления — известная особенность headless Chromium.'
          : 'Состояния разрешения согласованы.',
      });
    }

    // Процессоры
    const cores = params['navigator.hardwareConcurrency'];
    if (!cores || cores.state !== 'ok') {
      add({ id: 'client.hardware-concurrency', status: 'insufficient', params: ['navigator.hardwareConcurrency'], observed: 'Недоступно', explanation: 'API может быть ограничено браузером; не признак автоматизации.' });
    } else {
      add({
        id: 'client.hardware-concurrency', factor: 'hardware', weak: true,
        status: cores.value > 0 ? 'ok' : 'mismatch',
        params: ['navigator.hardwareConcurrency'],
        observed: `hardwareConcurrency = ${cores.value}`,
        explanation: cores.value > 0 ? 'Число логических процессоров сообщается.' : 'Нулевое число процессоров нетипично для реального устройства.',
      });
    }

    // WebRTC
    const webrtc = val(params, 'api.webrtc');
    if (webrtc !== undefined) {
      add({
        id: 'client.webrtc-missing', factor: 'apis', weak: true,
        status: webrtc ? 'ok' : 'mismatch',
        params: ['api.webrtc'],
        observed: `RTCPeerConnection: ${webrtc ? 'есть' : 'нет'}`,
        explanation: webrtc ? 'WebRTC API доступен.' : 'WebRTC API отключён (флаг запуска, политика или расширение) — слабый сигнал.',
      });
    }

    // Часовой пояс и язык — справочно (по умолчанию 0 баллов)
    const timeZone = val(params, 'Intl.timeZone');
    if (timeZone && languages && languages.state === 'ok' && languages.value.length) {
      add({
        id: 'client.timezone-language', status: 'info',
        params: ['Intl.timeZone', 'navigator.languages'],
        observed: `timeZone = ${timeZone}, languages = [${languages.value.join(', ')}]`,
        explanation: 'Часовой пояс и языки показываются для сравнения с IP (VPN): их расхождение — нормальная ситуация для путешественников и VPN, поэтому баллов не даёт.',
      });
    }

    return checks;
  }

  function analyzeServer(headers, clientParams, options) {
    const weights = Object.assign({}, DEFAULT_WEIGHTS, (options && options.weights) || {});
    const checks = [];
    const add = (def) => checks.push(makeCheck(weights, def));
    const h = (name) => (headers && Object.prototype.hasOwnProperty.call(headers, name) ? headers[name] : undefined);
    const ua = h('user-agent');
    const parsed = parseUserAgent(ua);
    const mode = h('sec-fetch-mode');
    const navigation = mode === 'navigate' || (mode === undefined && h('sec-fetch-dest') === undefined);

    if (ua === undefined) {
      add({ id: 'server.headless-ua', status: 'insufficient', params: ['User-Agent'], observed: 'Заголовок User-Agent отсутствует', explanation: 'Без User-Agent остальные проверки неточны. Отсутствие само по себе не доказывает автоматизацию: его могут убрать прокси.' });
    } else {
      add({
        id: 'server.headless-ua', factor: 'headless',
        status: parsed.headless ? 'mismatch' : 'ok',
        params: ['User-Agent'],
        observed: parsed.headless ? 'User-Agent содержит «HeadlessChrome»' : 'Обычный User-Agent',
        explanation: parsed.headless ? 'Headless Chromium сообщает об этом в заголовке User-Agent.' : 'Признака headless в заголовке нет.',
      });
    }

    const clientUa = val(clientParams, 'navigator.userAgent');
    if (ua !== undefined && clientUa !== undefined) {
      add({
        id: 'server.ua-mismatch-client', factor: 'ua-consistency',
        status: ua === clientUa ? 'ok' : 'mismatch',
        params: ['User-Agent', 'navigator.userAgent'],
        observed: ua === clientUa ? 'Заголовок совпадает с navigator.userAgent' : 'Заголовок отличается от navigator.userAgent',
        explanation: ua === clientUa
          ? 'User-Agent одинаков на уровне HTTP и JavaScript.'
          : 'User-Agent в HTTP и в JavaScript различается: его подменили только на одном уровне (расширение, флаг запуска, прокси).',
      });
    }

    const chUa = h('sec-ch-ua');
    if (parsed.chromium && !parsed.headless) {
      if (chUa === undefined) {
        add({
          id: 'server.ch-ua-missing', factor: 'client-hints',
          status: navigation ? 'mismatch' : 'insufficient',
          params: ['Sec-CH-UA'],
          observed: 'Sec-CH-UA отсутствует',
          explanation: 'Chromium отправляет Sec-CH-UA по HTTPS. Заголовка может не быть из-за HTTP-соединения, прокси или CDN — это не доказательство автоматизации.',
        });
      } else {
        const major = chromiumMajorFromBrands(parseClientHintBrands(chUa));
        add({
          id: 'server.ch-ua-version', factor: 'ua-consistency',
          status: major === null || parsed.major === null ? 'insufficient' : major === parsed.major ? 'ok' : 'mismatch',
          params: ['User-Agent', 'Sec-CH-UA'],
          observed: `User-Agent: ${parsed.major ?? '—'}, Sec-CH-UA: ${major ?? '—'}`,
          explanation: major === parsed.major
            ? 'Версии в User-Agent и Sec-CH-UA совпадают.'
            : 'Версия в User-Agent не совпадает с Sec-CH-UA — признак ручной подмены User-Agent.',
        });
      }
    }

    const chPlatform = h('sec-ch-ua-platform');
    if (chPlatform !== undefined && parsed.platform) {
      const family = platformFamily(unquote(chPlatform));
      add({
        id: 'server.ch-platform-mismatch', factor: 'platform',
        status: family === parsed.platform ? 'ok' : 'mismatch',
        params: ['User-Agent', 'Sec-CH-UA-Platform'],
        observed: `User-Agent: ${parsed.platform}, Sec-CH-UA-Platform: ${unquote(chPlatform)}`,
        explanation: family === parsed.platform ? 'Платформа согласована.' : 'Платформа в User-Agent не совпадает с Client Hints.',
      });
    }

    const acceptLanguage = h('accept-language');
    if (acceptLanguage === undefined) {
      add({
        id: 'server.accept-language-missing', factor: 'languages',
        status: navigation ? 'mismatch' : 'insufficient',
        params: ['Accept-Language'],
        observed: 'Accept-Language отсутствует',
        explanation: 'Обычный браузер отправляет Accept-Language при переходе на страницу. Заголовок может убрать прокси — сигнал средней силы, не доказательство.',
      });
    } else {
      const clientLanguages = val(clientParams, 'navigator.languages');
      if (clientLanguages && clientLanguages.length) {
        const same = primaryLanguage(acceptLanguage) === primaryLanguage(clientLanguages[0]);
        add({
          id: 'server.accept-language-client', factor: 'languages',
          status: same ? 'ok' : 'mismatch',
          params: ['Accept-Language', 'navigator.languages'],
          observed: `Accept-Language: ${acceptLanguage}; navigator.languages: [${clientLanguages.join(', ')}]`,
          explanation: same ? 'Языки в HTTP и JavaScript согласованы.' : 'Основной язык в HTTP отличается от navigator.languages — язык подменён только на одном уровне.',
        });
      }
    }

    const fetchHeaders = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'];
    if (parsed.chromium) {
      const missing = fetchHeaders.filter((name) => h(name) === undefined);
      add({
        id: 'server.fetch-metadata-missing', factor: 'fetch-metadata',
        status: missing.length === fetchHeaders.length ? 'mismatch' : missing.length ? 'acceptable' : 'ok',
        params: ['Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-Dest'],
        observed: missing.length ? `Нет: ${missing.join(', ')}` : `site=${h('sec-fetch-site')}, mode=${h('sec-fetch-mode')}, dest=${h('sec-fetch-dest')}`,
        explanation: missing.length === fetchHeaders.length
          ? 'Современный Chromium отправляет Sec-Fetch-* по HTTPS; их полное отсутствие говорит о HTTP-клиенте, а не браузере, или о прокси.'
          : 'Метаданные запроса присутствуют.',
      });
    }

    const accept = h('accept');
    if (navigation && accept !== undefined) {
      const usual = /text\/html/.test(accept);
      add({
        id: 'server.accept-unusual', factor: 'accept',
        status: usual ? 'ok' : 'mismatch',
        params: ['Accept'],
        observed: `Accept: ${accept}`,
        explanation: usual ? 'При переходе на страницу браузер просит text/html.' : 'Для перехода на страницу Accept без text/html нетипичен для браузера.',
      });
    }

    const encoding = h('accept-encoding');
    if (encoding !== undefined) {
      const modern = /gzip/.test(encoding) && /br/.test(encoding);
      add({
        id: 'server.accept-encoding', factor: 'accept', weak: true,
        status: modern ? 'ok' : 'mismatch',
        params: ['Accept-Encoding'],
        observed: `Accept-Encoding: ${encoding}`,
        explanation: modern ? 'Стандартный набор сжатия Chromium.' : 'Нет gzip или br: так бывает у HTTP-библиотек и некоторых прокси — слабый сигнал.',
      });
    }

    return checks;
  }

  // ---------- Баллы ----------

  function levelOf(score) {
    if (score === null || score === undefined) return 'unavailable';
    return LEVELS.find((entry) => score <= entry.max).level;
  }

  // Правила одного фактора не суммируются (берётся максимум), слабые признаки — не больше WEAK_CAP вместе.
  function score(checks, options) {
    const weakCap = options && Number.isFinite(options.weakCap) ? options.weakCap : WEAK_CAP;
    const byFactor = new Map();
    for (const check of checks) {
      if (check.points <= 0) continue;
      const current = byFactor.get(check.factor);
      if (!current || check.points > current.points) byFactor.set(check.factor, check);
    }
    let strong = 0;
    let weak = 0;
    const counted = [];
    for (const check of byFactor.values()) {
      if (check.weak) weak += check.points;
      else strong += check.points;
      counted.push(check.id);
    }
    const weakApplied = Math.min(weak, weakCap);
    const total = Math.max(0, Math.min(100, strong + weakApplied));
    return {
      score: total,
      level: levelOf(total),
      counted,
      strongPoints: strong,
      weakPoints: weak,
      weakApplied,
      skippedDuplicates: checks.filter((c) => c.points > 0 && !counted.includes(c.id)).map((c) => c.id),
    };
  }

  // ---------- Отчёт ----------

  function buildReport(input) {
    const options = input.options || {};
    const clientChecks = input.client ? analyzeClient(input.client.params, options) : [];
    const serverAvailable = Boolean(input.server && input.server.headers);
    const serverChecks = serverAvailable ? analyzeServer(input.server.headers, input.client ? input.client.params : {}, options) : [];
    const clientScore = input.client ? score(clientChecks, options) : null;
    const serverScore = serverAvailable ? score(serverChecks, options) : null;
    const available = [clientScore && 'client', serverScore && 'server'].filter(Boolean);
    const overall = available.length
      ? Math.round(available.map((name) => (name === 'client' ? clientScore.score : serverScore.score)).reduce((a, b) => a + b, 0) / available.length)
      : null;
    const warnings = clientChecks.concat(serverChecks).filter((check) => check.points > 0).map((check) => ({
      id: check.id, severity: check.severity, points: check.points, observed: check.observed,
    }));
    return {
      schema: SCHEMA,
      tool: { name: 'Browser Risk Assessment', version: VERSION },
      measuredAt: new Date().toISOString(),
      environment: input.environment || null,
      components: {
        client: input.client
          ? { available: true, score: clientScore.score, level: clientScore.level, durationMs: input.client.durationMs }
          : { available: false, score: null, level: 'unavailable' },
        server: serverAvailable
          ? { available: true, score: serverScore.score, level: serverScore.level, source: input.server.source || 'unknown' }
          : { available: false, score: null, level: 'unavailable', reason: (input.server && input.server.reason) || 'Серверный обработчик не подключён' },
      },
      overall: {
        available: overall !== null,
        score: overall,
        level: levelOf(overall),
        basedOn: available,
        method: available.length === 2
          ? 'Среднее client-side и server-side.'
          : available.length === 1
            ? `Только ${available[0]}-side: второй компонент недоступен.`
            : 'Нет доступных компонентов.',
      },
      params: {
        client: input.client ? input.client.params : {},
        server: serverAvailable ? { headers: SERVER_HEADERS.reduce((acc, name) => {
          acc[name] = Object.prototype.hasOwnProperty.call(input.server.headers, name)
            ? { state: 'ok', value: input.server.headers[name] }
            : { state: 'absent', value: null };
          return acc;
        }, {}) } : {},
      },
      checks: { client: clientChecks, server: serverChecks },
      warnings,
      errors: (input.client && input.client.errors) || [],
      scoring: {
        weights: Object.assign({}, DEFAULT_WEIGHTS, options.weights || {}),
        weakCap: Number.isFinite(options.weakCap) ? options.weakCap : WEAK_CAP,
        levels: { low: '0–34', medium: '35–69', high: '70–100' },
        client: clientScore,
        server: serverScore,
        method: 'Балл = сумма весов сработавших правил; правила одного фактора не суммируются (максимум), '
          + 'слабые признаки вместе ограничены weakCap; результат ограничен 0–100. Неизвестные и недоступные '
          + 'значения баллов не дают. Балл — не вероятность и не доказательство автоматизации.',
      },
    };
  }

  async function run(options) {
    const opts = options || {};
    const client = await collectClient(opts);
    const report = buildReport({ client, server: opts.server || null, environment: opts.environment || null, options: opts });
    root.BrowserRisk.lastReport = report;
    return report;
  }

  // ---------- Сравнение двух отчётов ----------

  const DIFF_EXPLANATIONS = [
    [/webdriver/, 'Playwright, Puppeteer и Selenium выставляют navigator.webdriver = true; в обычном Chrome он false.'],
    [/userAgent|appVersion|sec-ch-ua|user-agent/i, 'Разные сборки (Chrome и Chromium из Playwright) или подмена User-Agent.'],
    [/^(screen|window)\./, 'Размер и положение окна, масштаб, программно заданный viewport в Playwright.'],
    [/languages?|accept-language|Intl\.locale/i, 'Язык профиля: временный профиль Playwright берёт язык системы или параметр locale.'],
    [/timeZone/, 'Часовой пояс системы или параметр timezoneId в Playwright.'],
    [/plugins|mimeTypes/, 'Встроенный PDF-просмотрщик: в headless и некоторых сборках Chromium его нет.'],
    [/webgl/, 'GPU и драйвер: программный рендеринг в headless/VM или флаги отключения GPU.'],
    [/permission|Notification/i, 'Временный профиль Playwright не хранит разрешения; в обычном профиле они могли быть заданы ранее.'],
    [/api\.webrtc/, 'WebRTC может быть отключён флагами запуска.'],
    [/hardware|deviceMemory|maxTouchPoints/, 'Аппаратные значения обычно одинаковы на одном ПК; отличие — признак ограничений API или эмуляции.'],
    [/userAgentData/, 'Client Hints: разные сборки Chromium сообщают разные бренды и версии.'],
    [/window\.chrome/, 'В обычном Chrome window.chrome есть всегда; его отсутствие — особенность headless/нестандартной сборки.'],
    [/sec-fetch/i, 'Тип запроса (переход или fetch) и источник перехода.'],
    [/^accept(-encoding)?$/i, 'Набор форматов и сжатий зависит от версии браузера (например, image/jxl и zstd есть не во всех версиях).'],
  ];

  function explainDifference(key) {
    const hit = DIFF_EXPLANATIONS.find(([pattern]) => pattern.test(key));
    return hit ? hit[1] : 'Отличие окружений; само по себе не ошибка.';
  }

  function flattenParams(report) {
    const flat = {};
    const client = (report.params && report.params.client) || {};
    for (const key of Object.keys(client)) flat[`client:${key}`] = client[key];
    const headers = (report.params && report.params.server && report.params.server.headers) || {};
    for (const key of Object.keys(headers)) flat[`server:${key}`] = headers[key];
    return flat;
  }

  function show(entry) {
    if (!entry) return '—';
    if (entry.state !== 'ok') return `(${entry.state})`;
    return Array.isArray(entry.value) ? `[${entry.value.join(', ')}]` : String(entry.value);
  }

  function compareReports(a, b) {
    const left = flattenParams(a);
    const right = flattenParams(b);
    const keys = Array.from(new Set(Object.keys(left).concat(Object.keys(right)))).sort();
    const params = keys.map((key) => {
      const l = left[key];
      const r = right[key];
      let status;
      if (!l || l.state !== 'ok') status = r && r.state === 'ok' ? 'missing-in-a' : 'missing-in-both';
      else if (!r || r.state !== 'ok') status = 'missing-in-b';
      else status = JSON.stringify(l.value) === JSON.stringify(r.value) ? 'same' : 'different';
      const name = key.replace(/^(client|server):/, '');
      return {
        key, a: show(l), b: show(r), status,
        explanation: status === 'same' ? null : explainDifference(name),
      };
    });
    const warningIds = (report) => new Set((report.warnings || []).map((w) => w.id));
    const wa = warningIds(a);
    const wb = warningIds(b);
    const scoreOf = (report, name) => (report.components && report.components[name] ? report.components[name].score : null);
    const delta = (name) => {
      const x = scoreOf(a, name);
      const y = scoreOf(b, name);
      return { a: x, b: y, delta: x === null || y === null ? null : y - x };
    };
    const counts = params.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
    return {
      a: { environment: a.environment, measuredAt: a.measuredAt },
      b: { environment: b.environment, measuredAt: b.measuredAt },
      scores: { client: delta('client'), server: delta('server'), overall: { a: a.overall && a.overall.score, b: b.overall && b.overall.score, delta: a.overall && b.overall && a.overall.score !== null && b.overall.score !== null ? b.overall.score - a.overall.score : null } },
      warnings: {
        added: Array.from(wb).filter((id) => !wa.has(id)),
        removed: Array.from(wa).filter((id) => !wb.has(id)),
        common: Array.from(wa).filter((id) => wb.has(id)),
      },
      counts,
      params,
    };
  }

  root.BrowserRisk = {
    VERSION,
    SCHEMA,
    SERVER_HEADERS,
    DEFAULT_WEIGHTS,
    WEAK_CAP,
    collectClient,
    analyzeClient,
    analyzeServer,
    score,
    levelOf,
    buildReport,
    run,
    compareReports,
    parseUserAgent,
    parseClientHintBrands,
    lastReport: null,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
