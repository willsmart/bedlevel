const
colors = require('colors/safe'),
{ Matrix } = require('ml-matrix');

module.exports = transform;

let settings, robot, prompt, basePrompt;

function transform({ x, y, z }) {
  if (!settings) return;
  const { mat } = settings, xyzw=new Matrix([[x,y,z,1]])
  ({x,y,z}=xyzw.mmul(mat));
  return {x,y,z}
}

transform.name = 'threeDots';

transform.load = async function({ settings: asettings, prompt:aprompt, robot:arobot }) {
  settings = asettings;
  robot = arobot
  basePrompt = aprompt

  await basePrompt.loadPrompt({
    name: transform.name,
    msg: colors.cyan('three-dots:  '),
    fn: '.prompts/three-dots.json'
  });

  prompt = q =>
    basePrompt(typeof q == 'object' ? Object.assign({ name: transform.name }, q) : { q, name: transform.name });
};

transform.configure = async function() {
  const { robot, prompt } = settings;

  const poss = [
    {
      logical: {
        xy: await prompt('What is the position of the first defined point (in mm, as something like "10,40"):')
      },
      physical: {}
    },
    {
      logical: {
        xy: await prompt('What is the position of the second defined point (in mm, as something like "10,40"):')
      },
      physical: {}
    },
    {
      logical: {
        xy: await prompt('What is the position of the third defined point (in mm, as something like "10,40"):')
      },
      physical: {}
    }
  ];
  robot
    .home()
    .goto({ z: 50 })
    .drive('Please drive robot to the first defined pos', poss[0].physical)
    .drive('Please drive robot to the second defined pos', poss[0].physical)
    .drive('Please drive robot to the third defined pos', poss[0].physical);

    const
    {x:lax,y:lay} = poss[0].logical,
    {x:lbx,y:lby} = poss[1].logical,
    {x:lcx,y:lcy} = poss[2].logical,
    lv=(lax*lby - lay*lbx) / (lcx*lay - lax*lby - lcy*lax + lay*lbx),
    lu=(lax-(lcx-lax)*lv)/(lax-lbx),

     {x:ax,y:ay,z:az} = poss[0].physical,
    {x:bx,y:by,z:bz} = poss[1].physical,
    {x:cx,y:cy,z:cz} = poss[2].physical,
   v=(ax*by - ay*bx) / (cx*ay - ax*by - cy*ax + ay*bx),
   u=(ax-(cx-ax)*v)/(ax-bx)

const lm=new Matrix([
  [lbx-lax, lcx-lax, 1, lax],
  [lby-lay, lcy-lay, 1, lay]
])

  const mat = settings.mat || (settings.mat={x:{},y:{},z:{}});


  /*
  0=a.x+u*(b.x-a.x)+v*(c.x-a.x) = a.y+u*(b.y-a.y)+v*(c.y-a.y)
  u=(a.x-(c.x-a.x)*v)/(a.x-b.x)=(a.y-(c.y-a.y)*v)/(a.y-b.y)
  (a.x-(c.x-a.x)*v)*(a.y-b.y)=(a.y-(c.y-a.y)*v)*(a.x-b.x)

  ax.ay-ax.by-cx.v.ay+ax.v.by=ay.ax-ay.bx-cy.v.ax+ay.v.bx
  ax.by - cx.v.ay + ax.v.by = ay.bx - cy.v.ax + ay.v.bx
  v = (ax.by - ay.bx) / (cx.ay - ax.by - cy.ax + ay.bx)



  */

  mat.w.x = ax-
};
