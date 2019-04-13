// page-dump
// © Will Smart 2018. Licence: MIT
//
// simply dumps the static webpage, which includes the js code and stylesheets

const util = require('util');

const processArgs = require('../general/process-args');
const Page = require('../page/page');

const exec = util.promisify(require('child_process').exec);

async function execCommand(cmd) {
  const { _stdout, stderr, error } = await exec(cmd);
  if (stderr.length) {
    console.error(stderr);
    return false;
  }
  return true;
}

(async function() {
  var args = processArgs();

  const path = args.path || '.';

  if (!(await execCommand(`${path}/bin/bundle-client`))) {
    process.exit(1);
  }

  const page = new Page({ path });
  console.log(await page.page());
})();
