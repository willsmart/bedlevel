const fs = require('fs');
const util = require('util');
const { promisify } = util;

const log = require('../general/log');
const PublicApi = require('../general/public-api');

const exec = util.promisify(require('child_process').exec);
const readFile_p = promisify(fs.readFile);

// API is auto-generated at the bottom from the public interface of the Page class

async function execScss(scssFilename) {
  const cssFilename = `${scssFilename}.css`;
  log('page', `scss "${scssFilename}" "${cssFilename}"`);
  const { _stdout, stderr, error } = await exec(`scss "${scssFilename}" "${cssFilename}"`);
  //if (stdout.length) console.log(stdout);
  if (stderr.length) console.log(stderr);
  if (error) return;
  return await readFile_p(cssFilename, 'utf8');
}

async function execJs({ jsPaths, tmpOutputPath }) {
  log('page', `js "${jsPaths.join('", "')}"`);
  const { _stdout, stderr, error } = await exec(`browserify '${jsPaths.join("', '")}' -o '${tmpOutputPath}'`);
  //if (stdout.length) console.log(stdout);
  if (stderr.length) console.log(stderr);
  if (error) return;
  return await readFile_p(tmpOutputPath, 'utf8');
}

class Page {
  // public methods
  static publicMethods() {
    return ['page'];
  }

  constructor({ path, doCache = false } = {}) {
    const page = this;
    path = path || '.';
    page.doCache = doCache;
    if (fs.existsSync(`${path}/html`)) {
      page.htmlDir = fs.realpathSync(`${path}/html`);
    }
    if (fs.existsSync(`${path}/javascripts`)) {
      page.jsDir = fs.realpathSync(`${path}/javascripts`);
    }
    if (fs.existsSync(`${path}/stylesheets`)) {
      page.cssDir = fs.realpathSync(`${path}/stylesheets`);
    }
  }

  get pageTemplate() {
    const page = this,
      { _pageTemplate } = page,
      { htmlDir } = page;
    if (_pageTemplate) return _pageTemplate;
    if (!htmlDir) return;
    const filename = `${htmlDir}/page.html`;
    if (!fs.existsSync(`${filename}`)) return;

    const ret = fs.readFileSync(filename, 'utf8');
    if (page.doCache) page._pageTemplate = ret;
    return ret;
  }

  async filePathsForTypes(dir, types) {
    if (!dir) return [];
    return Promise.all(
      fs
        .readdirSync(dir)
        .sort()
        .map(filename => {
          for (const { regex } of Object.values(types)) {
            if (regex.test(filename)) {
              return `${dir}/${filename}`;
            }
          }
        })
        .filter(path => path)
    );
  }

  async fileContentsForTypes(dir, types) {
    if (!dir) return [];
    return Promise.all(
      fs
        .readdirSync(dir)
        .sort()
        .map(filename => {
          for (const { regex, filter } of Object.values(types)) {
            if (regex.test(filename)) {
              const path = `${dir}/${filename}`;
              const body = fs.readFileSync(path, 'utf8');
              return filter ? filter(body, path) : body;
            }
          }
        })
        .filter(body => body)
    );
  }

  async jsBody() {
    const page = this;
    const jsPaths = await page.filePathsForTypes(page.jsDir, {
      js: { regex: /\.js$/ }
    });
    return `<script>${await execJs({ jsPaths, tmpOutputPath: `${page.jsDir}/tmp.js.browserified` })}</script>`;
  }

  async cssBody() {
    const page = this;
    const bodies = await page.fileContentsForTypes(page.cssDir, {
      css: { regex: /(?<!\.scss)\.css$/ },
      scss: { regex: /\.scss$/, filter: (_body, filename) => execScss(filename) }
    });
    return bodies.map(body => `<style>${body}</style>`).join('\n');
  }

  async page() {
    const page = this,
      { _pageBody } = this;

    if (_pageBody) return _pageBody;

    let { pageTemplate } = page;
    if (!pageTemplate) return;

    const endOfHeadIndex = /<\/head>/i.exec(pageTemplate).index;
    if (endOfHeadIndex == -1) return;

    const cssBody = await page.cssBody(),
      jsBody = await page.jsBody();

    let ret = pageTemplate.substring(0, endOfHeadIndex) + cssBody + pageTemplate.substring(endOfHeadIndex);

    const endOfBodyIndex = /<\/body>/i.exec(ret).index;
    if (endOfBodyIndex == -1) return;
    ret = ret.substring(0, endOfBodyIndex) + jsBody + ret.substring(endOfBodyIndex);

    if (page.doCache) page._pageBody = ret;
    return ret;
  }
}

// API is the public facing class
module.exports = PublicApi({
  fromClass: Page,
  hasExposedBackDoor: true
});
