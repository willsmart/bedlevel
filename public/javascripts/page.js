const log = require('../../general/log');
const WebSocketClient = require('../../web-socket/web-socket-client');
window.ws = new WebSocketClient({ port: 80 });
let sha;
ws.watch({
  callbackKey: 'page',
  onpayload: ({ messageType, payloadObject }) => {
    if (messageType == 'SHA' && payloadObject && payloadObject.message != sha) {
      const newSha = payloadObject.message;
      if (sha) {
        log('ws', `new SHA: ${newSha}, will reload`);
        location.reload(true);
      } else log('ws', `SHA: ${newSha}`);
      sha = newSha;
    }
  }
});
