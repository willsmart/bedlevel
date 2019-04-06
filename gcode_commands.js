const ReadLine = require('readline');
const fs = require('fs');
const lerp = (f, a, b) => (1 - f) * a + f * b;
const delerp = (v, a, b) => (v - a) / (b - a);

const homeCmd = 'G28',
  zprobeCmd = 'G30',
  setPositionCmd = 'G92',
  setBedTempCmd = 'M140',
  setHotendTempCmd = 'M104',
  waitCmd = 'M116',
  rapidMoveCmd = 'G0',
  moveCmd = 'G1',
  disableSteppersCmd = 'M18',
  absoluteCmd = 'G90',
  relativeCmd = 'G91',
  laserPowerCmd = 'M1000',
  laserFeedrateCmd = 'M1001';

const humanToGCode = {
  home: homeCmd,
  zprobe: zprobeCmd,
  setPosition: setPositionCmd,
  setbedtemp: setBedTempCmd,
  sethotendtemp: setHotendTempCmd,
  wait: waitCmd,
  rapidMove: rapidMoveCmd,
  move: moveCmd,
  disableSteppers: disableSteppersCmd,
  absolute: absoluteCmd,
  relative: relativeCmd,
  laserPower: laserPowerCmd,
  laserFeedrate: laserFeedrateCmd,
};

const gcodeToHuman = {};
Object.keys(humanToGCode).forEach(human => (gcodeToHuman[humanToGCode[human]] = human));
for (let i = 0; i <= 9; i++) {
  if (`G${i}` in gcodeToHuman) gcodeToHuman[`G0${i}`] = gcodeToHuman[`G${i}`];
  if (`M${i}` in gcodeToHuman) gcodeToHuman[`M0${i}`] = gcodeToHuman[`M${i}`];
}

gcodeToHuman.G01 = gcodeToHuman.G1;

// API
const GCodeCmds = (module.exports = {
  humanToGCode,
  gcodeToHuman,
  home() {
    return [{ command: homeCmd }];
  },

  disableSteppers({ x, y, z, e } = {}) {
    return [{ command: this.disableSteppersCmd, params: { x, y, z, e } }];
  },

  zprobe({ x, y }) {
    return [{ command: zprobeCmd, params: { s: -1, x, y } }];
  },

  heat({ bed, hotend, wait }) {
    const ret = [];
    if (bed !== undefined) ret.push({ command: setBedTempCmd, params: { s: bed } });
    if (hotend != undefined) ret.push({ command: setHotendTempCmd, params: { s: hotend } });
    if (wait != undefined) ret.push({ command: waitCmd });
    return ret;
  },

  move({ x, y, z, dx, dy, dz, feed, extruder, extrude, laser, state, rapid }) {
    if (state) return statelyMove(arguments[0]);

    const ret = [];
    if (x !== undefined || y !== undefined || z !== undefined || extruder !== undefined) {
      ret.push({
        command: rapid ? rapidMoveCmd : moveCmd,
        params: {
          x,
          y,
          z,
          f: feed,
          r: laser,
          e: extruder,
        },
      });
    }
    if (dx !== undefined || dy !== undefined || dz !== undefined || extrude !== undefined) {
      ret.push({ command: relativeCmd });
      ret.push({
        command: rapid ? rapidMoveCmd : moveCmd,
        params: {
          x: dx,
          y: dy,
          z: dz,
          f: feed,
          r: laser,
          e: extrude,
        },
      });
      ret.push({ command: absoluteCmd });
    }
    return ret;
  },

  laserPower({ power, killAfterMove }) {
    return [
      {
        command: laserPowerCmd,
        params: { r: power, s: killAfterMove == false ? 0 : 1 },
      },
    ];
  },

  laserFeedrateForMaxPower({ feed }) {
    return [
      {
        command: laserFeedrateCmd,
        params: { f: feed },
      },
    ];
  },
});

function statelyMove({ x, y, z, dx, dy, dz, feed, extruder, laser, extrudePerMM, state, rapid }) {
  if (!state) return GCodeCmds.move(arguments[0]);

  let ret = [];

  if (!(state.pos && state.pos.x !== undefined && state.pos.y !== undefined && state.pos.z !== undefined)) {
    state.pos = state.pos || { e: 0 };
    ret.push(
      ...GCodeCmds.move({
        x,
        y,
        z,
        dx,
        dy,
        dz,
        extruder,
        feed,
        laser,
        rapid,
      })
    );
    if (x !== undefined) state.pos.x = x;
    if (y !== undefined) state.pos.y = y;
    if (z !== undefined) state.pos.z = z;
    if (dx !== undefined) state.pos.x += dx;
    if (dy !== undefined) state.pos.y += dy;
    if (dz !== undefined) state.pos.z += dz;
    return ret;
  }

  //console.log(Object.assign({ x, y, z }, state.pos));

  let endPos = {
      x: (x === undefined ? state.pos.x : x) + (dx || 0),
      y: (y === undefined ? state.pos.y : y) + (dy || 0),
      z: (z === undefined ? state.pos.z : z) + (dz || 0),
    },
    dist = Math.sqrt(
      (endPos.x - state.pos.x) * (endPos.x - state.pos.x) +
        (endPos.y - state.pos.y) * (endPos.y - state.pos.y) +
        (endPos.z - state.pos.z) * (endPos.z - state.pos.z)
    );
  endPos.e = extruder !== undefined ? extruder : state.pos.e + (extrudePerMM || 0) * dist;

  if (state.probes && state.probeBelowZ && (state.probeBelowZ > endPos.z || state.probeBelowZ > state.pos.z)) {
    const quantum = state.maxProbedMove || 10;

    if (dist > 0.0001) {
      let newPos = state.pos;
      for (let f = Math.min(quantum, dist); f <= dist; f = Math.min(f + quantum, dist)) {
        newPos = {
          x: lerp(f / dist, state.pos.x, endPos.x),
          y: lerp(f / dist, state.pos.y, endPos.y),
          z: lerp(f / dist, state.pos.z, endPos.z),
          e: lerp(f / dist, state.pos.e, endPos.e),
        };

        const zprobe = getProbez(Object.assign({ state }, newPos));

        ret.push(
          ...GCodeCmds.move({
            x: newPos.x,
            y: newPos.y,
            z: newPos.z - zprobe,
            feed,
            laser,
            rapid,
            extruder: newPos.e,
          })
        );
        if (zprobe) {
          ret[ret.length - 1].comment = ` ; adjusted z from ${newPos.z.toFixed(3)} by ${-zprobe.toFixed(3)}`;
        }
        if (f == dist) break;
      }
      state.pos = newPos;
    } else {
      ret.push(
        ...GCodeCmds.move({
          feed,
          laser,
          extruder: endPos.e,
        })
      );
      state.pos = endPos;
    }
  } else {
    ret.push(
      ...GCodeCmds.move({
        x: endPos.x,
        y: endPos.y,
        z: endPos.z + (state.zOffsetAtTop || 0),
        rapid,
        feed,
        laser,
        extruder: endPos.e,
      })
    );
    if (state.zOffsetAtBottom) {
      ret[ret.length - 1].comment = ` ; adjusted z from ${endPos.z.toFixed(3)} by ${state.zOffsetAtTop.toFixed(3)}`;
    }
    state.pos = endPos;
  }

  return ret;
}

function getProbez({ x, y, z, state }) {
  const ztop = +(state.zOffsetAtTop || 0);
  const zbot = +(state.zOffsetAtBottom || 0);
  if (!state.probes || !state.probeBelowZ || z >= state.probeBelowZ) return -ztop;

  const zoffs = (ztop * z) / state.probeBelowZ + zbot * (1 - z / state.probeBelowZ);

  let near = [null, null, null, null];
  state.probes.forEach(probe => {
    if (probe.z === undefined) return -zoffs;
    if (probe.x <= x) {
      if (probe.y <= y) {
        if (!near[0] || near[0].x < probe.x || near[0].y < probe.y) near[0] = probe;
      } else {
        if (!near[2] || near[2].x < probe.x || near[2].y > probe.y) near[2] = probe;
      }
    } else {
      if (probe.y <= y) {
        if (!near[1] || near[1].x > probe.x || near[1].y < probe.y) near[1] = probe;
      } else {
        if (!near[3] || near[3].x > probe.x || near[3].y > probe.y) near[3] = probe;
      }
    }
  });
  if (!(near[0] && near[1] && near[2] && near[3])) return -zoffs;
  const xf = delerp(x, near[0].x, near[1].x),
    yf = delerp(y, near[0].y, near[2].y);
  return (
    -zoffs + (1 - z / state.probeBelowZ) * lerp(yf, lerp(xf, near[0].z, near[1].z), lerp(xf, near[2].z, near[3].z))
  );
}
