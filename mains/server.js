// model_server
// © Will Smart 2018. Licence: MIT

const processArgs = require('../general/process-args');
const WebSocketServer = require('../web-socket/web-socket-server');

(async function() {
  var args = processArgs();

  console.log('Bedlevel server');
  console.log('   args: ' + JSON.stringify(args));

  const wsserver = new WebSocketServer({
    hasPageServer: true,
    pagePath: `${__dirname}/../public`,
    cachePage: args['--cachepage']
  });

  let tick = 0;
  setInterval(() => {
    tick++;
    if (tick < 0) console.log(wsserver, args);
  }, 5000);

  await wsserver.start({ port: +(args.port || 3000) });

  //  console.log(cache, schema, wsserver, datapointDbConnection, connection, args, connectionInfo);
})();
