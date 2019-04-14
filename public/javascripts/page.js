const WebSocketClient = require('../../web-socket/web-socket-client');
window.ws = new WebSocketClient({ port: 80 });
let sha;
ws.watch({
  callbackKey: 'page',
  onpayload: ({ messageType, payloadObject }) => {
    if (messageType == 'SHA' && payloadObject != sha) {
      if (sha) {
        log('ws', `new SHA: ${payloadObject}, will reload`);
        location.reload(true);
      } else log('ws', `SHA: ${payloadObject}`);
      sha = payloadObject;
    }
  }
});
