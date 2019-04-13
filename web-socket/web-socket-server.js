const WebSocket = require('ws');
const { URL } = require('url');
const MyCrypto = require('../general/mycrypto');
const Cookie = require('cookie');
const PageServer = require('../page/page-server');
const PublicApi = require('../general/public-api');
const makeClassWatchable = require('../general/watchable');
const log = require('../general/log');

// API is auto-generated at the bottom from the public interface of this class

class WebSocketServer {
  // public methods
  static publicMethods() {
    return ['start', 'cache', 'watch', 'stopWatching'];
  }

  constructor({ hasPageServer, pagePath, cachePage = false }) {
    const server = this;

    if (hasPageServer) {
      server.pageServer = new PageServer({ path: pagePath, doCache: cachePage });
    }
  }

  get cache() {
    return this._cache;
  }

  get schema() {
    return this._schema;
  }

  get dbConnection() {
    return this._dbConnection;
  }

  get sessionCookieName() {
    return `_${this.appCookiePrefix}_session`;
  }

  decryptedSession(encSession) {
    const server = this,
      sessionString = encSession ? MyCrypto.decrypt(encSession, 'session') : '{}';
    try {
      const ret = JSON.parse(sessionString);
      return ret && typeof ret == 'object' ? ret : {};
    } catch (err) {
      return {};
    }
  }

  encryptedSession(session) {
    const server = this,
      sessionCookie = JSON.stringify(session || {});
    return MyCrypto.encrypt(sessionCookie, 'session');
  }

  decryptedPhoenixUserId(encPhoenix) {
    return encPhoenix ? +MyCrypto.decrypt(encPhoenix, 'phoenix') : undefined;
  }

  encryptedPhoenixUserId(userId) {
    return MyCrypto.encrypt(`${userId}`, 'phoenix');
  }

  async start({ port = 3000 } = {}) {
    const server = this,
      { pageServer } = server;

    server.appCookiePrefix = 'bedlevel';

    if (pageServer) {
      server.wss = new WebSocket.Server({
        noServer: Boolean(pageServer)
      });

      pageServer.start({
        wss: server.wss,
        port: port
      });
    } else {
      server.wss = new WebSocket.Server({
        port: port
      });
    }

    var nextWsIndex = 1;

    function processSession(req) {
      const cookies = Cookie.parse(req.headers.cookie || ''),
        session = server.decryptedSession(cookies[server.sessionCookieName]),
        searchParams = new URL(req.url, 'http://localhost').searchParams,
        encPhoenix = searchParams.get('phoenix');

      if (encPhoenix) {
        if (encPhoenix == 'out') {
          delete session.user;
        } else {
          const phoenixUserId = server.decryptedPhoenixUserId(encPhoenix);
          session.user = { id: phoenixUserId };
        }
      }

      return { session, sessionChanged: !!encPhoenix };
    }

    server.wss.on('headers', function(headers, req) {
      const { session, sessionChanged } = processSession(req);
      if (sessionChanged) {
        headers.push(
          'Set-Cookie: ' +
            Cookie.serialize(server.sessionCookieName, String(server.encryptedSession(session)), {
              maxAge: 60 * 60 * 24 * 7 // 1 week
            })
        );
      }
    });

    server.wss.on('connection', function connection(ws, req) {
      (ws.pongHistory = [0, 0, 0, 1]), (ws.pongCount = 1);

      const { session } = processSession(req);
      log('ws', `Session: ${JSON.stringify(session)}`);

      var client = new WebSocketClient({
        server,
        session,
        ws,
        index: nextWsIndex++,
        userId: session.user ? session.user.id : undefined
      });

      server.notifyListeners('onclientConnected', client);

      ws.on('pong', () => {
        ws.pongHistory[ws.pongHistory.length - 1]++;
        ws.pongCount++;
      });

      ws.on('message', function incoming(message) {
        client.serverReceivedMessage(message);
      });

      ws.on('close', function close() {
        client.closed();
      });

      ws.on('error', () => log('err', 'errored'));
    });

    const interval = setInterval(function ping() {
      server.wss.clients.forEach(function each(ws) {
        if (!ws.pongCount) {
          return ws.terminate();
        }

        ws.pongHistory.push(0);
        ws.pongCount -= ws.pongHistory.shift();

        ws.ping('', false, true);
      });
    }, 10000);

    log('ws', `Web socket server listening on port ${port}`);
  }
}

class WebSocketClient {
  constructor({ server, session, ws, index, userId }) {
    const client = this;

    client.server = server;
    client.session = session;
    client.ws = ws;
    client.index = index;
    client.userId = userId;
  }

  serverReceivedMessage(message) {
    const client = this;

    log('ws', 'Received message from client #' + client.index + ':   ' + message);

    const matches = /^(?:(\d+)|(\w+)):/.exec(message),
      messageIndex = matches ? +matches[1] : -1,
      messageType = matches ? matches[2] : undefined;
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

    if (messageType == 'signin') {
      setTimeout(() => {
        client.sendPayload({
          messageType: 'Phoenix',
          payloadObject: client.server.encryptedPhoenixUserId(1)
        });
      }, 100);
    }

    client.notifyListeners('onpayload', {
      messageIndex,
      messageType,
      payloadObject,
      userId: client.userId
    });
  }

  closed() {
    const client = this;
    const server = client.server;

    log('ws', 'Client #' + client.index + ' closed');

    client.notifyListeners('onclose');
  }

  sendPayload({ messageIndex = -1, messageType, payloadObject }) {
    const client = this;

    const message = `${
      messageIndex == -1 ? (messageType ? `${messageType}:` : '') : `${messageIndex}:`
    }${JSON.stringify(payloadObject)}`;
    log('ws', 'Sending message to client #' + client.index + ':   ' + message);

    client.ws.send(message);
  }
}

makeClassWatchable(WebSocketClient);
makeClassWatchable(WebSocketServer);

// API is the public facing class
module.exports = PublicApi({
  fromClass: WebSocketServer,
  hasExposedBackDoor: true
});
