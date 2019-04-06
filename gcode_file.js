const ReadLine = require('readline');
const fs = require('fs');

// API
module.exports = {
  split,
  load,
  save,
  lineFromCommand,
  linesFromCommands
};

function split(gcodes) {
  let ret = [];
  _split(gcodes, ret);
  return ret;
}

function _split(gcodes, addTo) {
  if (Array.isArray(gcodes)) {
    gcodes.forEach(gcode => _split(gcode, addTo));
  } else if (typeof gcodes == 'string') {
    gcodes = gcodes.split('\n').filter(gcode => gcode.length);
    if (gcodes.length != 1) {
      _split(gcodes, addTo);
      return;
    }
    addTo.push(gcodes[0]);
  }
}

function load({ filename, oncommand, onend }) {
  return new Promise(resolve => {
    var lineReader = ReadLine.createInterface({
      input: fs.createReadStream(filename)
    });

    if (onend) {
      lineReader.once('close', function(line) {
        onend();
        resolve();
      });
    }

    const modalState = {};
    lineReader.on('line', function(line) {
      oncommand(commandFromLine(line, modalState));
    });
  });
}

function commandFromLine(line, modalState) {
  let match = /^\s*(;.*|%.*|\([^)]*\))?(([A-Z]-?\d+(?:\.\d+)?)([^;]*))?$/.exec(line);
  if (!match) throw new Error(`Could not parse gcode line: ${line}`);
  let commandType = match[3],
    args = match[4],
    comment = match[1];
  if (!match[2]) {
    return {
      string: match[0],
      comment: comment || ''
    };
  }

  if (match[2].startsWith('G') || match[2].startsWith('M')) {
    modalState.command = commandType;
  } else {
    if (!modalState.command) {
      throw new Error(`Line has no command: ${match[1]}`);
    }
    commandType = modalState.command;
    comment = undefined;
    args = line;
  }

  const command = {
    string: match[0],
    comment: comment || '',
    command: commandType,
    params: {}
  };
  let paramMatch;
  const regex = /\s*(([A-Z])(-?\d+(?:\.\d+)?)|[^\s]+)/g;
  let hasGorM;
  while ((paramMatch = regex.exec(args))) {
    if (paramMatch[2]) {
      if (paramMatch[2] == 'G' || paramMatch[2] == 'M') {
        if (hasGorM) {
          throw new Error(`Line has two or more G or M commands: ${line}`);
        }
        hasGorM = true;
      }
      command.params[paramMatch[2].toLowerCase()] = +paramMatch[3];
    } else {
      throw new Error(`Could not parse args for command ${line}`);
    }
  }
  return command;
}

function save({ filename }) {
  return new Promise(resolve => {
    const stream = fs.createWriteStream(filename);
    stream.once('open', function(fd) {
      resolve({
        oncommand: command => stream.write(`${lineFromCommand(command)}\n`),
        onend: () => stream.end()
      });
    });
  });
}

function linesFromCommands() {
  let ret = '';
  Array.prototype.forEach.call(arguments, command => {
    if (Array.isArray(command)) ret += linesFromCommands(...command);
    else if (typeof command == 'object') ret += lineFromCommand(command) + '\n';
  });
  return ret;
}

function lineFromCommand(command) {
  let ret = '';
  if (command.command) {
    ret += command.command;
    if (command.params) {
      Object.keys(command.params).forEach(param => {
        const val = command.params[param];
        if (typeof val == 'number' || typeof val == 'string') {
          ret += ` ${param.toUpperCase()}${+(+val).toFixed(4)}`;
        }
      });
    }
  }
  if (command.comment) {
    if (ret) ret += ` ${command.comment}`;
    else ret = command.comment;
  }
  return ret;
}
