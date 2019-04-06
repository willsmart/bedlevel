const processArgs = require('./process_args');
const fs = require('fs');
const Prompt = require('prompt');
var Robot = require('./robot');
var GCodeFile = require('./gcode_file');
var GCodeCmds = require('./gcode_commands');
const lerp = (f, a, b) => (1 - f) * a + f * b;
const delerp = (v, a, b) => (v - a) / (b - a);

Prompt.start();

let enablePrompt = true;
const prompt = fields => {
  if (typeof fields == 'string') fields = [fields];
  if (!Array.isArray(fields)) fields = ['something'];
  return new Promise((resolve, fail) => {
    if (!enablePrompt) {
      resolve({});
    }
    Prompt.get(fields, (err, result) => {
      if (err) {
        fail(err);
        return;
      }
      resolve(result);
    });
  });
};

// promisify fs.readFile()
fs.readFileAsync = function(filename) {
  return new Promise(function(resolve, reject) {
    try {
      fs.readFile(filename, function(err, buffer) {
        if (err) reject(err);
        else resolve(buffer);
      });
    } catch (err) {
      reject(err);
    }
  });
};
(async function() {
  var args = processArgs();

  if (args.noprompt) enablePrompt = false;

  const app = {
    args: args,
    log: function(level) {
      const appLevel = this.args.loglevel === undefined ? 1 : this.args.loglevel;
      if (level <= appLevel) console.log.apply(console, Array.prototype.slice.call(arguments, 1));
    }
  };

  const dotfn = args.dotfn || 'dots.json';

  const saveDots = () => new Promise(resolve => fs.writeFile(dotfn, JSON.stringify(dots, undefined, 2), resolve));

  if (args.savedots) {
    const maxr = +args.maxr || 50,
      quantum = +args.quantum || 20;
    const rquantums = Math.floor(maxr / quantum);
    let dots = [];
    for (let yi = -rquantums; yi <= rquantums; yi++) {
      for (let xi = -rquantums; xi <= rquantums; xi++) {
        if ((xi * xi + yi * yi) * quantum * quantum > maxr * maxr) continue;
        dots.push({
          x: quantum * xi,
          y: quantum * yi
        });
      }
    }

    await saveDots();
    app.log(1, `Wrote "${dotfn}"`);
  }

  let dots;
  try {
    dots = JSON.parse(await fs.readFileAsync(dotfn));
  } catch (err) {
    app.log(0, err);
    return;
  }

  let gcodeFile = args.gcodein || 'in.gcode';
  if (args.laser) {
    const robotState = {
      isAbsolute: true,
      laserOn: false
    };
    const infn = gcodeFile;
    const outfn = args.gcodeout || 'out.gcode';
    const z = args.z !== undefined ? args.z : 0;
    const feedrateForMaxPower = args.maxpowerf !== undefined ? args.maxpowerf : 50;
    const laserPower = args.laserpower || 1;
    const feedrateMultiple = args.fmul || 1;
    const feedrateMultipleLaserOff = args.fmuloff || feedrateMultiple;
    const xoffset = +args.xoffset || 0;
    const yoffset = +args.yoffset || 0;
    const zoffset = +args.zoffset || 0;
    const zthres = (+args.zthres || 0) + zoffset;
    console.log({ xoffset, yoffset });
    const xmul = +args.xmul || 1;
    const ymul = +args.ymul || 1;
    const zmul = +args.zmul || 1;
    const translateCommand = command => {
      const cmd = GCodeCmds.gcodeToHuman[command.command || ''];
      switch (cmd) {
        case 'absolute':
          robotState.isAbsolute = true;
          break;
        case 'relative':
          robotState.isAbsolute = false;
          break;
        case 'home':
          delete robotState.pos;
          break;
        case 'setPosition':
          robotState.pos = robotState.pos || {
            e: 0
          };
          if (command.params.e !== undefined) robotState.pos.e = command.params.e;
          if (command.params.x !== undefined) robotState.pos.x = command.params.x * xmul + xoffset;
          if (command.params.y !== undefined) robotState.pos.y = command.params.y * ymul + yoffset;
          if (command.params.z !== undefined) robotState.pos.z = command.params.z * zmul + zoffset;
          break;
        case 'rapidMove':
        case 'move':
          if (!robotState.isAbsolute) break;
          const ret = [];
          if (!robotState.homed) {
            ret.push(...GCodeCmds.home());
            robotState.homed = true;
          }
          if (command.params.x != undefined) command.params.x = command.params.x * xmul + xoffset;
          if (command.params.y != undefined) command.params.y = command.params.y * ymul + yoffset;
          if (command.params.z != undefined) command.params.z = command.params.z * zmul + zoffset;
          let laser;
          if (command.params.z != undefined) {
            if (robotState.laserOn) {
              if (command.params.z > zthres) {
                laser = 0;
                robotState.laserOn = false;
                if (command.params.f === undefined) command.params.f = robotState.f;
              }
            } else if (!robotState.laserOn && command.params.z < zthres) {
              if (!robotState.sentFeedrate && feedrateForMaxPower) {
                ret.push(...GCodeCmds.laserFeedrateForMaxPower({ feed: feedrateForMaxPower }));
                robotState.sentFeedrate = true;
              }
              laser = laserPower;
              robotState.laserOn = true;
              if (command.params.f === undefined) command.params.f = robotState.f;
            }
            command.params.z = z;
          }

          if (command.params.f !== undefined) {
            robotState.f = command.params.f;
            command.params.f *= robotState.laserOn ? feedrateMultiple : feedrateMultipleLaserOff;
          }

          ret.push(
            ...GCodeCmds.move({
              x: command.params.x,
              y: command.params.y,
              z: command.params.z,
              laser,
              rapid: cmd == 'rapidMove',
              extruder: command.params.e,
              feed: command.params.f,
              state: robotState
            })
          );
          return ret;
      }
      if (!command.command) {
        return [];
      }
      return [command];
    };
    let it = 0;
    await GCodeFile.save({
      filename: outfn
    }).then(({ oncommand, onend }) => {
      return GCodeFile.load({
        filename: infn,
        oncommand: command => {
          it++;
          if (it % 100 == 0) app.log(3, `Line ${it}`);
          translateCommand(command).forEach(newCommand => oncommand(newCommand));
        },
        onend: onend
      });
    });
    gcodeFile = outfn;
  }

  if (args.adjustgcode) {
    const robotState = {
      isAbsolute: true,
      probeBelowZ: 3,
      probes: args.nodots ? undefined : dots,
      maxProbedMove: 10,
      zOffsetAtTop: +(args.topz || 0),
      zOffsetAtBottom: +(args.botz || 0.1)
    };
    const infn = gcodeFile;
    const outfn = args.gcodeout || 'out.gcode';
    const translateCommand = command => {
      if (args.zoffset && command.params && command.params.z !== undefined) command.params.z += +args.zoffset;
      if (args.fmul && command.params && command.params.f !== undefined) command.params.f *= +args.fmul;
      let cmd = GCodeCmds.gcodeToHuman[command.command || ''];
      switch (cmd) {
        case 'absolute':
          robotState.isAbsolute = true;
          break;
        case 'relative':
          robotState.isAbsolute = false;
          break;
        case 'home':
          delete robotState.pos;
          break;
        case 'setPosition':
          robotState.pos = robotState.pos || {
            e: 0
          };
          if (command.params.e !== undefined) robotState.pos.e = command.params.e;
          if (command.params.x !== undefined) robotState.pos.x = command.params.x;
          if (command.params.y !== undefined) robotState.pos.y = command.params.y;
          if (command.params.z !== undefined) robotState.pos.z = command.params.z;
          break;
        case 'rapidMove':
        case 'move':
          if (!robotState.isAbsolute) break;
          return GCodeCmds.move({
            x: command.params.x,
            y: command.params.y,
            z: command.params.z,
            rapid: cmd == 'rapidMove',
            extruder: command.params.e,
            feed: command.params.f,
            state: robotState
          });
      }
      return [command];
    };
    let it = 0;
    await GCodeFile.save({
      filename: outfn
    }).then(({ oncommand, onend }) => {
      return GCodeFile.load({
        filename: infn,
        oncommand: command => {
          it++;
          if (it % 100 == 0) app.log(3, `Line ${it}`);
          if (it == 1) {
            translateCommand(GCodeCmds.home()[0]).forEach(oncommand);
          }
          translateCommand(command).forEach(oncommand);
        },
        onend: onend
      });
    });
    gcodeFile = outfn;
  }

  const robot = new Robot(app);
  await robot.open();

  robot.probes = dots;
  robot.probeBelowZ = args.probebelowz || 4;

  const bedHeat = args.bedtemp || 90,
    hotendHeat = args.hotendtemp || 240;

  if (args.heat || args.heatbed) {
    app.log(1, `heating bed to ${bedHeat}`);
    const logLevel = args.loglevel || 1;
    if (logLevel < 3) args.loglevel = 3;
    await robot.send(
      GCodeFile.linesFromCommands(
        GCodeCmds.heat({
          bed: bedHeat,
          wait: true
        })
      )
    );
    await robot.wait();
    app.log(1, `done heating bed to ${bedHeat}`);
    args.loglevel = logLevel;
  }

  if (args.heat || args.heathotend || args.retractfilament || args.installfilament) {
    app.log(1, `heating hotend to ${hotendHeat}`);
    const logLevel = args.loglevel || 1;
    if (logLevel < 3) args.loglevel = 3;
    await robot.send(
      GCodeFile.linesFromCommands(
        GCodeCmds.heat({
          hotend: hotendHeat,
          wait: true
        })
      )
    );
    await robot.wait();
    app.log(1, `done heating hotend to ${hotendHeat}`);
    args.loglevel = logLevel;
  }

  if (args.probe) {
    const repeats = +args.repeats || 3,
      discardRepeats = +args.discardrepeats || 1;

    const promises = [];
    dots.forEach(dot => {
      dot.zs = dot.zs || [];

      for (let repeat = repeats; repeat > dot.zs.length; repeat--) {
        promises.push(
          robot.zprobe(dot).then(_dot => {
            dot.zs.push(_dot.z);
            return saveDots();
          })
        );
      }
    });

    await Promise.all(promises);
    await robot.waitForSends();

    dots.forEach(dot => {
      const N = dot.zs.length;
      let av = 0;
      dot.zs.forEach(z => (av += z / N));
      dot.zs.sort((a, b) => Math.abs(a - av) - Math.abs(b - av));
      const zs = dot.zs.filter((z, index) => index < dot.zs.length - discardRepeats);
      dot.z = zs.reduce((prev, z) => {
        return prev + z / zs.length;
      }, 0);
      app.log(3, `dot at ${dot.x}, ${dot.y} = ${dot.z} : ${dot.zs} (used ${zs})`);
    });

    const odotfn = args.odotfn || dotfn;
    await saveDots();
    app.log(1, `Wrote "${odotfn}"`);
    return;
  }

  if (args.run) {
    app.log(1, `Running gcode`);
    commands = [];

    const robotState = {
      isAbsolute: true,
      lastX: 0,
      lastY: 0
    };

    const adjust = ['adjust', 'xoffset', 'yoffset', 'zoffset', 'xmul', 'ymul', 'zmul', 'fmul', 'xyrot'].find(
      p => p in args
    );

    const fmul = +(args.fmul || 1);
    const xoffset = +(args.xoffset || 0);
    const yoffset = +(args.yoffset || 0);
    const zoffset = +(args.zoffset || 0);
    const xmul = +(args.xmul || 1);
    const ymul = +(args.ymul || 1);
    const zmul = +(args.zmul || 1);
    const xyrot = (+(args.xyrot || 0) * Math.PI) / 180;

    const translateCommand = command => {
      const cmd = GCodeCmds.gcodeToHuman[command.command || ''];
      switch (cmd) {
        case 'absolute':
          robotState.isAbsolute = true;
          break;
        case 'relative':
          robotState.isAbsolute = false;
          break;
        case 'home':
          delete robotState.pos;
          break;
        case 'setPosition':
          robotState.pos = robotState.pos || {
            e: 0
          };
          if (command.params.e !== undefined) robotState.pos.e = command.params.e;
          if (command.params.x !== undefined) robotState.lastX = +command.params.x;
          if (command.params.y !== undefined) robotState.lastY = +command.params.y;
          if ((command.params.x !== undefined || command.params.y !== undefined) && xyrot) {
            const x = +('x' in command.params ? command.params.x : robotState.isAbsolute ? robotState.lastX : 0),
              y = +('y' in command.params ? command.params.y : robotState.isAbsolute ? robotState.lastY : 0);
            console.log({ p: command.params, x, y, xyrot });
            command.params.x = Math.cos(xyrot) * x + Math.sin(xyrot) * y;
            command.params.y = Math.cos(xyrot) * y - Math.sin(xyrot) * x;
            console.log(command.params);
          }
          if (command.params.y !== undefined) robotState.pos.y = command.params.y * ymul + yoffset;
          if (command.params.x !== undefined) robotState.pos.x = command.params.x * xmul + xoffset;
          if (command.params.y !== undefined) robotState.pos.y = command.params.y * ymul + yoffset;
          if (command.params.z !== undefined) robotState.pos.z = command.params.z * zmul + zoffset;
          break;
        case 'rapidMove':
        case 'move':
          if (!robotState.isAbsolute) break;
          const ret = [];
          if (!robotState.homed) {
            ret.push(...GCodeCmds.home());
            robotState.homed = true;
          }
          if (command.params.x !== undefined) robotState.lastX = +command.params.x;
          if (command.params.y !== undefined) robotState.lastY = +command.params.y;
          if ((command.params.x !== undefined || command.params.y !== undefined) && xyrot) {
            const x = +('x' in command.params ? command.params.x : robotState.isAbsolute ? robotState.lastX : 0),
              y = +('y' in command.params ? command.params.y : robotState.isAbsolute ? robotState.lastY : 0);
            console.log({ p: command.params, x, y, xyrot });
            command.params.x = Math.cos(xyrot) * x + Math.sin(xyrot) * y;
            command.params.y = Math.cos(xyrot) * y - Math.sin(xyrot) * x;
            console.log(command.params);
          }
          if (command.params.x != undefined) command.params.x = command.params.x * xmul + xoffset;
          if (command.params.y != undefined) command.params.y = command.params.y * ymul + yoffset;
          if (command.params.z != undefined) command.params.z = command.params.z * zmul + zoffset;
          if (command.params.f !== undefined) command.params.f *= fmul;

          ret.push(
            ...GCodeCmds.move({
              x: command.params.x,
              y: command.params.y,
              z: command.params.z,
              rapid: cmd == 'rapidMove',
              extruder: command.params.e,
              feed: command.params.f,
              state: robotState
            })
          );
          return ret;
      }
      if (!command.command) {
        return [];
      }
      return [command];
    };

    await GCodeFile.load({
      filename: gcodeFile,
      oncommand: command => {
        if (adjust) translateCommand(command).forEach(command => commands.push(command));
        else commands.push(command);
      },
      onend: () => {}
    });
    let it = 0;
    for (const command of commands) {
      it++;
      await robot.sendCommands(command, (it * 100.0) / commands.length);
    }
    await robot.waitForSends();
  }

  if (args.lay) {
    const maxr = args.maxr || 50,
      startr = args.startr || 10,
      feed = args.feed || 200,
      stride = args.stride || 10,
      speed = args.speed || 200,
      extrudePerMM = args.extruderate || 0;
    const startz = args.startz || 1,
      endz = args.endz || 1;
    for (let r = startr; r < maxr; r += stride / 20) {
      const rf = delerp(r, startr, maxr);
      const ang = ((r - startr) / stride - Math.floor((r - startr) / stride)) * Math.PI * 2;
      await robot.move({
        x: r * Math.sin(ang),
        y: r * Math.cos(ang),
        z: lerp(rf, startz, endz),
        extrudePerMM: extrudePerMM,
        feed: speed
      });
    }
    await robot.wait();
  }

  const plugExtrudeLength = 20,
    bowdenLength = 780,
    fastExtrudeFeedrate = 4000,
    extrudeFeedrate = 200;
  if (args.retractfilament)
    try {
      console.log('Please pull out the tube and press enter');
      await robot.waitForSends();
      await prompt('enter');

      await robot.move({
        extrude: plugExtrudeLength,
        feed: fastExtrudeFeedrate
      });

      await robot.waitForSends();
      console.log('Please cut off the plug and press enter');
      await prompt('enter');

      await robot.move({
        extrude: -(plugExtrudeLength + bowdenLength),
        feed: fastExtrudeFeedrate
      });
      await robot.disableSteppers();
    } catch (err) {
      console.log('Quit');
    }

  if (args.installfilament)
    try {
      console.log('Please place the new filament through the coldend path and press enter');
      await prompt('enter');

      await robot.move({
        extrude: bowdenLength,
        feed: fastExtrudeFeedrate
      });

      while (true) {
        await robot.disableSteppers();
        console.log("Enter 'n' to quit");
        await robot.waitForSends();
        if ((await prompt('continue')).continue == 'n') break;
        await robot.move({
          extrude: 10,
          feed: extrudeFeedrate
        });
      }
    } catch (err) {
      console.log('Quit');
    }

  if (args.heatoff) {
    await robot.waitForSends();
    app.log(1, `turning off heaters`);
    await robot.send(
      GCodeFile.linesFromCommands(
        GCodeCmds.heat({
          hotend: 0,
          bed: 0
        })
      )
    );
  }

  await robot.disableSteppers();
  if (!args.noclose) {
    await robot.close();
  }
})();
