const transforms = {
  threeDots: require('three-dots'),
  gridXY: require('grid-XY'),
  gridZ: require('grid-Z')
};
transformsEntries = Object.entries(transforms);
enabledTransforms = [];

module.exports = transform;

function transform(xyz) {
  for (const [_, transform] of enabledTransforms) if (transform.enabled) transform(xyz); // please export a transform function from individual transform files
}

transform.transforms = transforms;

transform.load = function({ args, prompt, robot, singleton }) {
  enabledTransforms = transformsEntries.filter(([name, transform]) => {
    const settings = singleton[name] || (singleton[name] = {});
    return transform.load({ args, prompt, robot, settings }); // please provide a load member function in individual transform files
  });
};

transform.configure = function({ name }) {
  transform.disable({ name });
  if (transforms[name].configure()) {
    // please provide a configure member function in individual transform files
    transform.enable({ name });
  }
};

transform.enable = function({ name }) {
  transform.disable({ name });
  enabledTransforms.push(transforms[name]);
};

transform.disable = function({ name }) {
  enabledTransforms = enabledTransforms.filter(t => t !== transforms[name]);
};
