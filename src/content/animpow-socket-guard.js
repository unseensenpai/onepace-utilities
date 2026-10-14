// Runs in the page's own world before AnimPow's scripts, only while the "blockSocket" setting is on
// (the background registers it). The online-user socket gets a stand-in that stays "connecting"
// and its token request never settles, so nothing goes out and the site has no error to retry on.
(() => {
  const SOCKET_HOST = 'online-user-websocket.animpow.com';
  const TOKEN_PATH = '/ws/token';

  const isTokenUrl = (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    return url.host === location.host && url.pathname === TOKEN_PATH;
  };

  class IdleSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.onopen = this.onmessage = this.onerror = this.onclose = null;
    }

    send() {}

    close() {
      this.readyState = 3;
    }
  }

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args, newTarget) {
      if (new URL(String(args[0]), location.href).host === SOCKET_HOST) return new IdleSocket(args[0]);
      return Reflect.construct(target, args, newTarget);
    }
  });

  const nativeFetch = window.fetch;
  window.fetch = function fetch(input, init) {
    if (isTokenUrl(input)) return new Promise(() => {});
    return nativeFetch.call(this, input, init);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.apwBlocked = isTokenUrl(url);
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function send(body) {
    if (this.apwBlocked) return undefined;
    return nativeSend.call(this, body);
  };
})();
