export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Hilangkan prefix /ttsaveig dari path, biar asset handler
    // nyari file relatif ke root folder ini (index.html, script.js, dll)
    url.pathname = url.pathname.replace(/^\/ttsaveig\/?/, '/') || '/';

    return env.ASSETS.fetch(new Request(url, request));
  }
};
