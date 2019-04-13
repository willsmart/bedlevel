const http = require('http');
const url = require('url');

const PublicApi = require('../general/public-api');
const log = require('../general/log');
const Page = require('./page');

// API is auto-generated at the bottom from the public interface of this class

class PageServer {
  // public methods
  static publicMethods() {
    return ['start'];
  }

  constructor({ path, doCache = false }) {
    const pageServer = this;

    Object.assign(pageServer, {
      page: new Page({ path, doCache }),
    });
  }

  async start({ wss, port = 3000 } = {}) {
    const pageServer = this,
      { page } = pageServer;

    const server = (pageServer.server = http.createServer());

    server.on('headers', function(headers, request) {
      if (isPageRequest(request)) return;

      wss.emit('headers', headers, req);
    });

    server.on('upgrade', function upgrade(request, socket, head) {
      if (isPageRequest(request)) return;

      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit('connection', ws, request);
      });
    });

    server.on('request', function upgrade(request, response) {
      if (!isPageRequest(request)) return;

      page.page().then(body => {
        response.write(body);
        response.end();
      });
    });

    server.listen(port);

    log('ws', `Page/WebSocket server listening on port ${port}`);

    function isPageRequest(request) {
      return !/^\/sock($|\?)/.test(url.parse(request.url).pathname);
    }
  }
}

// API is the public facing class
module.exports = PublicApi({
  fromClass: PageServer,
  hasExposedBackDoor: true,
});
