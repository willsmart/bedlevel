// API
module.exports = processArgs;

function processArgs() {
  var args = {};
  process.argv.slice(2).forEach(arg => {
    let kv = /([\w-.]+)=(.*)/.exec(arg);
    if (kv) {
      args[kv[1]] = kv[2];
    } else {
      args[arg] = true;
    }
  });
  return args;
}
