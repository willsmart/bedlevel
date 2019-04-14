const WebSocketClient = require('../../web-socket/web-socket-client');
window.ws = new WebSocketClient({ port: 80 });
let sha;
ws.watch({
  callbackKey: 'page',
  onpayload: ({ messageType, payload }) => {
    if (messageType == 'SHA' && payload && payload.sha != sha) {
      if (sha) {
        log('ws', `new SHA: ${payload.sha}, will reload`);
        location.reload(true);
      } else log('ws', `SHA: ${payload.sha}`);
      sha = payload.sha;
    }
  }
});
