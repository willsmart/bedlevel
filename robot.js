const SerialPort = require('serialport');
const delay = require('./delay');
const GCodeFile = require('./gcode_file');
const GCodeCmds = require('./gcode_commands');

class Robot {
  constructor(app) {
    this.app = app;
  }

  async open() {
    const robot = this;

    this.queuedSends = [];
    this.outstandingSends = 0;
    this.maxOutstandingSends = 1;
    this.outstandingZprobes = [];
    this.doneResolves = [];
    this.doneSendsResolves = [];

    if (robot.serialPort) return;

    const list = await SerialPort.list();
    console.log(JSON.stringify(list.map(v => v.comName)));
    let port = list.reduce(
      (prev, port) => (/usbmodem/.test(port.comName) || /^ttyACM/.test(port.comName) ? port.comName : prev),
      false
    );
    if (!port) throw new Error('No usbmodem port found');
    robot.app.log(1, `Opening robot on port ${port}`);
    await new Promise(resolve => {
      robot.serialPort = new SerialPort(
        port,
        {
          baudRate: 250000
        },
        resolve
      );
      robot.serialPort.flush(() => {
        robot.parser = robot.serialPort.pipe(new SerialPort.parsers.Readline());
        robot.parser.on('data', data => robot.ondata(data));
      });
      return;
    }).then(() => delay(1000));
  }
  close() {
    const robot = this;

    if (!robot.serialPort) return;

    robot.app.log(1, 'Closing robot');
    return new Promise(resolve => robot.serialPort.close(resolve));
  }

  async move() {
    return this.sendCommands(GCodeCmds.move(arguments[0]));
  }

  async disableSteppers() {
    return this.sendCommands(GCodeCmds.disableSteppers(arguments[0]));
  }

  async waitForAllMoves() {
    return this.sendCommands(GCodeCmds.waitForAllMoves());
  }

  async finish() {
    await this.waitForAllMoves();
    await this.wait();
    await this.disableSteppers();
  }

  async home() {
    return this.sendCommands(GCodeCmds.home());
  }

  async sendCommands(commands, { pcnt, processGCode } = {}) {
    const robot = this;

    return robot.send(GCodeFile.linesFromCommands(commands), { pcnt, processGCode });
  }

  async send(gcode, { pcnt, processGCode } = {}) {
    const robot = this;

    if (!robot.serialPort) return;

    const gcodes = GCodeFile.split(gcode);
    let ret = false;
    gcodes.forEach(gcode => {
      gcode = gcode.trim();
      if (gcode.startsWith(';')) return;

      if (robot.outstandingSends < robot.maxOutstandingSends) {
        robot.app.log(2, `>>>${pcnt ? ` (${pcnt}%)` : ''} "${gcode}"`);
        if (processGCode && !(gcode = processGCode(gcode))) return;
        robot.serialPort.write(gcode + '\n');
        robot.outstandingSends++;
        ret = true;
      } else {
        robot.queuedSends.push({ gcode, pcnt, processGCode });
      }
    });
    if (!ret) return;
    return new Promise(resolve => robot.serialPort.drain(resolve));
  }

  wait() {
    const robot = this;

    return new Promise(resolve => robot.doneResolves.push(resolve));
  }

  waitForSends() {
    const robot = this;

    if (!this.outstandingSends) return Promise.resolve();
    return new Promise(resolve => robot.doneSendsResolves.push(resolve));
  }

  ondata(data) {
    const robot = this;

    if (data.endsWith('\r')) data = data.substring(0, data.length - 1);
    switch (data) {
      case 'ok':
        robot.app.log(4, `--- "${data}"`);

        let didWrite = false;
        if (--robot.outstandingSends < robot.maxOutstandingSends) {
          let info = robot.queuedSends.shift();
          if (info) {
            let { gcode, pcnt, processGCode } = info;
            robot.app.log(2, `>>>${pcnt ? ` (${pcnt}%)` : ''} "${gcode}"`);
            if (processGCode && !(gcode = processGCode(gcode))) return;
            robot.serialPort.write(gcode + '\n');
            robot.outstandingSends++;
            didWrite = true;
          } else {
            let resolve;
            while ((resolve = robot.doneSendsResolves.shift())) {
              resolve();
            }
          }
        }
        if (didWrite) robot.serialPort.drain();
        break;
      case 'wait':
        robot.app.log(4, `--- "${data}"`);

        let resolve;
        while ((resolve = robot.doneResolves.shift())) {
          resolve();
        }
        break;
      default:
        if (robot.outstandingZprobes.length) {
          const match = /^PROBE-ZOFFSET:(-?\d+(?:\.\d*)?)$/.exec(data);
          if (match) {
            let zprobe = robot.outstandingZprobes.shift();

            zprobe.z = +match[1];
            robot.app.log(1, `--- Zprobe @ X${zprobe.x} Y${zprobe.y} -> Z${zprobe.z}`);

            const resolve = zprobe.resolve;
            if (resolve) {
              delete zprobe.resolve;
              resolve(zprobe);
            }
            return;
          }
        }

        robot.app.log(3, `--- "${data}"`);
    }
  }

  zprobe({ x, y }) {
    const robot = this;

    x = x || 0;
    y = y || 0;

    return new Promise(resolve => {
      this.outstandingZprobes.push({
        x: x,
        y: y,
        resolve
      });
      robot.send(
        GCodeFile.linesFromCommands(
          ...GCodeCmds.home(),
          ...GCodeCmds.move({
            dz: -100
          }),
          ...GCodeCmds.zprobe({
            x: x,
            y: y
          })
        )
      );
    });
  }
}

// API
module.exports = Robot;
