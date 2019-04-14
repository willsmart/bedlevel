const WebSocket = require('isomorphic-ws');
const PublicApi = require('../general/public-api');
const makeClassWatchable = require('../general/watchable');
const log = require('../general/log');

// API is auto-generated at the bottom from the public interface of this class

class WebSocketClient {
  // public methods
  static publicMethods() {
    return ['sendMessage', 'sendPayload', 'isOpen', 'watch', 'stopWatching'];
  }

  constructor({ port = 3000 } = {}) {
    const client = this;

    window.sendWSMessage = function(message) {
      client.sendMessage({ message });
    };

    client._isOpen = false;
    client.nextMessageIndex = 1;
    client.clientParams = {
      port: port
    };

    function open() {
      const host =
        window.location.protocol == 'https:'
          ? `wss://sock.${window.location.host}`
          : `ws://${window.location.hostname}:${port}`;
      const ws = (client.ws = new WebSocket(
        `${host}/sock${client.phoenix ? `?phoenix=${encodeURIComponent(client.phoenix)}` : ''}`
      ));
      delete client.phoenix;
      ws.onopen = function open() {
        client._isOpen = true;
        client.notifyListeners('onopen');

        (client.pongHistory = [0, 0, 0, 1]), (client.pongCount = 1);
      };

      ws.onclose = function close() {
        clearInterval(ws.pingInterval);
        client._isOpen = false;
        client.notifyListeners('onclose');
        delete client.intentionalClose;
        setTimeout(() => open(), client.intentionalClose ? 100 : 2000);
      };

      if (ws.on) {
        ws.on('pong', () => {
          ws.pongHistory[ws.pongHistory.length - 1]++;
          ws.pongCount++;
        });
      }

      ws.onmessage = function incoming(message) {
        let match = /^Phoenix:(.*)$/.exec(message.data);
        if (match) {
          client.phoenix = JSON.parse(match[1]);
          client.intentionalClose = true;
          ws.close();
          return;
        }

        performance.mark('receive');
        log('ws', 'WS>I> Got message from server:   ' + message.data);

        client.notifyListeners(
          'onpayload',
          WebSocketClient.decodeMessage({
            message: message.data
          })
        );
      };

      ws.onerror = err => {
        log('err', `WS>!> Error: ${err.message}`);
      };

      if (ws.ping) {
        ws.pingInterval = setInterval(function ping() {
          if (!ws.pongCount) {
            client.intentionalClose = true;
            return ws.close();
          }

          ws.pongHistory.push(0);
          clwsient.pongCount -= ws.pongHistory.shift();

          ws.ping('', false, true);
        }, 10000);
      }
    }
    open();

    log('ws', `WS>L> Web socket client listening to server on port ${port}`);
  }

  get isOpen() {
    return this._isOpen;
  }

  static decodeMessage({ message }) {
    const matches = /^(?:(\d+)|(\w+)):/.exec(message),
      messageIndex = matches && matches[1] !== undefined ? +matches[1] : -1,
      messageType = matches && matches[2] !== undefined ? matches[2] : undefined;
    if (matches) message = message.substring(matches[0].length);

    let payloadObject;
    try {
      payloadObject = JSON.parse(message);
    } catch (err) {
      payloadObject = message;
    }
    if (Array.isArray(payloadObject)) {
      payloadObject = {
        array: payloadObject
      };
    } else if (!payloadObject || typeof payloadObject != 'object') {
      payloadObject = {
        message: `${payloadObject}`
      };
    }

    return {
      messageIndex,
      messageType,
      payloadObject
    };
  }
  get cache() {
    return this._cache;
  }

  sendMessage({ message }) {
    this.sendPayload(
      WebSocketClient.decodeMessage({
        message
      })
    );
  }

  sendPayload({ messageIndex = -1, messageType, payloadObject = {} }) {
    const client = this;

    if (!client.isOpen) return;

    if (messageIndex == -1 && !messageType) messageIndex = client.nextMessageIndex++;
    const message = `${
      messageIndex == -1 ? (messageType ? `${messageType}:` : '') : `${messageIndex}:`
    }${JSON.stringify(payloadObject)}`;
    performance.mark('send');
    log('ws', 'WS>O> Sending message to server:   ' + message);

    client.ws.send(message);
  }
}

makeClassWatchable(WebSocketClient);

// API is the public facing class
module.exports = PublicApi({
  fromClass: WebSocketClient,
  hasExposedBackDoor: true
});
